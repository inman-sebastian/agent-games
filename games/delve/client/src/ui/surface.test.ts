// surface.test.ts — the panel frame's pixel layout (#42).
//
// Asserts the DATA, not the image: `framePixels` decides every pixel and `patternUrl` only paints
// it, so the interesting part is testable without a canvas — which happy-dom does not provide.
import { describe, it, expect } from 'vitest';
import { framePixels, FRAME_SIZE, FRAME_SLICE, type FrameRoles, type Pattern } from './surface';

const ROLES: FrameRoles = {
  outline: '#2e222f',
  light: '#9babb2',
  shade: '#625565',
  fill: '#3e3546',
};

const colorsIn = (pattern: Pattern): Set<string | null> =>
  new Set(pattern.flatMap((row) => [...row]));

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
    // The outline separates a panel from the rock behind it, so a gap anywhere in it shows. It is
    // also the one rule every source agrees on: a dark outline reads at any size.
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
    // backwards is the classic way a UI looks subtly wrong without looking broken. The rock is lit
    // from above too, so these must agree with it.
    const mid = FRAME_SIZE >> 1;
    const last = FRAME_SIZE - 1;
    expect(framePixels('raised', ROLES)[1][mid], 'raised: top lit').toBe(ROLES.light);
    expect(framePixels('raised', ROLES)[last - 1][mid], 'raised: bottom shaded').toBe(ROLES.shade);
    expect(framePixels('inset', ROLES)[1][mid], 'inset: top shaded').toBe(ROLES.shade);
    expect(framePixels('inset', ROLES)[last - 1][mid], 'inset: bottom lit').toBe(ROLES.light);
  });

  it('opposes the inner lip to the outer bevel', () => {
    // What makes a panel read as a frame AROUND something rather than as a raised rectangle. The
    // second ring has to invert the first; if they agree, the panel just looks thicker.
    const px = framePixels('raised', ROLES);
    const mid = FRAME_SIZE >> 1;
    const last = FRAME_SIZE - 1;
    expect(px[1][mid], 'outer top is lit').toBe(ROLES.light);
    expect(px[2][mid], 'inner top is shaded').toBe(ROLES.shade);
    expect(px[last - 1][mid], 'outer bottom is shaded').toBe(ROLES.shade);
    expect(px[last - 2][mid], 'inner bottom is lit').toBe(ROLES.light);
  });

  it('leaves the bevel corners dark rather than picking a side', () => {
    // A bevel that turns a corner has to choose which side wins, and either choice reads as a
    // mistake. Dark reads as a mitre.
    const px = framePixels('raised', ROLES);
    const last = FRAME_SIZE - 1;
    for (const [y, x] of [
      [1, 1],
      [1, last - 1],
      [last - 1, 1],
      [last - 1, last - 1],
    ]) {
      expect(px[y][x], `bevel corner ${x},${y}`).toBe(ROLES.outline);
    }
  });

  it('keeps the tiling face FLAT', () => {
    // Deliberate, and the whole lesson of the rejected version. The middle slice tiles across the
    // entire panel, so anything but one flat colour repeats behind the text — and every source says
    // the same thing: no dithering in UI, none at all under ~8-10px of run. Texture in a pixel-art
    // interface comes from placed detail, not from noise.
    const px = framePixels('raised', ROLES);
    const middle = new Set<string | null>();
    for (let y = FRAME_SLICE; y < FRAME_SIZE - FRAME_SLICE; y++) {
      for (let x = FRAME_SLICE; x < FRAME_SIZE - FRAME_SLICE; x++) middle.add(px[y][x]);
    }
    expect([...middle], 'the tiling face is one flat colour').toEqual([ROLES.fill]);
  });

  it('invents no colour', () => {
    // The frame's palette is the stylesheet's, read back out of it — never a value chosen in here.
    const allowed = new Set<string | null>(Object.values(ROLES));
    for (const kind of ['raised', 'inset'] as const) {
      for (const color of colorsIn(framePixels(kind, ROLES))) {
        expect(allowed.has(color), `${kind} uses ${color}`).toBe(true);
      }
    }
  });
});
