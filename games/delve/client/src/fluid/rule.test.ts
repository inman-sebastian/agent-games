// rule.test.ts — the pixel fluid rule's invariants (#87), on the TypeScript twin. The GPU is checked
// against this twin in the lab, so what holds here holds for the shader.
//
// FLUIDS.md's lessons from the whole-cell models drive the list: exact mass, nothing unsupported moving
// sideways, shapes checked IN MOTION every pass (not only once settled), pools that settle flat.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_PARAMS,
  EMPTY,
  LAVA,
  WATER,
  kindOf,
  liquid,
  stepFluid,
  type FluidGrid,
  type PassLog,
} from './rule';

function makeGrid(
  width: number,
  height: number,
  rock: (x: number, y: number) => boolean,
): FluidGrid {
  const solid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) solid[y * width + x] = rock(x, y) ? 1 : 0;
  return { width, height, state: new Uint32Array(width * height), solid };
}

function pour(grid: FluidGrid, x: number, y: number, kind: number, right = true): void {
  const i = y * grid.width + x;
  if (!grid.solid[i] && kindOf(grid.state[i]) === EMPTY) {
    grid.state[i] = liquid(kind, right, DEFAULT_PARAMS.energy);
  }
}

const count = (grid: FluidGrid, kind: number): number =>
  grid.state.reduce((total, state) => total + (kindOf(state) === kind ? 1 : 0), 0);

const occupiedIn = (grid: FluidGrid, state: Uint32Array, x: number, y: number): boolean =>
  x < 0 ||
  y < 0 ||
  x >= grid.width ||
  y >= grid.height ||
  grid.solid[y * grid.width + x] === 1 ||
  kindOf(state[y * grid.width + x]) !== EMPTY;

/** A random little world: scattered rock, and liquid of both kinds poured into the gaps. */
const worldArb = fc
  .record({
    width: fc.integer({ min: 4, max: 24 }),
    height: fc.integer({ min: 4, max: 24 }),
    seed: fc.integer({ min: 0, max: 1_000_000 }),
    rockDensity: fc.integer({ min: 0, max: 40 }),
    liquidDensity: fc.integer({ min: 0, max: 60 }),
    firstPass: fc.integer({ min: 0, max: 5000 }),
  })
  .map((spec) => {
    let random = spec.seed;
    const next = (): number => {
      random = (Math.imul(random, 1103515245) + 12345) >>> 0;
      return (random >>> 16) % 100;
    };
    const grid = makeGrid(spec.width, spec.height, () => next() < spec.rockDensity);
    for (let y = 0; y < spec.height; y++) {
      for (let x = 0; x < spec.width; x++) {
        if (grid.solid[y * spec.width + x] || next() >= spec.liquidDensity) continue;
        // any energy, not just a fresh pour's: settled liquid (energy spent) is where the rules differ
        const energy = next() < 50 ? 0 : (next() * 255) / 99;
        grid.state[y * spec.width + x] = liquid(
          next() < 25 ? LAVA : WATER,
          next() < 50,
          Math.round(energy),
        );
      }
    }
    return { grid, firstPass: spec.firstPass };
  });

/** A basin: rock floor and walls, open above, `width` wide inside. */
const basin = (width: number, height: number): FluidGrid =>
  makeGrid(width + 2, height, (x, y) => x === 0 || x === width + 1 || y === height - 1);

