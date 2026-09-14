// liquid.test.ts — the port against Terraria's own code (#90). Every scene in
// terraria-oracle/scenes.json was run through Terraria 1.4.0.5's decompiled Liquid.cs; the port must produce the
// same liquid in every tile, and the same number of active entries, at every snapshot.
import { describe, it, expect } from 'vitest';
import { loadOracle, replay } from './oracle';

const { scenes, results } = loadOracle();

describe("the port matches Terraria's Liquid.cs", () => {
  for (const scene of scenes) {
    it(scene.name, () => {
      const expected = results.find((result) => result.name === scene.name)!.snapshots;
      let snapshot = 0;
      replay(scene, (update, liquid) => {
        const oracle = expected[snapshot++];
        expect(oracle.update).toBe(update);
        const levels = Array.from(liquid.level);
        const first = levels.findIndex((level, index) => level !== oracle.levels[index]);
        const where =
          first < 0
            ? ''
            : ` first at ${first % liquid.width},${Math.floor(first / liquid.width)}: ${levels[first]} ≠ ${oracle.levels[first]}`;
        expect(first, `update ${update}${where}`).toBe(-1);
        expect(liquid.activeCount(), `active entries at update ${update}`).toBe(oracle.active);
      });
      expect(snapshot).toBe(expected.length);
    });
  }
});
