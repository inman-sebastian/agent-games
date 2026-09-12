// index.ts — the DELVE game client: the glue that turns the pure sim (engine) and the shared
// renderers (cave-render / ore-art / sprites / lighting) into a playable game. It owns only what
// isn't a rule: the canvas + camera, the game loop, input, audio, juice (particles/floaties/
// shake), the HUD/inventory/codex DOM, and save/load. Every world and gameplay rule is imported —
// never re-implemented here — so the game, the labs, and the tools all obey one ruleset.
import * as engine from '@delve/shared';
import type {
  Session,
  Input,
  TileCoord,
  SimEvent,
  StateMessage,
  ClientCommand,
} from '@delve/shared';
import { T, setStrata as setRenderStrata, composeBand, mix, hashXY } from './render/cave-render';
import { UPSCALE } from './render/palette';
import { ORE_ART, SHAPES } from './render/ore-art';
import { oreMaterial, collectTwinkleEdges, drawDamage } from './render/materials';
import type { Pen } from '@delve/shared';
import { drawPlayer, poseFor } from './render/entity/player';
import { create as createLighting, LAMP_COLOR } from './render/lighting';
import * as net from './net';
import { hydrate, load, save, fresh } from './save';
import { buildInventoryRows } from './ui/inventory';

// ---- display + world-view geometry ------------------------------------------------------
// Art is authored at T=16 logical px per tile (a fine, Terraria-ish grid). It renders at logical
// resolution, then DISPLAYS at TILE_PX CSS px per tile with image-rendering:pixelated — so a tile
// "looks like" TILE_PX on screen while the art stays 16px. 32px is a clean 2× integer scale.
const TILE_PX = T * UPSCALE; // on-screen size of a tile (CSS px) — the art grid, shared with the UI
// The world is unbounded in every direction, so the canvas is a VIEWPORT onto it: a 2-axis camera
// keeps the miner centred and we render only the visible tile window. Sized by fit().
let VIEW_COLS = 21;
let VIEW_ROWS = 15;
let LW = VIEW_COLS * T;
let LH = VIEW_ROWS * T;
// Cached rock CHUNK size (tiles) + a shading-context margin so chunk seams are invisible.
const CW = 12;
const CH = 6;
const MARGIN = 1;
const CAMERA_LERP = 0.16; // per-frame fraction the camera closes on its target (smooth follow)
const CHUNK_CACHE_LIMIT = 400; // start evicting far chunks once the cache grows past this
const CHUNK_EVICT_MARGIN = 12; // keep chunks within this many chunk-cells of the view

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// Scratch buffer: renders one chunk (+margin) at a time when baking rock; also reused for the
// small per-dig patch window (always ≤ a chunk, so it fits).
const fieldBuf = document.createElement('canvas');
fieldBuf.width = (CW + 2 * MARGIN) * T;
fieldBuf.height = (CH + 2 * MARGIN) * T;
const lb = fieldBuf.getContext('2d')!;
lb.imageSmoothingEnabled = false;

// ---- state / persistence ----------------------------------------------------------------
// hydrate/load/save + save-format migration live in ./save (extracted so they're testable
// without the game loop). `save(s)` takes the current session since it's no longer a closure.
const SAVE_INTERVAL_MS = 2500;

let s: Session = load() || fresh();
setInterval(() => save(s), SAVE_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save(s);
});

// 2-axis camera (keeps the miner centred). The sim position (s.player.x, s.player.y) is continuous and smooth
// from the physics step, so the camera follows it directly.
let camX = 0;
let camY = 0;
function snapCam(): void {
  camX = s.player.x * T - LW / 2 + T / 2;
  camY = s.player.y * T - LH / 2 + T / 2;
}

// ---- audio (synth) ----------------------------------------------------------------------
// One AudioContext, unlocked lazily on the first gesture (browsers keep it suspended until
// then). Everything routes through a single master gain so mute is instant and total. Timbres
// follow the design convention: rising pitch = good, noise = friction, low body = heavy.
const MASTER_VOLUME = 0.5;
let AC: AudioContext | null = null;
let muted = false;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (AC) return AC;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    AC = new Ctor();
    master = AC.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(AC.destination);
  } catch {
    AC = null;
  }
  return AC;
}
// A short attack→decay envelope: silence → peak over `attack`, then exponential fall over `decay`.
function env(node: GainNode, gain: number, attack: number, decay: number): void {
  const now = AC!.currentTime;
  node.gain.setValueAtTime(0, now);
  node.gain.linearRampToValueAtTime(gain, now + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}
function tone(
  freq: number,
  attack: number,
  decay: number,
  type: OscillatorType = 'square',
  gain = 0.3,
): void {
  if (!audio() || muted) return;
  const osc = AC!.createOscillator();
  const gainNode = AC!.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gainNode);
  gainNode.connect(master!);
  env(gainNode, gain, attack, decay);
  osc.start();
  osc.stop(AC!.currentTime + attack + decay + 0.02);
}
function noise(duration: number, cutoff: number, gain = 0.4): void {
  if (!audio() || muted) return;
  const source = AC!.createBufferSource();
  const buffer = AC!.createBuffer(1, AC!.sampleRate * duration, AC!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // white noise
  source.buffer = buffer;
  const filter = AC!.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gainNode = AC!.createGain();
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(master!);
  env(gainNode, gain, 0.002, duration);
  source.start();
}
// SFX bank — the frequencies/durations below are a synth coefficient family, tuned by ear.
const sfx = {
  dig(depth: number): void {
    noise(0.06, 800 - Math.min(600, depth * 2), 0.18); // deeper rock reads as duller/lower
  },
  chip(): void {
    noise(0.04, 1200, 0.12);
  },
  // `prize` is NORMALISED rarity, 0 (worthless) .. 1 (the rarest thing in the game) — not a tier
  // index. The tier count is a content decision that changes whenever an ore is added, and reward
  // pitch should not move when it does (#46).
  break(prize: number): void {
    noise(0.12, 500 + prize * 960, 0.4);
  },
  ore(prize: number): void {
    const base = 520 + prize * 720;
    tone(base, 0.005, 0.14, 'triangle', 0.28);
    setTimeout(() => tone(base * 1.5, 0.005, 0.16, 'triangle', 0.22), 60); // a bright rising fifth
  },
  land(impact: number): void {
    noise(0.09, 300 - impact * 130, 0.18 + impact * 0.26); // heavier fall → lower, louder thud
  },
};

// ---- juice (particles / floaties / shake) -----------------------------------------------
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  t: number;
  col: string;
  sz: number;
}
interface Floaty {
  x: number;
  y: number;
  text: string;
  col: string;
  t: number;
  life: number;
  big: boolean;
}
let particles: Particle[] = [];
let floaties: Floaty[] = [];
let shake = 0;
const SHAKE_ENABLED = false; // screen shake disabled for now (flip to re-enable)

