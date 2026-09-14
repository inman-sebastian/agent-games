// cave-render.ts — the shared DELVE rock renderer. Pure, no game state: given a solidTile(c,r)
// predicate and a world window, it composites the layered cave (background + top-lit rock + sky) into a 2D
// context. (Stalactites and stalagmites left block rendering; they return as decorations with biomes.) The game draws its rock on the GPU (render/gpu/rock.wgsl); this is
// the reference that port is gated against (`pnpm render-gate`), and what the labs and icons draw with.
//
// Many of the numbers in shadeRock/buildMask are hand-tuned noise octave frequencies/amplitudes
// and brightness thresholds — a "family of coefficients" (see CODE-STYLE.md) kept inline with a
// note rather than atomised into dozens of names that would obscure the pipeline.
import {
  vnoise,
  mulberry,
  hashXY,
  SUB,
  FULL,
  OPEN,
  covers,
  insideShape,
  diagonalDistance,
} from '@delve/shared';
import type { Side } from '@delve/shared';
import type { StrataResource } from '@delve/shared';
import { T, TEX, clamp01, mix, desat, colorsFor, stoneSurface } from './palette';
import type { Rgb, RockColors } from './palette';
import type { Material, ShadeCtx } from './materials/types';

// Low-level colour/texture primitives now live in palette.ts (shared with the material shaders);
// re-export the ones existing importers pull from cave-render so nothing else has to change.
export { T, TEX, UPSCALE, clamp01, hexRgb, rgbHex, mix, desat } from './palette';
export type { Rgb } from './palette';

const makeCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement =>
  typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

// ---- depth strata palette ----
// Strata come from the resource registry; the owning context hands them in via setStrata (the
// game and the labs pass Blocks.STRATA).
let STRATA: readonly StrataResource[] = [];
export function setStrata(strata: readonly StrataResource[]): void {
  STRATA = strata ?? [];
}

const smoothstep = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The 6-stop colour ramp for a world CELL row, interpolated smoothly between adjacent strata — unless
 * the next one is `hard`, which holds this stratum's ramp right up to its top.
 *
 * Strata tops are authored in BLOCKS, like everything world-gen decides, so the cell row converts
 * first. It compared cells to blocks directly until #57, which put every stratum's colour at half its
 * authored depth after the 2x2 split and disagreed with the sim's own `strataIndexAt`.
 */
export function rampAt(row: number): string[] {
  const block = row / SUB;
  let index = 0;
  while (index < STRATA.length - 1 && block >= STRATA[index + 1].top) index++;
  const near = STRATA[index];
  const far = STRATA[Math.min(index + 1, STRATA.length - 1)];
  if (near === far || far.hard) return near.ramp.slice();
  const t = smoothstep((block - near.top) / (far.top - near.top));
  return near.ramp.map((hex, stop) => mix(hex, far.ramp[stop], t));
}

export interface BgColors {
  top: string;
  bot: string;
  sil: string;
}

/** The atmospheric background wall for a ramp — lighter, cooler, desaturated than the rock. */
export function bgFor(ramp: string[]): BgColors {
  const base = desat(mix(ramp[1], '#4a4864', 0.64), 0.52);
  return {
    top: mix(base, '#585672', 0.18),
    bot: mix(base, '#171525', 0.5),
    sil: mix(base, '#000000', 0.3),
  };
}

export const DIAGONAL = 1.414; // √2 — cost of a diagonal step in the chamfer distance transform
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
// Halved with the cell (#44). These are ABSOLUTE pixel distances, not fractions of a cell — so on an
// 8px cell the old values ate twice the proportion they were tuned for, and corner rounding alone
// took a third of every cell. Rock read as gravel until these came down with it.
export const EDGE_EROSION_BASE = 0.2;
export const EDGE_EROSION_RANGE = 0.7;
export const EDGE_NOISE_FREQ = 0.28;
// Corner rounding: bite a quarter-disc out of every CONVEX corner (two adjacent open sides) so blocks
// never read as perfectly square. Radius in px = base + noise * edge noise (organic, world-anchored).
export const CORNER_ROUND_BASE = 1.3;
export const CORNER_ROUND_NOISE = 0.65;

