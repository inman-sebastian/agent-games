// grid-liquid.test.ts — the Terraria-style liquid (#90): falls, evens out along rows, conserves exactly, rests.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createGridLiquid, GRID_WATER_PARAMS } from './grid-liquid';
import { waterRuns, UNIT, type Liquid } from './liquid';

const TICKS = GRID_WATER_PARAMS.ticksPerSecond;

function scene(rows: string[]): { liquid: Liquid; at: (column: number, row: number) => number } {
  const height = rows.length;
  const width = rows[0].length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => (solid[row * width + column] = c === '#' ? 1 : 0)),
  );
  const liquid = createGridLiquid(width, height, solid);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => {
      if (c === '~') liquid.add(row * width + column, UNIT);
    }),
  );
  return { liquid, at: (column, row) => row * width + column };
}

function box(
  width: number,
  height: number,
  cell: (column: number, row: number) => string,
): string[] {
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) =>
      column === 0 || column === width - 1 || row === height - 1 ? '#' : cell(column, row),
    ).join(''),
  );
}

const run = (liquid: Liquid, seconds: number, each?: () => void): void => {
  for (let k = 0; k < Math.round(seconds * TICKS); k++) {
    liquid.step();
    each?.();
  }
};

const surfaceAt = (liquid: Liquid, column: number): number => {
  const runs = waterRuns(liquid, column, UNIT / 50);
  return runs.length > 0 ? runs[0].surface : NaN;
};

function unitsIn(liquid: Liquid, left: number, right: number, top: number, bottom: number): number {
  let sum = 0;
  for (let row = top; row <= bottom; row++)
    for (let column = left; column <= right; column++)
      sum += liquid.volume[row * liquid.width + column];
  return sum;
}

describe('the grid liquid', () => {
  it('conserves every unit and never goes negative, through random caves, pours and digs', () => {
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
          const solid = new Uint8Array(16 * 12);
          rockBits.forEach((isRock, index) => (solid[index] = isRock && index % 3 === 0 ? 1 : 0));
          const liquid = createGridLiquid(16, 12, solid);
          for (const [index, units] of pours) liquid.add(index, units);
          const total = liquid.total();
          for (let tick = 0; tick < 90; tick++) {
            if (tick % 15 === 0 && digs.length > 0) {
              const index = digs[(tick / 15) % digs.length];
              liquid.setSolid(index, !liquid.isSolid(index));
            }
            liquid.step();
            expect(liquid.total()).toBe(total);
            for (let index = 0; index < 16 * 12; index++)
              expect(liquid.volume[index]).toBeGreaterThanOrEqual(0);
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

  it('lets a dropped block fall and land flat on the floor', () => {
    const { liquid } = scene(
      box(12, 20, (column, row) => (column >= 4 && column < 8 && row >= 2 && row < 5 ? '~' : '.')),
    );
    run(liquid, 3);
    expect(unitsIn(liquid, 1, 10, 17, 18)).toBe(12 * UNIT);
    const surfaces = Array.from({ length: 10 }, (_, index) => surfaceAt(liquid, index + 1));
    expect((Math.max(...surfaces) - Math.min(...surfaces)) * 8).toBeLessThan(1);
  });

  it('levels a breached reservoir flat without a long slope', () => {
    const { liquid, at } = scene(
      box(40, 20, (column, row) => (column === 16 ? '#' : column < 16 && row >= 6 ? '~' : '.')),
    );
    for (let row = 0; row < 19; row++) liquid.setSolid(at(16, row), false);
    run(liquid, 4);
    const surfaces = Array.from({ length: 38 }, (_, index) => surfaceAt(liquid, index + 1));
    expect((Math.max(...surfaces) - Math.min(...surfaces)) * 8).toBeLessThan(2);
  });

  it('drains a pool through a hole in its floor as one connected stream, with no spray beside it', () => {
    const { liquid, at } = scene(
      box(30, 26, (column, row) => {
        if (row === 10) return '#';
        if (row < 10 && (column < 9 || column > 20)) return '#';
        return row >= 4 && row < 10 ? '~' : '.';
      }),
    );
    const start = unitsIn(liquid, 9, 20, 0, 9);
    liquid.setSolid(at(15, 10), false);
    let spray = 0;
    run(liquid, 1.5, () => {
      // IN MOTION: nothing in the air beside the stream, between the hole and where the cave's pool can rise
      // (72 cells over a 28-cell floor: rows 21–24)
      for (let row = 12; row < 19; row++)
        spray += liquid.volume[at(14, row)] + liquid.volume[at(16, row)];
    });
    expect(spray).toBe(0);
    run(liquid, 10);
    expect(unitsIn(liquid, 9, 20, 0, 9)).toBeLessThan(0.05 * start);
  });

  it('comes to rest: a settled pool stops changing', () => {
    const { liquid } = scene(box(20, 10, (_, row) => (row >= 5 ? '~' : '.')));
    run(liquid, 2);
    const before = Array.from(liquid.volume);
    run(liquid, 1);
    expect(Array.from(liquid.volume)).toEqual(before);
  });
});