// Fine pixel debris: mostly 1px, shaded off the source colour (bright chip / body / dark fleck)
// so it reads as chipped rock, not flat chunky blocks.
function chips(cx: number, cy: number, count: number, col: string, speed = 40): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = (0.4 + Math.random()) * speed;
    const roll = Math.random();
    const shade =
      roll < 0.28 ? mix(col, '#fdf3d4', 0.5) : roll < 0.62 ? col : mix(col, '#0a0912', 0.4);
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - 20, // bias upward so debris arcs
      life: 0.35 + Math.random() * 0.4,
      t: 0,
      col: shade,
      sz: Math.random() < 0.8 ? 1 : 2,
    });
  }
}
function floaty(x: number, y: number, text: string, col: string, big = false): void {
  floaties.push({ x, y, text, col, t: 0, life: big ? 1.4 : 0.9, big });
}

// ---- layered pixel-art cave renderer ----------------------------------------------------
// The rock (a per-pixel top-lit field, see cave-render) is cached as world-anchored CW×CH tile
// CHUNKS on a 2D grid (the world is unbounded in both axes). A chunk is generated once the first
// time it scrolls into view — OFF THE MAIN THREAD via a Worker so moving into fresh world never
// stalls — and kept, so scrolling back is a cheap blit. Digging re-renders only a small window
// around the changed tile (synchronously; cheap, no dig latency) and patches it into the affected
// chunk(s). Chunks render with a MARGIN of context so seams are invisible; fieldBuf is the
// main-thread scratch for patches / the sync fallback.
interface Chunk {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
const chunks = new Map<string, Chunk>();
const chunkX = (column: number): number => Math.floor(column / CW);
const chunkY = (row: number): number => Math.floor(row / CH);
const ckey = (cx: number, cy: number): string => cx + ',' + cy;

// A tile is solid rock when it's below the surface and not yet dug. The world is unbounded — every
// column below the surface is rock until you dig it (no side walls).
const solidTile = (column: number, row: number): boolean =>
  engine.solidAt(s.world.seed, column, row) && !engine.isDug(s.world, column, row);

// a tile's ore material (if it sits in an ore pocket), baked into the rock band by composeBand so
// veins feather into the strata. Same lookup the worker uses; null → the tile renders as plain rock.
const materialAt = (column: number, row: number) =>
  oreMaterial(engine.oreAt(s.world.seed, column, row));

function newChunkCanvas(): Chunk {
  const cv = document.createElement('canvas');
  cv.width = CW * T;
  cv.height = CH * T;
  return { cv, ctx: cv.getContext('2d')! };
}

// draw an ore's authored crystal/nugget art into a small canvas — used as its item icon in the
// inventory and the collection codex (so ores read as distinct collectibles).
function oreIcon(oreId: number, artPx = 16): HTMLCanvasElement {
  const art = ORE_ART[oreId];
  const cv = document.createElement('canvas');
  cv.width = cv.height = artPx;
  cv.className = 'oreic';
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (art) {
    const pen: Pen = (a, b, w, h, col) => {
      g.fillStyle = col;
      g.fillRect(a, b, w || 1, h || 1);
    };
    SHAPES[art.shape](pen, artPx >> 1, artPx >> 1, (artPx >> 1) - 2, art.c);
  }
  return cv;
}

// ---- off-thread chunk generation (Worker) with a synchronous fallback -------------------
interface ChunkResult {
  cx: number;
  cy: number;
  bmp: ImageBitmap;
}
let worker: Worker | null = null;
const pending = new Map<string, Array<[number, number]> | null>(); // key -> dig patches queued while generating
let rebuildCount = 0;
let lastRebuildMs = 0;

const canOffloadChunks =
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  !!OffscreenCanvas.prototype.transferToImageBitmap;
if (canOffloadChunks) {
  try {
    worker = new Worker(new URL('./render/chunk-worker.ts', import.meta.url), { type: 'module' });
    worker.postMessage({
      type: 'init',
      cfg: { T, CW, CH, MARGIN, strata: engine.STRATA },
    });
    worker.postMessage({ type: 'world', seed: s.world.seed }); // seed to bake ore into chunks
    worker.onmessage = (e: MessageEvent<ChunkResult>) => {
      const { cx, cy, bmp } = e.data;
      const key = ckey(cx, cy);
      const queued = pending.get(key);
      pending.delete(key);
      const chunk = chunks.get(key) || newChunkCanvas();
      chunk.ctx.clearRect(0, 0, CW * T, CH * T);
      chunk.ctx.drawImage(bmp, 0, 0);
      bmp.close();
      chunks.set(key, chunk);
      if (queued) for (const [c, r] of queued) patchDig(c, r); // re-apply digs that landed mid-flight
    };
    worker.onerror = () => {
      worker = null; // fall back to sync on failure
    };
  } catch {
    worker = null;
  }
}

// dug tiles overlapping a chunk's render region — extended 12 rows up so the Worker has the
// openings that feed top-light seeding (usually empty for fresh depth).
const TOP_LIGHT_LOOKUP_ROWS = 12;
function dugInRegion(cx: number, cy: number): string[] {
  const left = cx * CW - MARGIN;
  const right = cx * CW + CW - 1 + MARGIN;
  const top = cy * CH - MARGIN - TOP_LIGHT_LOOKUP_ROWS;
  const bottom = cy * CH + CH - 1 + MARGIN;
  const out: string[] = [];
  for (const k in s.world.dug) {
    const comma = k.indexOf(',');
    const c = +k.slice(0, comma);
    const r = +k.slice(comma + 1);
    if (c >= left && c <= right && r >= top && r <= bottom) out.push(k);
  }
  return out;
}
function requestChunk(cx: number, cy: number): void {
  const key = ckey(cx, cy);
  if (chunks.has(key) || pending.has(key)) return;
  pending.set(key, null);
  worker!.postMessage({ type: 'chunk', cx, cy, dug: new Set(dugInRegion(cx, cy)) });
}

// Re-post the world seed to the Worker so it bakes ore with the current seed. Call whenever the
// world changes (new game / server hello) — right where the chunk cache is cleared.
function syncWorkerWorld(): void {
  worker?.postMessage({ type: 'world', seed: s.world.seed });
}

// Synchronous chunk render (fallback when no Worker) — uses the shared renderer.
function renderChunkSync(cx: number, cy: number): Chunk {
  const start = performance.now();
  composeBand(
    lb,
    solidTile,
    cx * CW - MARGIN,
    cy * CH - MARGIN,
    CW + 2 * MARGIN,
    CH + 2 * MARGIN,
    Infinity,
    surfaceOf,
    materialAt,
  );
  const key = ckey(cx, cy);
  const chunk = chunks.get(key) || newChunkCanvas();
  chunk.ctx.clearRect(0, 0, CW * T, CH * T);
  chunk.ctx.drawImage(fieldBuf, MARGIN * T, MARGIN * T, CW * T, CH * T, 0, 0, CW * T, CH * T);
  chunks.set(key, chunk);
  lastRebuildMs = performance.now() - start;
  rebuildCount++;
  return chunk;
}
// Get a chunk for blitting, or null while it's being generated off-thread.
function getChunk(cx: number, cy: number): Chunk | null {
  const chunk = chunks.get(ckey(cx, cy));
  if (chunk) return chunk;
  if (worker) {
    requestChunk(cx, cy);
    return null;
  }
  return renderChunkSync(cx, cy);
}

// A dig changes one tile → re-render only a small window around it (a few ms, on the main thread —
// no latency on digs) and patch it into the cached chunk(s) it overlaps. If a chunk is still being
// generated, queue the patch to re-apply when it arrives.
function patchDig(c: number, r: number): void {
  const start = performance.now();
  const coreL = c - 1;
  const coreR = c + 1;
  const coreT = r - 1;
  const coreB = r + 1;
  const bandLeft = coreL - MARGIN;
  const bandTop = coreT - MARGIN;
  composeBand(
    lb,
    solidTile,
    bandLeft,
    bandTop,
    coreR - coreL + 1 + 2 * MARGIN,
    coreB - coreT + 1 + 2 * MARGIN,
    Infinity,
    surfaceOf,
    materialAt,
  );
  // copy each overlapping chunk's slice of the re-rendered core out of fieldBuf
  for (let cy = chunkY(coreT); cy <= chunkY(coreB); cy++) {
    for (let cx = chunkX(coreL); cx <= chunkX(coreR); cx++) {
      const key = ckey(cx, cy);
      const chunk = chunks.get(key);
      if (!chunk) {
        if (pending.has(key)) {
          const queued = pending.get(key) || [];
          queued.push([c, r]);
          pending.set(key, queued);
        }
        continue;
      }
      const wl = Math.max(coreL, cx * CW); // world-tile intersection of the core and this chunk
      const wr = Math.min(coreR, cx * CW + CW - 1);
      const wt = Math.max(coreT, cy * CH);
      const wb = Math.min(coreB, cy * CH + CH - 1);
      chunk.ctx.drawImage(
        fieldBuf,
        (wl - bandLeft) * T,
        (wt - bandTop) * T,
        (wr - wl + 1) * T,
        (wb - wt + 1) * T,
        (wl - cx * CW) * T,
        (wt - cy * CH) * T,
        (wr - wl + 1) * T,
        (wb - wt + 1) * T,
      );
    }
  }
  lastRebuildMs = performance.now() - start;
  rebuildCount++;
}

// ---- lighting ---------------------------------------------------------------------------
// The geometry-aware lighting system lives in render/lighting (shared with the labs, so they
// light identically). We keep one instance; each frame we push emitters — the miner's lamp +
// glowing ore veins — then call lighting.render() with the viewport + this game's solidTile.
const lighting = createLighting();

// ---- render -----------------------------------------------------------------------------
// The surface is a heightmap (#44), so everything that used to take the constant row now takes this
// — one closure over the live seed, so the renderer, the lighting and the compositor agree.
const surfaceOf = (column: number): number => engine.surfaceAt(s.world.seed, column);

const LAMP_BASE_INTENSITY = 0.9; // lamp seed brightness at lamp reach 0
const LAMP_REACH_GAIN = 0.16; // added lamp brightness per tile of lamp reach (Deep Lantern reaches further)

// idle dust motes that drift near the lamp (positions are seeded once, animated by time)
const motes = Array.from({ length: 10 }, () => ({
  x: Math.random(),
  y: Math.random(),
  s: 0.3 + Math.random(),
}));

function render(t: number): void {
  ctx.clearRect(0, 0, LW, LH);
  const px = s.player.x + correctionX; // continuous player centre (tile units) + reconciliation smoothing
  const py = s.player.y + correctionY;
  // 2-axis camera keeps the miner centred on screen (issue #1 — open world in all directions)
  const targetCamX = px * T - LW / 2 + T / 2;
  const targetCamY = py * T - LH / 2 + T / 2;
  camX += (targetCamX - camX) * CAMERA_LERP;
  camY += (targetCamY - camY) * CAMERA_LERP;
  const shx = SHAKE_ENABLED ? (Math.random() * 2 - 1) * shake : 0;
  const shy = SHAKE_ENABLED ? (Math.random() * 2 - 1) * shake : 0;
  const st = engine.stats(s.player);

  ctx.save();
  ctx.translate(Math.round(shx - camX), Math.round(shy - camY));

  // visible tile window (with a little overscan for shading context)
  const colL = Math.floor(camX / T) - 2;
  const colR = Math.floor(camX / T) + VIEW_COLS + 2;
  const rowT = Math.floor(camY / T) - 2;
  const rowB = Math.floor(camY / T) + VIEW_ROWS + 2;
  // blit the cached rock chunks spanning the view; a not-yet-generated chunk (Worker in flight)
  // shows a flat bg placeholder for the frame or two until it arrives.
  const cx0 = chunkX(colL);
  const cx1 = chunkX(colR);
  const cy0 = chunkY(rowT);
  const cy1 = chunkY(rowB);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const chunk = getChunk(cx, cy);
      if (chunk) {
        ctx.drawImage(chunk.cv, cx * CW * T, cy * CH * T);
      } else {
        ctx.fillStyle = '#0b0e13';
        ctx.fillRect(cx * CW * T, cy * CH * T, CW * T, CH * T);
      }
    }
  }
  // prefetch a ring of chunks around the view so they're ready before they scroll in
  if (worker) {
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) requestChunk(cx, cy);
  } else {
    // sync fallback: bake at most one missing chunk per frame so a resize/teleport can't hitch
    for (let cy = cy0; cy <= cy1; cy++) {
      let baked = false;
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!chunks.has(ckey(cx, cy))) {
          renderChunkSync(cx, cy);
          baked = true;
          break;
        }
      }
      if (baked) break;
    }
  }
  // bound memory: drop chunks well outside the view (both axes)
  if (chunks.size > CHUNK_CACHE_LIMIT) {
    for (const key of [...chunks.keys()]) {
      const comma = key.indexOf(',');
      const kx = +key.slice(0, comma);
      const ky = +key.slice(comma + 1);
      if (
        kx < cx0 - CHUNK_EVICT_MARGIN ||
        kx > cx1 + CHUNK_EVICT_MARGIN ||
        ky < cy0 - CHUNK_EVICT_MARGIN ||
        ky > cy1 + CHUNK_EVICT_MARGIN
      ) {
        chunks.delete(key);
      }
    }
  }

  // lamp falloff at a tile: full within 1 tile, easing to a 0.14 floor by the lamp's reach
  const lightAt = (c: number, r: number): number => {
    const dist = Math.hypot(c - px, r - py);
    return Math.max(0.14, 1 - Math.max(0, dist - 1) / (st.lamp + 0.5));
  };

  // (Ore no longer emits its own light — veins read purely by their baked surface + sparkle/twinkle,
  // lit by the lamp like any other rock. The lighting system still supports coloured emitters via
  // addLight(r>0) for future light sources; ore just doesn't use it.)

  // tiered damage: chip away tiles taking dig damage (rock + ore alike). Iterate the sparse dmg map
  // (only in-progress tiles), gated to the view + lamp reach. A material may override the shared look.
  if (debugFlags.damage)
    for (const cellKey in s.world.dmg) {
      const dmg = s.world.dmg[cellKey];
      if (!dmg) continue;
      const comma = cellKey.indexOf(',');
      const dc = +cellKey.slice(0, comma);
      const dr = +cellKey.slice(comma + 1);
      if (dc < colL || dc > colR || dr < rowT || dr > rowB) continue; // off-screen
      if (!solidTile(dc, dr)) continue;
      const dlit = lightAt(dc, dr);
      if (dlit < 0.16) continue; // hidden by fog
      const hp = engine.blockAt(s.world.seed, dc, dr).hp;
      if (hp <= 0) continue;
      // which side is it being mined from? the dominant cardinal axis toward the miner (chunks bite out
      // of that edge). px/py are the player's centre in tile units.
      const towardX = px - (dc + 0.5);
      const towardY = py - (dr + 0.5);
      const dirX = Math.abs(towardX) >= Math.abs(towardY) ? Math.sign(towardX) : 0;
      const dirY = dirX === 0 ? Math.sign(towardY) : 0;
      const damageCtx = {
        g: ctx,
        x: dc * T,
        y: dr * T,
        scale: 1,
        frac: dmg / hp,
        seed: hashXY(dc, dr, 71),
        lit: dlit,
        dirX,
        dirY,
      };
      (materialAt(dc, dr)?.damage ?? drawDamage)(damageCtx);
    }

  // animated cluster-edge twinkle: adjacent same-material tiles sharing a lit, exposed face flash as
  // ONE edge — a single glint hops along the whole run. Gated by lamp reach, so only ore you can
  // actually see twinkles. Drawn additively, before the lighting scrim (so lit glints survive it).
  if (debugFlags.twinkle) {
    const twinkleEdges = collectTwinkleEdges({
      bandLeft: colL,
      bandTop: rowT,
      cols: colR - colL + 1,
      rows: rowB - rowT + 1,
      solid: solidTile,
      materialAt,
      lit: lightAt,
      seedAt: (c, r) => hashXY(c, r, 55),
      minLit: 0.2,
    });
    if (twinkleEdges.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const offX = colL * T;
      const offY = rowT * T;
      for (const edge of twinkleEdges) {
        edge.material.twinkle!({
          g: ctx,
          x0: edge.x0 + offX,
          y0: edge.y0 + offY,
          x1: edge.x1 + offX,
          y1: edge.y1 + offY,
          scale: 1,
          time: t,
          seed: edge.seed,
          litAt: edge.litAt,
        });
      }
      ctx.restore();
    }
  }

  // idle dust motes drifting near the lamp
  ctx.fillStyle = '#fff';
  for (const m of motes) {
    const mx = (px + (m.x - 0.5) * st.lamp * 1.4) * T + T / 2;
    const my = (py + (((m.y + t * 0.03 * m.s) % 1) - 0.5) * st.lamp * 1.3) * T + T / 2;
    ctx.globalAlpha = 0.1 * m.s * (py > 0 ? 1 : 0);
    ctx.fillRect(Math.round(mx + Math.sin(t + m.x * 9) * 1.5), Math.round(my), 1, 1);
  }
  ctx.globalAlpha = 1;

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.col;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz);
  }
  ctx.globalAlpha = 1;

  // the player's imported sprite, standing on its feet. The bob the placeholder needed is gone: the
  // animations carry their own, so adding more on top double-counted it.
  const halfHeight = engine.PHYS.HH;
  const footX = Math.round(px * T);
  const footY = Math.round((py + halfHeight) * T);
  // Frame timing follows the animation's own authored durations, scaled a little by run speed so a
  // brisk walk does not look like it is sliding.
  const gait =
    miner.state === 'run' ? Math.max(0.6, Math.abs(s.player.vx) / engine.PHYS.RUN_SPEED) : 1;
  drawPlayer(ctx, poseFor(miner.state, t * 1000, gait), footX, footY, {
    scale: 1,
    facing: s.player.facing,
  }); // lamp bloom is part of the lighting pass

  // coin floaties
  ctx.textAlign = 'center';
  for (const f of floaties) {
    const a = Math.max(0, 1 - f.t / f.life);
    ctx.globalAlpha = a;
    ctx.font = `700 ${f.big ? 11 : 8}px ui-monospace,monospace`;
    ctx.fillStyle = '#000';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.col;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // mining reticle — the tile being aimed at (bright if solid & within reach, dim otherwise)
  if (curTarget) {
    const { column, row } = curTarget;
    const withinReach =
      Math.abs(column - Math.floor(px)) <= engine.PHYS.REACH &&
      Math.abs(row - Math.floor(py)) <= engine.PHYS.REACH;
    const ok = engine.solidCell(s.world, column, row) && withinReach;
    ctx.globalAlpha = ok ? 0.85 : 0.22;
    ctx.strokeStyle = ok ? '#fdf3d4' : '#8892a0';
    ctx.strokeRect(column * T + 0.5, row * T + 0.5, T - 1, T - 1);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // lighting: push the miner's lamp emitter (seed brightness scales with lamp reach, so the Deep
  // Lantern reaches further), then composite the shared geometry-aware system over the frame.
  // Debug: `lighting` off skips the whole pass (flat, fully-visible world); `fog` off keeps the
  // lamp glow but drops the darkness scrim. (Guard the emitter too, so it isn't left unconsumed.)
  if (debugFlags.lighting) {
    lighting.addLight(
      px * T,
      (py - 0.1) * T,
      0,
      LAMP_COLOR,
      LAMP_BASE_INTENSITY + LAMP_REACH_GAIN * st.lamp,
    );
    lighting.render({
      g: ctx,
      LW,
      LH,
      T,
      camX,
      camY,
      surfaceAt: surfaceOf,
      solidTile,
      scrim: debugFlags.fog,
    });
  }
}

// ---- input ------------------------------------------------------------------------------
// Decoupled controls (#3): move with A/D or ←/→, jump with W/↑/Space. MINING is its own action —
// aim at a tile and hold to mine it (within reach), independent of moving:
//   • mouse / touch: the tile under the cursor, held down to mine (a reticle shows it)
//   • keyboard: hold J/K to mine in the aim direction (S/↓ aims down, else held side / facing)
type HeldKey = 'left' | 'right' | 'jump' | 'down' | 'mine';
const held: Record<HeldKey, boolean> = {
  left: false,
  right: false,
  jump: false,
  down: false,
  mine: false,
};
let moving = false;
let curTarget: TileCoord | null = null;

// The miner's animation/behaviour state (idle/run/jump/fall/mine) as a state machine over the pure
// physics — see @delve/shared miner.ts. Driven once per fixed tick; `.state` selects the walk/idle
// bob (below), and the enter hook hangs landing juice on the air→ground transition (a soft thud +
// dust + a nudge of shake) — impact feedback the game didn't have before. `lastFallSpeed` is the
// descent speed captured just before the step, since the physics zeroes vy on contact.
let lastFallSpeed = 0;
const miner = engine.newMinerMachine({
  onEnter(state, { from }) {
    const landed = (state === 'idle' || state === 'run') && (from === 'jump' || from === 'fall');
    if (!landed) return;
    const impact = Math.min(1, lastFallSpeed / engine.PHYS.MAX_FALL);
    if (impact <= 0) return; // stepped onto ground without really falling (e.g. off a 1-tile lip)
    const footX = s.player.x * T;
    const footY = (s.player.y + engine.PHYS.HH) * T;
    sfx.land(impact);
    chips(footX, footY, 3 + Math.round(impact * 4), '#8a7a66', 30 + impact * 30);
    shake = Math.min(5, shake + 0.8 + impact * 2.2);
  },
});

// ---- app / screen state machine ---------------------------------------------------------
// The top-level flow: the title screen → playing ⇄ paused. This is the single source of truth for
// "is the game running" — the sim only ticks in `playing` (see frame()), and CSS keys the visible
// chrome off `<body data-app>` (topbar/HUD/touch hidden on the title; title panel shown only there).
// There is deliberately NO blocking `loading` state: the client renders from localStorage instantly
// and plays offline, connecting to the server in the background (see boot), so gating play on the
// network would regress that. `pause` covers every reason the sim should stop — the pause menu and
// the inventory/collection panels all route through it, so one flag governs the tick loop.
type AppState = 'title' | 'playing' | 'paused';
type AppEvent = 'start' | 'pause' | 'resume';
const app = new engine.StateMachine<AppState, AppEvent>(
  'title',
  {
    title: { start: 'playing' },
    playing: { pause: 'paused' },
    paused: { resume: 'playing' },
  },
  {
    onEnter(state) {
      document.body.dataset.app = state;
      if (state === 'paused') {
        releaseAllHeld(); // don't leave a key "stuck down" while the sim is frozen
        aim.down = false;
      }
    },
  },
);
document.body.dataset.app = app.state; // reflect the initial state (onEnter doesn't fire at construction)
const simRunning = (): boolean => app.is('playing');
const KEYMAP: Record<string, HeldKey> = {
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyJ: 'mine',
  KeyK: 'mine',
};
function releaseAllHeld(): void {
  (Object.keys(held) as HeldKey[]).forEach((k) => (held[k] = false));
}
addEventListener('keydown', (e: KeyboardEvent) => {
  if (!simRunning()) return;
  const key = KEYMAP[e.code];
  if (!key) return;
  e.preventDefault();
  held[key] = true;
  audio();
});
addEventListener('keyup', (e: KeyboardEvent) => {
  const key = KEYMAP[e.code];
  if (key) held[key] = false;
});

// pointer: a reticle ALWAYS follows the cursor (aim.has once it's moved over the canvas); holding
// the button (aim.down) mines the aimed tile. Movement is keyboard / on-screen buttons.
const aim = { cx: 0, cy: 0, has: false, down: false };
function setAim(e: PointerEvent): void {
  aim.cx = e.clientX;
  aim.cy = e.clientY;
  aim.has = true;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!simRunning()) return;
  e.preventDefault();
  audio();
  setAim(e);
  aim.down = true;
});
canvas.addEventListener('pointermove', (e) => setAim(e));
addEventListener('pointerup', () => (aim.down = false));
addEventListener('pointercancel', () => (aim.down = false));

