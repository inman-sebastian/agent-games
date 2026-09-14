// slopes.test.ts — sloped cells in the world (#92). That world smoothing (the port of Terraria's Smooth World pass)
// matches Terraria's code is tools/terraria-oracle/smooth.test.ts; this is about the world it feeds: slopes exist
// on the surface, the query is a pure function that agrees across chunk seams and cache misses, and a slope is
// mined like any other cell.
import { describe, it, expect } from 'vitest';
import { blockAt, mineTile, mineable, newSession, solidAt, surfaceAt } from './engine';
import {
  cellGenerator,
  covers,
  FULL,
  insideShape,
  OPEN,
  SMOOTH_CHUNK,
  shapeAt,
  skyRowAt,
  smoothFirstLoop,
  smoothSecondLoop,
  type SmoothGrid,
} from './slopes';
import type { SimEvent } from './types';

/** Every sloped cell along the surface of `columns` columns from `from`. */
function slopesAlong(
  seed: number,
  from: number,
  columns: number,
): { c: number; r: number; slope: number }[] {
  const found: { c: number; r: number; slope: number }[] = [];
  for (let c = from; c < from + columns; c++) {
    const surface = surfaceAt(seed, c);
    for (let r = surface - 1; r <= surface + 2; r++) {
      const shape = shapeAt(seed, c, r);
      if (shape !== OPEN && shape !== FULL) found.push({ c, r, slope: shape });
    }
  }
  return found;
}

describe('slopes in the world', () => {
  it('smooths the surface: floor slopes on its steps, all at the surface', () => {
    const slopes = slopesAlong(12345, -400, 800);
    expect(slopes.length).toBeGreaterThan(20);
    for (const { c, r, slope } of slopes) {
      const surface = surfaceAt(12345, c);
      expect([surface, surface + 1], `slope at ${c},${r}`).toContain(r);
      // a heightmap has no overhangs, so its slopes are floors
      expect([1, 2]).toContain(slope);
      // a floor slope sits on something
      expect(solidAt(12345, c, r + 1), `under ${c},${r}`).toBe(true);
    }
  });

  it('is a pure function of the cell: the same answer however the chunk cache was filled', () => {
    const seed = 777;
    const cells: [number, number][] = [];
    for (let c = -SMOOTH_CHUNK * 2; c < SMOOTH_CHUNK * 2; c += 3) {
      const surface = surfaceAt(seed, c);
      for (let r = surface - 1; r <= surface + 2; r++) cells.push([c, r]);
    }
    const first = cells.map(([c, r]) => shapeAt(seed, c, r));
    // query another seed in between (evicting the cache), then the same cells in reverse
    for (let c = 0; c < SMOOTH_CHUNK * 70; c += SMOOTH_CHUNK) shapeAt(99, c, 0);
    const again = [...cells]
      .reverse()
      .map(([c, r]) => shapeAt(seed, c, r))
      .reverse();
    expect(again).toEqual(first);
  });

  it('mines a slope like any other cell: mineable, breaks, and is open once dug', () => {
    const seed = 12345;
    const slope = slopesAlong(seed, 3100, 400)[0];
    expect(slope, 'a slope near the centre of the world').toBeDefined();
    const session = newSession(seed);
    const { c, r } = slope;
    expect(mineable(session.world, c, r)).toBe(true);
    expect(blockAt(seed, c, r).slope).toBe(slope.slope);
    const events: SimEvent[] = [];
    expect(mineTile(session, c, r, 50, events)).toBe(true);
    expect(events.some((event) => event.type === 'break' && event.c === c && event.r === r)).toBe(
      true,
    );
    expect(mineable(session.world, c, r)).toBe(false);
  });
});

describe('slope geometry', () => {
  it("knows which sides each shape covers: a slope's two solid edges, a full cell's four", () => {
    // Terraria (Tile.cs:216-238): 1 solid left+bottom, 2 right+bottom, 3 left+top, 4 right+top
    const sides = (shape: number): string =>
      (['up', 'down', 'left', 'right'] as const).filter((side) => covers(shape, side)).join(' ');
    expect(sides(FULL)).toBe('up down left right');
    expect(sides(OPEN)).toBe('');
    expect(sides(1)).toBe('down left');
    expect(sides(2)).toBe('down right');
    expect(sides(3)).toBe('up left');
    expect(sides(4)).toBe('up right');
  });

  it('puts the solid half of a cell on the side of its solid edges, the open corner empty', () => {
    const size = 8;
    const picture = (shape: number): string[] =>
      Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => (insideShape(shape, x, y, size) ? '#' : '.')).join(
          '',
        ),
      );
    // slope 1: open top-right — a floor descending to the right
    expect(picture(1)).toEqual([
      '#.......',
      '##......',
      '###.....',
      '####....',
      '#####...',
      '######..',
      '#######.',
      '########',
    ]);
    // the four slopes tile a full cell in pairs (1 with 4, 2 with 3), overlapping only on the diagonal
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        expect(insideShape(1, x, y, size) || insideShape(4, x, y, size)).toBe(true);
        expect(insideShape(2, x, y, size) || insideShape(3, x, y, size)).toBe(true);
      }
    }
    expect(insideShape(3, 7, 7, size)).toBe(false);
    expect(insideShape(4, 0, 7, size)).toBe(false);
  });

  it('shows sky down to the first full cell, so a surface slope has sky in its open corner', () => {
    const seed = 12345;
    for (let c = 3000; c < 3400; c++) {
      const sky = skyRowAt(seed, c);
      expect(shapeAt(seed, c, sky + 1), `column ${c}`).toBe(FULL);
      for (let r = surfaceAt(seed, c) - 2; r <= sky; r++)
        expect(shapeAt(seed, c, r)).not.toBe(FULL);
    }
  });
});

describe('chunk seams inside the world (#93)', () => {
  it('chunks from column 0 are what one continuous pass leaves', () => {
    // A chunk that started from the unsmoothed world at its seam put two floor slopes side by side there: a
    // sawtooth the pass never makes, and one Terraria's collision lets a body's corner sink into.
    for (let seed = 1; seed <= 40; seed++) {
      const chunks = 6;
      const firstColumn = -1;
      const width = chunks * SMOOTH_CHUNK + 2;
      let highest = Infinity;
      let lowest = -Infinity;
      for (let x = 0; x < width; x++) {
        highest = Math.min(highest, surfaceAt(seed, firstColumn + x));
        lowest = Math.max(lowest, surfaceAt(seed, firstColumn + x));
      }
      const firstRow = highest - 4;
      const height = lowest - highest + 10;
      const grid: SmoothGrid = {
        firstColumn,
        firstRow,
        width,
        height,
        active: new Uint8Array(width * height),
        slope: new Uint8Array(width * height),
        half: new Uint8Array(width * height),
      };
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          grid.active[x * height + y] = firstRow + y > surfaceAt(seed, firstColumn + x) ? 1 : 0;
        }
      }
      smoothFirstLoop(grid, cellGenerator(seed, 1));
      smoothSecondLoop(grid, cellGenerator(seed, 2));
      // The last chunk's right seam reads a chunk this grid lacks, so compare the ones before it.
      for (let column = 0; column < (chunks - 1) * SMOOTH_CHUNK; column++) {
        for (let y = 0; y < height; y++) {
          const index = (column - firstColumn) * height + y;
          const want = !grid.active[index] ? OPEN : grid.half[index] ? FULL : grid.slope[index];
          expect(shapeAt(seed, column, firstRow + y), `seed ${seed} cell ${column},${firstRow + y}`).toBe(
            want,
          );
        }
      }
    }
  });
});
