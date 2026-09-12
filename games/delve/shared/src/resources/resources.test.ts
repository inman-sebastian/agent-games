// resources.test.ts — every registered entity conforms to its resource contract. Parametrized
// per-entity so a failure names the exact offender. Node-free (shared stays platform-neutral);
// the filesystem drift check (index.ts ↔ directory) lives in tools/resources.test.ts, where node
// types are available.
import { describe, it, expect } from 'vitest';
import { all, shapes, rarityOf, RARITY_MAX } from '@delve/shared';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RAMP_STOPS = 6;

const strata = all('strata');
const ores = all('ore');

describe('strata conformance', () => {
  it.each(strata.map((s) => [s.id, s] as const))('%s', (_id, stratum) => {
    expect(stratum.id).toBeTruthy();
    expect(Number.isFinite(stratum.top)).toBe(true);
    expect(stratum.top).toBeGreaterThanOrEqual(0);
    expect(stratum.ramp).toHaveLength(RAMP_STOPS);
    for (const hex of stratum.ramp) expect(hex).toMatch(HEX_COLOR);
  });
});

describe('ore conformance', () => {
  it.each(ores.map((o) => [o.name, o] as const))('%s', (_name, ore) => {
    expect(Number.isFinite(ore.id)).toBe(true);
    expect(ore.name).toBeTruthy();
    expect(ore.band).toHaveLength(2);
    expect(ore.band[0]).toBeLessThanOrEqual(ore.band[1]);
    expect(ore.hp).toBeGreaterThanOrEqual(0);
    expect(ore.weight).toBeGreaterThan(0);
    expect(ore.color).toMatch(HEX_COLOR);
    expect(shapes[ore.art.shape]).toBeDefined();
    expect(ore.art.c).toHaveLength(3);
    expect(ore.desc.length).toBeGreaterThan(0);
  });

  it('ore ids are unique', () => {
    const ids = ores.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ---- rarity (#46) -----------------------------------------------------------------------
  //
  // `rarityOf` used to be an ore's INDEX in the registry, so one number carried two unrelated
  // jobs: registry identity and reward tier. The client scales every reward cue by it — break
  // pitch, particle count, screen shake, whether the pickup gets the big floaty — so appending
  // four ore files after mythril made quartz (band 95) out-reward mythril (band 480) and made
  // stone bricks (band 20) the loudest, shakiest event in the entire game.
  //
  // Rarity is now AUTHORED on the resource, and these assert the properties that matter.

  it('every ore authors its own rarity, and rarityOf returns it', () => {
    for (const ore of ores) {
      expect(Number.isInteger(ore.rarity), `${ore.name} rarity is an integer`).toBe(true);
      expect(ore.rarity, `${ore.name} rarity floor`).toBeGreaterThanOrEqual(0);
      expect(ore.rarity, `${ore.name} rarity ceiling`).toBeLessThanOrEqual(RARITY_MAX);
      expect(rarityOf(ore.id), `${ore.name} rarityOf agrees with the resource`).toBe(ore.rarity);
    }
  });

  it('the top tier is reserved, and shallow material never reaches the celebration', () => {
    // The bug's shape, stated as intent rather than as the two ores that happened to show it: what
    // went wrong was a SHALLOW, PLENTIFUL material claiming the feedback owed to a deep, scarce
    // one. Both halves are asserted, so appending another ore file cannot reintroduce it.
    const top = ores.filter((o) => o.rarity === RARITY_MAX);
    expect(top.map((o) => o.name), 'the top tier holds exactly one ore').toEqual(['Mythril']);

    const SHALLOW = 100; // rows; roughly the first two strata
    const CELEBRATED = Math.ceil(RARITY_MAX * 0.6); // the tier the client gives the big floaty to
    for (const ore of ores.filter((o) => o.band[0] < SHALLOW)) {
      expect(ore.rarity, `${ore.name} is shallow, so it must not be celebrated`).toBeLessThan(
        CELEBRATED,
      );
    }
  });

  it('rarity is NOT derived from depth', () => {
    // Worth pinning, because "sort the registry by depth" was the tempting cheap fix and it is
    // wrong. Depth says WHERE a material is, not how special it is: quartz is deeper than gold and
    // far more plentiful, and stone bricks are shallow but not a prize at all. A rarity that
    // tracked depth would also be built on the placement system, which is being demoted from
    // depth-only anyway (docs/BIOMES.md). So the two orderings must be allowed to disagree.
    const byRarity = [...ores].sort((a, b) => a.rarity - b.rarity || a.id - b.id).map((o) => o.name);
    const byDepth = [...ores].sort((a, b) => a.band[0] - b.band[0]).map((o) => o.name);
    expect(byRarity).not.toEqual(byDepth);
  });
});
