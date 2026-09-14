// slopes.test.ts — sloped cells in the world (#92). That world smoothing (the port of Terraria's Smooth World pass)
// matches Terraria's code is tools/terraria-oracle/smooth.test.ts; this is about the world it feeds: slopes exist
// on the surface, the query is a pure function that agrees across chunk seams and cache misses, and a slope is
// mined like any other cell.
import { describe, it, expect } from 'vitest';
import { blockAt, mineTile, mineable, newSession, solidAt, surfaceAt } from './engine';
import { FULL, OPEN, SMOOTH_CHUNK, shapeAt } from './slopes';
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
