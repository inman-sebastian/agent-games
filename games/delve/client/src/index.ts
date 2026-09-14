// index.ts — the DELVE game client: the glue that turns the pure sim (engine) and the shared
// renderers (cave-render / ore-art / sprites / lighting) into a playable game. It owns only what
// isn't a rule: the canvas + camera, the game loop, input, audio, juice (particles/floaties/
// shake), the HUD/inventory/codex DOM, and save/load. Every world and gameplay rule is imported —
// never re-implemented here — so the game, the labs, and the tools all obey one ruleset.
import * as engine from '@delve/shared';
import type { Session, Input, TileCoord, SimEvent, StateMessage } from '@delve/shared';
import { T, setStrata as setRenderStrata, mix, hashXY } from './render/cave-render';
import {
  CHUNK_COLS,
  CHUNK_ROWS,
  chunkX,
  chunkY,
  createChunkCache,
  type ChunkWorker,
} from './render/chunks';
import { UPSCALE } from './render/palette';
import { oreMaterial, collectTwinkleEdges, drawDamage } from './render/materials';
import { drawPlayer, poseFor, stepLift, STEP_LIFT_TIME } from './render/entity/player';
import { create as createLighting, LAMP_COLOR } from './render/lighting';
import * as net from './net';
import { load, save, fresh } from './save';
import { createPrediction } from './prediction';
import { unlockAudio, sfx, toggleMute, audioStatus } from './audio';
import { buildInventoryGrid } from './ui/inventory';
import { defineSlot, type DelveSlot } from './ui/slot';
import { installSurfaces } from './ui/surface';

// ---- display + world-view geometry ------------------------------------------------------
// The world grid is CELLS of T=8 art px; four cells make a 16-art-px block (#44). The scene renders at
// that logical resolution and DISPLAYS at UPSCALE with image-rendering:pixelated, so a cell is
// TILE_PX = 16 CSS px on screen and a block is 32 — a clean 2x integer scale.
const TILE_PX = T * UPSCALE; // on-screen size of one CELL (CSS px) — the art grid, shared with the UI
// The world is unbounded in every direction, so the canvas is a VIEWPORT onto it: a 2-axis camera
// keeps the miner centred and we render only the visible tile window. Sized by fit().
let VIEW_COLS = 21;
let VIEW_ROWS = 15;
let LW = VIEW_COLS * T;
let LH = VIEW_ROWS * T;
const CAMERA_LERP = 0.16; // per-frame fraction the camera closes on its target (smooth follow)

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// ---- state / persistence ----------------------------------------------------------------
// load/save (the localStorage cache) live in ./save; turning a save back into a Session is
// engine.hydrate in @delve/shared, shared with the server (extracted so they're testable
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

// ---- rock chunks ------------------------------------------------------------------------
// The rock is cached as world-anchored chunks, baked off-thread as they come into view and re-baked
// when a dig makes them stale. The cache, its Worker protocol and the rules for what a dig invalidates
// live in render/chunks.ts, where they are tested; this is only what the game plugs into it.

// A cell is solid rock when it's below the surface and not yet dug. The world is unbounded — every
// column below the surface is rock until you dig it (no side walls).
const solidTile = (column: number, row: number): boolean =>
  engine.solidAt(s.world.seed, column, row) && !engine.isDug(s.world, column, row);

// a cell's ore material (if it sits in an ore pocket), baked into the rock by composeBand so veins
// feather into the strata. The same lookup the Worker uses; null → the cell renders as plain rock.
const materialAt = (column: number, row: number) =>
  oreMaterial(engine.oreAt(s.world.seed, column, row));

