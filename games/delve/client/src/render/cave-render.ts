// cave-render.ts — the shared DELVE rock renderer. Pure, no game state: given a solidTile(c,r)
// predicate and a world window, it composites the layered cave (background + top-lit rock + sky
// + stalactites) into a 2D context. Used by the main thread (per-dig patches), the chunk Worker
// (off-thread chunk generation) and the labs, so the look can never drift between them.
//
// Many of the numbers in shadeRock/buildMask are hand-tuned noise octave frequencies/amplitudes
// and brightness thresholds — a "family of coefficients" (see CODE-STYLE.md) kept inline with a
// note rather than atomised into dozens of names that would obscure the pipeline.
import { vnoise, mulberry, hashXY } from '@delve/shared';
import type { StrataResource } from '@delve/shared';

export const T = 16; // tile size in logical (art) pixels
export const TEX = 90210; // fixed seed for all rock-texture noise (keeps texture stable per world coord)

// 4×4 ordered (Bayer) dither matrix — quantises the smooth brightness into pixel-art bands.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type Rgb = [number, number, number];

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const makeCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement =>
  typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

// ---- colour helpers ----
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

// ---- depth strata palette ----
// Strata come from the resource registry; the owning context hands them in via setStrata (the
// main thread / labs pass Blocks.STRATA; the Worker gets them posted in its init message).
let STRATA: readonly StrataResource[] = [];
export function setStrata(strata: readonly StrataResource[]): void {
  STRATA = strata ?? [];
}

const smoothstep = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/** The 6-stop colour ramp for a world row, interpolated smoothly between adjacent strata. */
export function rampAt(row: number): string[] {
  let index = 0;
  while (index < STRATA.length - 1 && row >= STRATA[index + 1].top) index++;
  const near = STRATA[index];
  const far = STRATA[Math.min(index + 1, STRATA.length - 1)];
  if (near === far) return near.ramp.slice();
  const t = smoothstep((row - near.top) / (far.top - near.top));
  return near.ramp.map((hex, stop) => mix(hex, far.ramp[stop], t));
}

interface RockColors {
  rimB: Rgb;
  rimA: Rgb;
  lit: Rgb;
  body2: Rgb;
  body: Rgb;
  deep: Rgb;
  center: Rgb;
  rimRock: Rgb;
}

/** Derive the shading swatches (as rgb) from a ramp: rim highlights → dark centers. */
function colorsFor(ramp: string[]): RockColors {
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

interface BgColors {
  top: string;
  bot: string;
  sil: string;
}

/** The atmospheric background wall for a ramp — lighter, cooler, desaturated than the rock. */
function bgFor(ramp: string[]): BgColors {
  const base = desat(mix(ramp[1], '#4a4864', 0.64), 0.52);
  return {
    top: mix(base, '#585672', 0.18),
    bot: mix(base, '#171525', 0.5),
    sil: mix(base, '#000000', 0.3),
  };
}

const DIAGONAL = 1.414; // √2 — cost of a diagonal step in the chamfer distance transform
const DIST_INF = 1e6;

/** Two-pass chamfer distance transform: distance (in px) from each cell to the nearest `src` cell. */
function distField(
  isSource: (index: number) => boolean,
  width: number,
  height: number,
  outOfBounds: number,
): Float32Array {
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = isSource(i) ? 0 : DIST_INF;
  const at = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? outOfBounds : dist[y * width + x];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(
        dist[i],
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + DIAGONAL,
        at(x + 1, y - 1) + DIAGONAL,
      );
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(
        dist[i],
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + DIAGONAL,
        at(x - 1, y + 1) + DIAGONAL,
      );
    }
  }
  return dist;
}

type SolidTile = (column: number, row: number) => boolean;

// Edge erosion: how far (px) a tile's boundary with open space is nibbled by world-space noise,
// so rock edges read organic and connect seamlessly across tiles. thr = EDGE_EROSION_BASE +
// EDGE_EROSION_RANGE * noise.
const EDGE_EROSION_BASE = 0.4;
const EDGE_EROSION_RANGE = 1.4;
const EDGE_NOISE_FREQ = 0.28;

