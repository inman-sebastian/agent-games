// rule.ts — the pixel fluid's rule (#87), in TypeScript. It's the reference: gpu/fluid.wgsl is its WGSL twin,
// fluid-lab checks the two agree pixel for pixel, and rule.test.ts property-tests this one. The model and
// why it's built this way are in docs/FLUIDS.md.
//
// One pass is three stages, each reading only the stage before it, so every pixel can run at once:
//
//   1. head   relax the hydraulic head field — each resting liquid pixel's body surface height
//   2. fall   every run of liquid over empty space falls one pixel, together
//   3. flow   a Margolus block pass: lava sinks through water, liquid slides and flows sideways
//
// Integers and hashes only, so both twins compute exactly the same thing.
import { hashXY } from '@delve/shared';

export const EMPTY = 0;
export const WATER = 1;
export const LAVA = 2;

/** A pixel's state: kind in bits 0–1, direction in bit 2 (1 = right), energy in bits 8–15. */
export const KIND_MASK = 3;
export const DIRECTION_BIT = 4;
export const ENERGY_SHIFT = 8;

export const kindOf = (state: number): number => state & KIND_MASK;
export const energyOf = (state: number): number => (state >>> ENERGY_SHIFT) & 255;
export const liquid = (kind: number, right: boolean, energy: number): number =>
  kind | (right ? DIRECTION_BIT : 0) | (energy << ENERGY_SHIFT);
const withEnergy = (state: number, energy: number): number =>
  (state & ~(255 << ENERGY_SHIFT)) | (energy << ENERGY_SHIFT);

/**
 * Head is measured in HEAD_UNITS per pixel of height. A step through liquid adds to it: HEAD_SIDE sideways,
 * HEAD_UP upward, nothing downward. Every cycle therefore costs something, so a head left behind by a
 * surface that has drained away climbs back to the truth instead of circulating forever.
 *
 * The sideways cost must be tiny, because it's how far out of level a settled body can stay: a pool
 * can't feel a surface that stands less than a pixel higher per HEAD_UNITS pixels away. At a quarter pixel
 * per pixel a wide pool froze three pixels out of level; at 1/256 it settles flat (rule.test.ts).
 */
export const HEAD_UNITS = 256;
export const HEAD_SIDE = 1;
export const HEAD_UP = HEAD_UNITS;

/**
 * Under pressure: the body's surface stands MORE than one pixel above. One pixel isn't pressure — a stray
 * pixel lying on a pool's partial top row would push the pixel under it sideways into the row's gaps
 * forever, and the pool would never settle (found by rule.test.ts's basin property).
 */
export const underPressure = (head: number, y: number): boolean =>
  head + HEAD_UNITS < y * HEAD_UNITS;

/** The longest run of liquid that falls as one in a pass; a longer column falls in pieces this long. */
export const FALL_RUN = 64;

export interface FluidParams {
  /** Pixels surface liquid may run sideways without falling, 0–255. */
  energy: number;
  /**
   * How far along its row liquid with no energy left looks for a drop. It flows toward one it can see,
   * so a settled surface is flat to one pixel in `sight` — a slope doesn't hold like sand.
   */
  sight: number;
  /** Head relaxation steps per pass: how fast pressure news travels through a body, in pixels. */
  headSteps: number;
  /** Chance, out of CHANCE_SCALE, that a kind acts on a pass — its speed. Indexed by kind. */
  chance: readonly [number, number, number];
}

export const CHANCE_SCALE = 1024;

export const DEFAULT_PARAMS: FluidParams = {
  energy: 255,
  sight: 8,
  headSteps: 4,
  // water every pass; lava a quarter as often: slow in time, never short in reach (FLUIDS.md, lesson 3)
  chance: [0, CHANCE_SCALE, CHANCE_SCALE / 4],
};

export interface FluidGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major pixel states. */
  state: Uint32Array<ArrayBuffer>;
  /** Row-major hydraulic head, in HEAD_UNITS; carried between passes and relaxed each one. */
  head: Uint32Array<ArrayBuffer>;
  /** Row-major, 1 where rock is. */
  readonly solid: Uint8Array<ArrayBuffer>;
}

export function createFluidGrid(
  width: number,
  height: number,
  solid: Uint8Array<ArrayBuffer>,
): FluidGrid {
  const head = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) head.fill(y * HEAD_UNITS, y * width, (y + 1) * width);
  return { width, height, state: new Uint32Array(width * height), head, solid };
}

/** What a pass did, for the tests: where every sideways move started, and the state the flow stage read. */
export interface PassLog {
  sideways: { x: number; y: number }[];
  fallen?: Uint32Array;
}

