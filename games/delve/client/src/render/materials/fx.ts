// fx.ts — reusable, opt-in visual effects a material's shader can layer on top of its base surface.
// These lean on what the compositor already computes per pixel (see ShadeCtx): how lit a pixel is
// (0..1, peaking on exposed top-lit faces) and its world coordinate (for stable, seamless placement).
import { hashXY } from '@delve/shared';
import { clamp01, T } from '../palette';
import type { Rgb } from '../palette';
import type { Material, ShadeCtx } from './types';

const rnd01 = (a: number, b: number): number => (hashXY(a, b, 91) & 4095) / 4095;

/** One frame of a twinkle: how bright the flash is (0 = not flashing) and where along the edge it
 * sits (0..1). Both are meaningful only when `alpha > 0`. */
export interface Flash {
  alpha: number;
  offset: number;
}
const NO_FLASH: Flash = { alpha: 0, offset: 0 };

/**
 * Pick a point in [0,1] at least `gap` away from `prev` (the "safe zone"), uniform over what's left.
 * So consecutive flashes never spawn right next to the last one.
 */
export function pickAway(u: number, prev: number, gap: number): number {
  const lowLen = Math.max(0, prev - gap); // usable span [0, prev-gap]
  const highLen = Math.max(0, 1 - (prev + gap)); // usable span [prev+gap, 1]
  const total = lowLen + highLen;
  if (total <= 0) return prev >= 0.5 ? 0 : 1; // whole edge inside the safe zone → jump to the far end
  const x = u * total;
  // stay in the low span [0, prev-gap] unless x has spilled past it AND a high span exists
  return x < lowLen || highLen <= 0 ? x : prev + gap + (x - lowLen);
}

/**
 * A single tile/edge's twinkle for this frame, on an IRREGULAR schedule so it never reads as "on a
 * timer": time is cut into slots, most slots are skipped, and a firing slot flashes at a random
 * moment and brightness. The `seed` offsets the slot grid so no two edges share a rhythm. When a
 * flash fires, its `offset` along the edge is random but kept `gap` clear of the previous slot's spot
 * (a safe zone), so the glint hops around the edge instead of pinning to one place. Deterministic.
 */
export function twinkleFlash(
  time: number,
  seed: number,
  {
    period = 1.5, // avg seconds per flash slot
    density = 0.5, // fraction of slots that actually flash
    width = 0.14, // flash duration as a fraction of a slot
    gap = 0.4, // min distance (0..1) a new flash keeps from the previous one
  }: { period?: number; density?: number; width?: number; gap?: number } = {},
): Flash {
  const tt = time / period + (seed % 997) / 997; // per-edge phase so slot grids don't align
  const slot = Math.floor(tt);
  if (rnd01(seed, slot) > density) return NO_FLASH; // this slot: no flash
  const at = 0.15 + 0.7 * rnd01(seed, slot * 131 + 7); // when within the slot it flashes
  const d = Math.abs(tt - slot - at);
  if (d > width) return NO_FLASH;
  const bright = 0.65 + 0.35 * rnd01(seed, slot * 131 + 13);
  const alpha = (1 - d / width) * bright; // triangular flash, random peak brightness
  const prev = rnd01(seed, (slot - 1) * 197 + 3); // previous slot's raw pick
  const offset = pickAway(rnd01(seed, slot * 197 + 3), prev, gap);
  return { alpha, offset };
}

/** Draw a small pixel-art "+" glint (bright core + four dimmer arms) centred at display px (x,y),
 * sized to one art pixel = `scale` display px. Used by a material's animated `twinkle`. The caller
 * sets an additive composite so the glint reads as light; this just fills art-pixel blocks. */
export function drawGlint(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  alpha: number,
  color: Rgb,
  scale: number,
): void {
  const a = clamp01(alpha);
  if (a <= 0) return;
  const u = Math.max(1, Math.round(scale)); // one art pixel in display px
  const fill = `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`;
  g.fillStyle = fill;
  const block = (ox: number, oy: number, m: number): void => {
    g.globalAlpha = a * m;
    g.fillRect(Math.round(x + ox * u - u / 2), Math.round(y + oy * u - u / 2), u, u);
  };
  block(0, 0, 1); // bright core
  block(-1, 0, 0.65); // ← arm
  block(1, 0, 0.65); // → arm
  block(0, -1, 0.65); // ↑ arm
  block(0, 1, 0.65); // ↓ arm
  g.globalAlpha = 1;
}