// the tile under the cursor (or null if the cursor hasn't been over the canvas yet)
function pointerTile(): TileCoord | null {
  if (!aim.has) return null;
  const rect = canvas.getBoundingClientRect();
  const wx = ((aim.cx - rect.left) / rect.width) * LW + camX;
  const wy = ((aim.cy - rect.top) / rect.height) * LH + camY;
  return { column: Math.floor(wx / T), row: Math.floor(wy / T) };
}
// keyboard aim: the neighbour tile in the held/facing direction (S/↓ down, else side/facing)
function keyboardAimTile(): TileCoord {
  let dx = 0;
  let dy = 0;
  if (held.down) dy = 1;
  else if (held.left) dx = -1;
  else if (held.right) dx = 1;
  else dx = s.player.facing === 'left' ? -1 : 1;
  return { column: Math.floor(s.player.x) + dx, row: Math.floor(s.player.y) + dy };
}

// ---- game loop (fixed-tick sim + client prediction) -------------------------------------
// The sim advances in FIXED TICK_DT steps (an accumulator drains real frame time into whole
// ticks), so client prediction and the authoritative server step the SAME dt — a replayed input
// reproduces the server's result. Each tick we sample input, predict locally, and (when online)
// stream the input to the server + buffer it for reconciliation. Rendering happens once per
// animation frame on the latest predicted state.
let last = 0;
let accumulator = 0; // banked real time waiting to be spent as whole ticks
const MAX_FRAME_DT = 0.1; // clamp long frames (tab switch) so we don't spiral catching up
const MAX_CATCHUP_TICKS = 8; // cap sim ticks per frame; drop the rest rather than freeze
const FPS_EMA_ALPHA = 0.1; // smoothing for the debug fps / frame-time readouts
const TICK_DT = engine.TICK_DT;