describe('the pixel fluid rule', () => {
  it('conserves every kind exactly, never moves liquid into rock, and never moves an unsupported pixel sideways — every pass', () => {
    fc.assert(
      fc.property(worldArb, ({ grid, firstPass }) => {
        const water = count(grid, WATER);
        const lava = count(grid, LAVA);
        for (let pass = firstPass; pass < firstPass + 60; pass++) {
          const before = grid.state;
          const log: PassLog = { sideways: [] };
          stepFluid(grid, pass, DEFAULT_PARAMS, log);
          expect(count(grid, WATER)).toBe(water);
          expect(count(grid, LAVA)).toBe(lava);
          for (let i = 0; i < grid.state.length; i++) {
            if (grid.solid[i]) expect(grid.state[i]).toBe(before[i]);
          }
          // IN MOTION: a sideways move starts from a pixel standing on something — before the pass, or
          // after it when what it stands on slid in underneath this very pass
          for (const { x, y } of log.sideways) {
            const supported =
              occupiedIn(grid, before, x, y + 1) || occupiedIn(grid, grid.state, x, y + 1);
            expect(supported, `unsupported sideways move from ${x},${y} on pass ${pass}`).toBe(
              true,
            );
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(worldArb, ({ grid, firstPass }) => {
        const copy: FluidGrid = { ...grid, state: grid.state.slice() };
        for (let pass = firstPass; pass < firstPass + 30; pass++) {
          stepFluid(grid, pass);
          stepFluid(copy, pass);
        }
        expect(copy.state).toEqual(grid.state);
      }),
      { numRuns: 30 },
    );
  });

  it('settles a pour in a basin: it stops changing, every row under the top is full, and the top row is the rest', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 40 }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 1000 }),
        (width, amount, seed) => {
          const height = 24;
          const grid = basin(width, height);
          const volume = Math.min(amount, width * (height - 4));
          // scattered through the air above the floor, a pattern first and then filling in, so it arrives
          // falling. (Bounded: it's two sweeps, and the volume always fits.)
          let poured = 0;
          for (const pattern of [true, false]) {
            for (let y = 0; y < height - 1; y++) {
              for (let x = 1; x <= width && poured < volume; x++) {
                const i = y * grid.width + x;
                if (kindOf(grid.state[i]) !== EMPTY) continue;
                if (pattern && (x * 7 + y + seed) % 3 !== 0) continue;
                grid.state[i] = liquid(WATER, (x + seed) % 2 === 0, DEFAULT_PARAMS.energy);
                poured++;
              }
            }
          }
          let pass = seed;
          let still = 0;
          for (; still < 2 && pass < seed + 4000; pass++) {
            const before = grid.state;
            stepFluid(grid, pass);
            still = grid.state.every((state, i) => state === before[i]) ? still + 1 : 0;
          }
          expect(still, `still moving after ${pass - seed} passes`).toBe(2);

          const inside = (y: number): number => {
            let filled = 0;
            for (let x = 1; x <= width; x++)
              if (kindOf(grid.state[y * grid.width + x]) === WATER) filled++;
            return filled;
          };
          const fullRows = Math.floor(volume / width);
          const remainder = volume % width;
          const floor = height - 2;
          for (let row = 0; row < fullRows; row++)
            expect(inside(floor - row), `row ${row} up`).toBe(width);
          expect(inside(floor - fullRows)).toBe(remainder);
          for (let y = 0; y < floor - fullRows; y++) expect(inside(y)).toBe(0);
        },
      ),
      { numRuns: 40 },
    );
  });

  /** A settled pool 10 wide and 6 deep against a wall, with the floor running on 18 pixels past it. */
  const dammedPool = (): { grid: FluidGrid; wall: number; floor: number } => {
    const width = 30;
    const height = 12;
    const floor = height - 1;
    const wall = 11;
    const grid = makeGrid(
      width,
      height,
      (x, y) => y === floor || x === 0 || x === width - 1 || (x === wall && y >= 4),
    );
    // a SETTLED pool: every pixel has spent its energy, so only pressure can move it
    for (let y = floor - 6; y < floor; y++) {
      for (let x = 1; x < wall; x++) grid.state[y * width + x] = liquid(WATER, x % 2 === 0, 0);
    }
    return { grid, wall, floor };
  };
  const waterIn = (grid: FluidGrid, x0: number, x1: number, y: number): number => {
    let found = 0;
    for (let x = x0; x <= x1; x++) if (kindOf(grid.state[y * grid.width + x]) === WATER) found++;
    return found;
  };
  const settle = (grid: FluidGrid, passes: number): void => {
    for (let pass = 0; pass < passes; pass++) stepFluid(grid, pass);
  };

  it('pushes a pool out through a hole at the foot of its wall, across the floor beyond — but never up', () => {
    const { grid, wall, floor } = dammedPool();
    grid.solid[(floor - 1) * grid.width + wall] = 0; // the hole
    settle(grid, 3000);
    // pressure drives the pool's bottom pixels out, and they run along the whole floor outside...
    expect(waterIn(grid, wall + 1, grid.width - 2, floor - 1)).toBe(grid.width - 2 - wall);
    // ...but liquid never climbs, so nothing stacks above the hole's row (no pressure, as decided)
    for (let y = 0; y < floor - 1; y++) expect(waterIn(grid, wall + 1, grid.width - 2, y)).toBe(0);
    expect(count(grid, WATER)).toBe(60);
  });

  it('levels a pool flat across the whole floor when its wall is dug away', () => {
    const { grid, wall, floor } = dammedPool();
    for (let y = 0; y < floor; y++) grid.solid[y * grid.width + wall] = 0;
    settle(grid, 4000);
    const inside = grid.width - 2; // 28 wide
    expect(waterIn(grid, 1, inside, floor - 1)).toBe(inside);
    expect(waterIn(grid, 1, inside, floor - 2)).toBe(inside);
    expect(waterIn(grid, 1, inside, floor - 3)).toBe(60 - 2 * inside);
    expect(waterIn(grid, 1, inside, floor - 4)).toBe(0);
  });

  it('sinks lava through water, and lava falls slower than water', () => {
    const column = (): FluidGrid => makeGrid(1, 40, (_x, y) => y === 39);
    const layered = column();
    for (let y = 0; y < 5; y++) pour(layered, 0, y, LAVA);
    for (let y = 5; y < 20; y++) pour(layered, 0, y, WATER);
    for (let pass = 0; pass < 2000; pass++) stepFluid(layered, pass);
    const kinds = Array.from(layered.state, kindOf);
    expect(kinds.slice(34, 39)).toEqual([LAVA, LAVA, LAVA, LAVA, LAVA]);
    expect(kinds.slice(19, 34).every((kind) => kind === WATER)).toBe(true);

    const fall = (kind: number): number => {
      const grid = column();
      pour(grid, 0, 0, kind);
      for (let pass = 0; pass < 20; pass++) stepFluid(grid, pass);
      return Array.from(grid.state, kindOf).indexOf(kind);
    };
    expect(fall(WATER)).toBeGreaterThan(fall(LAVA));
  });
});