/** Hash seeds for a pass: the flow stage's blocks and the fall stage's runs roll independently. Kept
 *  under 2^25 so the JavaScript multiply inside hashXY stays exact, as the WGSL u32 multiply is. */
const flowSeed = (pass: number): number => (pass & 0xffffff) * 2;
const fallSeed = (pass: number): number => (pass & 0xffffff) * 2 + 1;
const chanceOf = (roll: number): number => (roll >>> 16) & (CHANCE_SCALE - 1);

type Reader = (x: number, y: number) => number;

/** A reader over a state: -1 for rock or outside the grid. */
function readerFor(grid: FluidGrid, state: Uint32Array): Reader {
  const { width, height, solid } = grid;
  return (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height || solid[y * width + x] ? -1 : state[y * width + x];
}

const isLiquidValue = (value: number): boolean => value >= 0 && kindOf(value) !== EMPTY;
const isOccupiedValue = (value: number): boolean => value < 0 || kindOf(value) !== EMPTY;

/** Liquid standing on something: what head flows through. Falling liquid never takes part (lesson 1). */
export const resting = (at: Reader, x: number, y: number): boolean =>
  isLiquidValue(at(x, y)) && isOccupiedValue(at(x, y + 1));

/** Stage 1, one relaxation step: a resting pixel's head is the best of its own height and its neighbours'. */
export function headStep(
  grid: FluidGrid,
  at: Reader,
  head: Uint32Array,
  x: number,
  y: number,
): number {
  const own = y * HEAD_UNITS;
  if (!resting(at, x, y)) return own;
  const index = (nx: number, ny: number): number => ny * grid.width + nx;
  let best = own;
  if (resting(at, x, y - 1)) best = Math.min(best, head[index(x, y - 1)]); // from above: no cost
  if (resting(at, x, y + 1)) best = Math.min(best, head[index(x, y + 1)] + HEAD_UP);
  if (resting(at, x - 1, y)) best = Math.min(best, head[index(x - 1, y)] + HEAD_SIDE);
  if (resting(at, x + 1, y)) best = Math.min(best, head[index(x + 1, y)] + HEAD_SIDE);
  return best;
}

/**
 * Stage 2: does the liquid at (x, y) fall this pass? It does when it heads a run of liquid, at most
 * FALL_RUN long, that ends over empty space, and the run's bottom pixel's kind comes up on its chance.
 * Every pixel of a run finds the same bottom, so the whole run moves together: a stream stays whole.
 */
export function falls(
  at: Reader,
  x: number,
  y: number,
  pass: number,
  params: FluidParams,
): boolean {
  if (!isLiquidValue(at(x, y))) return false;
  for (let k = 1; k <= FALL_RUN; k++) {
    const below = at(x, y + k);
    if (below < 0) return false;
    if (kindOf(below) !== EMPTY) continue;
    const bottom = at(x, y + k - 1);
    return chanceOf(hashXY(x, y + k - 1, fallSeed(pass))) < params.chance[kindOf(bottom)];
  }
  return false;
}

/**
 * Stage 3: the four pixels of the block whose top-left is (x0, y0) after the flow pass, as [a, b, c, d]
 * (top-left, top-right, bottom-left, bottom-right). `at` reads the fallen state; `pressurized(x, y)` says
 * whether the body's surface stands above that pixel.
 */
export function blockStep(
  x0: number,
  y0: number,
  pass: number,
  params: FluidParams,
  at: Reader,
  pressurized: (x: number, y: number) => boolean,
  log?: PassLog,
): [number, number, number, number] {
  const chanceRoll = chanceOf(hashXY(x0, y0, flowSeed(pass)));
  const s = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
  const moved = [false, false, false, false];
  const isRock = (i: number): boolean => s[i] < 0;
  const kind = (i: number): number => (isRock(i) ? EMPTY : kindOf(s[i]));
  const isLiquid = (i: number): boolean => kind(i) !== EMPTY;
  const isEmpty = (i: number): boolean => !isRock(i) && kind(i) === EMPTY;
  const occupied = (i: number): boolean => isRock(i) || kind(i) !== EMPTY;
  const acts = (i: number): boolean => chanceRoll < params.chance[kind(i)];
  const move = (from: number, to: number, energy: number): void => {
    const travelling = withEnergy(s[from], energy);
    s[from] = s[to];
    s[to] = travelling;
    moved[from] = true;
    moved[to] = true;
  };

  // lava sinks through water
  for (const [top, bottom] of [
    [0, 2],
    [1, 3],
  ]) {
    if (kind(top) === LAVA && kind(bottom) === WATER && acts(top)) move(top, bottom, params.energy);
  }

  // diagonal slide: liquid over something, into the empty diagonal below, past an empty side
  if (isLiquid(0) && !moved[0] && acts(0) && occupied(2) && isEmpty(3) && isEmpty(1)) {
    move(0, 3, params.energy);
  } else if (isLiquid(1) && !moved[1] && acts(1) && occupied(3) && isEmpty(2) && isEmpty(0)) {
    move(1, 2, params.energy);
  }

  // sideways flow for supported liquid: under pressure, toward the open side; at the surface, while it
  // has energy or can see a drop
  const flow = (
    from: number,
    to: number,
    towardRight: boolean,
    supported: boolean,
    x: number,
    y: number,
  ): void => {
    if (!supported) return;
    if (!isLiquid(from) || moved[from] || !acts(from)) return;
    const underPressure = pressurized(x, y);
    const energy = energyOf(s[from]);
    const stored = (s[from] & DIRECTION_BIT) !== 0;
    const seesAhead = !underPressure && energy === 0 && dropAhead(x, y, stored);
    if (!underPressure && energy === 0 && !seesAhead && dropAhead(x, y, !stored)) {
      if (stored === towardRight) s[from] ^= DIRECTION_BIT; // turn to face the drop behind
      return;
    }
    if (!underPressure && stored !== towardRight) return;
    if (isEmpty(to) && !moved[to] && (underPressure || energy > 0 || seesAhead)) {
      log?.sideways.push({ x, y });
      if (underPressure) s[from] = (s[from] & ~DIRECTION_BIT) | (towardRight ? DIRECTION_BIT : 0);
      move(from, to, underPressure ? params.energy : Math.max(0, energy - 1));
    } else if (!isEmpty(to) && !underPressure && energy > 0) {
      // blocked: turn around, which costs energy too, so liquid boxed in on both sides comes to rest
      s[from] = withEnergy(s[from] ^ DIRECTION_BIT, energy - 1);
    }
  };
  // A drop within sight along the row: an empty pixel over empty space, with nothing in the way before it.
  function dropAhead(x: number, y: number, right: boolean): boolean {
    const step = right ? 1 : -1;
    for (let k = 1; k <= params.sight; k++) {
      const ahead = at(x + k * step, y);
      if (ahead < 0 || kindOf(ahead) !== EMPTY) return false;
      if (!isOccupiedValue(at(x + k * step, y + 1))) return true;
    }
    return false;
  }
  // The bottom row stands on what's below the block; the top row on the bottom row.
  flow(2, 3, true, isOccupiedValue(at(x0, y0 + 2)), x0, y0 + 1);
  flow(3, 2, false, isOccupiedValue(at(x0 + 1, y0 + 2)), x0 + 1, y0 + 1);
  flow(0, 1, true, occupied(2), x0, y0);
  flow(1, 0, false, occupied(3), x0 + 1, y0);

  return [s[0], s[1], s[2], s[3]];
}

/** One pass over the whole grid: head, fall, flow. The flow tiling is offset by one pixel on odd passes. */
export function stepFluid(
  grid: FluidGrid,
  pass: number,
  params: FluidParams = DEFAULT_PARAMS,
  log?: PassLog,
): void {
  const { width, height } = grid;
  const pixels = width * height;

  // 1. head — relaxed against the state as it stands at the start of the pass
  const atStart = readerFor(grid, grid.state);
  let head = grid.head;
  for (let step = 0; step < params.headSteps; step++) {
    const next = new Uint32Array(pixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) next[y * width + x] = headStep(grid, atStart, head, x, y);
    }
    head = next;
  }
  grid.head = head;

  // 2. fall
  const fallen = new Uint32Array(pixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (falls(atStart, x, y - 1, pass, params))
        fallen[i] = withEnergy(grid.state[i - width], params.energy);
      else if (falls(atStart, x, y, pass, params)) fallen[i] = EMPTY;
      else fallen[i] = grid.state[i];
    }
  }

  // 3. flow
  if (log) log.fallen = fallen;
  const at = readerFor(grid, fallen);
  const pressurized = (x: number, y: number): boolean => underPressure(head[y * width + x], y);
  const next = new Uint32Array(pixels);
  const offset = pass & 1;
  for (let y0 = -offset; y0 < height; y0 += 2) {
    for (let x0 = -offset; x0 < width; x0 += 2) {
      const block = blockStep(x0, y0, pass, params, at, pressurized, log);
      for (let i = 0; i < 4; i++) {
        const x = x0 + (i & 1);
        const y = y0 + (i >> 1);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        // rock keeps whatever state it had: a liquid pixel under freshly built rock stays put, inert
        next[y * width + x] = block[i] < 0 ? fallen[y * width + x] : block[i];
      }
    }
  }
  grid.state = next;
}