// ---- client prediction / reconciliation state ----
let inputSeq = 0; // monotonic input counter; the server echoes the last-applied one as ackSeq
const pendingInputs: { seq: number; input: Input }[] = []; // un-acked inputs, replayed after each snapshot
let correctionX = 0; // reconciliation error, absorbed into the render offset and decayed to 0
let correctionY = 0;
const CORRECTION_RETAIN = 0.0025; // fraction of the correction kept per second (fast; invisible on LAN)

// turn a physics event (chip / break / jump) into juice: sound, particles, floaty, and the
// cached-chunk patch when a tile breaks.
function onEvent(ev: SimEvent): void {
  const cx = ev.c * T + T / 2;
  const cy = ev.r * T + T / 2;
  if (ev.type === 'chip') {
    sfx.chip();
    chips(cx, cy, 2, '#8a7a66', 25);
    shake = Math.min(3, shake + 0.4);
    return;
  }
  if (ev.type !== 'break') return;
  patchDig(ev.c, ev.r); // tile became open → patch the cached chunk(s)
  // Every reward cue scales by NORMALISED rarity rather than by the tier number, so adding an ore
  // never re-tunes the feedback for the ores already there — which is the mistake this whole thing
  // came from (#46). The coefficients are chosen so the top tier lands exactly where mythril landed
  // before; what changed is that the other twelve now land on their AUTHORED tier instead of on
  // their position in the registry.
  const prize = (ev.ore ? engine.rarityOf(ev.ore) : 0) / engine.RARITY_MAX;
  const RICH_BONUS = 0.33; // a rich vein reads as roughly two tiers better than it is
  sfx.dig(ev.r);
  sfx.break(prize);
  chips(cx, cy, 5 + Math.round(prize * 8), ev.ore ? engine.ORE_BY_ID[ev.ore].color : '#6b5a45', 45);
  shake = Math.min(7, shake + 1.2 + prize * 4 + (ev.rich ? 2 : 0));
  if (ev.ore) {
    // ore collected into the inventory (sold later)
    sfx.ore(Math.min(1, prize + (ev.rich ? RICH_BONUS : 0)));
    const col = ev.rich ? '#f2c14e' : engine.ORE_BY_ID[ev.ore].color;
    const name = engine.ORE_BY_ID[ev.ore].name;
    // The big floaty is the celebration, so it belongs to the top two tiers and a rich vein of
    // anything. Narrower than before, when it reached down to emerald — but before, it also reached
    // stone bricks.
    floaty(cx, cy - 4, '+' + ev.qty + ' ' + name + (ev.rich ? '!' : ''), col, prize >= 0.6 || ev.rich);
    for (let i = 0; i < 4 + Math.round(prize * 8) + (ev.rich ? 8 : 0); i++) chips(cx, cy, 1, col, 55);
  }
}

