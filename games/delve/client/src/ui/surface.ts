// surface.ts — the interface's MATERIALS, drawn in code (#42, #43).
//
// The stylesheet work put the UI on the art's grid and the art's palette, and that exposed a
// sharper problem than the one it fixed: the interface was geometrically pixel-correct and
// materially flat. Two solid fills and a hairline border. Meanwhile the rock beside it has a
// six-step ramp, 4x4 ordered dithering, texture noise, accent flecks, a lit rim and a dark centre.
// Sharing a palette is not sharing an art direction. Flat colour is what CSS gives you for free,
// and "for free" is exactly what made the UI read as CSS.
//
// So the surfaces are DRAWN, with the same primitives the rock is drawn with. Everything here is
// generated at startup — canvas, then a data URL, then a CSS custom property — which satisfies the
// create-every-asset rule with no asset file to keep in sync, no build step, and no second home for
// the palette: the colours are read back out of the stylesheet's own role properties.
//
// THE ONE IMPORT THAT MATTERS is `BAYER` from render/palette.ts. It is the identical 4x4 matrix
// every material shader quantises with, so a dithered panel and a dithered rock face interleave on
// the same threshold grid rather than merely resembling each other. That is the same "cohesion by
// construction rather than by imitation" argument the material system already won on.
//
// Every pattern is kept as PURE DATA so it can be asserted without a canvas, which happy-dom does
// not provide. The canvas function only paints what the pure ones decide.
import { BAYER } from '../render/palette';
import { hashXY } from '@delve/shared';

/** A pixel grid. `null` is transparent, which is how a dithered fade is expressed. */
export type Pattern = readonly (readonly (string | null)[])[];

/**
 * The nine-slice source: a 3px border per side, and a 10x10 middle that tiles across the face.
 *
 * The middle was 2x2 first, and that was the mistake. A 2x2 tile of Bayer-thresholded fleck repeats
 * every two pixels, which does not read as stone — it reads as a screen-door pattern, because at
 * that size an ordered dither IS a regular grid. The face needs a domain big enough for the texture
 * to look unplanned. Ten wraps cleanly and is past the point where the eye finds the period.
 */
export const FRAME_SIZE = 16;
export const FRAME_SLICE = 3;

/** Dither tiles are one Bayer matrix across, so they repeat seamlessly on the threshold grid. */
export const DITHER = 4;

/** Fixed, so the panel's texture is the same every boot — a UI that reshuffles is a UI that flickers. */
const FLECK_SEED = 0x5e17;

/**
 * The 4x4 ordered-dither threshold at a pixel, 0..1 — the rock's matrix, not a copy of it.
 *
 * A pixel takes the second colour when the requested density exceeds this. Because the matrix is
 * 4x4 and the tiles are 4x4, a tile wraps with the pattern intact: no seam, at any repeat.
 */
export const threshold = (x: number, y: number): number =>
  (BAYER[(x & 3) | ((y & 3) << 2)] + 0.5) / 16;

/**
 * Mix two colours by ordered dither at `density` (0 = all `a`, 1 = all `b`).
 *
 * This is the pixel-art vocabulary CSS cannot express. A gradient blends; a dither INTERLEAVES two
 * palette steps and lets the eye do the blending, which is why it stays on-palette at every
 * intermediate value. The rock has never used a gradient anywhere.
 */
export function ditherTile(a: string | null, b: string | null, density: number): Pattern {
  const rows: (string | null)[][] = [];
  for (let y = 0; y < DITHER; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < DITHER; x++) row.push(density > threshold(x, y) ? b : a);
    rows.push(row);
  }
  return rows;
}

/**
 * A vertical fade to transparent, `height` art pixels tall, as a dither ramp rather than a blend.
 *
 * For the scrim under the top bar. That was a four-stop hard-banded gradient, which is the best CSS
 * can do and still read as CSS — four visible steps is a banding artefact, where a dithered fade is
 * a technique. `curve` shapes how fast it opens up; above 1 it holds opaque longer, which keeps the
 * HUD legible while the tail gets out of the world's way.
 */
