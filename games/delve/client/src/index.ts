// index.ts — the DELVE game client: the glue that turns the pure sim (engine) and the shared
// renderers (cave-render / ore-art / sprites / lighting) into a playable game. It owns only what
// isn't a rule: the canvas + camera, the game loop, input, audio, juice (particles/floaties/
// shake), the HUD/shop/codex DOM, and save/load. Every world and gameplay rule is imported —
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
import {
  T,
  setStrata as setRenderStrata,
  composeBand,
  mix,
  hashXY,
  hexRgb,
} from './render/cave-render';
import { ORE_ART, SHAPES } from './render/ore-art';
import { oreMaterial, collectTwinkleEdges, drawDamage } from './render/materials';
import type { Pen } from '@delve/shared';
import { drawMiner } from './render/sprites';
import { create as createLighting, LAMP_COLOR } from './render/lighting';
import * as net from './net';

// ---- display + world-view geometry ------------------------------------------------------
// Art is authored at T=16 logical px per tile (a fine, Terraria-ish grid). It renders at logical
// resolution, then DISPLAYS at TILE_PX CSS px per tile with image-rendering:pixelated — so a tile
// "looks like" TILE_PX on screen while the art stays 16px. 32px is a clean 2× integer scale.
const TILE_PX = 32; // on-screen size of a tile (CSS px) — clean 2× of the 16px art
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
const SAVE_KEY = 'delve.save.v1';
const SAVE_INTERVAL_MS = 2500;

function fresh(): Session {
  return engine.newSession((Math.random() * 2 ** 31) >>> 0);
}
// Reconstruct a Session from a saved object over a fresh one (fills fields added since it was
// written) and reset transient physics. Handles three formats: the current split save
// ({ world, player }), the pre-split flat save, and the pre-physics grid save. Used by both
// the localStorage load and the server hydrate (src/net.ts). `saved` is deserialized external
// data, so it's genuinely untyped here.
function hydrate(saved: any): Session {
  const seed = saved.world?.seed ?? saved.seed;
  const base = engine.newSession(seed);
  const s: Session =
    saved.world && saved.player
      ? {
          world: { ...base.world, ...saved.world },
          player: {
            ...base.player,
            ...saved.player,
            up: { ...base.player.up, ...saved.player.up },
            tech: { ...base.player.tech, ...saved.player.tech },
          },
        }
      : {
          // migrate a pre-split flat save: peel world fields off, the rest is the player
          world: { ...base.world, dug: saved.dug ?? {}, dmg: saved.dmg ?? {} },
          player: {
            ...base.player,
            x: saved.x ?? base.player.x,
            y: saved.y ?? base.player.y,
            facing: saved.facing ?? base.player.facing,
            coins: saved.coins ?? 0,
            earned: saved.earned ?? 0,
            inv: saved.inv ?? {},
            log: saved.log ?? {},
            depth: saved.depth ?? 0,
            best: saved.best ?? 0,
            up: { ...base.player.up, ...(saved.up ?? {}) },
            tech: { ...base.player.tech, ...(saved.tech ?? {}) },
          },
        };
  if (saved.world === undefined && saved.x === undefined && saved.c !== undefined) {
    s.player.x = saved.c + 0.5; // pre-physics grid save
    s.player.y = saved.r + 0.5;
  }
  s.player.vx = 0; // reset transient physics fields
  s.player.vy = 0;
  s.player.grounded = false;
  s.player.digKey = null;
  s.player.digTime = 0;
  return s;
}
function load(): Session | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !(saved.seed || saved.world?.seed)) return null;
    return hydrate(saved);
  } catch {
    return null;
  }
}
// Persist locally as the OFFLINE fallback. When online the server is authoritative and persists
// the session itself (the client streams inputs, never state), so this is just a local cache used
// before the first hello / when the server is unreachable.
function save(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or unavailable — the game stays playable, just not persisted */
  }
}