let fpsEMA = 0;
let frameMsEMA = 0;

// Sample this frame's intent into an Input (movement + the aimed mine target); also refresh the
// reticle target as a side effect.
function sampleInput(): Input {
  const hover = pointerTile();
  const mineNow = aim.down ? hover : held.mine ? keyboardAimTile() : null;
  curTarget = hover || (held.mine ? keyboardAimTile() : null); // reticle follows the cursor
  if (aim.down && hover) {
    s.player.facing =
      hover.column < Math.floor(s.player.x)
        ? 'left'
        : hover.column > Math.floor(s.player.x)
          ? 'right'
          : s.player.facing;
  }
  return { left: held.left, right: held.right, jump: held.jump, mine: mineNow };
}

// One fixed sim step: predict locally (turning events into juice), and when online stream the
// input to the server + buffer it so the next authoritative snapshot can be reconciled.
function tick(): void {
  const input = sampleInput();
  if (net.isOnline()) {
    inputSeq++;
    net.sendInput(inputSeq, input);
    pendingInputs.push({ seq: inputSeq, input });
    if (pendingInputs.length > 256) pendingInputs.shift(); // safety bound against an unresponsive server
  }
  lastFallSpeed = s.player.vy; // pre-step descent speed (vy>0 = falling); the landing hook reads it
  const res = engine.physicsStep(s, input, TICK_DT);
  for (const ev of res.events) onEvent(ev);
  moving = Math.abs(s.player.vx) > engine.MOVE_EPSILON;
  engine.driveMiner(miner, s.player, s.player.digKey !== null); // may fire the landing hook above
}

