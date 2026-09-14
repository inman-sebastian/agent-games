// tile-liquid.test.ts — DELVE's liquid (#90): Terraria's fall with flat pools. What the author asked for, in
// motion: surfaces stay flat while they fill, pools drain completely, nothing is left hanging, volume is exact.
import { describe, it, expect } from 'vitest';
import {
  createTileLiquid,
  MIN_FILM,
  WATER_UPDATES_PER_SECOND,
  type TileLiquid,
} from './tile-liquid';

/** '#' rock, '~' full of water, '.' open. */
function scene(rows: string[]): TileLiquid {
  const height = rows.length;
  const width = rows[0].length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => (solid[row * width + column] = c === '#' ? 1 : 0)),
  );
  const liquid = createTileLiquid(width, height, solid);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => {
      if (c === '~') liquid.add(row * width + column, 1 << 16);
    }),
  );
  return liquid;
}

/** A closed box with rock sides and floor; `cell` draws the inside. */
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

const updates = (seconds: number): number => Math.round(seconds * WATER_UPDATES_PER_SECOND);
const levelsSum = (liquid: TileLiquid): number =>
  liquid.level.reduce((sum, value) => sum + value, 0);
const levelAt = (liquid: TileLiquid, column: number, row: number): number =>
  liquid.level[row * liquid.width + column];

/** All the liquid in a column, above row `below`. */
function depth(liquid: TileLiquid, column: number, below = liquid.height): number {
  let sum = 0;
  for (let row = 0; row < below; row++) sum += levelAt(liquid, column, row);
  return sum;
}

/** Flat, in levels: a quarter of an art pixel. The top-up after levelling can leave a few levels between cells. */
const FLAT = 8;

/** The largest difference in level between neighbouring resting wet cells along any row. */
function worstStep(liquid: TileLiquid): number {
  let worst = 0;
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column + 1 < liquid.width; column++) {
      const here = row * liquid.width + column;
      const right = here + 1;
      if (!liquid.resting[here] || !liquid.resting[right]) continue;
      if (liquid.level[here] === 0 || liquid.level[right] === 0) continue;
      worst = Math.max(worst, Math.abs(liquid.level[here] - liquid.level[right]));
    }
  }
  return worst;
}

