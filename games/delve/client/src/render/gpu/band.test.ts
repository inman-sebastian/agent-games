// band.test.ts — the cell band under a screen (#71). Its size is the renderer's buffers' and textures' size, so
// it must not change while the screen doesn't: it used to flicker by a cell as the camera scrolled, and every
// flicker reallocated them.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { bandFor } from './renderer';
import { T } from '../palette';

describe('the band under a screen', () => {
  it('keeps one size for a screen size, wherever the camera is', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 64, max: 2000 }),
        fc.integer({ min: 64, max: 1200 }),
        fc.double({ min: -5000, max: 50000, noNaN: true }),
        fc.double({ min: -5000, max: 50000, noNaN: true }),
        (width, height, camX, camY) => {
          const here = bandFor(camX, camY, width, height);
          const there = bandFor(0, 0, width, height);
          expect([here.cols, here.rows]).toEqual([there.cols, there.rows]);
        },
      ),
    );
  });

  it('covers every cell a screen pixel touches', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 64, max: 2000 }),
        fc.integer({ min: 64, max: 1200 }),
        fc.double({ min: -5000, max: 50000, noNaN: true }),
        fc.double({ min: -5000, max: 50000, noNaN: true }),
        (width, height, camX, camY) => {
          const band = bandFor(camX, camY, width, height);
          expect(band.left).toBeLessThanOrEqual(Math.floor(band.originX / T));
          expect((band.left + band.cols) * T).toBeGreaterThanOrEqual(band.originX + width);
          expect((band.top + band.rows) * T).toBeGreaterThanOrEqual(band.originY + height);
        },
      ),
    );
  });
});
