// palette.ts — low-level colour + texture primitives shared by the compositor (cave-render.ts) AND
// by every material's shader (client/src/render/materials/*). Deliberately compositor-free + DOM-free
// so a material can import it without a cycle.
import { vnoise, hashXY } from '@delve/shared';

export const T = 16; // tile size in logical (art) pixels
export const TEX = 90210; // fixed seed for all texture noise (keeps texture stable per world coord)

/**
 * How many CSS pixels one ART pixel occupies on screen. The art is drawn at logical resolution and
 * upscaled with `image-rendering: pixelated`, so this is the whole game's unit of measurement — a
 * tile displays at `T * UPSCALE` px.
 *
 * The interface is measured in it too (`--px` in the stylesheet, gated by tools/style.test.ts), so
 * UI padding, borders and icon sizes land on the same grid the world does instead of on whatever
 * the browser felt like. An odd offset is how a pixel interface stops looking like pixel art.
 */
export const UPSCALE = 2;

/**
 * Resurrect 64 by Kerrie Lake, in palette order — the SOURCE palette for every colour in DELVE.
 * <https://lospec.com/palette-list/resurrect-64>
 *
 * The rock, the materials, the character and the interface all draw from this list, or from a
 * `mix()`/`desat()` of it. See docs/PALETTE.md for the art direction; this is its code home, and
 * what the stylesheet gate checks the UI's colours against.
 */
export const R64: readonly string[] = [
  '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a', '#694f62', '#7f708a', '#9babb2',
  '#c7dcd0', '#ffffff', '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
  '#fb6b1d', '#f79617', '#f9c22b', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
  '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86', '#165a4c', '#239063', '#1ebc73',
  '#91db69', '#cddf6c', '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90', '#0b5e65',
  '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2', '#323353', '#484a77', '#4d65b4', '#4d9be6',
  '#8fd3ff', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded', '#753c54', '#a24b6f',
  '#cf657f', '#ed8099', '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
];

export type Rgb = [number, number, number];

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const hexRgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

export const rgbHex = (rgb: number[]): string =>
  '#' +
  rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

export const mix = (a: string, b: string, t: number): string => {
  const from = hexRgb(a);
  const to = hexRgb(b);
  return rgbHex(from.map((v, i) => v + (to[i] - v) * t));
};

export const desat = (hex: string, t: number): string => {
  const c = hexRgb(hex);
  const luma = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return rgbHex(c.map((v) => v + (luma - v) * t));
};

// 4×4 ordered (Bayer) dither matrix — quantises smooth brightness into pixel-art bands.
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Quantise `brightness` (0..1) to one of `bands` (dark→light) with 4×4 Bayer dithering at (px,py).
 * The shared banding primitive materials use so their pixel-art dithering matches the rock's. */
export function quantize(bands: Rgb[], brightness: number, px: number, py: number): Rgb {
  const last = bands.length - 1;
  const scaled = clamp01(brightness) * last;
  const band = scaled | 0;
  const dither = (BAYER[(px & 3) | ((py & 3) << 2)] + 0.5) / 16;
  return bands[Math.min(last, band + (scaled - band > dither ? 1 : 0))];
}

// ---- the shared stone SURFACE (the rock's texture DNA, reusable by every material) ----

/** The six shading swatches (as rgb) derived from a 6-stop ramp: rim highlights → dark centres,
 * plus the accent flecks that give the surface its hand-drawn character. */
export interface RockColors {
  rimB: Rgb;
  rimA: Rgb;
  lit: Rgb;
  body2: Rgb;
  body: Rgb;
  deep: Rgb;
  center: Rgb;
  rimRock: Rgb;
}

/** Derive the shading swatches from a 6-stop palette ramp (shadow → rim). */
export function colorsFor(ramp: string[]): RockColors {
  const swatches: Record<keyof RockColors, string> = {
    rimB: desat(ramp[5], 0.22),
    rimA: desat(ramp[4], 0.28),
    lit: desat(ramp[3], 0.15),
    body2: ramp[2],
    body: ramp[1],
    deep: ramp[0],
    center: mix(ramp[0], '#000000', 0.4),
    rimRock: desat(mix(ramp[4], ramp[2], 0.45), 0.35),
  };
  const out = {} as RockColors;
  for (const key of Object.keys(swatches) as (keyof RockColors)[]) out[key] = hexRgb(swatches[key]);
  return out;
}

const stoneBandsCache = new Map<RockColors, Rgb[]>();