/** A cell's shape: FULL, or one of Terraria's slopes 1–4 (@delve/shared slopes.ts). Only asked of solid cells. */
type ShapeTile = (column: number, row: number) => number;

/** Every solid cell full: the world before slopes, and the labs that don't have them. */
const ALL_FULL: ShapeTile = () => FULL;

/**
 * Per-pixel solidity mask with gently eroded (organic) edges; noise is in WORLD space. Exported for the
 * liquid lab (#90), whose water wets the open pixels the stone leaves.
 *
 * Slopes (#94): a sloped cell's pixels outside its solid half are open, and its diagonal is an edge like any
 * other, eroded by the same noise. A side counts as exposed where the neighbour across it doesn't cover it — a
 * slope leaves its open sides exposed — and a slope's two tips round like convex corners.
 */
export function buildMask(
  isSolid: SolidTile,
  width: number,
  height: number,
  bandLeft: number,
  bandTop: number,
  shapeOf: ShapeTile = ALL_FULL,
): Uint8Array {
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const mask = new Uint8Array(width * height);
  const shapeAtCell = (column: number, row: number): number =>
    isSolid(column, row) ? shapeOf(column, row) : OPEN;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const column = bandLeft + ((px / T) | 0);
      const row = bandTop + ((py / T) | 0);
      const shape = shapeAtCell(column, row);
      const localX = px % T;
      const localY = py % T;
      if (!insideShape(shape, localX, localY, T)) {
        mask[py * width + px] = 0;
        continue;
      }
      // a side is exposed where the neighbour across it doesn't cover it; an open side of this cell's own is
      // bounded by its diagonal instead
      const openU = !covers(shapeAtCell(column, row - 1), 'down');
      const openD = !covers(shapeAtCell(column, row + 1), 'up');
      const openL = !covers(shapeAtCell(column - 1, row), 'right');
      const openR = !covers(shapeAtCell(column + 1, row), 'left');
      const edgeU = openU && covers(shape, 'up');
      const edgeD = openD && covers(shape, 'down');
      const edgeL = openL && covers(shape, 'left');
      const edgeR = openR && covers(shape, 'right');
      // distance (px) from this sub-tile pixel to the nearest exposed edge, diagonal or corner
      let edgeDist = diagonalDistance(shape, localX, localY, T);
      if (edgeU) edgeDist = Math.min(edgeDist, localY + 0.5);
      if (edgeD) edgeDist = Math.min(edgeDist, T - 1 - localY + 0.5);
      if (edgeL) edgeDist = Math.min(edgeDist, localX + 0.5);
      if (edgeR) edgeDist = Math.min(edgeDist, T - 1 - localX + 0.5);
      if (!coversCorner(shapeAtCell(column - 1, row - 1), 'down', 'right'))
        edgeDist = Math.min(edgeDist, Math.hypot(localX + 0.5, localY + 0.5));
      if (!coversCorner(shapeAtCell(column + 1, row - 1), 'down', 'left'))
        edgeDist = Math.min(edgeDist, Math.hypot(T - localX - 0.5, localY + 0.5));
      if (!coversCorner(shapeAtCell(column - 1, row + 1), 'up', 'right'))
        edgeDist = Math.min(edgeDist, Math.hypot(localX + 0.5, T - localY - 0.5));
      if (!coversCorner(shapeAtCell(column + 1, row + 1), 'up', 'left'))
        edgeDist = Math.min(edgeDist, Math.hypot(T - localX - 0.5, T - localY - 0.5));
      const noise = vnoise(
        (originX + px) * EDGE_NOISE_FREQ,
        (originY + py) * EDGE_NOISE_FREQ,
        TEX + 2,
      );
      const threshold = EDGE_EROSION_BASE + EDGE_EROSION_RANGE * noise;
      // convex-corner rounding: erode a quarter-disc at any corner where two adjacent sides are open — an
      // exposed edge, or the cell's own open side (so a slope's tips round) — so the outline is never
      // perfectly square. Distance is to that corner's tile vertex.
      const sideU = openU || !covers(shape, 'up');
      const sideD = openD || !covers(shape, 'down');
      const sideL = openL || !covers(shape, 'left');
      const sideR = openR || !covers(shape, 'right');
      let cornerDist = 99;
      if (sideU && sideL) cornerDist = Math.min(cornerDist, Math.hypot(localX + 0.5, localY + 0.5));
      if (sideU && sideR)
        cornerDist = Math.min(cornerDist, Math.hypot(T - localX - 0.5, localY + 0.5));
      if (sideD && sideL)
        cornerDist = Math.min(cornerDist, Math.hypot(localX + 0.5, T - localY - 0.5));
      if (sideD && sideR)
        cornerDist = Math.min(cornerDist, Math.hypot(T - localX - 0.5, T - localY - 0.5));
      const roundRadius = CORNER_ROUND_BASE + CORNER_ROUND_NOISE * noise;
      const solid = edgeDist > threshold && cornerDist >= roundRadius;
      mask[py * width + px] = solid ? 1 : 0;
    }
  }
  return mask;
}

