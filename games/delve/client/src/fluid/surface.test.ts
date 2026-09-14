// surface.test.ts — the interactive water surface (#89). Behaviour in motion: ripples travel, then die.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createSurface, WATER_SURFACE } from './surface';

const DT = 1 / 60;

describe('the water surface', () => {
  it('stays perfectly still when nothing disturbs it', () => {
    const surface = createSurface(64);
    for (let step = 0; step < 600; step++) surface.step(DT);
    expect(surface.amplitude).toBe(0);
  });

  it('carries a disturbance outward as a ripple', () => {
    const surface = createSurface(160);
    surface.disturb(20, 120, 3);
    let reachedAt = -1;
    for (let step = 1; step <= 120 && reachedAt < 0; step++) {
      surface.step(DT);
      if (Math.abs(surface.offset[60]) > 0.05) reachedAt = step;
    }
    // it arrives, 40 columns away, well within two seconds — and later than it reaches nearer columns
    expect(reachedAt).toBeGreaterThan(0);
    const nearer = createSurface(160);
    nearer.disturb(20, 120, 3);
    let nearAt = -1;
    for (let step = 1; step <= 120 && nearAt < 0; step++) {
      nearer.step(DT);
      if (Math.abs(nearer.offset[30]) > 0.05) nearAt = step;
    }
    expect(nearAt).toBeLessThan(reachedAt);
  });

  it('settles back to its level after a splash', () => {
    const surface = createSurface(96);
    surface.disturb(48, 200, 4);
    let peak = 0;
    for (let step = 0; step < 30; step++) {
      surface.step(DT);
      peak = Math.max(peak, surface.amplitude);
    }
    expect(peak).toBeGreaterThan(1); // a visible ripple, at least a pixel
    for (let step = 0; step < 60 * 6; step++) surface.step(DT);
    expect(surface.amplitude).toBeLessThan(0.25); // under half a pixel: drawn flat
  });

  it('stays bounded and deterministic under any sequence of impacts', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 79 }),
            fc.integer({ min: -600, max: 600 }),
            fc.integer({ min: 1, max: 8 }),
          ),
          { maxLength: 40 },
        ),
        (impacts) => {
          const a = createSurface(80);
          const b = createSurface(80);
          for (const [x, speed, radius] of impacts) {
            a.disturb(x, speed, radius);
            b.disturb(x, speed, radius);
            for (let step = 0; step < 3; step++) {
              a.step(DT);
              b.step(DT);
            }
          }
          for (let step = 0; step < 120; step++) {
            a.step(DT);
            b.step(DT);
            for (let column = 0; column < 80; column++)
              expect(Number.isFinite(a.offset[column])).toBe(true);
            // however hard it's hit, a splash is capped
            expect(a.amplitude).toBeLessThanOrEqual(WATER_SURFACE.maxOffset);
          }
          expect(Array.from(a.offset)).toEqual(Array.from(b.offset));
        },
      ),
      { numRuns: 50 },
    );
  });
});
