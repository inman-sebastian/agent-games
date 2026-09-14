// liquid.test.ts — the cell-pipe liquid (#90). Behaviour in motion, from the reviews that sank the earlier
// models: nothing hangs, every opening pours, no wall of water stands beside a breach, U-bends level, volume
// is exact. Runs are short and bounded.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createLiquid, waterRuns, UNIT, WATER_PARAMS, type Liquid } from './liquid';

const SUBSTEPS = WATER_PARAMS.substepsPerSecond;

/** '#' rock, '~' a full cell of water, '.' open. */
function scene(rows: string[]): { liquid: Liquid; at: (column: number, row: number) => number } {
  const height = rows.length;
  const width = rows[0].length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => (solid[row * width + column] = c === '#' ? 1 : 0)),
  );
  const liquid = createLiquid(width, height, solid);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => {
      if (c === '~') liquid.add(row * width + column, UNIT);
    }),
  );
  return { liquid, at: (column, row) => row * width + column };
}

/** A box `width` × `height` with rock walls and floor, filled by `cell(column, row)` inside. */
function box(
  width: number,
  height: number,
  cell: (column: number, row: number) => string,
): string[] {
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) => {
      const edge = column === 0 || column === width - 1 || row === height - 1;
      return edge ? '#' : cell(column, row);
    }).join(''),
  );
}

function run(liquid: Liquid, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds * SUBSTEPS);
  for (let k = 0; k < steps; k++) {
    liquid.step();
    each?.();
  }
}

/** The surface of the resting water in a column, in rows, or NaN if there's none. */
function surfaceAt(liquid: Liquid, column: number): number {
  const runs = waterRuns(liquid, column, UNIT / 50);
  return runs.length > 0 ? runs[0].surface : NaN;
}

/** Units in a rectangle of cells. */
function unitsIn(liquid: Liquid, left: number, right: number, top: number, bottom: number): number {
  let sum = 0;
  for (let row = top; row <= bottom; row++)
    for (let column = left; column <= right; column++)
      sum += liquid.volume[row * liquid.width + column];
  return sum;
}

