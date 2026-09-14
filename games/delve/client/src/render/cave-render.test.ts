// cave-render.test.ts — the strata ramp the renderer paints agrees with the stratum the sim says a
// row is in.
//
// `rampAt` is handed CELL rows while strata tops are authored in BLOCKS. Before this test it compared
// the two directly, so after the 2x2 split (#44) every stratum's colour arrived at half its authored
// depth — and bedrock (#57) would have painted at block 350, halfway down a world whose floor is 700.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  STRATA,
  SUB,
  FLOOR,
  strataIndexAt,
  FULL,
  OPEN,
  SLOPE_DOWN_LEFT,
  SLOPE_DOWN_RIGHT,
  insideShape,
  diagonalDistance,
} from '@delve/shared';
import { setStrata, rampAt, buildMask } from './cave-render';

beforeAll(() => setStrata(STRATA));

describe('rampAt', () => {
  it("paints each stratum's own ramp at its authored top — in blocks, like the sim", () => {
    for (const [index, stratum] of STRATA.entries()) {
      const row = stratum.top * SUB;
      expect(strataIndexAt(row), stratum.id).toBe(index);
      expect(rampAt(row), stratum.id).toEqual(stratum.ramp);
    }
  });

  it('a hard stratum does not bleed into the band above it', () => {
    const bedrock = STRATA[STRATA.length - 1];
    const above = STRATA[STRATA.length - 2];
    expect(bedrock.hard).toBe(true);
    expect(rampAt(FLOOR * SUB - 1)).toEqual(above.ramp);
    expect(rampAt(FLOOR * SUB)).toEqual(bedrock.ramp);
  });
});

describe('buildMask with slopes (#94)', () => {
  const T8 = 8;
  /** A world: rock below row 0, open above; `slopes` puts a shape at a cell (OPEN for air). */
  const world = (slopes: Map<string, number>) => ({
    solid: (c: number, r: number): boolean => {
      const shape = slopes.get(`${c},${r}`);
      return shape === undefined ? r >= 0 : shape !== OPEN;
    },
    shape: (c: number, r: number): number => slopes.get(`${c},${r}`) ?? (r >= 0 ? FULL : OPEN),
  });

  it("leaves a slope's open corner open and its solid half solid, well inside the diagonal", () => {
    // a row of floor slopes along the surface, open above
    const slopes = new Map<string, number>();
    for (let c = 0; c < 40; c++) slopes.set(`${c},0`, c % 2 ? SLOPE_DOWN_RIGHT : SLOPE_DOWN_LEFT);
    const { solid, shape } = world(slopes);
    const mask = buildMask(solid, 40 * T8, T8, 0, 0, shape);
    for (let c = 0; c < 40; c++) {
      const kind = shape(c, 0);
      for (let y = 0; y < T8; y++) {
        for (let x = 0; x < T8; x++) {
          const pixel = mask[y * 40 * T8 + c * T8 + x];
          if (!insideShape(kind, x, y, T8)) expect(pixel, `open corner ${c}:${x},${y}`).toBe(0);
          // past the deepest the erosion or a rounded tip can reach, the solid half is solid
          else if (diagonalDistance(kind, x, y, T8) > 2.2 && y < T8 - 2 && x > 1 && x < T8 - 2)
            expect(pixel, `solid half ${c}:${x},${y}`).toBe(1);
        }
      }
    }
  });

  it('erodes a full cell along a side a slope beside it leaves exposed, and not along one it covers', () => {
    // pairs along row 0: a full cell, then to its right a slope — 2 leaves the full cell's right side exposed
    // (its own left edge isn't solid); 1 covers it
    const erodedRightEdge = (slope: number): number => {
      const slopes = new Map<string, number>();
      for (let c = 0; c < 200; c += 2) {
        slopes.set(`${c},-1`, OPEN);
        slopes.set(`${c + 1},-1`, OPEN);
        slopes.set(`${c + 1},0`, slope);
      }
      const { solid, shape } = world(slopes);
      const width = 200 * T8;
      const mask = buildMask(solid, width, T8, 0, 0, shape);
      let eroded = 0;
      // the full cells' rightmost column, away from the top corner's rounding
      for (let c = 0; c < 200; c += 2)
        for (let y = 3; y < T8; y++) eroded += mask[y * width + c * T8 + T8 - 1] ? 0 : 1;
      return eroded;
    };
    expect(erodedRightEdge(SLOPE_DOWN_LEFT)).toBeGreaterThan(20);
    expect(erodedRightEdge(SLOPE_DOWN_RIGHT)).toBe(0);
  });
});
