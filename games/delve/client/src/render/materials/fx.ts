// fx.ts — reusable, opt-in visual effects a material's shader can layer on top of its base surface.
// These lean on what the compositor already computes per pixel (see ShadeCtx): how lit a pixel is
// (0..1, peaking on exposed top-lit faces) and its world coordinate (for stable, seamless placement).
import { hashXY } from '@delve/shared';
import { clamp01, T } from '../palette';
import type { Rgb } from '../palette';
import type { DamageCtx, Material, ShadeCtx } from './types';

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

// ---- tiered damage (centre-out cracks) --------------------------------------------------------
// As a tile is mined, cracks spread OUTWARD from its centre and the middle chips into a growing
// cavity — so the damage lives on the (now fully-lit) block face, not along its edges. Deterministic
// per tile (no flicker between hits), keyed on dig progress. Shared across ALL mineable tiles — plain
// rock included — so it can't live on a Material; a material may still override via Material.damage.
const TAU = Math.PI * 2;

const DAMAGE_STAGES = 4; // discrete destruction stages, so the block's progress reads at a glance
const GOLDEN_ANGLE = 2.3999632; // radians — spaces cracks evenly AND independently of how many exist
const crackAccum = new Int8Array(T * T); // per-pixel crack-hit count (reused; deepens where arms cross)

/**
 * Draw a mineable tile's damage state as a STABLE, ADDITIVE crack web quantised into a few discrete
 * stages, so a block's destruction is legible while mining. Each crack has a fixed angle (golden-angle
 * spacing seeded per tile, so it never moves when others appear) and a fixed jagged path; advancing a
 * stage only ADDS a crack and LENGTHENS the existing ones along the same paths — nothing reshuffles.
 * Kept subtle: low-alpha overlays let the rock texture bleed through so cracks read as shadow WITHIN
 * the stone. Deterministic per `seed`.
 */
export function drawDamage(ctx: DamageCtx): void {
  const { g, frac, seed, lit } = ctx;
  if (frac <= 0 || lit < 0.12) return; // pristine, or hidden in the dark → nothing to draw
  const u = Math.max(1, Math.round(ctx.scale)); // one art pixel in display px
  const half = T / 2;

  // plot one art-pixel (floored to the tile grid), clamped inside the tile
  const plot = (axf: number, ayf: number, color: string, alpha: number): void => {
    const ax = Math.floor(axf);
    const ay = Math.floor(ayf);
    if (ax < 0 || ay < 0 || ax >= T || ay >= T) return;
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(ctx.x + ax * u, ctx.y + ay * u, u, u);
  };

  const stage = Math.min(DAMAGE_STAGES, Math.ceil(frac * DAMAGE_STAGES)); // 1..4
  const arms = 1 + stage; // stage 1 → 2 cracks, … stage 4 → 5 cracks (only ever added)
  const steps = Math.round((0.34 + 0.16 * stage) * (half - 0.5)); // existing cracks lengthen per stage
  const baseAngle = ((hashXY(seed, 0, 5) & 255) / 255) * TAU; // per-tile rotation (variety between tiles)
  crackAccum.fill(0);
  for (let a = 0; a < arms; a++) {
    let angle = baseAngle + a * GOLDEN_ANGLE; // arm a's angle is fixed regardless of how many arms show
    // start a couple of pixels out from dead-centre so the arms don't stack into a solid focal dot
    let ax = half - 0.5 + Math.cos(angle) * 1.5;
    let ay = half - 0.5 + Math.sin(angle) * 1.5;
    for (let s = 0; s <= steps; s++) {
      angle += ((hashXY(seed * 7 + a, s, 11) & 255) / 255 - 0.5) * 0.6; // organic wander (deterministic)
      ax += Math.cos(angle);
      ay += Math.sin(angle);
      const v = 150 + (hashXY(a, s, seed) % 34); // faint, warm break-edge (not a white highlight)
      plot(ax + 1, ay, `rgb(${v},${v - 8},${v - 20})`, 0.14);
      // tally the crack core; drawn afterwards so crossings can deepen (a single accumulated pass)
      const cx = Math.floor(ax);
      const cy = Math.floor(ay);
      if (cx >= 0 && cy >= 0 && cx < T && cy < T && crackAccum[cy * T + cx] < 9)
        crackAccum[cy * T + cx]++;
    }
  }
  // draw crack cores in one pass, deepening where arms overlap — crossings read as deeper fractures
  g.fillStyle = 'rgb(20,17,26)';
  for (let idx = 0; idx < crackAccum.length; idx++) {
    const hits = crackAccum[idx];
    if (hits === 0) continue;
    g.globalAlpha = Math.min(0.85, 0.44 + 0.17 * (hits - 1)); // 1 crack → soft; each overlap → deeper
    g.fillRect(ctx.x + (idx % T) * u, ctx.y + ((idx / T) | 0) * u, u, u);
  }

  // silhouette deformation: bite small chunks out of the edge the tile is being mined FROM, one more
  // per stage (stable + additive per seed). The bitten pixels go dark so the adjacent open tunnel
  // reads as eating into the block's outline. Only on a known mining side.
  if (ctx.dirX || ctx.dirY) {
    const horiz = ctx.dirY !== 0; // top/bottom edge (chunks vary along X) vs left/right (along Y)
    const atFar = ctx.dirX > 0 || ctx.dirY > 0; // notch the bottom/right edge vs the top/left
    for (let n = 0; n < stage; n++) {
      const along = 1 + Math.floor(((hashXY(seed, n, 23) & 255) / 255) * (T - 3)); // pos along the edge
      const w = 1 + (hashXY(seed, n, 27) % 2); // chunk width (1..2 px)
      const d = 1 + (hashXY(seed, n, 29) % 2); // chunk depth into the block (1..2 px)
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++) {
          const inset = atFar ? T - 1 - j : j; // from the far or near edge, inward
          plot(horiz ? along + i : inset, horiz ? inset : along + i, 'rgb(8,8,12)', 0.94);
        }
    }
  }

  g.globalAlpha = 1;
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
          dc < 0
            ? (column - s.bandLeft) * T + EDGE_INSET
            : (column + 1 - s.bandLeft) * T - EDGE_INSET;
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
