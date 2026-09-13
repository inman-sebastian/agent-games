// surface.ts — panel frames DRAWN IN CODE as nine-slice border images (#42).
//
// Panels were a flat fill with a hairline border, which is what a div looks like. A frame is what
// makes a panel read as an OBJECT — a plate bolted over the world rather than a rectangle of colour
// on top of it.
//
// The technique is nine-slice `border-image`: a small source is cut into a 3x3 grid, the corners are
// placed as-is, the edges tile along their sides, and the middle fills. One 7x7 source dresses a
// panel of any size, and with `image-rendering: pixelated` it scales without a blurred pixel.
//
// The art is GENERATED AT STARTUP rather than shipped as a file: canvas → data URL → a CSS custom
// property. That satisfies the create-every-asset rule with no asset to keep in sync, no build step,
// and no second home for the palette — the colours are read back out of the stylesheet's own role
// properties, so a frame can never disagree with the panel it frames.
//
// WHY THERE IS NO TEXTURE IN HERE, which is the interesting part and was learned the hard way.
//
// A previous version gave every surface a uniform hash-noise mottle and dithered the frame's inner
// ring, reasoning that the UI should share the rock's materials and not merely its palette. It read
// as a mistake, and the research is unanimous about why:
//
//   • "Keep it off small sprites, moving regions, and UI." (Pixnote, dithering guide)
//   • Under roughly 8-10px of run, "skip the dithering and use a solid colour or a single-pixel
//     shade shift instead" — the frame's transition ring was ONE pixel wide. (ibid)
//   • At small sizes "there's no room for a pattern to read; it just looks noisy." (Spearite)
//   • "Generally you want to avoid mechanical dithering and opt for a pattern based effect
//     instead." (alain.xyz)
//   • "A dark outline reads at any size and is the safe default." (Pixnote, game assets)
//
// The through-line: in pixel art UI, texture comes from DELIBERATE, PLACED detail — a corner rivet,
// an inner line, a header band — not from uniform noise. Dithering belongs to large areas and
// gradients, and a panel is neither, because a panel has TEXT on it. Sharing an art direction turned
// out to mean sharing the palette, the grid, the hard edges and the light direction. It did not mean
// running the rock's shader over the chrome.
//
// So the frame spends its detail structurally: an outline, a lit bevel, and an opposed inner lip
// that turns the content area into a well. Compare the alternatives in `client/labs/panel-lab.html`.
//
// The pixel layout is kept as PURE DATA (`framePixels`) so it can be asserted without a canvas,
// which happy-dom does not provide; the canvas function only paints what that decides.

/** The nine-slice source is 7x7 art pixels: a 3px border per side, and a 1x1 middle that tiles. */
export const FRAME_SIZE = 7;
export const FRAME_SLICE = 3;

/** A pixel grid. `null` is transparent. */
export type Pattern = readonly (readonly (string | null)[])[];

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
  /** The face the frame encloses. Flat, deliberately. */
  readonly fill: string;
}

/**
 * The frame's pixels, row-major. Three rings and a face:
 *
 *   ring 0  the hard outline — what separates a panel from the rock behind it
 *   ring 1  the bevel lip, lit on the top and left and shaded on the bottom and right
 *   ring 2  the same lip INVERTED, which turns the content area into a shallow well
 *   middle  the face, flat, tiling across the panel
 *
 * Ring 2 is where the panel gets its substance. A single bevel reads as a raised rectangle; a bevel
 * with an opposed inner lip reads as a frame AROUND something, which is what a panel is. It costs
 * one pixel and no texture.
 */
export function framePixels(kind: FrameKind, roles: FrameRoles): Pattern {
  const last = FRAME_SIZE - 1;
  const lit = kind === 'raised' ? roles.light : roles.shade;
  const unlit = kind === 'raised' ? roles.shade : roles.light;
  const rows: string[][] = [];
  for (let y = 0; y < FRAME_SIZE; y++) {
    const row: string[] = [];
    for (let x = 0; x < FRAME_SIZE; x++) {
      const ring = Math.min(x, y, last - x, last - y);
      // Top and left are lit, bottom and right are shaded, and where they meet the SHADE wins.
      //
      // That precedence is the whole corner rule, and getting it wrong is visible immediately. An
      // earlier version painted every bevel corner dark, reasoning that a corner cannot pick a side.
      // What that actually produced was a lit top run starting one pixel in from the left and a lit
      // left run starting one pixel down, so the two never met — the bevel read as two detached
      // lines floating off the panel rather than as one edge turning a corner.
      //
      // Letting shade win instead gives a continuous lit L across the top-left and a continuous dark
      // L across the bottom-right, which is how a bevel has been drawn since window chrome existed.
      const shaded = x === last - ring || y === last - ring;
      if (ring === 0) {
        row.push(roles.outline);
      } else if (ring === 1) {
        row.push(shaded ? unlit : lit);
      } else if (ring === 2) {
        row.push(shaded ? lit : unlit); // the well's lip: opposed to the outer bevel
      } else {
        row.push(roles.fill);
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
      if (color === null) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL('image/png');
}

/** Read one `--c-*` role off an element's computed style. */
const role = (style: CSSStyleDeclaration, name: string): string =>
  style.getPropertyValue(name).trim();

/**
 * Generate every frame and publish it as a CSS custom property on `root`.
 *
 * Call once at boot, before anything is shown. Until it runs, the rules fall back to a plain border
 * in the same roles (`var(--frame-raised, none)`), so a panel is never invisible — the markup does
 * not wait for script.
 */
export function installSurfaces(root: HTMLElement = document.documentElement): void {
  const style = getComputedStyle(root);
  const void_ = role(style, '--c-void');
  const panel = role(style, '--c-panel');
  const edge = role(style, '--c-edge');
  const dim = role(style, '--c-dim');
  const mute = role(style, '--c-mute');

  // The shade MUST be darker than the face, which an earlier version got wrong: it used the mid
  // grey, which is LIGHTER than the panel face, so the bottom and right read as lit as well and the
  // plate looked flat and slightly swollen. With six steps in the ramp and the face near the bottom
  // of it, "darker than the face" leaves exactly one choice.
  // The lit step is TWO ramp steps above the face, not four. The bevel was `--c-mute` first, which
  // is three steps up from the panel face and read as a hard white line drawn on the panel rather
  // than as an edge catching light. A bevel is a lighting cue, and a lighting cue that outshines
  // everything else on screen stops being one.
  const raised: FrameRoles = { outline: void_, light: dim, shade: void_, fill: panel };

  // A recess is filled with the darkest step, so its shading comes from the LIP rather than the
  // interior: a dark upper lip merging with the outline, and a lit lower one.
  const inset: FrameRoles = { outline: void_, light: edge, shade: void_, fill: void_ };

  // A control sits ON a panel, so its face is one ramp step lighter. With both on the same face the
  // bevel was doing all the work, and three pixels of bevel is not enough work at button size.
  const control: FrameRoles = { outline: void_, light: mute, shade: void_, fill: edge };
  // (a control's face is already two steps up, so its lip keeps the brighter step to stay visible)

  root.style.setProperty('--frame-raised', `url("${patternUrl(framePixels('raised', raised))}")`);
  root.style.setProperty('--frame-inset', `url("${patternUrl(framePixels('inset', inset))}")`);
  root.style.setProperty('--frame-control', `url("${patternUrl(framePixels('raised', control))}")`);
}