/**
 * THE shared surface — the rock's exact texture recipe (three world-space noise octaves that lump
 * the top-lit brightness into organic light/dark, then a Bayer-dithered band pick, then the sparse
 * rim-rock / centre-pit / bright-cap accents). Rock renders through this, and every material builds
 * on it in its own palette, so all solid tiles share one visual language. `brightness` is the raw
 * geometric top-light (this adds the texture); `colors` is the material's palette from `colorsFor`.
 */
export function stoneSurface(
  worldX: number,
  worldY: number,
  px: number,
  py: number,
  brightness: number,
  colors: RockColors,
): Rgb {
  let b = brightness;
  b +=
    (vnoise(worldX * 0.16, worldY * 0.16, TEX) - 0.5) * 0.55 +
    (vnoise(worldX * 0.45 + 7, worldY * 0.45, TEX) - 0.5) * 0.3 +
    (vnoise(worldX * 1.05, worldY * 1.05 + 3, TEX) - 0.5) * 0.14;
  b = clamp01(b);
  let bands = stoneBandsCache.get(colors);
  if (!bands) {
    bands = [colors.center, colors.deep, colors.body, colors.body2, colors.lit, colors.rimA];
    stoneBandsCache.set(colors, bands);
  }
  let color = quantize(bands, b, px, py);
  if (b > 0.6 && vnoise(worldX * 0.5 + 2, worldY * 0.5, TEX + 8) < 0.4) color = colors.rimRock;
  if (b > 0.25 && b < 0.72 && vnoise(worldX * 0.75, worldY * 0.75, TEX + 5) > 0.86)
    color = colors.center;
  if (b > 0.88 && vnoise(worldX * 0.7, worldY * 0.5, TEX) > 0.6) color = colors.rimB;
  return color;
}

// The 6 shading bands (dark→light) for a palette, cached — shared by the surface primitives below.
const bandsCache = new Map<RockColors, Rgb[]>();
function bandsFor(colors: RockColors): Rgb[] {
  let bands = bandsCache.get(colors);
  if (!bands) {
    bands = [colors.center, colors.deep, colors.body, colors.body2, colors.lit, colors.rimA];
    bandsCache.set(colors, bands);
  }
  return bands;
}

/**
 * A polished-METAL surface — smoother than the craggy stone: broad low-frequency tonal blotches plus
 * a faint anisotropic "brushed" streak, quantised into the palette bands with NO speckle accents. So
 * a metal reads as a buffed sheet, not rock. `blotch` = how uneven (low → mirror, high → matte/rough);
 * `streak` = strength of the brushed grain. Same signature shape as stoneSurface.
 */
export function metalSurface(
  worldX: number,
  worldY: number,
  px: number,
  py: number,
  brightness: number,
  colors: RockColors,
  blotch: number,
  streak: number,
): Rgb {
  let b = brightness;
  b += (vnoise(worldX * 0.09, worldY * 0.09, TEX) - 0.5) * blotch; // broad, soft tonal variation
  b += (vnoise(worldX * 0.6, worldY * 0.13, TEX + 11) - 0.5) * streak; // faint horizontal brushed grain
  return quantize(bandsFor(colors), clamp01(b), px, py);
}

/**
 * A crystalline FACET surface — partitions world space into small skewed cells, each a flat brightness
 * offset (cut-crystal planes) with a faint sub-facet gradient so they're not dead flat. Reads as a
 * faceted gem/crystal rather than organic rock. `facet` = facet size in px.
 */
export function facetSurface(
  worldX: number,
  worldY: number,
  px: number,
  py: number,
  brightness: number,
  colors: RockColors,
  facet: number,
): Rgb {
  // skewed cell coords so facets aren't axis-aligned squares
  const u = Math.floor((worldX * 0.92 + worldY * 0.38) / facet);
  const v = Math.floor((worldY * 0.92 - worldX * 0.3) / facet);
  const tone = ((hashXY(u, v, 17) & 255) / 255 - 0.5) * 0.6; // per-facet flat brightness step
  const grain = (vnoise(worldX * 0.6, worldY * 0.6, TEX + 3) - 0.5) * 0.1; // subtle sub-facet variation
  return quantize(bandsFor(colors), clamp01(brightness + tone + grain), px, py);
}

/**
 * A glossy GLASS surface — even smoother than metal and slightly deepened (glass reads dark + wet),
 * with almost no texture of its own. The sharp specular highlights that sell "glass" come from the
 * material layering a tight `sparkle` on top; this is just the smooth, dark body.
 */
export function glassSurface(
  worldX: number,
  worldY: number,
  px: number,
  py: number,
  brightness: number,
  colors: RockColors,
): Rgb {
  const b = clamp01(brightness * 0.88 + (vnoise(worldX * 0.1, worldY * 0.1, TEX + 7) - 0.5) * 0.14);
  return quantize(bandsFor(colors), b, px, py);
}