export function fadeStrip(color: string, height: number, curve = 1.6): Pattern {
  const rows: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const density = Math.pow(1 - y / (height - 1), curve);
    const row: (string | null)[] = [];
    for (let x = 0; x < DITHER; x++) row.push(density > threshold(x, y) ? color : null);
    rows.push(row);
  }
  return rows;
}

/**
 * Raised reads as a plate sitting on the world; inset reads as a recess cut into a panel.
 *
 * They are the same art with the bevel reversed, which is the whole trick of a bevel — light from
 * above means a raised edge is lit on top and a sunken one is lit on the bottom. The rock is lit
 * from above too (RENDERING.md), so the interface agrees with the world about where the light is.
 */
export type FrameKind = 'raised' | 'inset';

/** The colours a frame is built from, read from the stylesheet's roles. */
export interface FrameRoles {
  /** The hard outer line. The darkest step, same as the sprite outline. */
  readonly outline: string;
  /** The lit side of the bevel. */
  readonly light: string;
  /** The shaded side of the bevel. */
  readonly shade: string;
  /** The face the frame encloses. */
  readonly fill: string;
  /** The lighter fleck interleaved into the face — the rock's hand-drawn character. */
  readonly speck: string;
  /** The darker mottle, so the face carries three steps rather than two. */
  readonly mottle: string;
  /** Share of the face taken by each fleck colour. */
  readonly speckle: number;
}

/**
 * The frame's pixels, row-major.
 *
 * Four rings, and the third is the one that matters:
 *
 *   ring 0  the hard outline — what separates a panel from the rock behind it
 *   ring 1  the bevel lip, lit on one pair of sides and shaded on the other
 *   ring 2  a DITHERED transition from that lip into the face
 *   middle  the face, with its fleck interleaved, tiling across the whole panel
 *
 * Ring 2 is the difference between this and a CSS border. A hard lip against a flat face is a line;
 * the same lip dithering into the face is a MATERIAL, and it is how the rock's lit rim resolves into
 * its body. Without it, a panel is a rectangle with an edge drawn on it.
 *
 * The bevel corners stay dark rather than taking a side, because a bevel that turns a corner has to
 * pick which side wins and picking either reads as a mistake. Dark reads as a mitre.
 */