/** The off-thread baker, where the browser can transfer an OffscreenCanvas back; otherwise null. */
function chunkWorker(): ChunkWorker | null {
  const canOffload =
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    !!OffscreenCanvas.prototype.transferToImageBitmap;
  if (!canOffload) return null;
  try {
    // `new URL(..., import.meta.url)` has to stay in this file for Vite to bundle the Worker.
    return new Worker(new URL('./render/chunk-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

const chunkCache = createChunkCache({
  sources: () => ({ solid: solidTile, surfaceAt: surfaceOf, materialAt }),
  dugKeys: () => Object.keys(s.world.dug),
  worker: chunkWorker(),
  seed: () => s.world.seed,
  strata: engine.STRATA,
  makeCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d')! };
  },
});

// ---- lighting ---------------------------------------------------------------------------
// The geometry-aware lighting system lives in render/lighting (shared with the labs, so they
// light identically). We keep one instance; each frame we push the emitters — today only the miner's
// lamp, since ore stopped glowing — then call lighting.render() with the viewport + solidTile.
const lighting = createLighting();

// ---- per-phase frame timing (debug) -----------------------------------------------------
// The 2x2 split (#44) quadrupled the cell count behind an unchanged screen, and "the game runs at
// 34fps" is a symptom, not a diagnosis. The render passes run in sequence, so one timestamp between
// each is enough for every pass to report its own cost in the debug panel — the expensive one names
// itself instead of being guessed at. Smoothed with the same EMA as the fps readout so it's legible
// while playing rather than a flicker of per-frame noise.
const phaseMs: Record<string, number> = {};
let phaseMark = 0;
function beginPhases(): void {
  phaseMark = performance.now();
}
function endPhase(name: string): void {
  const now = performance.now();
  const ms = now - phaseMark;
  phaseMark = now;
  phaseMs[name] =
    phaseMs[name] === undefined ? ms : phaseMs[name] + (ms - phaseMs[name]) * FPS_EMA_ALPHA;
}

// ---- render -----------------------------------------------------------------------------
// The surface is a heightmap (#44), so everything that used to take the constant row now takes this
// — one closure over the live seed, so the renderer, the lighting and the compositor agree.
const surfaceOf = (column: number): number => engine.surfaceAt(s.world.seed, column);

const LAMP_BASE_INTENSITY = 0.9; // lamp seed brightness at lamp reach 0
const LAMP_CORE_CELLS = 1 * engine.SUB; // full brightness within a block of the lamp
const LAMP_EASE_CELLS = 0.5 * engine.SUB; // extra distance the falloff eases over, past the lamp's reach
// Brightness per BLOCK of lamp reach. `lamp` is a distance in cells since the 2x2 split (#44), and
// this is the one place it's read as a brightness rather than a distance — multiplying the cell
// count would inflate the seed and over-light the scene, so it converts back to blocks first.
const LAMP_REACH_GAIN = 0.16; // added lamp brightness per block of lamp reach (Deep Lantern reaches further)

// idle dust motes that drift near the lamp (positions are seeded once, animated by time)
const motes = Array.from({ length: 10 }, () => ({
  x: Math.random(),
  y: Math.random(),
  s: 0.3 + Math.random(),
}));

function render(t: number): void {
  beginPhases();
  ctx.clearRect(0, 0, LW, LH);
  const px = s.player.x + prediction.offsetX; // player centre (cells) + reconciliation smoothing
  const py = s.player.y + prediction.offsetY;
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
  // the cached rock chunks spanning the view (placeholders while a bake is in flight), plus prefetch
  // and eviction around it
  chunkCache.draw(ctx, chunkX(colL), chunkX(colR), chunkY(rowT), chunkY(rowB));
  endPhase('chunks');

  // Distances in CELLS: full brightness within one block of the lamp, easing out over its reach. Both
  // were bare tile counts (1 and 0.5) that the 2x2 split halved in world terms.
  const lightAt = (c: number, r: number): number => {
    const dist = Math.hypot(c - px, r - py);
    return Math.max(0.14, 1 - Math.max(0, dist - LAMP_CORE_CELLS) / (st.lamp + LAMP_EASE_CELLS));
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

  endPhase('damage');

  // animated cluster-edge twinkle: adjacent same-material tiles sharing a lit, exposed face flash as
  // ONE edge — a single glint hops along the whole run. Gated by lamp reach, so only ore you can
  // actually see twinkles. Drawn additively, before the lighting scrim (so lit glints survive it).
  if (debugFlags.twinkle) {
    // Scanned over the LAMP's box, not the viewport's. Every cell the scan visits costs a solidAt
    // plus an oreAt on all four faces, and `lit` already rejects everything past the lamp anyway —
    // so the old full-screen band paid for ~19k cells to keep a couple of hundred. The 2x2 split
    // (#44) made that the second-biggest cost in the frame (9.3ms of a 25ms frame at 160x120).
    // `lightAt` floors at LAMP_MIN_LIT, so beyond this radius no cell can clear `minLit`.
    // lightAt falls to its floor by LAMP_CORE_CELLS + st.lamp + LAMP_EASE_CELLS, so nothing past that
    // can clear minLit; one extra cell of slack for the floor/ceil at the edges.
    const twinkleReach = Math.ceil(LAMP_CORE_CELLS + st.lamp + LAMP_EASE_CELLS) + 1;
    const tL = Math.max(colL, Math.floor(px) - twinkleReach);
    const tR = Math.min(colR, Math.floor(px) + twinkleReach);
    const tT = Math.max(rowT, Math.floor(py) - twinkleReach);
    const tB = Math.min(rowB, Math.floor(py) + twinkleReach);
    const twinkleEdges = collectTwinkleEdges({
      bandLeft: tL,
      bandTop: tT,
      cols: tR - tL + 1,
      rows: tB - tT + 1,
      solid: solidTile,
      materialAt,
      lit: lightAt,
      seedAt: (c, r) => hashXY(c, r, 55),
      minLit: 0.2,
    });
    if (twinkleEdges.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const offX = tL * T;
      const offY = tT * T;
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

  endPhase('twinkle');

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
  // Drawn LOWER than the sim has it while a step-up is being carried up — the only place the
  // renderer deliberately disagrees with the sim about where the player is, and it converges within
  // STEP_LIFT_TIME.
  const lift = stepTiles > 0 ? stepLift(stepTiles, stepAge) : 0;
  drawPlayer(ctx, poseFor(miner.state, t * 1000, walked), footX, Math.round(footY + lift * T), {
    scale: 1,
    facing: s.player.facing,
  }); // lamp bloom is part of the lighting pass

  // floaties: the "+2 Gold" text that rises off a broken ore cell
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

  // mining reticle — the cell being aimed at, bright exactly when the sim would mine it. Reach is the
  // sim's own rule (engine.withinReach, from the body's span) read against the sim's player — not the
  // smoothed display position, and not a centre-cell approximation, which is what this used to be and
  // why it dimmed cells the miner could reach.
  if (curTarget) {
    const { column, row } = curTarget;
    const ok = engine.solidCell(s.world, column, row) && engine.withinReach(s.player, column, row);
    ctx.globalAlpha = ok ? 0.85 : 0.22;
    ctx.strokeStyle = ok ? '#fdf3d4' : '#8892a0';
    ctx.strokeRect(column * T + 0.5, row * T + 0.5, T - 1, T - 1);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  endPhase('entities');

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
      LAMP_BASE_INTENSITY + LAMP_REACH_GAIN * (st.lamp / engine.SUB),
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
  endPhase('lighting');
}

// ---- input ------------------------------------------------------------------------------
// Decoupled controls (#3): move with A/D or ←/→, jump with W/↑/Space. MINING is its own action —
// aim at a tile and hold to mine it (within reach), independent of moving:
//   • mouse / touch: the tile under the cursor, held down to mine (a reticle shows it) — aiming
//     does not turn the miner; only moving does
//   • keyboard: hold J/K to mine in the aim direction (S/↓ aims down, else held side / facing)
type HeldKey = 'left' | 'right' | 'jump' | 'down' | 'mine';
const held: Record<HeldKey, boolean> = {
  left: false,
  right: false,
  jump: false,
  down: false,
  mine: false,
};
let curTarget: TileCoord | null = null;

// The miner's animation/behaviour state (idle/run/jump/fall/mine) as a state machine over the pure
// physics — see @delve/shared miner.ts. Driven once per fixed tick; `.state` picks the animation
// (poseFor in render/entity/player), and the enter hook hangs landing juice on the air→ground transition (a soft thud +
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
  unlockAudio();
});
addEventListener('keyup', (e: KeyboardEvent) => {
  const key = KEYMAP[e.code];
  if (key) held[key] = false;
});

// pointer: a reticle ALWAYS follows the cursor (aim.has once it's moved over the canvas); holding
// the button (aim.down) mines the aimed tile. Movement is keyboard / on-screen buttons — and so is
// FACING: the cursor aims, it never turns the miner (see sampleInput).
const aim = { cx: 0, cy: 0, has: false, down: false };
function setAim(e: PointerEvent): void {
  aim.cx = e.clientX;
  aim.cy = e.clientY;
  aim.has = true;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!simRunning()) return;
  e.preventDefault();
  unlockAudio();
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
// keyboard aim: the neighbour cell in the held/facing direction (S/↓ down, else side/facing).
// Aiming DOWN is relative to the FEET, not the centre. `player.y` is the body's centre and the body
// is 2*HH tall — 3.64 cells since the 2x2 split (#44) — so the old `floor(y) + 1` addressed a cell
// INSIDE the player. It always hit open space, which is not solid, so mining down with the keyboard
// silently did nothing at all. (Sideways is unaffected: the column is outside the body either way.)
function keyboardAimTile(): TileCoord {
  if (held.down) {
    // the cell the feet are standing on. y + HH lands exactly on the boundary when grounded, so
    // nudge inside it before flooring rather than trusting the float to fall the right way.
    return {
      column: Math.floor(s.player.x),
      row: Math.floor(s.player.y + engine.PHYS.HH + 0.01),
    };
  }
  let dx = 0;
  if (held.left) dx = -1;
  else if (held.right) dx = 1;
  else dx = s.player.facing === 'left' ? -1 : 1;
  return { column: Math.floor(s.player.x) + dx, row: Math.floor(s.player.y) };
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
// Predict locally, reconcile against the server without the avatar popping — see prediction.ts.
const prediction = createPrediction();
// Ground covered, in tiles. The walk cycle is phase-locked to this rather than to the clock, so the
// feet turn over with the floor instead of skating across it (see STRIDE_TILES).
let walked = 0;
// A step-up the sim has already resolved, being carried up visually. `tiles` is how far it rose.
let stepTiles = 0;
let stepAge = 0;

// turn a physics event (chip / break / jump) into juice: sound, particles, floaty, and the
// cached-chunk patch when a tile breaks.
function onEvent(ev: SimEvent): void {
  const cx = ev.c * T + T / 2;
  const cy = ev.r * T + T / 2;
  if (ev.type === 'step') {
    // The sim moved the body a whole tile in one tick. Hold the figure where it WAS and carry it up
    // over STEP_LIFT_TIME, so a resolved assist reads as a step rather than as a teleport.
    stepTiles = ev.tiles ?? 1;
    stepAge = 0;
    return;
  }
  if (ev.type === 'chip') {
    sfx.chip();
    chips(cx, cy, 2, '#8a7a66', 25);
    shake = Math.min(3, shake + 0.4);
    return;
  }
  if (ev.type !== 'break') return;
  chunkCache.dig(ev.c, ev.r); // the cell opened → re-bake the chunks that read it
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
    // ore collected into the inventory (there is no selling — collection is the reward)
    sfx.ore(Math.min(1, prize + (ev.rich ? RICH_BONUS : 0)));
    const col = ev.rich ? '#f2c14e' : engine.ORE_BY_ID[ev.ore].color;
    const name = engine.ORE_BY_ID[ev.ore].name;
    // The big floaty is the celebration, so it belongs to the top two tiers and a rich vein of
    // anything. Narrower than before, when it reached down to emerald — but before, it also reached
    // stone bricks.
    floaty(
      cx,
      cy - 4,
      '+' + ev.qty + ' ' + name + (ev.rich ? '!' : ''),
      col,
      prize >= 0.6 || ev.rich,
    );
    for (let i = 0; i < 4 + Math.round(prize * 8) + (ev.rich ? 8 : 0); i++)
      chips(cx, cy, 1, col, 55);
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
  // Facing is NOT set here. It belongs to the movement rule in engine.physicsStep and nowhere else:
  // aiming across the miner used to turn them, which fought the walk direction and flickered on
  // every snapshot — `facing` lives in PlayerState, which the server owns and replaces wholesale,
  // and it is not part of Input, so a mouse-derived facing could never reach the server to be
  // agreed on. You aim independently of where you're facing; the reticle shows where you're aiming.
  return { left: held.left, right: held.right, jump: held.jump, mine: mineNow };
}

// One fixed sim step: predict locally (turning events into juice), and when online stream the
// input to the server + buffer it so the next authoritative snapshot can be reconciled.
function tick(): void {
  const input = sampleInput();
  if (net.isOnline()) {
    net.sendInput(prediction.record(input), input);
  }
  lastFallSpeed = s.player.vy; // pre-step descent speed (vy>0 = falling); the landing hook reads it
  const res = engine.physicsStep(s, input, TICK_DT);
  // Only while actually on the ground: a cycle advanced by airborne drift would land mid-stride.
  if (s.player.grounded) walked += Math.abs(s.player.vx) * TICK_DT;
  for (const ev of res.events) onEvent(ev);
  engine.driveMiner(miner, s.player, s.player.digKey !== null); // may fire the landing hook above
}

// Reconcile the local prediction against an authoritative snapshot: adopt the server's player,
// apply the world deltas, then replay inputs the server hasn't acked yet to re-predict "now".
// Any residual difference is absorbed into a decaying render offset so corrections never pop.
function reconcile(msg: StateMessage): void {
  for (const cellKey of prediction.reconcile(s, msg)) {
    const comma = cellKey.indexOf(',');
    chunkCache.dig(+cellKey.slice(0, comma), +cellKey.slice(comma + 1)); // a dig the server saw first
  }
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

  // carry a resolved step-up upward (see stepLift)
  if (stepTiles > 0) {
    stepAge += dt;
    if (stepAge >= STEP_LIFT_TIME) stepTiles = 0;
  }

  // decay the reconciliation correction toward 0 (framerate-independent)
  prediction.decay(dt);

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
  const chunkStats = chunkCache.stats();
  const st = engine.stats(s.player);
  const up = (canvas.clientWidth / canvas.width).toFixed(2);
  const netInfo = net.netStatus();
  dbgText.textContent =
    `DELVE · debug  (F3 to toggle)\n` +
    `fps   ${fpsEMA.toFixed(1).padStart(5)}   frame ${frameMsEMA.toFixed(2)}ms\n` +
    `pos   ${s.player.x.toFixed(2)},${s.player.y.toFixed(2)}  vel ${s.player.vx.toFixed(1)},${s.player.vy.toFixed(1)}  ${s.player.grounded ? 'ground' : 'air'}  facing ${s.player.facing}\n` +
    `depth ${metres(s.player.depth)}m (cell row ${s.player.depth})\n` +
    `cam   ${camX.toFixed(1)},${camY.toFixed(1)}  view ${VIEW_COLS}×${VIEW_ROWS}\n` +
    `canvas ${canvas.width}×${canvas.height} @${up}×  tile ${TILE_PX}px  world ∞×∞\n` +
    `phase ${Object.entries(phaseMs)
      .map(([name, ms]) => `${name} ${ms.toFixed(1)}`)
      .join('  ')}\n` +
    `light field ${lighting.fieldMs.toFixed(1)}ms  scrim ${lighting.scrimMs.toFixed(1)}ms\n` +
    `bakes ${chunkStats.bakes}  ${chunkStats.bakeMs.toFixed(1)}ms round trip  inflight ${chunkStats.inflight}  chunk ${CHUNK_COLS}x${CHUNK_ROWS} cells\n` +
    `chunks cached ${chunkStats.cached}  sync bakes ${chunkStats.syncBakes}  last ${chunkStats.lastSyncBakeMs.toFixed(2)}ms\n` +
    `fx    particles ${particles.length}  floaties ${floaties.length}  shake ${shake.toFixed(2)}  lights ${lighting.count}\n` +
    `save  dug ${Object.keys(s.world.dug).length}  dmg ${Object.keys(s.world.dmg).length}\n` +
    `held  ${engine.invCount(s.player)} materials\n` +
    `stats interval ${st.interval.toFixed(0)}ms  lamp ${st.lamp.toFixed(1)}  fortune ${(st.fortune * 100).toFixed(0)}%\n` +
    `up    pick ${s.player.up.pick} · speed ${s.player.up.speed} · fortune ${s.player.up.fortune}   tech ${s.player.tech.lantern ? 'lantern' : '—'}\n` +
    `audio ${audioStatus()}\n` +
    `net   ${netInfo.status}  ackSeq ${netInfo.ackSeq}  pending ${prediction.pendingCount}  seq ${prediction.seq}`;
}

// ---- HUD / inventory --------------------------------------------------------------------
// Depth is shown in METRES, and a metre is a BLOCK: the miner is 1.82 blocks tall, a person-sized
// 1.82m. The sim records depth as a cell row, so every readout converts — without this the 2x2
// split (#44) doubled every depth the player saw (the HUD, the codex's "deepest", the debug panel)
// with no change in how deep anything actually was.
const metres = (row: number): number => engine.blockOf(row);
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
  unlockAudio();
  closeMenus();
  node.classList.add('on');
  app.send('pause'); // no-op if already paused
}
function resume(): void {
  closeMenus();
  app.send('resume'); // no-op if already playing (e.g. closing the last panel)
}

function updateHUD(): void {
  el('depth').textContent = String(metres(s.player.depth));
  el('held').textContent = engine.invCount(s.player).toLocaleString();
}

// The inventory panel: every material the player is holding, as icon + name + count rows.
function refreshInventory(): void {
  el('invTotal').textContent = engine.invCount(s.player).toLocaleString();
  const listEl = el('invList');
  listEl.innerHTML = '';
  listEl.appendChild(buildInventoryGrid(s.player.inv, engine.ORE_BY_ID));
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

    // The same slot widget the inventory is made of: FOUND shows the real material, undiscovered is
    // a `locked` slot. That kills the `?` glyph, which was a found asset standing in for art, and it
    // means an undiscovered entry reads as a thing you have not got rather than as missing data.
    const slot = document.createElement('delve-slot') as DelveSlot;
    slot.setAttribute('state', found ? 'filled' : 'locked');
    if (found) slot.setAttribute('ore', String(ore.id));

    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = found
      ? `<div class="nm">${ore.name}</div><div class="ds">${ore.desc}</div>` +
        `<div class="ds" style="color:var(--c-gold)">mined ${entry.mined.toLocaleString()} · deepest ${metres(entry.deepest)}m</div>`
      : `<div class="nm" style="color:var(--c-dim)">? ? ?</div><div class="ds">Undiscovered — dig deeper to find it.</div>`;
    row.appendChild(slot);
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
  const muted = toggleMute();
  muteBtn.textContent = muted ? '♪̸' : '♪';
  muteBtn.style.opacity = muted ? '0.5' : '1';
};
function newGame(): void {
  if (!confirm('Start a new mine? Your current progress is lost.')) return;
  s = fresh();
  net.sendCommand({ kind: 'newGame', seed: s.world.seed }); // server resets its world too (→ hello)
  prediction.reset();
  snapCam();
  chunkCache.reset(); // drops every chunk AND every bake still in flight for the old world
  save(s);
  refreshInventory();
  resume(); // close any open menu and hand control back to the mine
}
el('newBtn').onclick = newGame;

// ---- title / pause screens --------------------------------------------------------------
el('startBtn').onclick = () => {
  unlockAudio(); // first user gesture unlocks the AudioContext
  app.send('start');
};
// `?play` skips the title screen, so `shot.sh index.html` can capture the actual game instead of
// the title panel — the reason a real-game screenshot used to need Playwright. It deliberately does
// NOT unlock audio: that needs a genuine user gesture, and a headless capture has none.
if (/(\?|&)play\b/.test(location.search)) app.send('start');
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
// Cells render at a FIXED on-screen size: one art px is UPSCALE (2) CSS px, so an 8-art-px cell is
// 16 CSS px, and image-rendering:pixelated takes it on to device pixels crisply for free — no per-DPR
// render path needed. The camera centres the miner and the canvas is centred in the viewport.
// ponytail: fixed 1:1 for now; revisit fit + true fill when we tackle viewport framing.
// Both bounds are in CELLS, so the 2x2 split (#44) scales them — they were left behind, which
// capped a wide window at half the world it used to show and stopped the canvas filling the
// viewport at all. The cap only exists to stop a huge window asking for an unbounded canvas; the
// lighting no longer scales with screen area (it tracks the lamp's reach), so the old world-area
// limit is still the right one to express.
const MIN_VIEW_TILES = 9 * engine.SUB;
const MAX_VIEW_TILES = 160 * engine.SUB;
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
      unlockAudio();
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

installSurfaces(); // generate the nine-slice panel frames into CSS custom properties (ui/surface.ts)
defineSlot(); // register <delve-slot>, the widget four surfaces are made of (ui/slot.ts)
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
    s = engine.hydrate(snapshot);
    prediction.reset();
    chunkCache.reset(); // drops every chunk AND every bake still in flight for the old world
    snapCam();
    refreshInventory();
    updateHUD();
  },
  onState: (msg) => reconcile(msg),
});
