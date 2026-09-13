// char-lab.ts — DRIVE a character against real collision, and swap which one (#47).
//
// The scale question a sprite trial raises cannot be answered by looking at a sprite. A 15px figure
// and a 30px figure are not two pictures, they are two BODIES: the current 0.9 x 1.82 box was derived
// from the current art, and every clearance in DESIGN.md follows from it. So the only honest way to
// compare them is to walk each one through the same terrain and feel where it fits.
//
// This runs the REAL sim — `physicsStep` from @delve/shared, the same function the game and the
// server call — against a hand-cut fixture built around the exact clearances in question. Nothing
// about movement or collision is reimplemented here; if it behaves differently to the game, the lab
// is wrong.
//
// Controls: arrows or A/D to move, space or W to jump, R to reset, 1-3 to swap character,
// H toggles the hitbox, G toggles the tile grid.
import { T, setStrata, composeBand, UPSCALE } from '../src/render/cave-render';
import * as engine from '@delve/shared';
import type { Input, MinerState, Session } from '@delve/shared';
import { drawPlayer, poseFor, stepLift, STEP_LIFT_TIME } from '../src/render/entity/player';
import { HANA_SKIN, MINER_SKIN } from '../src/render/entity/skin';
import * as sprites from '../src/render/entity/sprites';
import type { SpriteAnim } from '../src/render/entity/sprite';
import { installSurfaces } from '../src/ui/surface';

/** A character under test: which sprites, how big its body is, and how it is drawn. */
interface Candidate {
  readonly id: string;
  readonly label: string;
  /** Half-extents in tiles. `null` keeps the engine default. */
  readonly body: { hw: number; hh: number } | null;
  readonly registry: Record<string, SpriteAnim>;
  readonly skin: typeof MINER_SKIN;
  readonly skinId: string;
  /** Whole-number sprite scale. Anything else stops being pixel art. */
  readonly scale: number;
  readonly note: string;
}

const P = sprites.PLAYER_SPRITES as unknown as Record<string, SpriteAnim>;
const H = sprites.HANA_SPRITES as unknown as Record<string, SpriteAnim>;

const CANDIDATES: readonly Candidate[] = [
  {
    id: 'player',
    label: '1 · Miner (current)',
    body: null, // 0.45 x 0.91 → 0.9 x 1.82 tiles
    registry: P,
    skin: MINER_SKIN,
    skinId: 'miner',
    scale: 1,
    note: '30px sprite, 1.82-tile body. Needs 2 tiles to stand, 3 to jump indoors.',
  },
  {
    id: 'hana1',
    label: '2 · Base character 1x',
    // The sprite is 15 art px tall, so the body follows it: just under one tile.
    body: { hw: 0.32, hh: 0.47 },
    registry: H,
    skin: HANA_SKIN,
    skinId: 'hana',
    scale: 1,
    note: '15px sprite, 0.94-tile body. One tile of headroom is enough — every tunnel opens up.',
  },
  {
    id: 'hana2',
    label: '3 · Base character 2x',
    body: null, // matches the miner's box, since the sprite matches its height
    registry: H,
    skin: HANA_SKIN,
    skinId: 'hana',
    scale: 2,
    note: 'Same 15px art at 2x: matches the miner exactly, but its pixels are twice the world’s.',
  },
];

let pick = 0;
const candidate = (): Candidate => CANDIDATES[pick];

// ---- the fixture -------------------------------------------------------------------------------
//
// Cut by hand from a per-column table rather than generated, because the point is to hit SPECIFIC
// clearances on purpose. Each zone is one question you cannot answer by looking at a sprite.
//
// `floor` is the topmost solid ground row; `head` is how many open tiles sit above it. So a zone with
// head 2 is a corridor you can stand in and not jump in — for the current body. For a one-tile body
// it is generous, and that difference is the entire decision.
const SEED = 4242;
const ROW = 120; // the ground line
const LEFT = 40;
const ROWS = 18;

interface Zone {
  readonly cols: number;
  readonly floor: number;
  readonly head: number;
  readonly label: string;
}