describe('tile liquid', () => {
  it('keeps a surface flat, every update, while it is poured into at one cell', () => {
    const liquid = scene(box(24, 12, (_, row) => (row >= 8 ? '~' : '.')));
    const start = levelsSum(liquid);
    let poured = 0;
    for (let k = 0; k < updates(4); k++) {
      liquid.add(liquid.width * 1 + 2, 1 << 14); // a quarter cell an update, into the far left
      poured = levelsSum(liquid) - start;
      liquid.step();
      // the far side rises with the side poured into (column 2 also holds the falling stream)
      expect(Math.abs(depth(liquid, 21) - depth(liquid, 4))).toBeLessThanOrEqual(FLAT);
    }
    expect(levelsSum(liquid)).toBe(start + poured);
  });

  it('spreads a new layer over a full pool at once, not outward from where it lands', () => {
    const liquid = scene(box(24, 12, (_, row) => (row >= 7 ? '~' : '.')));
    for (let k = 0; k < 12; k++) {
      liquid.add(liquid.width + 2, 1 << 14);
      liquid.step();
    }
    const layer = Array.from({ length: 22 }, (_, k) => levelAt(liquid, k + 1, 6));
    expect(Math.max(...layer) - Math.min(...layer)).toBeLessThanOrEqual(FLAT);
    expect(Math.min(...layer)).toBeGreaterThan(0);
  });

  it('drains a pool through a hole in its floor completely, and leaves nothing in the shaft', () => {
    const rows = [
      '##############################',
      '#####....................#####',
      '#####~~~~~~~~~~~~~~~~~~~~#####',
      '#####~~~~~~~~~~~~~~~~~~~~#####',
      '###############.##############',
      ...Array.from({ length: 12 }, () => '###############.##############'),
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '##############################',
    ];
    const liquid = scene(rows);
    const start = levelsSum(liquid);
    for (let k = 0; k < updates(20); k++) {
      liquid.step();
      // both sides of the hole drain together, until the last film gathers over it
      const near = depth(liquid, 8, 4);
      const far = depth(liquid, 22, 4);
      if (Math.max(near, far) > 2 * MIN_FILM) expect(Math.abs(near - far)).toBeLessThanOrEqual(4);
    }
    expect(levelsSum(liquid)).toBe(start);
    for (let row = 0; row < 17; row++) {
      for (let column = 0; column < liquid.width; column++) {
        expect(levelAt(liquid, column, row), `cell ${column},${row}`).toBe(0);
      }
    }
  });

  it('levels a breached reservoir across both sides, then stops changing', () => {
    const wall = 8;
    const liquid = scene(
      box(30, 14, (column, row) => (column === wall ? '.' : column < wall && row >= 2 ? '~' : '.')),
    );
    const start = levelsSum(liquid);
    for (let k = 0; k < updates(20); k++) liquid.step();
    const settled = liquid.level.slice();
    for (let k = 0; k < updates(1); k++) liquid.step();
    expect([...liquid.level]).toEqual([...settled]);
    expect(levelsSum(liquid)).toBe(start);
    expect(worstStep(liquid)).toBeLessThanOrEqual(FLAT);
    // the reservoir's water now lies across the whole floor, as deep on the far side as the near
    expect(Math.abs(depth(liquid, 2) - depth(liquid, 27))).toBeLessThanOrEqual(1);
  });

  it('lets a breached reservoir slump over a curtain rather than slide out whole', () => {
    const wall = 8;
    const liquid = scene(box(30, 14, (column, row) => (column < wall && row >= 2 ? '~' : '.')));
    for (let k = 0; k < 10; k++) liquid.step();
    // a sixth of a second on, the reservoir still stands well above the water it has let out…
    expect(depth(liquid, 2) - depth(liquid, 14)).toBeGreaterThan(4 * 255);
    // …and a third of a second on, it has slumped to under half its height, not stood as a tower
    for (let k = 0; k < 10; k++) liquid.step();
    expect(depth(liquid, 2)).toBeLessThan(6 * 255);
  });

  it('settles a dropped block into a pool with no partly filled cells under its surface', () => {
    const liquid = scene(
      box(20, 16, (column, row) => (column >= 7 && column < 13 && row >= 1 && row < 7 ? '~' : '.')),
    );
    const start = levelsSum(liquid);
    for (let k = 0; k < updates(6); k++) liquid.step();
    expect(levelsSum(liquid)).toBe(start);
    for (let row = 1; row < liquid.height; row++) {
      for (let column = 0; column < liquid.width; column++) {
        if (levelAt(liquid, column, row - 1) > 0 && !liquid.isSolid(row * liquid.width + column))
          expect(levelAt(liquid, column, row), `cell ${column},${row}`).toBe(255);
      }
    }
    expect(worstStep(liquid)).toBeLessThanOrEqual(FLAT);
  });

  it('drops a full column through the air without it spreading sideways', () => {
    const liquid = scene(
      box(16, 30, (column, row) => (column >= 7 && column < 9 && row >= 1 && row < 9 ? '~' : '.')),
    );
    for (let k = 0; k < 18; k++) {
      liquid.step();
      for (let row = 0; row < liquid.height; row++) {
        for (const column of [6, 9]) expect(levelAt(liquid, column, row), `update ${k}`).toBe(0);
      }
    }
  });

  it('never pulls water out of a stream into a pool it falls past', () => {
    const rows = [
      '##########',
      '#.....~..#',
      '#.....~..#',
      '#.....~..#',
      '#........#',
      '######...#',
      '#........#',
      '#........#',
      '#........#',
      '##########',
    ];
    const liquid = scene(rows);
    for (let column = 1; column <= 5; column++) liquid.add(4 * liquid.width + column, 1 << 15); // half full
    const shelf = (): number => {
      let sum = 0;
      for (let column = 1; column <= 5; column++) sum += levelAt(liquid, column, 4);
      return sum;
    };
    let previous = shelf();
    // until the basin below fills up to the shelf, when the two become one pool
    for (let k = 0; k < 15; k++) {
      liquid.add(liquid.width + 6, 1 << 16);
      liquid.step();
      expect(shelf()).toBeLessThanOrEqual(previous);
      previous = shelf();
    }
  });

  it('is deterministic', () => {
    const make = (): TileLiquid =>
      scene(
        box(20, 12, (column, row) =>
          column < 6 && row >= 3 ? '~' : column === 6 && row < 9 ? '#' : '.',
        ),
      );
    const a = make();
    const b = make();
    for (let k = 0; k < updates(5); k++) {
      a.step();
      b.step();
    }
    expect([...a.level]).toEqual([...b.level]);
  });
});