/** Per-pixel solidity mask with gently eroded (organic) edges; noise is in WORLD space. */
function buildMask(
  isSolid: SolidTile,
  width: number,
  height: number,
  bandLeft: number,
  bandTop: number,
): Uint8Array {
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const mask = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const column = bandLeft + ((px / T) | 0);
      const row = bandTop + ((py / T) | 0);
      if (!isSolid(column, row)) {
        mask[py * width + px] = 0;
        continue;
      }
      // distance (px) from this sub-tile pixel to the nearest open neighbour edge/corner
      const localX = px % T;
      const localY = py % T;
      let edgeDist = 99;
      if (!isSolid(column, row - 1)) edgeDist = Math.min(edgeDist, localY + 0.5);
      if (!isSolid(column, row + 1)) edgeDist = Math.min(edgeDist, T - 1 - localY + 0.5);
      if (!isSolid(column - 1, row)) edgeDist = Math.min(edgeDist, localX + 0.5);
      if (!isSolid(column + 1, row)) edgeDist = Math.min(edgeDist, T - 1 - localX + 0.5);
      if (!isSolid(column - 1, row - 1))
        edgeDist = Math.min(edgeDist, Math.hypot(localX + 0.5, localY + 0.5));
      if (!isSolid(column + 1, row - 1))
        edgeDist = Math.min(edgeDist, Math.hypot(T - localX - 0.5, localY + 0.5));
      if (!isSolid(column - 1, row + 1))
        edgeDist = Math.min(edgeDist, Math.hypot(localX + 0.5, T - localY - 0.5));
      if (!isSolid(column + 1, row + 1))
        edgeDist = Math.min(edgeDist, Math.hypot(T - localX - 0.5, T - localY - 0.5));
      const threshold =
        EDGE_EROSION_BASE +
        EDGE_EROSION_RANGE *
          vnoise((originX + px) * EDGE_NOISE_FREQ, (originY + py) * EDGE_NOISE_FREQ, TEX + 2);
      mask[py * width + px] = edgeDist > threshold ? 1 : 0;
    }
  }
  return mask;
}

// Contact shadow: how dark open pixels near a rock edge get (alpha, 0-255), by distance.
const CONTACT_SHADOW_NEAR = 105;
const CONTACT_SHADOW_FAR = 48;

let shadeCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let shadeCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

/** Foreground rock → a canvas (alpha layer): top-lit, dark-bodied, organic edges. */
function shadeRock(
  isSolid: SolidTile,
  width: number,
  height: number,
  colors: RockColors,
  bandLeft: number,
  bandTop: number,
): OffscreenCanvas | HTMLCanvasElement {
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const mask = buildMask(isSolid, width, height, bandLeft, bandTop);
  const isOpen = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? 0 : mask[y * width + x] ? 0 : 1;
  const rockDist = distField((i) => mask[i] === 1, width, height, 0);
  const edgeDist = distField((i) => mask[i] === 0, width, height, DIST_INF);

  // Distance-from-the-top-surface (px), so up-facing surfaces read brightest (top-light bias).
  const MAX_OVERHEAD = 12; // rows of solid rock above before a pixel counts as "deep, no top light"
  const topDist = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    const column = bandLeft + ((x / T) | 0);
    let solidAbove = 0;
    for (let k = 1; k <= MAX_OVERHEAD; k++) {
      if (isSolid(column, bandTop - k)) solidAbove++;
      else break;
    }
    let depth = solidAbove >= MAX_OVERHEAD ? DIST_INF : solidAbove * T;
    for (let y = 0; y < height; y++) {
      if (isOpen(x, y)) depth = 0;
      topDist[y * width + x] = depth;
      depth++;
    }
  }

  // brightness → colour band: center → deep → body → body2 → lit → rimA
  const BANDS = [colors.center, colors.deep, colors.body, colors.body2, colors.lit, colors.rimA];
  const LAST_BAND = BANDS.length - 1;

  if (!shadeCanvas || shadeCanvas.width !== width || shadeCanvas.height !== height) {
    shadeCanvas = makeCanvas(width, height);
    shadeCtx = shadeCanvas.getContext('2d') as CanvasRenderingContext2D;
    shadeCtx.imageSmoothingEnabled = false;
  }
  const ctx = shadeCtx as CanvasRenderingContext2D;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const setPixel = (i: number, rgb: Rgb, alpha: number): void => {
    const j = i * 4;
    data[j] = rgb[0];
    data[j + 1] = rgb[1];
    data[j + 2] = rgb[2];
    data[j + 3] = alpha;
  };

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      const worldX = originX + px;
      const worldY = originY + py;

      if (!mask[i]) {
        // open pixel — a soft contact shadow just outside the rock
        const d = rockDist[i];
        if (d < 1.4) setPixel(i, [0, 0, 0], CONTACT_SHADOW_NEAR);
        else if (d < 2.7) setPixel(i, [0, 0, 0], CONTACT_SHADOW_FAR);
        else setPixel(i, [0, 0, 0], 0);
        continue;
      }

      // brightness falls off from the nearest edge; a wider range where the top light reaches
      const range = topDist[i] <= edgeDist[i] + 0.8 ? 6.0 : 3.8;
      let brightness = 1 - edgeDist[i] / range;
      // multi-octave world-space perturbation (hand-tuned freqs/amplitudes) — lumps into light,
      // crevices into dark, so the surface→center transition is organic, not a flat band.
      brightness +=
        (vnoise(worldX * 0.16, worldY * 0.16, TEX) - 0.5) * 0.55 +
        (vnoise(worldX * 0.45 + 7, worldY * 0.45, TEX) - 0.5) * 0.3 +
        (vnoise(worldX * 1.05, worldY * 1.05 + 3, TEX) - 0.5) * 0.14;
      brightness = clamp01(brightness);

      // quantise to a colour band with Bayer dithering
      const scaled = brightness * LAST_BAND;
      const band = scaled | 0;
      const dither = (BAYER[(px & 3) | ((py & 3) << 2)] + 0.5) / 16;
      let color = BANDS[Math.min(LAST_BAND, band + (scaled - band > dither ? 1 : 0))];

      // sparse accent speckles: grayer rim rock, darker center pits, bright rim caps
      if (brightness > 0.6 && vnoise(worldX * 0.5 + 2, worldY * 0.5, TEX + 8) < 0.4)
        color = colors.rimRock;
      if (
        brightness > 0.25 &&
        brightness < 0.72 &&
        vnoise(worldX * 0.75, worldY * 0.75, TEX + 5) > 0.86
      )
        color = colors.center;
      if (brightness > 0.88 && vnoise(worldX * 0.7, worldY * 0.5, TEX) > 0.6) color = colors.rimB;
      setPixel(i, color, 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return shadeCanvas;
}