const ZONES: readonly Zone[] = [
  { cols: 8, floor: 0, head: 10, label: 'spawn' },
  { cols: 3, floor: 1, head: 9, label: '1-tile step' },
  { cols: 3, floor: 0, head: 10, label: '' },
  { cols: 3, floor: 2, head: 8, label: '2-tile step' },
  { cols: 3, floor: 0, head: 10, label: '' },
  { cols: 7, floor: 0, head: 2, label: '2-tile corridor' },
  { cols: 2, floor: 0, head: 10, label: '' },
  { cols: 6, floor: 0, head: 3, label: '3-tile corridor' },
  { cols: 2, floor: 0, head: 10, label: '' },
  { cols: 5, floor: 0, head: 1, label: '1-tile crawl' },
  { cols: 2, floor: 0, head: 10, label: '' },
  { cols: 3, floor: -7, head: 17, label: 'shaft' },
  { cols: 3, floor: 0, head: 10, label: '' },
];

const COLS = ZONES.reduce((n, z) => n + z.cols, 0);

/** Column → the zone covering it, for the labels drawn under the fixture. */
const zoneAt: Zone[] = [];
{
  let c = 0;
  for (const z of ZONES) for (let i = 0; i < z.cols; i++) zoneAt[c++] = z;
}

function buildWorld(): Session {
  const session = engine.newSession(SEED);
  const dug = session.world.dug;
  let c = LEFT;
  for (const z of ZONES) {
    for (let i = 0; i < z.cols; i++, c++) {
      // Everything starts solid (an untouched world has nothing dug), so only the air is carved.
      const floorTop = ROW - z.floor;
      for (let r = floorTop - 1; r >= floorTop - z.head; r--) dug[engine.key(c, r)] = true;
    }
  }
  return session;
}

let session = buildWorld();

function spawn(): void {
  const c = candidate();
  const p = session.player;
  if (c.body) {
    p.hw = c.body.hw;
    p.hh = c.body.hh;
  } else {
    delete p.hw;
    delete p.hh;
  }
  p.x = LEFT + 3.5;
  p.y = ROW + 1 - (p.hh ?? engine.PHYS.HH);
  p.vx = 0;
  p.vy = 0;
  p.grounded = true;
  engine.unstick(session.world, p);
}
spawn();

// ---- input -------------------------------------------------------------------------------------

const held = { left: false, right: false, jump: false };
let showHitbox = true;
let showGrid = false;

addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') held.left = true;
  else if (e.key === 'ArrowRight' || e.key === 'd') held.right = true;
  else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') held.jump = true;
  else if (e.key === 'r' || e.key === 'R') {
    session = buildWorld();
    spawn();
    baked = null; // the fixture is the only thing that can change the rock
  } else if (e.key === 'h' || e.key === 'H') showHitbox = !showHitbox;
  else if (e.key === 'g' || e.key === 'G') showGrid = !showGrid;
  else if (e.key >= '1' && e.key <= String(CANDIDATES.length)) {
    pick = Number(e.key) - 1;
    spawn();
    render();
  } else return;
  e.preventDefault();
});
addEventListener('keyup', (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') held.left = false;
  else if (e.key === 'ArrowRight' || e.key === 'd') held.right = false;
  else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') held.jump = false;
});

// ---- the loop ----------------------------------------------------------------------------------

setStrata(engine.STRATA);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const LW = COLS * T;
const LH = ROWS * T;
canvas.width = LW;
canvas.height = LH;
canvas.style.width = `${LW * UPSCALE}px`;
canvas.style.height = `${LH * UPSCALE}px`;
g.imageSmoothingEnabled = false;

const bandTop = ROW - 12; // 12 tiles of air above the ground line, plus the shaft below

/**
 * The rock, composited ONCE into an offscreen canvas and blitted after that.
 *
 * It was being recomposited every frame, which is 212,000 pixels through the rock shader sixty times
 * a second — and that is why the lab ran visibly slower than the game. The game never does this: a
 * chunk worker bakes the rock into ImageBitmaps and the frame loop only blits them
 * (`client/src/render/chunk-worker.ts`). The terrain here is static apart from a reset, so caching it
 * is both correct and the same trick.
 *
 * The zone labels are baked in too. They never move either.
 */
let baked: HTMLCanvasElement | null = null;

function bakeWorld(): void {
  const t0 = performance.now();
  const cv = document.createElement('canvas');
  cv.width = LW;
  cv.height = LH;
  const bg = cv.getContext('2d')!;
  bg.imageSmoothingEnabled = false;
  composeBand(bg, solidTile, LEFT, bandTop, COLS, ROWS, engine.WIDTH, () => -1);
  bg.font = '8px ui-monospace, monospace';
  bg.textAlign = 'center';
  bg.fillStyle = '#f9c22b';
  let col = 0;
  for (const z of ZONES) {
    if (z.label) bg.fillText(z.label, (col + z.cols / 2) * T, (ROW - bandTop) * T + 10);
    col += z.cols;
  }
  baked = cv;
  // Logged once, because this number is the reason the cache exists: it is what a frame used to
  // cost, and it is the difference between a lab that matches the game and one that does not.
  console.log(`rock composited in ${(performance.now() - t0).toFixed(1)}ms — cached from here`);
}
const solidTile = (c: number, r: number): boolean =>
  r > engine.surfaceAt(SEED, c) && !session.world.dug[engine.key(c, r)];