export function framePixels(kind: FrameKind, roles: FrameRoles): Pattern {
  const last = FRAME_SIZE - 1;
  const lit = kind === 'raised' ? roles.light : roles.shade;
  const unlit = kind === 'raised' ? roles.shade : roles.light;
  const rows: (string | null)[][] = [];
  for (let y = 0; y < FRAME_SIZE; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < FRAME_SIZE; x++) {
      const ring = Math.min(x, y, last - x, last - y);
      const onTopLeft = x <= y ? x <= last - y : y <= last - x; // which half of the mitre
      if (ring === 0) {
        row.push(roles.outline);
      } else if (ring === 1) {
        const corner = (x === 1 || x === last - 1) && (y === 1 || y === last - 1);
        row.push(corner ? roles.outline : onTopLeft ? lit : unlit);
      } else if (ring === 2) {
        // Half-density dither from the lip into the face: the lip's colour on the Bayer grid.
        row.push(threshold(x, y) < 0.5 ? (onTopLeft ? lit : unlit) : roles.fill);
      } else {
        // HASHED, not Bayer. An ordered dither is regular by design, which is what you want for a
        // fade and wrong for a surface — the rock's character comes from hash noise on top of its
        // bands, so the face uses the same trick. It wraps for free: the tile IS the coordinate
        // domain, so the same coordinates recur and the pattern repeats seamlessly.
        const n = (hashXY(x, y, FLECK_SEED) % 1000) / 1000;
        row.push(
          n < roles.speckle ? roles.speck : n > 1 - roles.speckle ? roles.mottle : roles.fill,
        );
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Paint a pattern into a data URL, one canvas pixel per art pixel. */
export function patternUrl(pattern: Pattern): string {
  const canvas = document.createElement('canvas');
  canvas.width = pattern[0].length;
  canvas.height = pattern.length;
  const g = canvas.getContext('2d')!;
  for (const [y, row] of pattern.entries()) {
    for (const [x, color] of row.entries()) {
      if (color === null) continue; // transparent
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL('image/png');
}

/** Read one `--c-*` role off an element's computed style. */
const role = (style: CSSStyleDeclaration, name: string): string =>
  style.getPropertyValue(name).trim();

/** The scrim's coverage. Dithered rather than alpha, so it stays a two-colour image. */
const SCRIM_DENSITY = 0.75;
/** The top bar's fade, in art pixels. Tall enough that the dither reads as a ramp, not a band. */
const FADE_HEIGHT = 24;
/**
 * How much fleck the panel face carries, PER COLOUR — so about a seventh of the face is mottled.
 *
 * The rock's is far heavier, and this is the one number in here with a hard ceiling rather than a
 * taste range: a panel has TEXT on it. At a tenth per colour the ore descriptions were visibly
 * fighting the surface. Raising it means raising the text contrast to pay for it.
 */
const PANEL_SPECKLE = 0.07;

/**
 * Generate every surface and publish it as a CSS custom property on `root`.
 *
 * Call once at boot, before anything is shown. Until it runs, the rules fall back to flat colour in
 * the same roles (`var(--frame-raised, none)`), so nothing is ever invisible — the markup does not
 * wait for script.
 */
export function installSurfaces(root: HTMLElement = document.documentElement): void {
  const style = getComputedStyle(root);
  const void_ = role(style, '--c-void');
  const panel = role(style, '--c-panel');
  const edge = role(style, '--c-edge');
  const mute = role(style, '--c-mute');

  // RAISED: a lit lip on the top and left; the shade side runs all the way to the darkest step so
  // it merges with the outline into a two-pixel dark edge.
  //
  // The shade MUST be darker than the face, which the first version got wrong: it used the mid grey,
  // which is LIGHTER than the panel face, so the bottom and right read as lit as well and the plate
  // looked flat and slightly swollen. With six steps in the ramp and the face near the bottom of it,
  // "darker than the face" leaves exactly one choice.
  const raised: FrameRoles = {
    outline: void_,
    light: mute,
    shade: void_,
    fill: panel,
    speck: edge,
    mottle: void_,
    speckle: PANEL_SPECKLE,
  };

  // INSET: the same logic inverted. A recess is filled with the darkest step, so its shading has to
  // come from the LIP rather than the interior — a dark upper lip merging with the outline, and a
  // lit lower one. That is what a hole in a plate looks like.
  const inset: FrameRoles = {
    outline: void_,
    light: edge,
    shade: void_,
    fill: void_,
    speck: panel,
    mottle: void_,
    speckle: PANEL_SPECKLE,
  };

  // CONTROL: a raised frame one ramp step LIGHTER than a panel, because a button sitting on a panel
  // has to be distinguishable from it. With both on the same face the bevel was doing all the work,
  // and at button size three pixels of bevel is not enough work.
  // Half the panel's fleck, and in the adjacent ramp steps rather than a bright one. A button is
  // small and almost entirely text, so a high-contrast speck lands directly behind a letter — which
  // is what the first attempt did, using the light grey on the mid grey right under the label.
  const control: FrameRoles = {
    ...raised,
    fill: edge,
    speck: role(style, '--c-dim'),
    mottle: panel,
    speckle: PANEL_SPECKLE / 2,
  };

  root.style.setProperty('--frame-raised', `url("${patternUrl(framePixels('raised', raised))}")`);
  root.style.setProperty('--frame-control', `url("${patternUrl(framePixels('raised', control))}")`);
  root.style.setProperty('--frame-inset', `url("${patternUrl(framePixels('inset', inset))}")`);
  root.style.setProperty(
    '--tex-scrim',
    `url("${patternUrl(ditherTile(null, void_, SCRIM_DENSITY))}")`,
  );
  root.style.setProperty('--tex-fade', `url("${patternUrl(fadeStrip(void_, FADE_HEIGHT))}")`);
  root.style.setProperty('--fade-h', `calc(var(--px) * ${FADE_HEIGHT})`);
}