/** Whether a (diagonal) neighbour's shape is solid at its corner nearest this cell — the corner between those two sides. */
const coversCorner = (shape: number, vertical: Side, horizontal: Side): boolean =>
  covers(shape, vertical) || covers(shape, horizontal);

// Contact shadow: how dark open pixels near a rock edge get (alpha, 0-255), by distance.
export const CONTACT_SHADOW_NEAR = 105;
export const CONTACT_SHADOW_FAR = 48;

let shadeCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let shadeCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

// Material boundary feathering: how far (px) and how noisily one material bleeds into another, so a
// vein blends organically into the rock instead of a hard tile seam (the same idea as the solid↔open
// edge erosion, applied to material boundaries). The distance is the material's own `feather` knob;
// this is the default when it doesn't set one.
export const FEATHER_FREQ = 0.32;
export const DEFAULT_FEATHER = 3.2;
export const BLEND_WIDTH = 1.9; // widens the material cross-fade so boundaries soften instead of a hard seam

/** Linear blend between two RGB colours (mix() is hex-only; the material blend works in RGB). */
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// How far the baked geometric light carries from an opening, in ABSOLUTE pixels — deliberately not
// in cells, so the lit band stays the same physical width whatever the grid is (~1.4 blocks). These
// are the radius of a dig's INFLUENCE on the shading: open a cell and every pixel within this much
// of it re-shades. Anything that repaints a region of rock has to cover it — see SHADE_INFLUENCE_PX.
// Rows of solid rock above a pixel before it counts as "deep, no top light". This is also how far
// DOWN a dig changes the baked shading: `topDist` seeds from the nearest opening above and walks
// downward, so opening a cell re-shades everything beneath it for this many cells. Anything that
// re-renders part of the rock has to account for that — the influence of a dig is not a disc.
export const TOP_LIGHT_ROWS = 12;
export const SHADE_RANGE_TOP_PX = 22.0; // where the top light reaches: a broad, softly fading band
export const SHADE_RANGE_SIDE_PX = 15.0; // a side/underside face, which the top light doesn't favour

/**
 * The radius, in CELLS, over which opening one cell changes the baked shading of its neighbours.
 * A partial re-render (a dig patch) must repaint at least this far around the change AND give those
 * pixels this much context, or the rock keeps stale shading at the seam — which reads as the light
 * "sticking" to the one cell that did get repainted.
 */
export const SHADE_INFLUENCE_CELLS = Math.ceil(SHADE_RANGE_TOP_PX / T);