// Reconcile the local prediction against an authoritative snapshot: adopt the server's player,
// apply the world deltas, then replay inputs the server hasn't acked yet to re-predict "now".
// Any residual difference is absorbed into a decaying render offset so corrections never pop.
function reconcile(msg: StateMessage): void {
  const shownX = s.player.x + correctionX; // where the avatar currently appears (pre-reconcile)
  const shownY = s.player.y + correctionY;

  s.player = msg.player; // server is the source of truth for the player

  // world deltas: newly-dug tiles (patch the rock the first time we hear of them) + tile damage
  for (const cellKey of msg.dugAdded) {
    if (!s.world.dug[cellKey]) {
      s.world.dug[cellKey] = true;
      const comma = cellKey.indexOf(',');
      patchDig(+cellKey.slice(0, comma), +cellKey.slice(comma + 1));
    }
  }
  s.world.dmg = msg.dmg;

  // drop acked inputs, replay the rest (silently — their juice already played when first predicted)
  while (pendingInputs.length && pendingInputs[0].seq <= msg.ackSeq) pendingInputs.shift();
  for (const p of pendingInputs) engine.physicsStep(s, p.input, TICK_DT);

  correctionX = shownX - s.player.x; // absorb the correction; the frame loop decays it to 0
  correctionY = shownY - s.player.y;
  if (!simRunning()) updateHUD(); // no tick loop while paused/title → refresh HUD for command results
}