// Locomotion state, mirroring the game's: distance for the cycle, and a step-up being carried up.
let walked = 0;
let stepTiles = 0;
let stepAge = 0;
let minerState: MinerState = 'idle';

let last = 0;
let accumulator = 0;
// Smoothed, and both shown in the readout. `fps` is capped by the display, so it cannot by itself
// tell a slow lab from a slow monitor — headless Chrome reports 30 for the real game too. `drawMs`
// is the number that actually answers it: the work one frame costs, independent of refresh rate.
// This lab ran visibly slow and it went unnoticed until it was FELT, which is what a number prevents.
let fps = 0;
let drawMs = 0;

function tick(): void {
  const input: Input = { left: held.left, right: held.right, jump: held.jump };
  const res = engine.physicsStep(session, input, engine.TICK_DT);
  for (const ev of res.events) {
    if (ev.type === 'step') {
      stepTiles = ev.tiles ?? 1;
      stepAge = 0;
    }
  }
  const p = session.player;
  if (p.grounded) walked += Math.abs(p.vx) * engine.TICK_DT;
  minerState = !p.grounded ? (p.vy < 0 ? 'jump' : 'fall') : Math.abs(p.vx) > 0.05 ? 'run' : 'idle';
}

function render(): void {
  if (!baked) bakeWorld();
  g.drawImage(baked!, 0, 0);

  if (showGrid) {
    g.strokeStyle = '#ffffff18';
    g.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      g.beginPath();
      g.moveTo(c * T + 0.5, 0);
      g.lineTo(c * T + 0.5, LH);
      g.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      g.beginPath();
      g.moveTo(0, r * T + 0.5);
      g.lineTo(LW, r * T + 0.5);
      g.stroke();
    }
  }

  const c = candidate();
  const p = session.player;
  const hw = p.hw ?? engine.PHYS.HW;
  const hh = p.hh ?? engine.PHYS.HH;
  const sx = (p.x - LEFT) * T;
  const sy = (p.y - bandTop) * T;

  // The hitbox, drawn from the SAME half-extents the sim collides with — so a mismatch between the
  // box and the sprite is visible rather than inferred. That is the whole point of the lab.
  if (showHitbox) {
    g.fillStyle = '#f9c22b22';
    g.fillRect(
      Math.round(sx - hw * T),
      Math.round(sy - hh * T),
      Math.round(hw * 2 * T),
      Math.round(hh * 2 * T),
    );
    g.strokeStyle = '#f9c22b';
    g.lineWidth = 1;
    g.strokeRect(
      Math.round(sx - hw * T) + 0.5,
      Math.round(sy - hh * T) + 0.5,
      Math.round(hw * 2 * T) - 1,
      Math.round(hh * 2 * T) - 1,
    );
  }

  const lift = stepTiles > 0 ? stepLift(stepTiles, stepAge) : 0;
  drawPlayer(
    g,
    poseFor(minerState, performance.now(), walked, c.registry),
    Math.round(sx),
    Math.round(sy + hh * T + lift * T),
    { scale: c.scale, facing: p.facing, skin: c.skin, skinId: c.skinId + c.scale },
  );

  const readout = document.getElementById('readout')!;
  readout.textContent =
    `${c.label}   body ${(hw * 2).toFixed(2)} x ${(hh * 2).toFixed(2)} tiles   ` +
    `sprite ${c.scale}x   state ${minerState}   ${fps.toFixed(0)} fps   ` +
    `${drawMs.toFixed(2)} ms/frame\n${c.note}`;
}

function frame(now: number): void {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt > 0) fps += (1 / dt - fps) * 0.1;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= engine.TICK_DT && steps < 8) {
    tick();
    accumulator -= engine.TICK_DT;
    steps++;
  }
  if (stepTiles > 0) {
    stepAge += dt;
    if (stepAge >= STEP_LIFT_TIME) stepTiles = 0;
  }
  const t0 = performance.now();
  render();
  drawMs += (performance.now() - t0 - drawMs) * 0.1;
  requestAnimationFrame(frame);
}

installSurfaces();
requestAnimationFrame(frame);
document.title = 'ready';