let s: Session = load() || fresh();
setInterval(save, SAVE_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save();
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
  break(rarity: number): void {
    noise(0.12, 500 + rarity * 120, 0.4);
  },
  ore(rarity: number): void {
    const base = 520 + rarity * 90;
    tone(base, 0.005, 0.14, 'triangle', 0.28);
    setTimeout(() => tone(base * 1.5, 0.005, 0.16, 'triangle', 0.22), 60); // a bright rising fifth
  },
  sell(amount: number): void {
    const notes = [523, 659, 784, 1047]; // C-E-G-C arpeggio; longer for bigger sales
    for (let i = 0; i < Math.min(4, 1 + Math.floor(amount / 40)); i++) {
      setTimeout(() => tone(notes[i], 0.005, 0.22, 'triangle', 0.3), i * 70);
    }
  },
  buy(): void {
    tone(440, 0.005, 0.09, 'square', 0.25);
    setTimeout(() => tone(660, 0.005, 0.12, 'square', 0.22), 70);
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
      cfg: { T, CW, CH, SURFACE: engine.SURFACE, MARGIN, strata: engine.STRATA },
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
    engine.SURFACE,
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
    engine.SURFACE,
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
const ORE_GLOW_SEED = 0.9; // base intensity an exposed ore vein emits (scaled by distance/damage)
const LAMP_BASE_INTENSITY = 0.9; // lamp seed brightness at vision 0
const LAMP_VISION_GAIN = 0.16; // added lamp brightness per unit of vision (Deep Lantern reaches further)

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

  // lamp falloff at a tile: full within 1 tile, easing to a 0.14 floor by the vision radius
  const lightAt = (c: number, r: number): number => {
    const dist = Math.hypot(c - px, r - py);
    return Math.max(0.14, 1 - Math.max(0, dist - 1) / (st.vision + 0.5));
  };

  // ore glow — the ore SURFACE is now baked into the chunks (feathered into the rock via each ore's
  // material shader), and lamp-only vision hides it where the light doesn't reach. Here we only seed
  // each exposed, lit vein's COLOURED glow into the lighting field. (ponytail: the Ore Scanner's
  // old xray-through-the-dark reveal is dropped — it contradicts lamp-only vision; redesign as a HUD
  // ping later. Baked ore also no longer shows a per-hit damage crack; re-add as an FX layer if missed.)
  for (let r = rowT; r <= rowB; r++) {
    if (r <= engine.SURFACE) continue;
    for (let c = colL; c <= colR; c++) {
      if (!solidTile(c, r)) continue;
      const block = engine.blockAt(s.world.seed, c, r);
      if (!block.ore) continue;
      const art = ORE_ART[block.ore];
      if (!art || art.dim) continue; // dirt: plain rock, no glow
      const li = lightAt(c, r);
      const frac = block.hp ? (s.world.dmg[engine.key(c, r)] || 0) / block.hp : 0;
      // an ore vein only emits when EXPOSED (bordering an open tile), so its colour has somewhere to
      // flood: seeded at the exposed OPEN face, the glow spills into the shaft and dies in rock
      // (occlusion-aware). Brightness fades with lamp distance; brighter as mined.
      let nc = c;
      let nr = r;
      if (!solidTile(c, r - 1)) nr = r - 1;
      else if (!solidTile(c, r + 1)) nr = r + 1;
      else if (!solidTile(c - 1, r)) nc = c - 1;
      else if (!solidTile(c + 1, r)) nc = c + 1;
      const exposed = nc !== c || nr !== r;
      if (exposed && (li > 0.16 || frac > 0.05)) {
        const [rr, gg, bb] = hexRgb(art.c[2]);
        const phase = ((hashXY(c, r, 55) & 1023) / 1023) * 6.283; // per-vein pulse offset
        const pulse = 0.85 + 0.15 * Math.sin(t * 2.4 + phase);
        lighting.addLight(
          nc * T + (T >> 1),
          nr * T + (T >> 1),
          1,
          [rr / 255, gg / 255, bb / 255],
          ORE_GLOW_SEED * li * (0.5 + 0.85 * frac) * pulse,
        );
      }
    }
  }

  // tiered damage: chip away tiles taking dig damage (rock + ore alike). Iterate the sparse dmg map
  // (only in-progress tiles), gated to the view + lamp reach. A material may override the shared look.
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

  // idle dust motes drifting near the lamp
  ctx.fillStyle = '#fff';
  for (const m of motes) {
    const mx = (px + (m.x - 0.5) * st.vision * 1.4) * T + T / 2;
    const my = (py + (((m.y + t * 0.03 * m.s) % 1) - 0.5) * st.vision * 1.3) * T + T / 2;
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

  // miner + lamp glow — sprite is 1 tile, centred on the player x and standing on its feet (y+HH)
  const halfHeight = engine.PHYS.HH;
  const bob = s.player.grounded ? Math.sin(t * 10) * (moving ? 0.5 : 0.2) : 0;
  const mX = Math.round(px * T - T / 2);
  const mY = Math.round((py + halfHeight) * T - T);
  drawMiner(ctx, mX, mY, s.player.facing, bob); // lamp bloom is part of the lighting pass

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

  // lighting: push the miner's lamp emitter (seed brightness scales with vision, so the Deep
  // Lantern reaches further), then composite the shared geometry-aware system over the frame.
  // Ore-vein emitters were already pushed in the ore loop above.
  lighting.addLight(
    px * T,
    (py - 0.1) * T,
    0,
    LAMP_COLOR,
    LAMP_BASE_INTENSITY + LAMP_VISION_GAIN * st.vision,
  );
  lighting.render({ g: ctx, LW, LH, T, camX, camY, SURFACE: engine.SURFACE, solidTile });
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
  if (paused()) return;
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
  if (paused()) return;
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
  const rarity = ev.ore ? engine.rarityOf(ev.ore) : 0;
  sfx.dig(ev.r);
  sfx.break(rarity);
  chips(cx, cy, 5 + rarity, ev.ore ? engine.ORE_BY_ID[ev.ore].color : '#6b5a45', 45);
  shake = Math.min(7, shake + 1.2 + rarity * 0.5 + (ev.rich ? 2 : 0));
  if (ev.ore) {
    // ore collected into the inventory (sold later)
    sfx.ore(rarity + (ev.rich ? 2 : 0));
    const col = ev.rich ? '#f2c14e' : engine.ORE_BY_ID[ev.ore].color;
    const name = engine.ORE_BY_ID[ev.ore].name;
    floaty(
      cx,
      cy - 4,
      '+' + ev.qty + ' ' + name + (ev.rich ? '!' : ''),
      col,
      rarity >= 4 || ev.rich,
    );
    for (let i = 0; i < 4 + rarity + (ev.rich ? 8 : 0); i++) chips(cx, cy, 1, col, 55);
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
  const res = engine.physicsStep(s, input, TICK_DT);
  for (const ev of res.events) onEvent(ev);
  moving = Math.abs(s.player.vx) > 0.5;
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
  if (paused()) updateHUD(); // no tick loop while paused → refresh HUD for command results (buys/sells)
}

function frame(now: number): void {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
  const t = now / 1000;
  const workStart = performance.now();
  if (dt > 0) fpsEMA += (1 / dt - fpsEMA) * FPS_EMA_ALPHA; // smoothed frames/sec from real timestamps

  // advance the sim in fixed ticks (paused while a menu overlay is open — don't bank ticks)
  if (paused()) {
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
dbg.classList.toggle('on', DEBUG);
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'F3' || e.code === 'Backquote') {
    DEBUG = !DEBUG;
    dbg.classList.toggle('on', DEBUG);
    e.preventDefault();
  }
});
function updateDebug(): void {
  const st = engine.stats(s.player);
  const up = (canvas.clientWidth / canvas.width).toFixed(2);
  const ore = engine.ORES[s.player.best];
  const netInfo = net.netStatus();
  dbg.textContent =
    `DELVE · debug  (F3 to toggle)\n` +
    `fps   ${fpsEMA.toFixed(1).padStart(5)}   frame ${frameMsEMA.toFixed(2)}ms\n` +
    `pos   ${s.player.x.toFixed(2)},${s.player.y.toFixed(2)}  vel ${s.player.vx.toFixed(1)},${s.player.vy.toFixed(1)}  ${s.player.grounded ? 'ground' : 'air'}  facing ${s.player.facing}\n` +
    `depth ${s.player.depth}m  best ${ore ? ore.name : '—'}\n` +
    `cam   ${camX.toFixed(1)},${camY.toFixed(1)}  view ${VIEW_COLS}×${VIEW_ROWS}\n` +
    `canvas ${canvas.width}×${canvas.height} @${up}×  tile ${TILE_PX}px  world ∞×∞\n` +
    `chunks cached ${chunks.size}  renders ${rebuildCount}  last ${lastRebuildMs.toFixed(2)}ms\n` +
    `fx    particles ${particles.length}  floaties ${floaties.length}  shake ${shake.toFixed(2)}  lights ${lighting.count}\n` +
    `save  dug ${Object.keys(s.world.dug).length}  dmg ${Object.keys(s.world.dmg).length}\n` +
    `econ  coins ${Math.floor(s.player.coins)}  earned ${s.player.earned}  cargo ${engine.invCount(s.player)} (${engine.invValue(s.player)} ◈)\n` +
    `stats interval ${st.interval.toFixed(0)}ms  vision ${st.vision.toFixed(1)}  value ×${st.valueMult.toFixed(1)}  fortune ${(st.fortune * 100).toFixed(0)}%\n` +
    `up    pick ${s.player.up.pick} · speed ${s.player.up.speed} · refine ${s.player.up.refine} · fortune ${s.player.up.fortune}   tech ${s.player.tech.scanner ? 'scanner' : '—'}/${s.player.tech.lantern ? 'lantern' : '—'}\n` +
    `audio ${AC ? (muted ? 'muted' : AC.state) : 'locked'}\n` +
    `net   ${netInfo.status}  ackSeq ${netInfo.ackSeq}  pending ${pendingInputs.length}  seq ${inputSeq}`;
}

// ---- HUD / shop -------------------------------------------------------------------------
const el = (id: string): HTMLElement => document.getElementById(id)!;
const overlay = el('overlay');
const codexOverlay = el('codexOverlay');
const paused = (): boolean =>
  overlay.classList.contains('on') || codexOverlay.classList.contains('on');

function updateHUD(): void {
  el('depth').textContent = String(s.player.depth);
  el('coins').textContent = Math.floor(s.player.coins).toLocaleString();
  el('cargo').textContent = engine.invValue(s.player).toLocaleString();
  const found = el('found');
  const ore = engine.ORES[s.player.best];
  found.textContent = ore ? ore.name : '—';
  found.style.color = ore && s.player.best > 0 ? ore.color : 'var(--dim)';
}

function buildShop(): void {
  const upgradesEl = el('upgrades');
  upgradesEl.innerHTML = '';
  for (const k of Object.keys(engine.UPGRADES) as Array<keyof typeof engine.UPGRADES>) {
    const upgrade = engine.UPGRADES[k];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="info"><div class="nm">${upgrade.name} <span class="lv">Lv ${s.player.up[k]}${s.player.up[k] >= upgrade.max ? ' MAX' : ''}</span></div>
        <div class="ds">${upgrade.desc}</div></div><button data-up="${k}"></button>`;
    upgradesEl.appendChild(row);
  }
  const techEl = el('tech');
  techEl.innerHTML = '';
  for (const k of Object.keys(engine.TECH) as Array<keyof typeof engine.TECH>) {
    const tech = engine.TECH[k];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div class="info"><div class="nm">${tech.name}</div><div class="ds">${tech.desc}</div></div>
        <button data-tech="${k}"></button>`;
    techEl.appendChild(row);
  }
  // Economy actions apply LOCALLY for instant UI (optimistic prediction), and send the intent as a
  // command so the server applies it authoritatively; the next snapshot reconciles. We only send
  // when the local (same-logic) attempt succeeds, so the server — with identical coins — agrees.
  upgradesEl.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.up as keyof typeof engine.UPGRADES | undefined;
    if (!k) return;
    if (engine.buyUpgrade(s.player, k)) {
      net.sendCommand({ kind: 'buyUpgrade', key: k });
      sfx.buy();
      save();
    }
    refreshShop();
  });
  techEl.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.tech as keyof typeof engine.TECH | undefined;
    if (!k) return;
    if (engine.buyTech(s.player, k)) {
      net.sendCommand({ kind: 'buyTech', key: k });
      sfx.buy();
      save();
    }
    refreshShop();
  });
  el('sellBtn').addEventListener('click', () => {
    const amount = engine.sellAll(s.player);
    if (amount > 0) {
      net.sendCommand({ kind: 'sellAll' });
      sfx.sell(amount);
      save();
    }
    refreshShop();
    updateHUD();
  });
}
function refreshShop(): void {
  el('shopCoins').textContent = Math.floor(s.player.coins).toLocaleString();
  // cargo list (ore icon rows) + sell button
  const cargoEl = el('cargoList');
  cargoEl.innerHTML = '';
  const ids = Object.keys(s.player.inv)
    .map(Number)
    .filter((id) => s.player.inv[id] > 0)
    .sort((a, b) => a - b);
  if (!ids.length) {
    cargoEl.textContent = 'empty';
  } else {
    for (const id of ids) {
      const row = document.createElement('span');
      row.className = 'invrow';
      row.appendChild(oreIcon(id, 16));
      const label = document.createElement('span');
      label.innerHTML = `${engine.ORE_BY_ID[id].name} <b>×${s.player.inv[id]}</b>`;
      row.appendChild(label);
      cargoEl.appendChild(row);
    }
  }
  const val = engine.invValue(s.player);
  const sellBtn = el('sellBtn') as HTMLButtonElement;
  sellBtn.textContent = val > 0 ? `Sell all  +${val.toLocaleString()} ◈` : 'Sell all';
  sellBtn.disabled = val <= 0;
  for (const b of el('upgrades').querySelectorAll('button')) {
    const btn = b as HTMLButtonElement;
    const k = btn.dataset.up as keyof typeof engine.UPGRADES;
    const upgrade = engine.UPGRADES[k];
    btn.closest('.row')!.querySelector('.lv')!.textContent =
      'Lv ' + s.player.up[k] + (s.player.up[k] >= upgrade.max ? ' MAX' : '');
    if (s.player.up[k] >= upgrade.max) {
      btn.textContent = 'MAX';
      btn.disabled = true;
    } else {
      const cost = engine.upgradeCost(k, s.player.up[k]);
      btn.textContent = cost.toLocaleString() + ' ◈';
      btn.disabled = s.player.coins < cost;
    }
  }
  for (const b of el('tech').querySelectorAll('button')) {
    const btn = b as HTMLButtonElement;
    const k = btn.dataset.tech as keyof typeof engine.TECH;
    const tech = engine.TECH[k];
    if (s.player.tech[k]) {
      btn.textContent = 'OWNED';
      btn.disabled = true;
    } else {
      btn.textContent = tech.cost.toLocaleString() + ' ◈';
      btn.disabled = s.player.coins < tech.cost;
    }
  }
}
function openShop(): void {
  audio();
  releaseAllHeld();
  aim.down = false;
  refreshShop();
  overlay.classList.add('on');
}
function closeShop(): void {
  overlay.classList.remove('on');
}
el('shopBtn').onclick = openShop;
el('closeBtn').onclick = closeShop;
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeShop();
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
        `<div class="ds" style="color:var(--gold)">mined ${entry.mined.toLocaleString()} · deepest ${entry.deepest}m · ${ore.value} ◈ each</div>`
      : `<div class="nm" style="color:var(--dim)">? ? ?</div><div class="ds">Undiscovered — dig deeper to find it.</div>`;
    row.appendChild(icon);
    row.appendChild(info);
    codexList.appendChild(row);
  }
}
function openCodex(): void {
  audio();
  releaseAllHeld();
  aim.down = false;
  renderCodex();
  codexOverlay.classList.add('on');
}
function closeCodex(): void {
  codexOverlay.classList.remove('on');
}
el('codexBtn').onclick = openCodex;
el('codexClose').onclick = closeCodex;
codexOverlay.addEventListener('click', (e) => {
  if (e.target === codexOverlay) closeCodex();
});

const muteBtn = el('muteBtn');
muteBtn.onclick = () => {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  muteBtn.textContent = muted ? '♪̸' : '♪';
  muteBtn.style.opacity = muted ? '0.5' : '1';
};
el('newBtn').onclick = function () {
  if (!confirm('Start a new mine? Your current progress is lost.')) return;
  s = fresh();
  net.sendCommand({ kind: 'newGame', seed: s.world.seed }); // server resets its world too (→ hello)
  pendingInputs.length = 0;
  inputSeq = 0;
  snapCam();
  chunks.clear();
  pending.clear();
  syncWorkerWorld();
  save();
  refreshShop();
};

// block scroll/zoom gestures on the game
addEventListener(
  'wheel',
  (e) => {
    if (!paused()) e.preventDefault();
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
buildShop();
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
    refreshShop();
    updateHUD();
  },
  onState: (msg) => reconcile(msg),
});