function frame(now: number): void {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
  const t = now / 1000;
  const workStart = performance.now();
  if (dt > 0) fpsEMA += (1 / dt - fpsEMA) * FPS_EMA_ALPHA; // smoothed frames/sec from real timestamps

  // advance the sim in fixed ticks (only while playing — title/paused don't bank ticks)
  if (!simRunning()) {
    moving = false;
    curTarget = null;
    accumulator = 0;
  } else {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= TICK_DT && steps < MAX_CATCHUP_TICKS) {
      tick();
      accumulator -= TICK_DT;
      steps++;
    }
    if (steps === MAX_CATCHUP_TICKS) accumulator = 0; // fell far behind → drop the backlog
  }

  // decay the reconciliation correction toward 0 (framerate-independent)
  correctionX *= Math.pow(CORRECTION_RETAIN, dt);
  correctionY *= Math.pow(CORRECTION_RETAIN, dt);
  if (Math.abs(correctionX) < 1e-3) correctionX = 0;
  if (Math.abs(correctionY) < 1e-3) correctionY = 0;

  // update particles / floaties / shake
  for (const p of particles) {
    p.t += dt;
    p.vy += 120 * dt; // debris gravity
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  particles = particles.filter((p) => p.t < p.life);
  for (const f of floaties) {
    f.t += dt;
    f.y -= (f.big ? 22 : 16) * dt; // floaties rise as they fade
  }
  floaties = floaties.filter((f) => f.t < f.life);
  shake *= Math.pow(0.001, dt); // exponential decay, framerate-independent
  if (shake < 0.05) shake = 0;

  render(t);
  updateHUD();
  frameMsEMA += (performance.now() - workStart - frameMsEMA) * FPS_EMA_ALPHA; // smoothed compute time
  if (DEBUG) updateDebug();
  requestAnimationFrame(frame);
}

// ---- debug overlay (F3 / ?debug) --------------------------------------------------------
let DEBUG = /(\?|&)debug\b/.test(location.search);
const dbg = document.getElementById('dbg')!;
const dbgText = document.getElementById('dbgtext')!;
const dbgToggles = document.getElementById('dbgtoggles')!;
dbg.classList.toggle('on', DEBUG);
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'F3' || e.code === 'Backquote') {
    DEBUG = !DEBUG;
    dbg.classList.toggle('on', DEBUG);
    e.preventDefault();
  }
});

// render-system toggles — clickable buttons in the debug panel that flip visual passes on/off in
// render() (see their use there), so you can isolate lighting / fog / twinkle / damage while playing.
const debugFlags = { lighting: true, fog: true, twinkle: true, damage: true };
for (const key of Object.keys(debugFlags) as (keyof typeof debugFlags)[]) {
  const button = document.createElement('button');
  button.className = 'dbgbtn on';
  button.textContent = key;
  button.addEventListener('click', () => {
    debugFlags[key] = !debugFlags[key];
    button.classList.toggle('on', debugFlags[key]);
  });
  dbgToggles.appendChild(button);
}

function updateDebug(): void {
  const st = engine.stats(s.player);
  const up = (canvas.clientWidth / canvas.width).toFixed(2);
  const netInfo = net.netStatus();
  dbgText.textContent =
    `DELVE · debug  (F3 to toggle)\n` +
    `fps   ${fpsEMA.toFixed(1).padStart(5)}   frame ${frameMsEMA.toFixed(2)}ms\n` +
    `pos   ${s.player.x.toFixed(2)},${s.player.y.toFixed(2)}  vel ${s.player.vx.toFixed(1)},${s.player.vy.toFixed(1)}  ${s.player.grounded ? 'ground' : 'air'}  facing ${s.player.facing}\n` +
    `depth ${s.player.depth}m\n` +
    `cam   ${camX.toFixed(1)},${camY.toFixed(1)}  view ${VIEW_COLS}×${VIEW_ROWS}\n` +
    `canvas ${canvas.width}×${canvas.height} @${up}×  tile ${TILE_PX}px  world ∞×∞\n` +
    `chunks cached ${chunks.size}  renders ${rebuildCount}  last ${lastRebuildMs.toFixed(2)}ms\n` +
    `fx    particles ${particles.length}  floaties ${floaties.length}  shake ${shake.toFixed(2)}  lights ${lighting.count}\n` +
    `save  dug ${Object.keys(s.world.dug).length}  dmg ${Object.keys(s.world.dmg).length}\n` +
    `held  ${engine.invCount(s.player)} materials\n` +
    `stats interval ${st.interval.toFixed(0)}ms  lamp ${st.lamp.toFixed(1)}  fortune ${(st.fortune * 100).toFixed(0)}%\n` +
    `up    pick ${s.player.up.pick} · speed ${s.player.up.speed} · fortune ${s.player.up.fortune}   tech ${s.player.tech.lantern ? 'lantern' : '—'}\n` +
    `audio ${AC ? (muted ? 'muted' : AC.state) : 'locked'}\n` +
    `net   ${netInfo.status}  ackSeq ${netInfo.ackSeq}  pending ${pendingInputs.length}  seq ${inputSeq}`;
}

// ---- HUD / inventory --------------------------------------------------------------------
const el = (id: string): HTMLElement => document.getElementById(id)!;
const overlay = el('overlay');
const codexOverlay = el('codexOverlay');
const pauseOverlay = el('pauseOverlay');

// A menu panel (inventory / collection / pause) pauses the sim. Opening any first closes the others
// (they're mutually exclusive) and drives the app FSM to `paused`; closing returns it to `playing`.
function closeMenus(): void {
  overlay.classList.remove('on');
  codexOverlay.classList.remove('on');
  pauseOverlay.classList.remove('on');
}
function openMenu(node: HTMLElement): void {
  audio();
  closeMenus();
  node.classList.add('on');
  app.send('pause'); // no-op if already paused
}
function resume(): void {
  closeMenus();
  app.send('resume'); // no-op if already playing (e.g. closing the last panel)
}

function updateHUD(): void {
  el('depth').textContent = String(s.player.depth);
  el('held').textContent = engine.invCount(s.player).toLocaleString();
}

