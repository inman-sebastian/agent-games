// cave-render.test.ts — the strata ramp the renderer paints agrees with the stratum the sim says a
// row is in.
//
// `rampAt` is handed CELL rows while strata tops are authored in BLOCKS. Before this test it compared
// the two directly, so after the 2x2 split (#44) every stratum's colour arrived at half its authored
// depth — and bedrock (#57) would have painted at block 350, halfway down a world whose floor is 700.
import { describe, it, expect, beforeAll } from 'vitest';
import { STRATA, SUB, FLOOR, strataIndexAt } from '@delve/shared';
import { setStrata, rampAt } from './cave-render';

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