/** Foreground rock → a canvas (alpha layer): top-lit, dark-bodied, organic edges. Where `materialAt`
 * assigns a tile a material, that material's own shader colours the pixel (through this same top-lit
 * geometry), and the rock↔material boundary is feathered by world noise so it blends seamlessly. */
function shadeRock(
  isSolid: SolidTile,
  width: number,
  height: number,
  rockColors: RockColors,
  materialAt: ((column: number, row: number) => Material | null) | undefined,
  bandLeft: number,
  bandTop: number,
  shapeOf: ShapeTile,
): OffscreenCanvas | HTMLCanvasElement {
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const mask = buildMask(isSolid, width, height, bandLeft, bandTop, shapeOf);
  const isOpen = (x: number, y: number): number =>
    x < 0 || x >= width || y < 0 || y >= height ? 0 : mask[y * width + x] ? 0 : 1;
  const rockDist = distField((i) => mask[i] === 1, width, height, 0);
  const edgeDist = distField((i) => mask[i] === 0, width, height, DIST_INF);

  // Distance-from-the-top-surface (px), so up-facing surfaces read brightest (top-light bias).
  const MAX_OVERHEAD = TOP_LIGHT_ROWS;
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

  // ---- per-tile material grid + the per-pixel feathered material lookup ----
  // Precompute each band tile's material (padded 1 tile so boundary feathering can read neighbours).
  // When materialAt is absent (the game/worker today), this is skipped and every pixel is rock.
  const cols = width / T;
  const rows = height / T;
  const paddedW = cols + 2;
  const tileMaterials: (Material | null)[] = [];
  if (materialAt) {
    for (let r = -1; r <= rows; r++)
      for (let c = -1; c <= cols; c++)
        tileMaterials[(r + 1) * paddedW + (c + 1)] = materialAt(bandLeft + c, bandTop + r);
  }
  const materialOfTile = (column: number, row: number): Material | null => {
    const c = column - bandLeft;
    const r = row - bandTop;
    if (c < -1 || c > cols || r < -1 || r > rows)
      return materialAt ? materialAt(column, row) : null;
    return tileMaterials[(r + 1) * paddedW + (c + 1)] ?? null;
  };

  // Per-pixel material BLEND (written into the reused `blend` object): `a` = the material colouring
  // this pixel, `b` = the material across the nearest DIFFERING boundary, `t` = how far to blend from
  // a→b (0..1). A smooth band around the tile edge, jittered by world noise, so materials fade into
  // each other AND into rock instead of meeting at a hard line. Covers material↔rock AND
  // material↔material. `a`/`b` === null means plain rock. t=0 → all `a` (deep, no nearby boundary).
  const blend: { a: Material | null; b: Material | null; t: number } = { a: null, b: null, t: 0 };
  const materialBlendAt = (px: number, py: number, worldX: number, worldY: number): void => {
    blend.b = null;
    blend.t = 0;
    if (!materialAt) {
      blend.a = null;
      return;
    }
    const column = bandLeft + ((px / T) | 0);
    const row = bandTop + ((py / T) | 0);
    const here = materialOfTile(column, row);
    blend.a = here;
    const localX = px % T;
    const localY = py % T;
    // nearest cardinal side whose neighbour is a DIFFERENT material (or rock) — the boundary to blend
    let bestDist = Infinity;
    let other: Material | null = null;
    // Only blend across a boundary between two SOLID tiles. An OPEN (dug) neighbour is the silhouette
    // edge — handled by erosion + contact shadow — not a material to blend toward; otherwise a mined-
    // out vein would leave its colour "stained" on the surrounding rock (its ore id is still in the
    // static world map even though the tile is now air).
    if (isSolid(column, row - 1)) {
      const up = materialOfTile(column, row - 1);
      if (up !== here && localY + 0.5 < bestDist) ((bestDist = localY + 0.5), (other = up));
    }
    if (isSolid(column, row + 1)) {
      const down = materialOfTile(column, row + 1);
      if (down !== here && T - 1 - localY + 0.5 < bestDist)
        ((bestDist = T - 1 - localY + 0.5), (other = down));
    }
    if (isSolid(column - 1, row)) {
      const left = materialOfTile(column - 1, row);
      if (left !== here && localX + 0.5 < bestDist) ((bestDist = localX + 0.5), (other = left));
    }
    if (isSolid(column + 1, row)) {
      const right = materialOfTile(column + 1, row);
      if (right !== here && T - 1 - localX + 0.5 < bestDist)
        ((bestDist = T - 1 - localX + 0.5), (other = right));
    }
    if (bestDist === Infinity) return; // no differing neighbour → all `a`
    const wa = here?.feather ?? DEFAULT_FEATHER;
    const wb = other?.feather ?? DEFAULT_FEATHER;
    // half-width (px into EACH tile) of the cross-fade — widened so high-contrast pairs (e.g. a bright
    // gem against dark rock) fade over a real band instead of a near-hard tile seam.
    const w = Math.max(2, (wa + wb) * 0.5 * BLEND_WIDTH);
    const jitter = (vnoise(worldX * FEATHER_FREQ, worldY * FEATHER_FREQ, TEX + 21) - 0.5) * w * 0.6;
    blend.b = other;
    // ramp 0 (deep in `a`) → 0.5 at the seam; the neighbour ramps the mirror image, so the two sides
    // meet at ~50/50 for a continuous cross-fade rather than a 60/40 step.
    blend.t = 0.5 * clamp01(1 - (bestDist + jitter) / w);
  };

  // Reused per-pixel context handed to a material's shader (never retained across pixels).
  const pixelCtx: ShadeCtx = {
    worldX: 0,
    worldY: 0,
    px: 0,
    py: 0,
    localX: 0,
    localY: 0,
    column: 0,
    row: 0,
    brightness: 0,
    edgeDist: 0,
    topDist: 0,
  };

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

      // brightness falls off from the nearest edge; a wider range where the top light reaches. This
      // is the shared GEOMETRIC light — the same for every material; each material adds its own
      // texture/palette on top. The range spans ~1–1.5 tiles so exposed rock reads as a broad, softly
      // fading band (like SteamWorld/Core Keeper) — a bigger lit surface for texture + damage FX —
      // rather than a thin bright rim snapping to black.
      // An up-facing surface is lit from the top. On a 45° slope the depth below the surface runs √2 times the
      // distance to it, so a floor counts as up-facing up to that (#94); a vertical face is far from the top.
      const range =
        topDist[i] <= edgeDist[i] * DIAGONAL + 0.8 ? SHADE_RANGE_TOP_PX : SHADE_RANGE_SIDE_PX;
      const rawBrightness = 1 - edgeDist[i] / range;

      // which material(s) colour this PIXEL — blended across the nearest boundary for a soft transition
      materialBlendAt(px, py, worldX, worldY);
      if (!blend.a && !blend.b) {
        // plain rock (deep, or a rock↔rock interior): the shared stone surface in the strata palette
        setPixel(i, stoneSurface(worldX, worldY, px, py, rawBrightness, rockColors), 255);
        continue;
      }
      // a material is involved — hand it the geometry; it owns the colour (noise / palette / sheen / …)
      pixelCtx.worldX = worldX;
      pixelCtx.worldY = worldY;
      pixelCtx.px = px;
      pixelCtx.py = py;
      pixelCtx.localX = px % T;
      pixelCtx.localY = py % T;
      pixelCtx.column = bandLeft + ((px / T) | 0);
      pixelCtx.row = bandTop + ((py / T) | 0);
      pixelCtx.brightness = rawBrightness; // raw geometric light; the material adds its own texture
      pixelCtx.edgeDist = edgeDist[i];
      pixelCtx.topDist = topDist[i];
      const colorA = blend.a
        ? blend.a.shade(pixelCtx)
        : stoneSurface(worldX, worldY, px, py, rawBrightness, rockColors);
      if (blend.t <= 0.001) {
        setPixel(i, colorA, 255); // deep in `a`, no nearby boundary
        continue;
      }
      const colorB = blend.b
        ? blend.b.shade(pixelCtx)
        : stoneSurface(worldX, worldY, px, py, rawBrightness, rockColors);
      setPixel(i, lerpRgb(colorA, colorB, blend.t), 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return shadeCanvas;
}

export const SKY_TOP = '#0e1830';
export const SKY_HORIZON = '#6a86b4';
export const BG_SILHOUETTE_FREQ_X = 0.045;
export const BG_SILHOUETTE_FREQ_Y = 0.06;
export const BG_SILHOUETTE_THRESHOLD = 0.42;

/**
 * "No sky in this crop" — every row is underground.
 *
 * The dev labs render isolated rock samples with no surface in view, and passing this says so,
 * where a bare `() => -1` at each call site just looked like a magic number.
 */
export const NO_SKY = (): number => -1;

/** The world columns a band spans, for whole-band queries like the sky boundary. */
const columnsOf = (bandLeft: number, colsW: number): number[] =>
  Array.from({ length: colsW }, (_, i) => bandLeft + i);

/**
 * Compose background + rock + sky for a world rectangle into 2D context `g`, with the
 * destination's top-left at `(bandLeft, bandTop)` and `colsW` x `rowsH` CELLS. The world is unbounded,
 * so `isSolid` answers for any column. (A seventh "world width" argument used to sit here, ignored
 * since the world stopped having edges; seventeen callers passed five different values for it.)
 */
export function composeBand(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  isSolid: SolidTile,
  bandLeft: number,
  bandTop: number,
  colsW: number,
  rowsH: number,
  /**
   * The surface row at a column. A FUNCTION, not a number: the surface is a heightmap (#44), so the
   * sky boundary follows the terrain instead of cutting straight across the band.
   */
  surfaceAt: (column: number) => number,
  materialAt?: (column: number, row: number) => Material | null,
  /** Each solid cell's shape: full or a slope (#94). Omitted, every solid cell is full. */
  shapeOf: ShapeTile = ALL_FULL,
): void {
  const width = colsW * T;
  const height = rowsH * T;
  const originX = bandLeft * T;
  const originY = bandTop * T;
  const ramp = rampAt(Math.max(1, bandTop + (rowsH >> 1)));
  const colors = colorsFor(ramp); // strata rock (also used for the bg)
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

  // Sky fills the open space above the ground, PER COLUMN, so a hillside's sky follows its ridge
  // instead of cutting straight across the band.
  //
  // Drawn BEFORE the rock, which is the ordering that actually matters. It used to come after, which
  // was harmless while the surface was one flat row — nothing solid existed above it. With a
  // heightmap the sky then painted straight over every hillside and the horizon came out dead flat,
  // which is exactly how this bug announced itself.
  const deepestSky = (Math.max(...columnsOf(bandLeft, colsW).map(surfaceAt)) + 1) * T;
  if (originY < deepestSky) {
    for (let i = 0; i < colsW; i++) {
      const columnBottom = (surfaceAt(bandLeft + i) + 1) * T;
      for (let py = 0; py < height; py++) {
        const worldY = originY + py;
        if (worldY >= columnBottom) break;
        // The gradient spans the band, not the column, so adjacent columns of different height
        // still share one continuous sky rather than each running its own ramp.
        g.fillStyle = mix(
          SKY_TOP,
          SKY_HORIZON,
          clamp01((worldY - originY) / (deepestSky - originY)),
        );
        g.fillRect(i * T, py, T, 1);
      }
    }
  }

  // foreground rock — where materialAt assigns a material, that material's shader colours the pixel
  // through this SAME top-lit geometry, with the boundary feathered by world noise (see shadeRock).
  g.drawImage(
    shadeRock(
      isSolid,
      width,
      height,
      colors,
      materialAt,
      bandLeft,
      bandTop,
      shapeOf,
    ) as CanvasImageSource,
    0,
    0,
  );
}

export { mulberry, hashXY, vnoise };