// The inventory panel: every material the player is holding, as icon + name + count rows.
function refreshInventory(): void {
  el('invTotal').textContent = engine.invCount(s.player).toLocaleString();
  const listEl = el('invList');
  listEl.innerHTML = '';
  for (const row of buildInventoryRows(s.player.inv, engine.ORE_BY_ID, oreIcon))
    listEl.appendChild(row);
}
function openInventory(): void {
  refreshInventory();
  openMenu(overlay);
}
el('invBtn').onclick = openInventory;
el('closeBtn').onclick = resume;
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) resume();
});

// ---- collection codex -------------------------------------------------------------------
function renderCodex(): void {
  const codexList = el('codexList');
  codexList.innerHTML = '';
  for (const ore of engine.ORES) {
    const entry = s.player.log[ore.id];
    const found = !!entry;
    const row = document.createElement('div');
    row.className = 'row';
    const icon = document.createElement('div');
    icon.style.cssText = 'width:30px; text-align:center; flex:0 0 auto';
    if (found) {
      icon.appendChild(oreIcon(ore.id, 22));
    } else {
      icon.textContent = '?';
      icon.style.color = 'var(--dim)';
      icon.style.fontWeight = '700';
    }
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = found
      ? `<div class="nm">${ore.name}</div><div class="ds">${ore.desc}</div>` +
        `<div class="ds" style="color:var(--gold)">mined ${entry.mined.toLocaleString()} · deepest ${entry.deepest}m</div>`
      : `<div class="nm" style="color:var(--dim)">? ? ?</div><div class="ds">Undiscovered — dig deeper to find it.</div>`;
    row.appendChild(icon);
    row.appendChild(info);
    codexList.appendChild(row);
  }
}
function openCodex(): void {
  renderCodex();
  openMenu(codexOverlay);
}
el('codexBtn').onclick = openCodex;
el('codexClose').onclick = resume;
codexOverlay.addEventListener('click', (e) => {
  if (e.target === codexOverlay) resume();
});

const muteBtn = el('muteBtn');
muteBtn.onclick = () => {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  muteBtn.textContent = muted ? '♪̸' : '♪';
  muteBtn.style.opacity = muted ? '0.5' : '1';
};
function newGame(): void {
  if (!confirm('Start a new mine? Your current progress is lost.')) return;
  s = fresh();
  net.sendCommand({ kind: 'newGame', seed: s.world.seed }); // server resets its world too (→ hello)
  pendingInputs.length = 0;
  inputSeq = 0;
  snapCam();
  chunks.clear();
  pending.clear();
  syncWorkerWorld();
  save(s);
  refreshInventory();
  resume(); // close any open menu and hand control back to the mine
}
el('newBtn').onclick = newGame;

// ---- title / pause screens --------------------------------------------------------------
el('startBtn').onclick = () => {
  audio(); // first user gesture unlocks the AudioContext
  app.send('start');
};
el('resumeBtn').onclick = resume;
el('pauseNewBtn').onclick = newGame;
// Escape toggles the pause menu while playing, and backs out of any open menu while paused.
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code !== 'Escape') return;
  e.preventDefault();
  if (app.is('playing')) openMenu(pauseOverlay);
  else if (app.is('paused')) resume();
});

// block scroll/zoom gestures on the game
addEventListener(
  'wheel',
  (e) => {
    if (simRunning()) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---- responsive sizing ------------------------------------------------------------------
// Tiles render at a FIXED "looks-like-16px" size: 1 art px = 1 CSS px, so a 16px tile is 16 CSS px
// and image-rendering:pixelated upscales it crisply to device pixels (32px on a 2× display) for
// free — no per-DPR render path needed. The camera centres the miner and the canvas is centred in
// the viewport.
// ponytail: fixed 1:1 for now; revisit fit + true fill when we tackle viewport framing.
const MIN_VIEW_TILES = 9;
const MAX_VIEW_TILES = 160;
function fit(): void {
  VIEW_COLS = Math.max(
    MIN_VIEW_TILES,
    Math.min(MAX_VIEW_TILES, Math.ceil(innerWidth / TILE_PX) + 1),
  );
  VIEW_ROWS = Math.max(
    MIN_VIEW_TILES,
    Math.min(MAX_VIEW_TILES, Math.ceil(innerHeight / TILE_PX) + 1),
  );
  LW = VIEW_COLS * T;
  LH = VIEW_ROWS * T;
  canvas.width = LW;
  canvas.height = LH;
  ctx.imageSmoothingEnabled = false; // (resetting width clears ctx state)
  const cssW = VIEW_COLS * TILE_PX;
  const cssH = VIEW_ROWS * TILE_PX;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.style.left = Math.round((innerWidth - cssW) / 2) + 'px'; // centre the viewport canvas
  canvas.style.top = Math.round((innerHeight - cssH) / 2) + 'px';
  // chunk cache is world-space, so it survives resize — no invalidation needed.
}
addEventListener('resize', fit);

// ---- boot -------------------------------------------------------------------------------
// on-screen movement buttons for touch devices (mining is aim+tap on the canvas)
if (matchMedia('(pointer: coarse)').matches) {
  el('touch').classList.add('on');
  const bind = (id: string, key: HeldKey): void => {
    const b = el(id);
    const on = (e: Event): void => {
      e.preventDefault();
      held[key] = true;
      audio();
    };
    const off = (e: Event): void => {
      e.preventDefault();
      held[key] = false;
    };
    b.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off);
  };
  bind('tL', 'left');
  bind('tR', 'right');
  bind('tJ', 'jump');
}

setRenderStrata(engine.STRATA); // hand the strata palette to the rock renderer (main thread)
fit();
snapCam();
updateHUD();
requestAnimationFrame(frame);

// Connect to the server: the game already rendered from localStorage (instant, offline-safe).
// The server is authoritative — the client streams inputs and reconciles. On every hello (join /
// reconnect / server new-game) we adopt the authoritative snapshot and reset the view + prediction
// buffers around it. Everything keeps working (local prediction only) if the server is unreachable.
net.connect({
  getSeed: () => s.world.seed,
  onHello: (snapshot) => {
    s = hydrate(snapshot);
    pendingInputs.length = 0;
    inputSeq = 0;
    correctionX = 0;
    correctionY = 0;
    chunks.clear();
    pending.clear(); // chunk-generation queue
    syncWorkerWorld();
    snapCam();
    refreshInventory();
    updateHUD();
  },
  onState: (msg) => reconcile(msg),
});