describe('the cell-pipe liquid', () => {
  it('conserves every unit, and never goes negative, through random caves, pours and digs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 16 * 12, maxLength: 16 * 12 }),
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 16 * 12 - 1 }), fc.integer({ min: 0, max: 2 * UNIT })),
          {
            maxLength: 20,
          },
        ),
        fc.array(fc.integer({ min: 0, max: 16 * 12 - 1 }), { maxLength: 8 }),
        (rockBits, pours, digs) => {
          const width = 16;
          const height = 12;
          const solid = new Uint8Array(width * height);
          rockBits.forEach((isRock, index) => (solid[index] = isRock && index % 3 === 0 ? 1 : 0));
          const liquid = createLiquid(width, height, solid);
          for (const [index, units] of pours) liquid.add(index, units);
          const total = liquid.total();
          for (let tick = 0; tick < 120; tick++) {
            if (tick % 15 === 0 && digs.length > 0) {
              const index = digs[(tick / 15) % digs.length];
              liquid.setSolid(index, !liquid.isSolid(index));
            }
            liquid.step();
            expect(liquid.total()).toBe(total);
            for (let index = 0; index < width * height; index++)
              expect(liquid.volume[index]).toBeGreaterThanOrEqual(0);
          }
          for (let index = 0; index < width * height; index++) {
            expect(Number.isFinite(liquid.rightVelocity[index])).toBe(true);
            expect(Number.isFinite(liquid.downVelocity[index])).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('is deterministic', () => {
    const make = () => {
      const { liquid, at } = scene(
        box(20, 12, (column, row) => (column < 6 && row > 2 ? '~' : '.')),
      );
      run(liquid, 1);
      liquid.setSolid(at(10, 10), true);
      run(liquid, 1);
      return Array.from(liquid.volume);
    };
    expect(make()).toEqual(make());
  });

  it('lets water fall: nothing rests on air, and a dropped block lands on the floor', () => {
    const { liquid, at } = scene(
      box(12, 20, (column, row) => (column >= 4 && column < 8 && row >= 2 && row < 5 ? '~' : '.')),
    );
    const width = liquid.width;
    run(liquid, 3, () => {
      // IN MOTION: a cell holding water over a mostly-empty open cell is falling, not resting
      for (let row = 0; row < liquid.height - 2; row++)
        for (let column = 1; column < width - 1; column++) {
          const index = row * width + column;
          const below = index + width;
          if (
            liquid.volume[index] > UNIT / 4 &&
            liquid.volume[below] < UNIT / 2 &&
            !liquid.isSolid(below)
          ) {
            expect(
              liquid.downVelocity[index],
              `resting on air at ${column},${row}`,
            ).toBeGreaterThan(0);
          }
        }
    });
    // all of it is down on the floor
    expect(unitsIn(liquid, 1, width - 2, 16, 18)).toBeGreaterThan(0.95 * 12 * UNIT);
    expect(at(0, 0)).toBe(0);
  });

  it('levels a heap flat to within a pixel', () => {
    // a wedge of water piled against the left wall of a wide basin
    const { liquid } = scene(
      box(32, 12, (column, row) => (row >= 1 + Math.floor(column / 2) ? '~' : '.')),
    );
    run(liquid, 8);
    const surfaces = Array.from({ length: 30 }, (_, index) => surfaceAt(liquid, index + 1));
    const spread = Math.max(...surfaces) - Math.min(...surfaces);
    expect(spread * 8).toBeLessThan(1); // under one art pixel
  });

  it('fills both legs of a U-bend to the same level', () => {
    // two shafts joined at the bottom; the left one starts full
    const { liquid } = scene(
      box(12, 24, (column, row) => {
        if (row < 19 && column >= 3 && column <= 8) return '#';
        if (row >= 19) return '~';
        return column <= 2 && row >= 4 ? '~' : '.';
      }),
    );
    run(liquid, 12);
    const left = surfaceAt(liquid, 1);
    const right = surfaceAt(liquid, 10);
    expect(Math.abs(left - right) * 8).toBeLessThan(1);
    // and the right leg really rose: it started with no water above the join
    expect(right).toBeLessThan(18);
  });

  it('pours out of every gap in a breached wall at once, not one', () => {
    // a reservoir behind a wall; three one-cell gaps dug through it below the waterline
    const gaps = [8, 13, 18];
    const { liquid, at } = scene(
      box(40, 22, (column, row) => (column === 16 ? '#' : column < 16 && row >= 4 ? '~' : '.')),
    );
    for (const row of gaps) liquid.setSolid(at(16, row), false);
    run(liquid, 0.5);
    // water has come through each gap: the cell just outside each one has been wet
    for (const row of gaps) {
      const outside = at(17, row);
      const through = liquid.volume[outside] + liquid.volume[outside + liquid.width];
      expect(through, `gap at row ${row}`).toBeGreaterThan(0);
      expect(liquid.rightVelocity[at(16, row)], `gap at row ${row}`).toBeGreaterThan(0);
    }
  });

  it('leaves no wall of water beside a breach: both sides level within seconds', () => {
    const { liquid, at } = scene(
      box(40, 20, (column, row) => (column === 16 ? '#' : column < 16 && row >= 6 ? '~' : '.')),
    );
    for (let row = 0; row < 19; row++) liquid.setSolid(at(16, row), false);
    run(liquid, 1.5);
    // the step at the old wall is already under two cells
    expect(surfaceAt(liquid, 20) - surfaceAt(liquid, 12)).toBeLessThan(2);
    run(liquid, 6);
    expect(Math.abs(surfaceAt(liquid, 36) - surfaceAt(liquid, 2)) * 8).toBeLessThan(1);
  });

  it('drains a pool through a hole in its floor as a connected stream', () => {
    // a pool on a shelf over a cave, a one-cell hole dug in the middle of its floor
    const { liquid, at } = scene(
      box(30, 26, (column, row) => {
        if (row === 10) return '#';
        if (row < 10 && (column < 9 || column > 20)) return '#';
        return row >= 4 && row < 10 ? '~' : '.';
      }),
    );
    const pool = () => unitsIn(liquid, 9, 20, 0, 9);
    const start = pool();
    liquid.setSolid(at(15, 10), false);
    let widestGap = 0;
    run(liquid, 1, () => {
      // IN MOTION, once it's falling: between the hole and the pool below, at most one dry cell
      let wetSeen = false;
      let gap = 0;
      for (let row = 11; row < 24; row++) {
        const wet = liquid.volume[at(15, row)] > UNIT / 50;
        if (wet) {
          if (wetSeen) widestGap = Math.max(widestGap, gap);
          wetSeen = true;
          gap = 0;
        } else if (wetSeen) gap++;
      }
    });
    expect(widestGap).toBeLessThanOrEqual(1);
    run(liquid, 10);
    expect(pool()).toBeLessThan(0.05 * start);
  });

  it('comes to rest: a settled pool stops moving', () => {
    const { liquid } = scene(box(20, 10, (_, row) => (row >= 5 ? '~' : '.')));
    run(liquid, 3);
    const before = Array.from(liquid.volume);
    run(liquid, 1);
    const after = Array.from(liquid.volume);
    const moved = before.reduce(
      (count, units, index) => count + (Math.abs(units - after[index]) > UNIT / 1000 ? 1 : 0),
      0,
    );
    expect(moved).toBe(0);
  });

  it("keeps a stream falling into a pool out of the pool's surface", () => {
    // a pool at the bottom of a shaft, and a stream falling into it from a trickle above
    const { liquid, at } = scene(box(6, 30, (_, row) => (row >= 24 ? '~' : '.')));
    run(liquid, 1, () => liquid.add(at(2, 2), Math.round(UNIT / 12))); // 20 cells a second: a steady stream
    const runs = waterRuns(liquid, 2, UNIT / 50);
    expect(runs.length).toBeGreaterThan(0);
    // the pool (risen about five rows under the pour) stops at its own surface, far below the stream's start
    expect(runs[0].topRow).toBeGreaterThan(12);
    expect(runs[0].surface - runs[0].topRow).toBeLessThan(1);
  });

  it("draws a deep pool from its volume, so compression doesn't sink its surface", () => {
    const { liquid } = scene(box(8, 32, (_, row) => (row >= 6 ? '~' : '.')));
    run(liquid, 4);
    // 25 full cells in each column, resting on the floor at row 31: the surface is at row 6
    expect(Math.abs(surfaceAt(liquid, 3) - 6) * 8).toBeLessThan(1);
  });
});