export interface SparkleOpts {
  /** Glint colour at full strength (usually near-white, tinted toward the material). */
  color: Rgb;
  /** Fraction (0..1) of candidate cells that actually sparkle — keep low for sparse, tasteful glints. */
  chance?: number;
  /** Litness below which nothing sparkles (so only lit/exposed faces glint). */
  minLit?: number;
  /** World-pixel spacing between candidate sparkles. */
  cell?: number;
}

/**
 * A baked sparkle: on well-lit pixels, a sparse, deterministic scatter of small "star" glints. Both
 * the star's SIZE (arm length) and BRIGHTNESS grow with how lit the pixel is — so a vein twinkles
 * hardest on the faces catching the most light, and not at all in the dark. Returns the pixel's
 * glint colour, or null if this pixel isn't part of a sparkle (→ the material keeps its base colour).
 * Deterministic in world space, so it's stable and seamless across tiles/chunks.
 */
export function sparkle(ctx: ShadeCtx, opts: SparkleOpts): Rgb | null {
  const cell = opts.cell ?? 8;
  const chance = opts.chance ?? 0.2;
  const minLit = opts.minLit ?? 0.6;

  const lit = ctx.brightness;
  if (lit < minLit) return null;

  // one candidate sparkle per `cell`×`cell` world block, present only `chance` of the time
  const blockX = Math.floor(ctx.worldX / cell);
  const blockY = Math.floor(ctx.worldY / cell);
  if ((hashXY(blockX, blockY, 71) & 1023) / 1023 > chance) return null;

  // centre kept away from the block edges so the star never clips across the boundary
  const margin = 2;
  const span = Math.max(1, cell - 2 * margin);
  const centreX = blockX * cell + margin + (hashXY(blockX, blockY, 72) % span);
  const centreY = blockY * cell + margin + (hashXY(blockX, blockY, 73) % span);
  const dx = Math.abs(ctx.worldX - centreX);
  const dy = Math.abs(ctx.worldY - centreY);

  // arm length grows with litness: bright faces get a 2px star, mid a single glint, dim nothing
  const t = clamp01((lit - minLit) / (1 - minLit));
  const size = t > 0.72 ? 2 : 1;
  const onStar = (dx === 0 && dy <= size) || (dy === 0 && dx <= size);
  if (!onStar) return null;

  // brightness scales with litness (dimmer arms than the centre), so bright faces glint hardest
  const arm = dx + dy;
  const intensity = (arm === 0 ? 1 : arm === 1 ? 0.82 : 0.6) * (0.55 + 0.45 * t);
  return [opts.color[0] * intensity, opts.color[1] * intensity, opts.color[2] * intensity];
}

// ---- cluster-aware twinkle edges --------------------------------------------------------------
// A run of adjacent, same-material tiles that share ONE exposed face (e.g. the whole top of a
// horizontal vein) is a single edge — so one glint travels the whole run instead of every tile
// flashing independently. Coordinates are band-local logical px (multiply by scale to draw).

/** One exposed cluster face a material can twinkle along. `litAt(t)` is the litness (0..1) sampled
 * at fraction t along the edge, so the glint dims where the run is less lit. */
export interface TwinkleEdge {
  material: Material;
  seed: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  litAt: (t: number) => number;
}

/** What {@link collectTwinkleEdges} needs to walk the tile grid and measure litness. */
export interface EdgeScan {
  bandLeft: number;
  bandTop: number;
  cols: number;
  rows: number;
  solid: (column: number, row: number) => boolean;
  materialAt: (column: number, row: number) => Material | null;
  lit: (column: number, row: number) => number; // 0..1
  seedAt: (column: number, row: number) => number;
  minLit?: number; // below this a tile contributes no light (and all-dark runs are dropped)
}