const SKY_TOP = '#0e1830';
const SKY_HORIZON = '#6a86b4';
const BG_SILHOUETTE_FREQ_X = 0.045;
const BG_SILHOUETTE_FREQ_Y = 0.06;
const BG_SILHOUETTE_THRESHOLD = 0.42;

/**
 * Compose background + rock + sky + stalactites for a world rectangle into 2D context `g`
 * (destination top-left, colsW×rowsH tiles). `W` is legacy (the world is unbounded); solidTile
 * handles any column.
 */
export function composeBand(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  isSolid: SolidTile,
  bandLeft: number,
  bandTop: number,
  colsW: number,
  rowsH: number,
  _legacyWidth: number,
  surface: number,
): void {
  const width = colsW * T;
  const height = rowsH * T;
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const ramp = rampAt(Math.max(1, bandTop + (rowsH >> 1)));
  const colors = colorsFor(ramp);
  const bg = bgFor(ramp);

  // background: flat midpoint fill (so cached chunks meet seamlessly) + world-anchored silhouettes
  g.fillStyle = mix(bg.top, bg.bot, 0.5);
  g.fillRect(0, 0, width, height);
  g.fillStyle = bg.sil;
  for (let py = 0; py < height; py += 2) {
    for (let px = 0; px < width; px += 2) {
      if (
        vnoise(
          (originX + px) * BG_SILHOUETTE_FREQ_X,
          (originY + py) * BG_SILHOUETTE_FREQ_Y,
          TEX + 50,
        ) < BG_SILHOUETTE_THRESHOLD
      ) {
        g.fillRect(px, py, 2, 2);
      }
    }
  }

  // foreground rock
  g.drawImage(
    shadeRock(isSolid, width, height, colors, bandLeft, bandTop) as CanvasImageSource,
    0,
    0,
  );

  // sky fills the open space above the ground (world rows ≤ surface)
  const skyBottom = (surface + 1) * T;
  if (originY < skyBottom) {
    for (let py = 0; py < height; py++) {
      const worldY = originY + py;
      if (worldY >= skyBottom) break;
      g.fillStyle = mix(SKY_TOP, SKY_HORIZON, clamp01((worldY - originY) / (skyBottom - originY)));
      g.fillRect(0, py, width, 1);
    }
  }

  // stalactites / stalagmites where open tiles meet rock (deterministic per world tile)
  const pen = (x: number, y: number, w: number, h: number, color: string): void => {
    g.fillStyle = color;
    g.fillRect(x, y, w || 1, h || 1);
  };
  for (let row = Math.max(surface + 1, bandTop); row < bandTop + rowsH; row++) {
    for (let column = bandLeft; column < bandLeft + colsW; column++) {
      if (isSolid(column, row)) continue;
      const x = (column - bandLeft) * T;
      const y = (row - bandTop) * T;
      if (isSolid(column, row - 1) && hashXY(column, row, 21) % 3 === 0) {
        const tipX = x + (T >> 1) + ((hashXY(column, row, 22) % 5) - 2);
        const length = 3 + (hashXY(column, row, 23) % 4);
        for (let i = 0; i < length; i++) {
          const halfWidth = Math.max(0, Math.round((length - i) / 2.2));
          pen(
            tipX - halfWidth,
            y + i,
            2 * halfWidth + 1,
            1,
            rgbHex(i < 2 ? colors.center : colors.deep),
          );
        }
        pen(tipX, y, 1, 1, rgbHex(colors.rimA));
      }
      if (isSolid(column, row + 1) && hashXY(column, row, 24) % 4 === 0) {
        const tipX = x + (T >> 1) + ((hashXY(column, row, 25) % 5) - 2);
        const length = 2 + (hashXY(column, row, 26) % 3);
        for (let i = 0; i < length; i++) {
          const halfWidth = Math.max(0, Math.round((length - i) / 2.2));
          pen(
            tipX - halfWidth,
            y + T - 1 - i,
            2 * halfWidth + 1,
            1,
            rgbHex(i < 1 ? colors.center : colors.deep),
          );
        }
      }
    }
  }
}

export { mulberry, hashXY, vnoise };
