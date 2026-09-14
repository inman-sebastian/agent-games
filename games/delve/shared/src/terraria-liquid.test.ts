// terraria-liquid.test.ts — the port of Terraria's liquid (#90): what Terraria's rules guarantee, in motion.
// Terraria rounds and deletes films, so volume is checked within a small drift rather than exactly.
import { describe, it, expect } from 'vitest';
import {
  createTerrariaLiquid,
  TERRARIA_LIQUID_UPDATES_PER_SECOND,
  type TerrariaLiquid,
} from './terraria-liquid';

function scene(rows: string[]): {
  liquid: TerrariaLiquid;
  at: (column: number, row: number) => number;
} {
  const height = rows.length;
  const width = rows[0].length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => (solid[row * width + column] = c === '#' ? 1 : 0)),
  );
  const liquid = createTerrariaLiquid(width, height, solid);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => {
      if (c === '~') liquid.add(row * width + column, 1 << 16);
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

const run = (liquid: TerrariaLiquid, seconds: number): void => {
  for (let k = 0; k < Math.round(seconds * TERRARIA_LIQUID_UPDATES_PER_SECOND); k++) liquid.step();
};

const levelsSum = (liquid: TerrariaLiquid): number =>
  liquid.level.reduce((sum, value) => sum + value, 0);

/** The height of the liquid standing in a column, in tiles. */
function heightIn(liquid: TerrariaLiquid, column: number): number {
  let sum = 0;
  for (let row = 0; row < liquid.height; row++) sum += liquid.level[row * liquid.width + column];
  return sum / 255;
}

describe("Terraria's liquid, ported", () => {
  it('drops a block of water to the floor, where it settles flat and goes to sleep', () => {
    const { liquid } = scene(
      box(14, 20, (column, row) => (column >= 5 && column < 9 && row >= 2 && row < 5 ? '~' : '.')),
    );
    const start = levelsSum(liquid);
    run(liquid, 10);
    const heights = Array.from({ length: 12 }, (_, index) => heightIn(liquid, index + 1));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.1);
    expect(Math.abs(levelsSum(liquid) - start) / start).toBeLessThan(0.02);
    expect(liquid.activeCount()).toBe(0);
  });

  it('drains a pool through a hole dug in its floor into the cave below', () => {
    const { liquid, at } = scene(
      box(30, 26, (column, row) => {
        if (row === 10) return '#';
        if (row < 10 && (column < 9 || column > 20)) return '#';
        return row >= 4 && row < 10 ? '~' : '.';
      }),
    );
    liquid.setSolid(at(15, 10), false);
    run(liquid, 15);
    let pool = 0;
    for (let row = 0; row < 10; row++)
      for (let column = 9; column <= 20; column++) pool += liquid.level[at(column, row)];
    expect(pool / 255).toBeLessThan(1);
  });

  it('levels a breached reservoir across both sides', () => {
    const { liquid, at } = scene(
      box(40, 20, (column, row) => (column === 16 ? '#' : column < 16 && row >= 6 ? '~' : '.')),
    );
    for (let row = 0; row < 19; row++) liquid.setSolid(at(16, row), false);
    run(liquid, 20);
    const heights = Array.from({ length: 38 }, (_, index) => heightIn(liquid, index + 1));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.2);
  });

  it('is deterministic', () => {
    const make = () => {
      const { liquid, at } = scene(
        box(20, 12, (column, row) => (column < 6 && row > 2 ? '~' : '.')),
      );
      run(liquid, 1);
      liquid.setSolid(at(10, 10), true);
      run(liquid, 1);
      return Array.from(liquid.level);
    };
    expect(make()).toEqual(make());
  });
});
