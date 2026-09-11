// palette.ts — low-level colour + texture primitives shared by the compositor (cave-render.ts) AND
// by every material's shader (client/src/render/materials/*). Deliberately compositor-free + DOM-free
// so a material can import it without a cycle.
import { vnoise } from '@delve/shared';

export const T = 16; // tile size in logical (art) pixels
export const TEX = 90210; // fixed seed for all texture noise (keeps texture stable per world coord)

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
