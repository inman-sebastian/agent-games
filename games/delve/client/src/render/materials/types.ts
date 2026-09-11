// materials/types.ts — the material rendering contract. Each material owns its own visual
// definition as a real shader FUNCTION (full control, no stringly-typed presets), living in its own
// file under this folder and self-registering. The compositor (cave-render.ts) owns the shared
// geometry — solidity, distance fields, top-light, world-anchoring, and the per-pixel feathered
// material assignment at boundaries — and delegates per-pixel COLOUR to the material's shader.
//
// This split is what keeps the system cohesive + scalable as materials multiply (metals, woods,
// ores, gems, strata): the world-anchored geometry is one shared engine (so tiles always blend and
// corners always match), while each material is free to look however it wants.
import type { Rgb } from '../palette';

/** Everything the compositor hands a material to colour one pixel. Reused per pixel (don't retain). */
export interface ShadeCtx {
  /** World pixel coordinates — use these (not px/py) to seed noise so texture is stable + seamless. */
  worldX: number;
  worldY: number;
  /** Pixel position within the render band (for Bayer dithering). */
  px: number;
  py: number;
  /** Pixel position within its tile, 0..T-1 (for self-connection / seams). */
  localX: number;
  localY: number;
  /** World tile coordinates (row = depth). */
  column: number;
  row: number;
  /** Geometric top-lit brightness 0..1 (edge falloff + top-light), BEFORE any material texture. */
  brightness: number;
  /** Raw geometry, if a material wants to go fully bespoke. */
  edgeDist: number;
  topDist: number;
}

/**
 * A material's visual definition. `shade` is the only required piece — it returns the pixel colour
 * with total freedom. Connection is expressed through optional knobs consumed by the compositor:
 *   • `feather` — how far (px) this material bleeds into neighbouring materials at a boundary; a
 *     hard-edged material (e.g. future wood planks) sets it low/0. Defaults to the shared value.
 * (Future hooks — a custom edge-erosion function for the material↔open boundary, and per-pair blend
 *  policy — plug in here when a material first needs them; every current material uses the defaults.)
 */
/** Per-frame context for a material's animated twinkle (drawn on top of the baked surface, in the
 * presentation layer). Unlike `shade`, this is imperative canvas drawing driven by wall-clock time.
 * It describes one EXPOSED CLUSTER EDGE — a run of adjacent same-material tiles sharing a lit face —
 * so a material draws a single glint travelling along the whole run (see collectTwinkleEdges). */
export interface TwinkleCtx {
  g: CanvasRenderingContext2D;
  /** Display-pixel endpoints of the exposed face this edge runs along. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Display pixels per art pixel (so a glint sizes crisply). */
  scale: number;
  /** Seconds (drives the animation). */
  time: number;
  /** Stable per-edge integer seed (for a deterministic, irregular flash schedule — see fx.ts). */
  seed: number;
  /** Litness 0..1 sampled at fraction t (0..1) along the edge (a vein only twinkles where lit). */
  litAt: (t: number) => number;
}

/** Per-frame context for a mineable tile's damage state — drawn on top of the baked surface as the
 * tile is chipped away. Like `twinkle`, this is imperative canvas drawing, but keyed on dig progress
 * (`frac`) rather than time. Materials may override the shared chipping (see fx.drawDamage) for a
 * bespoke break (e.g. a future gem shatter); everything defaults to the shared look. */
export interface DamageCtx {
  g: CanvasRenderingContext2D;
  /** Display-pixel top-left of the tile. */
  x: number;
  y: number;
  /** Display pixels per art pixel (so chips size crisply). */
  scale: number;
  /** Dig progress 0..1 (dmg / hp) — drives how much of the tile is chipped away. */
  frac: number;
  /** Stable per-tile integer seed (so the chip pattern is deterministic, not flickering). */
  seed: number;
  /** Litness 0..1 at this tile (chips only show where the tile is visible). */
  lit: number;
  /** Cardinal direction the tile is being mined FROM (toward the miner): one axis ±1, the other 0.
   * Chunks are bitten out of the silhouette on this side. 0,0 = don't deform (unknown side). */
  dirX: number;
  dirY: number;
}

export interface Material {
  /** Per-pixel colour of the BAKED surface (required). */
  shade(ctx: ShadeCtx): Rgb;
  /** How far this material bleeds into neighbours at a boundary (px); defaults to the shared value. */
  feather?: number;
  /** Optional ANIMATED glint drawn per-frame on this material's exposed, lit tiles. */
  twinkle?: (ctx: TwinkleCtx) => void;
  /** Optional bespoke damage/break FX; when absent the shared chipping (fx.drawDamage) is used. */
  damage?: (ctx: DamageCtx) => void;
}

// ---- ore material registry (keyed by ore id) --------------------------------------------
// Ore materials self-register from their own files; importing materials/index pulls them all in.
const oreMaterials: Record<number, Material> = {};

export function registerOreMaterial(oreId: number, material: Material): void {
  oreMaterials[oreId] = material;
}

/** The material for an ore id, or null if none is registered (→ the tile renders as plain rock). */
export function oreMaterial(oreId: number): Material | null {
  return oreMaterials[oreId] ?? null;
}
