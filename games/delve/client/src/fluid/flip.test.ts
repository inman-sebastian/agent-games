// flip.test.ts — the FLIP liquid's invariants (#88). Bounded: the whole file runs in about a second.
//
// What the grid and pixel models taught (FLUIDS.md) still applies to the checks: conserve what's
// conserved, never inside rock, and check shapes IN MOTION — a dam break has to reach the far wall and
// then settle flat at the right depth, which is the case the pixel automaton never passed.
import { describe, it, expect } from 'vitest';
import { createFlip, FLIP_DEFAULTS, type FlipSim } from './flip';

/** A walled tank: rock 4 px thick on the sides and floor, open above. */
function tank(
  width: number,
  height: number,
  extraRock?: (x: number, y: number) => boolean,
): Uint8Array {
  const solid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wall = x < 4 || x >= width - 4 || y >= height - 4;
      solid[y * width + x] = wall || extraRock?.(x, y) ? 1 : 0;
    }
  }
  return solid;
}

const run = (sim: FlipSim, seconds: number): void => {
  for (let step = 0; step < Math.round(seconds * 60); step++) sim.step(1 / 60);
};

describe('the FLIP liquid', () => {
  it('conserves particles, never ends a step in rock, and stays stable — every step', () => {
    const width = 128;
    const height = 96;
    // a tank with a rock ledge and a pillar in the way
    const solid = tank(
      width,
      height,
      (x, y) => (y >= 40 && y < 46 && x < 70) || (x >= 90 && x < 98 && y >= 60),
    );
    const sim = createFlip(width, height, solid);
    const seeded = sim.fill(4, 4, 60, 38);
    expect(seeded).toBeGreaterThan(300);
    for (let step = 0; step < 180; step++) {
      sim.step(1 / 60);
      expect(sim.count).toBe(seeded);
      for (let p = 0; p < sim.count; p++) {
        const x = sim.positions[2 * p];
        const y = sim.positions[2 * p + 1];
        expect(Number.isFinite(x) && Number.isFinite(y), `particle ${p} at step ${step}`).toBe(
          true,
        );
        expect(
          solid[Math.floor(y) * width + Math.floor(x)],
          `particle ${p} in rock at step ${step}`,
        ).toBe(0);
        // a fall from the tank's top reaches ~370 px/s; anything far past that is the solver blowing up
        expect(Math.hypot(sim.velocities[2 * p], sim.velocities[2 * p + 1])).toBeLessThan(2000);
      }
    }
  });

  it('is deterministic', () => {
    const solid = tank(96, 64);
    const a = createFlip(96, 64, solid);
    const b = createFlip(96, 64, solid);
    a.fill(4, 4, 40, 60);
    b.fill(4, 4, 40, 60);
    run(a, 1);
    run(b, 1);
    expect(Array.from(a.positions.subarray(0, 2 * a.count))).toEqual(
      Array.from(b.positions.subarray(0, 2 * b.count)),
    );
  });

  it('breaks a dam: the front reaches the far wall, then the water settles flat at its true depth', () => {
    const width = 192;
    const height = 96;
    const sim = createFlip(width, height, tank(width, height));
    sim.fill(4, 12, 52, 92);
    const expectedSurface = 92 - (48 * 80) / (width - 8); // the column's area spread over the floor

    let reached = Infinity;
    for (let step = 1; step <= 60 && reached === Infinity; step++) {
      sim.step(1 / 60);
      for (let p = 0; p < sim.count; p++)
        if (sim.positions[2 * p] > width - 12) reached = step / 60;
    }
    // measured at #88: the front arrives in about half a second
    expect(reached).toBeLessThan(1);

    run(sim, 8);
    // the surface: the highest particle in each 8 px column, ignoring the extreme two (spray)
    const tops = new Array(Math.floor((width - 8) / 8)).fill(Infinity);
    for (let p = 0; p < sim.count; p++) {
      const bin = Math.floor((sim.positions[2 * p] - 4) / 8);
      if (bin >= 0 && bin < tops.length) tops[bin] = Math.min(tops[bin], sim.positions[2 * p + 1]);
    }
    const sorted = [...tops].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    // flat: measured 68–74 after 8 s. At its true depth: drift compensation holds the volume — with the
    // reference's unscaled stiffness the median sat at 77, the liquid 30% compressed
    expect(
      sorted[sorted.length - 2] - sorted[1],
      sorted.map((t) => t.toFixed(0)).join(' '),
    ).toBeLessThanOrEqual(9);
    expect(Math.abs(median - expectedSurface)).toBeLessThanOrEqual(2.5);

    // and the particles are spread at about their seeded spacing, not stacked on each other: compressed liquid
    // (the unscaled stiffness) packed them at a mean nearest neighbour of 1.15 px against 2.4 px
    let nearestSum = 0;
    for (let p = 0; p < sim.count; p++) {
      let nearest = Infinity;
      for (let q = 0; q < sim.count; q++) {
        if (q === p) continue;
        const d = Math.hypot(
          sim.positions[2 * q] - sim.positions[2 * p],
          sim.positions[2 * q + 1] - sim.positions[2 * p + 1],
        );
        nearest = Math.min(nearest, d);
      }
      nearestSum += nearest;
    }
    expect(nearestSum / sim.count).toBeGreaterThan(0.75 * 2 * sim.radius);
    expect(FLIP_DEFAULTS.h).toBe(4);
  });
});
