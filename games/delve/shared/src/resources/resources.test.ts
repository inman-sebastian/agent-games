// resources.test.ts — every registered entity conforms to its resource contract. Parametrized
// per-entity so a failure names the exact offender. Node-free (shared stays platform-neutral);
// the filesystem drift check (index.ts ↔ directory) lives in tools/resources.test.ts, where node
// types are available.
import { describe, it, expect } from 'vitest';
import { all, shapes } from '@delve/shared';

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

  // `rarityOf` is an ore's INDEX in the registry, i.e. import order in resources/index.ts — and the
  // client scales reward feedback by it (break pitch, particle count, screen shake). So registry
  // order is implicitly a claim about how special each material is, and it should agree with depth.
  // It doesn't: quartz/platinum/obsidian/stonebricks were appended after mythril, so quartz (band
  // 95) outranks mythril (band 480) and stonebricks (band 20) outranks everything.
  //
  // `it.fails` asserts this is CURRENTLY BROKEN, so the gate stays green while the bug is on record
  // (see issue #46). When #46 is fixed this test starts failing — flip it to a plain `it()` then.
  it.fails('registry order agrees with depth order (#46 — expected to fail)', () => {
    const byRegistry = ores.map((o) => o.name);
    const byDepth = [...ores].sort((a, b) => a.band[0] - b.band[0]).map((o) => o.name);
    expect(byRegistry).toEqual(byDepth);
  });
});
