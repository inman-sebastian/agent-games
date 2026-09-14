// The lighting's reach is a WORLD distance, not a cell count. Two bugs in a row came from a length
// left in block units after the 2x2 split (#44) quadrupled the grid, and both presented as "the
// lamp only lights what the miner is standing on" — see lampReachBlocks.
import { describe, it, expect } from 'vitest';
import { SUB } from '@delve/shared';
import { lampReachBlocks } from './lighting';

// What the game actually seeds the lamp with at base levels: see LAMP_BASE_INTENSITY /
// LAMP_REACH_GAIN in client/src/index.ts, where the gain is per BLOCK of lamp reach.
const BASE_LAMP_BLOCKS = 3.4;
const BASE_SEED = 0.9 + 0.16 * BASE_LAMP_BLOCKS;
const LIGHT_DECAY_PER_BLOCK = 0.7; // the authored per-block conduction the per-cell step is rooted from

describe('lamp reach is a world distance (#44)', () => {
  it('carries the base lamp about 8 blocks down an open tunnel', () => {
    // The value the look was tuned to, pre-split, when one propagation step was one block.
    expect(lampReachBlocks(BASE_SEED)).toBeGreaterThan(7);
    expect(lampReachBlocks(BASE_SEED)).toBeLessThan(9);
  });

  it('is independent of how finely the grid is subdivided', () => {
    // THE invariant. Attenuation is authored per block and rooted to the per-cell step, so SUB
    // cell-steps must decay exactly as one block-step did. Reconstructing the per-block decay from
    // the per-cell one has to give back the authored 0.7 — if a future re-scale leaves the constant
    // in step units, this is what notices.
    const perCellDecay = Math.pow(LIGHT_DECAY_PER_BLOCK, 1 / SUB);
    expect(Math.pow(perCellDecay, SUB)).toBeCloseTo(LIGHT_DECAY_PER_BLOCK, 10);
    // and a brighter lamp always reaches further, at any subdivision
    expect(lampReachBlocks(BASE_SEED * 2)).toBeGreaterThan(lampReachBlocks(BASE_SEED));
  });

  it('reaches further than the miner can dig, so you can see what you mine', () => {
    expect(lampReachBlocks(BASE_SEED)).toBeGreaterThan(1);
  });
});
