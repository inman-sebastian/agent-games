// rule.ts — the pixel fluid's rule (#87): one pass of a Margolus block automaton over a grid of art
// pixels, in TypeScript. It's the reference: gpu/fluid.wgsl is its WGSL twin, fluid-lab checks the two
// agree pixel for pixel, and rule.test.ts property-tests this one. The model and why it's built this way
// are in docs/FLUIDS.md.
//
// Integers and hashes only, so both twins compute exactly the same thing. Every pixel's next state is a
// function of the PREVIOUS pass alone: a block reads outside itself from `state`, never from `next`.
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

export interface FluidParams {
  /** Pixels surface liquid may run sideways without falling, 0–255. */
  energy: number;
  /**
   * How far along its row liquid with no energy left looks for a drop. It flows toward one it can see,
   * so a settled surface is flat to one pixel in `sight` — a slope doesn't hold like sand.
   */
  sight: number;
  /** Chance, out of CHANCE_SCALE, that a kind acts on a pass — its speed. Indexed by kind. */
  chance: readonly [number, number, number];
}

export const CHANCE_SCALE = 1024;

export const DEFAULT_PARAMS: FluidParams = {
  energy: 255,
  sight: 8,
  // water every pass; lava a quarter as often: slow in time, never short in reach (FLUIDS.md, lesson 3)
  chance: [0, CHANCE_SCALE, CHANCE_SCALE / 4],
};

export interface FluidGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major pixel states. */
  state: Uint32Array<ArrayBuffer>;
  /** Row-major, 1 where rock is. */
  readonly solid: Uint8Array<ArrayBuffer>;
}

/** What a pass did, for the tests: where every sideways move started. */
export interface PassLog {
  sideways: { x: number; y: number }[];
}

/** The block's random roll for a pass: its low bits pick chance, one bit picks a pressurized direction. */
export const blockRoll = (x0: number, y0: number, pass: number): number => hashXY(x0, y0, pass);

/**
 * The four pixels of the block whose top-left is (x0, y0) after one pass, as [a, b, c, d] (top-left,
 * top-right, bottom-left, bottom-right). `at(x, y)` reads the previous pass: -1 for rock or outside.
 */
export function blockStep(
  x0: number,
  y0: number,
  pass: number,
  params: FluidParams,
  at: (x: number, y: number) => number,
  log?: PassLog,
): [number, number, number, number] {
  const roll = blockRoll(x0, y0, pass);
  const chanceRoll = (roll >>> 16) & (CHANCE_SCALE - 1);
  const pressureRight = ((roll >>> 12) & 1) === 1;
  const s = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
  const moved = [false, false, false, false];
  const isRock = (i: number): boolean => s[i] < 0;
  const kind = (i: number): number => (isRock(i) ? EMPTY : kindOf(s[i]));
  const isLiquid = (i: number): boolean => kind(i) !== EMPTY;
  const isEmpty = (i: number): boolean => !isRock(i) && kind(i) === EMPTY;
  const occupied = (i: number): boolean => isRock(i) || kind(i) !== EMPTY;
  const acts = (i: number): boolean => chanceRoll < params.chance[kind(i)];
  const withEnergy = (state: number, energy: number): number =>
    (state & ~(255 << ENERGY_SHIFT)) | (energy << ENERGY_SHIFT);
  const move = (from: number, to: number, energy: number): void => {
    const travelling = withEnergy(s[from], energy);
    s[from] = s[to];
    s[to] = travelling;
    moved[from] = true;
    moved[to] = true;
  };

  // 1. gravity, per column: liquid over empty falls; lava over water sinks
  for (const [top, bottom] of [
    [0, 2],
    [1, 3],
  ]) {
    if (!isLiquid(top) || !acts(top)) continue;
    const sinks = kind(top) === LAVA && kind(bottom) === WATER;
    if (isEmpty(bottom) || sinks) move(top, bottom, params.energy);
  }

  // 2. diagonal slide: liquid over something, into the empty diagonal below, past an empty side
  if (isLiquid(0) && !moved[0] && acts(0) && occupied(2) && isEmpty(3) && isEmpty(1)) {
    move(0, 3, params.energy);
  } else if (isLiquid(1) && !moved[1] && acts(1) && occupied(3) && isEmpty(2) && isEmpty(0)) {
    move(1, 2, params.energy);
  }

  // 3. sideways flow for supported liquid: pressurized always, surface while it has energy
  const flow = (
    from: number,
    to: number,
    towardRight: boolean,
    supported: boolean,
    pressurized: boolean,
    x: number,
    y: number,
  ): void => {
    if (!supported) return;
    if (!isLiquid(from) || moved[from] || !acts(from)) return;
    const energy = energyOf(s[from]);
    const stored = (s[from] & DIRECTION_BIT) !== 0;
    // Out of energy, surface liquid still flows toward a drop it can see: it turns to face one behind it.
    const seesAhead = !pressurized && energy === 0 && dropAhead(x, y, stored);
    if (!pressurized && energy === 0 && !seesAhead && dropAhead(x, y, !stored)) {
      if (stored === towardRight) s[from] ^= DIRECTION_BIT;
      return;
    }
    const right = pressurized ? pressureRight : stored;
    if (right !== towardRight) return;
    if (isEmpty(to) && !moved[to] && (pressurized || energy > 0 || seesAhead)) {
      log?.sideways.push({ x, y });
      move(from, to, pressurized ? params.energy : Math.max(0, energy - 1));
    } else if (!isEmpty(to) && !pressurized && energy > 0) {
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
      const below = at(x + k * step, y + 1);
      if (below >= 0 && kindOf(below) === EMPTY) return true;
    }
    return false;
  }
  // The bottom row stands on what's below the block; the top row on the bottom row.
  const liquidAt = (state: number): boolean => state >= 0 && kindOf(state) !== EMPTY;
  const underBottom = (x: number): boolean => {
    const below = at(x, y0 + 2);
    return below < 0 || liquidAt(below);
  };
  flow(2, 3, true, underBottom(x0), isLiquid(0), x0, y0 + 1);
  flow(3, 2, false, underBottom(x0 + 1), isLiquid(1), x0 + 1, y0 + 1);
  flow(0, 1, true, occupied(2), liquidAt(at(x0, y0 - 1)), x0, y0);
  flow(1, 0, false, occupied(3), liquidAt(at(x0 + 1, y0 - 1)), x0 + 1, y0);

  return [s[0], s[1], s[2], s[3]];
}

/** One pass over the whole grid. The tiling is offset by one pixel on odd passes. */
export function stepFluid(
  grid: FluidGrid,
  pass: number,
  params: FluidParams = DEFAULT_PARAMS,
  log?: PassLog,
): void {
  const { width, height, state, solid } = grid;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height || solid[y * width + x] ? -1 : state[y * width + x];
  const next = new Uint32Array(state.length);
  const offset = pass & 1;
  for (let y0 = -offset; y0 < height; y0 += 2) {
    for (let x0 = -offset; x0 < width; x0 += 2) {
      const block = blockStep(x0, y0, pass, params, at, log);
      for (let i = 0; i < 4; i++) {
        const x = x0 + (i & 1);
        const y = y0 + (i >> 1);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        // rock keeps whatever state it had: a liquid pixel under freshly built rock stays put, inert
        next[y * width + x] = block[i] < 0 ? state[y * width + x] : block[i];
      }
    }
  }
  grid.state = next;
}
