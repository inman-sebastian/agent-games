// blocks.test.ts — world-gen invariants. Replaces (and strengthens) the old hand-crafted
// verify.ts world checks: instead of one curated seed, these assert properties that must hold
// across MANY random seeds/cells — determinism, ore discoverability, and the placement invariant
// that ore never appears outside its band (a bug the single-scenario gate could never catch).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { blockAt, oreAt, ORES, ORE_BY_ID, strataIndexAt, rockHp, WIDTH, SURFACE } from '@delve/shared';

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe('world-gen determinism', () => {
  it('blockAt is a pure function of (seed, column, row)', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: -200, max: 200 }), fc.integer({ min: 1, max: 700 }), (seed, c, r) => {
        expect(blockAt(seed, c, r)).toEqual(blockAt(seed, c, r));
      }),
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

  it('row <= SURFACE is always open sky', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: -50, max: 50 }), fc.integer({ min: -20, max: SURFACE }), (seed, c, r) => {
        expect(blockAt(seed, c, r).kind).toBe('open');
        expect(oreAt(seed, c, r)).toBe(0);
      }),
    );
  });
});

describe('ore placement', () => {
  // The invariant the old gate couldn't make: ore NEVER appears outside its declared band.
  it('never places an ore outside its [minRow, maxRow] band', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: -200, max: 200 }), fc.integer({ min: 1, max: 700 }), (seed, c, r) => {
        const ore = oreAt(seed, c, r);
        if (ore === 0) return;
        const def = ORE_BY_ID[ore];
        expect(def, `oreAt returned unknown id ${ore}`).toBeDefined();
        expect(r).toBeGreaterThanOrEqual(def.band[0]);
        expect(r).toBeLessThanOrEqual(def.band[1]);
      }),
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
            if (oreAt(seed, c, r) === ore.id) { found = true; break; }
        if (found) seedsWithOre++;
      }
      // it should appear in the vast majority of seeds; require at least most of them
      expect(seedsWithOre, `${ore.name} appeared in only ${seedsWithOre}/20 seeds`).toBeGreaterThanOrEqual(15);
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
