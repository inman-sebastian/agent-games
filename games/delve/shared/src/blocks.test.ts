// blocks.test.ts — world-gen invariants. Replaces (and strengthens) the old hand-crafted
// verify.ts world checks: instead of one curated seed, these assert properties that must hold
// across MANY random seeds/cells — determinism, ore discoverability, and the placement invariant
// that ore never appears outside its band (a bug the single-scenario gate could never catch).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  blockAt,
  oreAt,
  ORES,
  ORE_BY_ID,
  strataIndexAt,
  rockHp,
  WIDTH,
  SURFACE_BASE,
  surfaceAt,
  solidAt,
} from '@delve/shared';

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe('world-gen determinism', () => {
  it('blockAt is a pure function of (seed, column, row)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: 1, max: 700 }),
        (seed, c, r) => {
          expect(blockAt(seed, c, r)).toEqual(blockAt(seed, c, r));
        },
      ),
    );
  });

  it('the same seed regenerates the same world slice', () => {
    const slice = (seed: number): number[] => {
      const out: number[] = [];
      for (let r = 1; r <= 60; r++) for (let c = 0; c < WIDTH; c++) out.push(oreAt(seed, c, r));
      return out;
    };
    expect(slice(4242)).toEqual(slice(4242));
    expect(slice(4242)).not.toEqual(slice(4243)); // different seeds diverge
  });

  it("is open sky at or above the column's own surface, solid below it", () => {
    // The surface is a heightmap now (#44), so this is per COLUMN. It used to assert that every row
    // at or above row 0 was open, which a hill or a valley makes false in both directions.
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: -300, max: 300 }),
        fc.integer({ min: -30, max: 30 }),
        (seed, c, offset) => {
          const surface = surfaceAt(seed, c);
          const row = surface + offset;
          if (offset <= 0) {
            expect(blockAt(seed, c, row).kind).toBe('open');
            expect(oreAt(seed, c, row)).toBe(0);
          } else {
            expect(blockAt(seed, c, row).solid).toBe(true);
          }
        },
      ),
    );
  });
});

describe('ore placement', () => {
  // The invariant the old gate couldn't make: ore NEVER appears outside its declared band.
  it('never places an ore outside its [minRow, maxRow] band', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: 1, max: 700 }),
        (seed, c, r) => {
          const ore = oreAt(seed, c, r);
          if (ore === 0) return;
          const def = ORE_BY_ID[ore];
          expect(def, `oreAt returned unknown id ${ore}`).toBeDefined();
          expect(r).toBeGreaterThanOrEqual(def.band[0]);
          expect(r).toBeLessThanOrEqual(def.band[1]);
        },
      ),
    );
  });

  // Discoverability across MANY seeds, not just the one the author happened to pick.
  it('every ore tier is discoverable within its band (20 seeds)', () => {
    const SCAN_ROWS = 80;
    for (const ore of ORES) {
      const lastRow = Math.min(ore.band[1], ore.band[0] + SCAN_ROWS);
      let seedsWithOre = 0;
      for (let seed = 1; seed <= 20; seed++) {
        let found = false;
        for (let r = ore.band[0]; r <= lastRow && !found; r++)
          for (let c = 0; c < WIDTH; c++)
            if (oreAt(seed, c, r) === ore.id) {
              found = true;
              break;
            }
        if (found) seedsWithOre++;
      }
      // it should appear in the vast majority of seeds; require at least most of them
      expect(
        seedsWithOre,
        `${ore.name} appeared in only ${seedsWithOre}/20 seeds`,
      ).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('depth curves are monotonic', () => {
  it('strataIndexAt never decreases with depth', () => {
    let prev = strataIndexAt(1);
    for (let r = 1; r <= 700; r++) {
      const idx = strataIndexAt(r);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it('rockHp never decreases with depth', () => {
    let prev = rockHp(1);
    for (let r = 1; r <= 700; r++) {
      const hp = rockHp(r);
      expect(hp).toBeGreaterThanOrEqual(prev);
      prev = hp;
    }
  });
});

describe('the surface heightmap (#44)', () => {
  it('is deterministic per seed and varies with it', () => {
    const slice = (seed: number): number[] =>
      Array.from({ length: 200 }, (_, i) => surfaceAt(seed, i - 100));
    expect(slice(9)).toEqual(slice(9));
    expect(slice(9)).not.toEqual(slice(10));
  });

  it('is not flat', () => {
    // The whole point of the issue: the surface is content, not a plane.
    const heights = new Set(Array.from({ length: 400 }, (_, c) => surfaceAt(3, c - 200)));
    expect(heights.size).toBeGreaterThan(4);
  });

  it('never rises more than the player can step', () => {
    // THE constraint the amplitudes were chosen against, measured rather than trusted. A rise
    // steeper than the step-up assist is a wall of open ground the player simply cannot pass, and
    // the movement regression test found exactly that before `stepUp` existed.
    let worst = 0;
    for (const seed of [1, 7, 42, 1234, 99999]) {
      for (let c = -500; c < 500; c++) {
        worst = Math.max(worst, Math.abs(surfaceAt(seed, c + 1) - surfaceAt(seed, c)));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('stays within a sane band of the base row', () => {
    // Unbounded terrain would put the spawn arbitrarily far from the strata the ore bands assume.
    for (const seed of [1, 7, 42, 1234, 99999]) {
      for (let c = -500; c < 500; c++) {
        expect(Math.abs(surfaceAt(seed, c) - SURFACE_BASE)).toBeLessThanOrEqual(6);
      }
    }
  });

  it('puts the boundary exactly at the surface row, with nothing floating', () => {
    // The issue's own acceptance criterion: no column's surface sits inside rock or hangs over a
    // gap. Solidity is DEFINED from the heightmap, so this is really a check that every consumer
    // agrees — `blockAt`, `solidAt` and `oreAt` all branch on it separately.
    for (const seed of [5, 555]) {
      for (let c = -60; c < 60; c++) {
        const surface = surfaceAt(seed, c);
        expect(solidAt(seed, c, surface)).toBe(false);
        expect(solidAt(seed, c, surface + 1)).toBe(true);
        expect(blockAt(seed, c, surface).solid).toBe(false);
        expect(blockAt(seed, c, surface + 1).solid).toBe(true);
      }
    }
  });
});
