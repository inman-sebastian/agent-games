// surface.test.ts — the interface's generated materials (#42, #43).
//
// Asserts the PATTERNS, not the images: every function here decides pixels and `patternUrl` only
// paints them, so the interesting part is testable without a canvas — which happy-dom lacks.
//
// The properties worth holding are the ones that make these read as pixel art rather than as CSS:
// that the dither uses the ROCK's threshold grid, that tiles wrap seamlessly, that a bevel is lit
// from the right direction, and that no colour is invented in here.
import { describe, it, expect } from 'vitest';
import { BAYER } from '../render/palette';
import {
  framePixels,
  ditherTile,
  fadeStrip,
  threshold,
  FRAME_SIZE,
  FRAME_SLICE,
  DITHER,
  type FrameRoles,
  type Pattern,
} from './surface';

const ROLES: FrameRoles = {
  outline: '#2e222f',
  light: '#9babb2',
  shade: '#625565',
  fill: '#3e3546',
  speck: '#7f708a',
  mottle: '#2e222f',
  speckle: 0.25,
};

const colorsIn = (pattern: Pattern): Set<string | null> =>
  new Set(pattern.flatMap((row) => [...row]));


describe('the dither', () => {
  it('is the rock\'s own threshold grid', () => {
    // THE point of this file. If the UI dithered on its own matrix it would only resemble the rock;
    // on the same matrix the two interleave on the same grid.
    for (let y = 0; y < DITHER; y++) {
      for (let x = 0; x < DITHER; x++) {
        expect(threshold(x, y)).toBe((BAYER[(x & 3) | ((y & 3) << 2)] + 0.5) / 16);
      }
    }
  });

  it('tiles seamlessly, because it is exactly one matrix across', () => {
    // A tile narrower or wider than the matrix would show a seam at every repeat, which is the one
    // way a dithered background looks worse than a flat one.
    const tile = ditherTile('#000000', '#ffffff', 0.5);
    expect(tile).toHaveLength(DITHER);
    for (const row of tile) expect(row).toHaveLength(DITHER);
    for (let y = 0; y < DITHER; y++) {
      for (let x = 0; x < DITHER; x++) {
        expect(threshold(x, y), `wraps at ${x},${y}`).toBe(threshold(x + DITHER, y + DITHER));
      }
    }
  });

  it('is monotonic in density', () => {
    // More density must never mean fewer lit pixels, or a fade would reverse somewhere in the middle.
    const count = (density: number): number =>
      ditherTile(null, '#fff', density).flat().filter(Boolean).length;
    let previous = -1;
    for (let i = 0; i <= 10; i++) {
      const now = count(i / 10);
      expect(now, `density ${i / 10}`).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    expect(count(0), 'density 0 is empty').toBe(0);
    expect(count(1), 'density 1 is full').toBe(DITHER * DITHER);
  });
});

describe('the top bar fade', () => {
  it('runs from solid to nothing', () => {
    const strip = fadeStrip('#2e222f', 24);
    expect(strip).toHaveLength(24);
    expect(strip[0].every((c) => c !== null), 'the top row is solid').toBe(true);
    expect(strip[23].every((c) => c === null), 'the bottom row is clear').toBe(true);
  });

  it('thins monotonically over each matrix period, not row by row', () => {
    // Row-by-row monotonicity is the WRONG property here, and asserting it was my first mistake:
    // the Bayer threshold varies with y, so an ordered dither's per-row count oscillates by design.
    // That oscillation is exactly what makes it read as a dither rather than as a stack of bands.
    //
    // The real guarantee is over one full period of the matrix: averaged across four rows, coverage
    // only ever thins. A fade that thickened over a whole period would read as the banding artefact
    // the CSS gradient had.
    const strip = fadeStrip('#2e222f', 24);
    const filled = strip.map((row) => row.filter(Boolean).length);
    const periods: number[] = [];
    for (let y = 0; y + DITHER <= filled.length; y += DITHER) {
      periods.push(filled.slice(y, y + DITHER).reduce((a, b) => a + b, 0));
    }
    expect(periods.length, 'the strip spans several periods').toBeGreaterThan(2);
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i], `period ${i} vs ${i - 1}`).toBeLessThanOrEqual(periods[i - 1]);
    }
  });
});