const EDGE_MARGIN = 3; // px kept clear of a run's ends so a glint never clips the corner
const EDGE_INSET = 3; // px the glint sits inside the exposed face

function sampleAlong(lit: number[], t: number): number {
  if (lit.length === 1) return lit[0];
  const p = clamp01(t) * (lit.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  return i + 1 < lit.length ? lit[i] * (1 - f) + lit[i + 1] * f : lit[i];
}

/**
 * Group exposed, twinkle-capable tiles into per-side runs of the SAME material, one {@link TwinkleEdge}
 * each. Horizontal runs form on the up/down faces, vertical runs on the left/right faces. The driver
 * calls `edge.material.twinkle` once per edge, so a big cluster flashes as a few unified edges rather
 * than a swarm of per-tile glints. Recompute only when the world changes, not per frame.
 */
export function collectTwinkleEdges(s: EdgeScan): TwinkleEdge[] {
  const minLit = s.minLit ?? 0.12;
  const edges: TwinkleEdge[] = [];
  const c0 = s.bandLeft;
  const c1 = s.bandLeft + s.cols;
  const r0 = s.bandTop;
  const r1 = s.bandTop + s.rows;

  // the material of a solid, twinkle-capable tile whose neighbour in (dc,dr) is open — else null
  const faceMat = (column: number, row: number, dc: number, dr: number): Material | null => {
    if (!s.solid(column, row) || s.solid(column + dc, row + dr)) return null;
    const material = s.materialAt(column, row);
    return material && material.twinkle ? material : null;
  };

  const emit = (
    material: Material,
    tiles: Array<[number, number]>,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void => {
    const lit = tiles.map(([c, r]) => {
      const l = s.lit(c, r);
      return l < minLit ? 0 : l;
    });
    if (Math.max(...lit) <= 0) return; // wholly dark run: nothing to twinkle
    const [firstC, firstR] = tiles[0];
    edges.push({
      material,
      seed: s.seedAt(firstC, firstR),
      x0,
      y0,
      x1,
      y1,
      litAt: (t: number) => sampleAlong(lit, t),
    });
  };

  // horizontal runs — up (dr = -1) and down (dr = +1) faces; the run varies along the column
  for (const dr of [-1, 1]) {
    for (let row = r0; row < r1; row++) {
      let column = c0;
      while (column < c1) {
        const material = faceMat(column, row, 0, dr);
        if (!material) {
          column++;
          continue;
        }
        let end = column;
        while (end + 1 < c1 && faceMat(end + 1, row, 0, dr) === material) end++;
        const tiles: Array<[number, number]> = [];
        for (let c = column; c <= end; c++) tiles.push([c, row]);
        const y =
          dr < 0 ? (row - s.bandTop) * T + EDGE_INSET : (row + 1 - s.bandTop) * T - EDGE_INSET;
        emit(
          material,
          tiles,
          (column - s.bandLeft) * T + EDGE_MARGIN,
          y,
          (end + 1 - s.bandLeft) * T - EDGE_MARGIN,
          y,
        );
        column = end + 1;
      }
    }
  }

  // vertical runs — left (dc = -1) and right (dc = +1) faces; the run varies along the row
  for (const dc of [-1, 1]) {
    for (let column = c0; column < c1; column++) {
      let row = r0;
      while (row < r1) {
        const material = faceMat(column, row, dc, 0);
        if (!material) {
          row++;
          continue;
        }
        let end = row;
        while (end + 1 < r1 && faceMat(column, end + 1, dc, 0) === material) end++;
        const tiles: Array<[number, number]> = [];
        for (let r = row; r <= end; r++) tiles.push([column, r]);
        const x =
          dc < 0 ? (column - s.bandLeft) * T + EDGE_INSET : (column + 1 - s.bandLeft) * T - EDGE_INSET;
        emit(
          material,
          tiles,
          x,
          (row - s.bandTop) * T + EDGE_MARGIN,
          x,
          (end + 1 - s.bandTop) * T - EDGE_MARGIN,
        );
        row = end + 1;
      }
    }
  }

  return edges;
}