describe('the panel frame', () => {
  it('is square, and leaves a middle to tile', () => {
    const px = framePixels('raised', ROLES);
    expect(px).toHaveLength(FRAME_SIZE);
    for (const row of px) expect(row).toHaveLength(FRAME_SIZE);
    expect(FRAME_SIZE - FRAME_SLICE * 2, 'the middle slice is at least one pixel').toBeGreaterThan(
      0,
    );
  });

  it('is outlined on every edge', () => {
    // The outline separates a panel from the rock behind it, so a gap anywhere in it shows.
    const px = framePixels('raised', ROLES);
    const last = FRAME_SIZE - 1;
    for (let i = 0; i < FRAME_SIZE; i++) {
      expect(px[0][i], `top ${i}`).toBe(ROLES.outline);
      expect(px[last][i], `bottom ${i}`).toBe(ROLES.outline);
      expect(px[i][0], `left ${i}`).toBe(ROLES.outline);
      expect(px[i][last], `right ${i}`).toBe(ROLES.outline);
    }
  });

  it('lights a raised frame from above and an inset one from below', () => {
    // Reversing the bevel is the entire difference between a plate and a recess, and getting it
    // backwards is the classic way a UI looks subtly wrong without looking broken.
    const mid = FRAME_SIZE >> 1;
    const last = FRAME_SIZE - 1;
    expect(framePixels('raised', ROLES)[1][mid], 'raised: top lit').toBe(ROLES.light);
    expect(framePixels('raised', ROLES)[last - 1][mid], 'raised: bottom shaded').toBe(ROLES.shade);
    expect(framePixels('inset', ROLES)[1][mid], 'inset: top shaded').toBe(ROLES.shade);
    expect(framePixels('inset', ROLES)[last - 1][mid], 'inset: bottom lit').toBe(ROLES.light);
  });

  it('dithers the lip into the face rather than butting it', () => {
    // The ring that makes a frame a material instead of a border. It must contain BOTH the lip's
    // colour and the face's — all of one means it is just a second hard line.
    const ring = new Set<string | null>();
    const px = framePixels('raised', ROLES);
    const mid = FRAME_SIZE >> 1;
    for (const [y, x] of [
      [2, mid],
      [mid, 2],
    ]) {
      ring.add(px[y][x]);
    }
    // sample the whole transition ring on the lit sides
    const lit = new Set<string | null>();
    for (let i = 2; i < FRAME_SIZE - 2; i++) {
      lit.add(px[2][i]);
      lit.add(px[i][2]);
    }
    expect(lit.has(ROLES.light), 'the transition carries the lip').toBe(true);
    expect(lit.has(ROLES.fill), 'the transition carries the face').toBe(true);
  });

  it('flecks the tiling face, so a panel is textured rather than flat', () => {
    // The face tiles across the whole panel, so this is what the user actually sees most of. Flat
    // colour here is what made the interface read as CSS.
    const px = framePixels('raised', ROLES);
    const middle = new Set<string | null>();
    for (let y = FRAME_SLICE; y < FRAME_SIZE - FRAME_SLICE; y++) {
      for (let x = FRAME_SLICE; x < FRAME_SIZE - FRAME_SLICE; x++) middle.add(px[y][x]);
    }
    expect(middle.has(ROLES.fill), 'the face is present').toBe(true);
    expect(middle.size, 'the face is not one flat colour').toBeGreaterThan(1);
  });

  it('invents no colour', () => {
    // The frame's palette is the stylesheet's, read back out of it — never a value chosen in here.
    const allowed = new Set<string | null>(
      Object.values(ROLES).filter((v): v is string => typeof v === 'string'),
    );
    for (const kind of ['raised', 'inset'] as const) {
      for (const color of colorsIn(framePixels(kind, ROLES))) {
        expect(allowed.has(color), `${kind} uses ${color}`).toBe(true);
      }
    }
  });
});
