// part.ts — the Part contract: what a character part IS, and how its appearance layers.
//
// This mirrors the split the material system already runs on (see docs/MATERIALS.md): the
// COMPOSITOR owns geometry, the MATERIAL owns only colour. Here the RASTERIZER (limb.ts) owns
// geometry and a PART owns only appearance — so a part picks one of the shared shape primitives
// rather than inventing its own coverage test, exactly as a material picks a surface class rather
// than hand-rolling a texture. That is what keeps silhouettes coherent as parts multiply.
//
// LAYERS are the reason this contract exists rather than just a shader per part. Equipment, armour
// and customisation are layers over a part's surface, each a function of (along, around) — so a
// pauldron is authored once against the shoulder's surface and lands correctly in every pose,
// rather than being redrawn per frame.
//
// The compositing idiom is already established in the codebase: `sparkle(ctx, …) ?? stoneSurface(…)`
// in the FX catalogue returns a colour or null and falls through. Layers stack the same way.
import type { Rgb } from '../palette';
import { colorsFor } from '../palette';
import type { PartCtx, PartShader } from './limb';

/**
 * A layer's shader returns a colour where it covers and `null` where it doesn't — so layers
 * composite by fall-through, top layer first, base surface last. `null` is "not here", NOT
 * "transparent": there is no alpha blending anywhere in this path, because soft edges are what cost
 * pixel art its crispness.
 */
export type LayerShader = (ctx: PartCtx) => Rgb | null;

/** One appearance layer over a part — a piece of armour, a strap, a patch of dirt, a tattoo. */
export interface PartLayer {
  /** Identifier, so equipment can add/remove its own layers without touching others. */
  readonly id: string;
  /** Its own 6-stop ramp: armour is a different material from the cloth under it. */
  readonly ramp: readonly string[];
  readonly shade: LayerShader;
}

// ---- shape primitives (the shape equivalent of the surface classes) ----------------------------
//
// Deliberately few. A part's silhouette is its CLASS, not a per-part invention — three primitives
// cover a humanoid, and a new one should only appear when a genuinely different body plan needs it
// (a wing, a tail, a worm segment).

export type PartShape =
  | {
      /** A limb: a segment with a radius that may TAPER from the proximal to the distal joint. */
      readonly kind: 'limb';
      /** Radius at the `from` joint, in art px. */
      readonly rFrom: number;
      /** Radius at the `to` joint. Equal to `rFrom` for a uniform capsule. */
      readonly rTo: number;
    }
  | {
      /** A head or a torso: an ellipse about the segment's midpoint. */
      readonly kind: 'bulb';
      /** Half-extent across the segment. */
      readonly rAcross: number;
      /** Half-extent along it, as a multiple of the segment's own half-length. */
      readonly alongScale: number;
    };

/**
 * A character part. Geometry comes from `shape`; everything else is appearance.
 *
 * `from`/`to` name joints on the rig rather than carrying coordinates, so a part is pose-independent
 * — the rig supplies the positions each frame and the part never knows where it is in the world.
 */
export interface Part {
  readonly id: string;
  /** Joint this part hangs from (proximal) and reaches to (distal). */
  readonly from: string;
  readonly to: string;
  readonly shape: PartShape;
  /** 6-stop ramp, shadow → rim. Same contract as a stratum's. */
  readonly ramp: readonly string[];
  /** The base surface — one of the shared part surfaces (cloth/plate/skin). */
  readonly surface: PartShader;
  /**
   * Appearance layers, FRONT-MOST FIRST. The first one to return non-null wins, so ordering is
   * explicit rather than emergent from an array reversal somewhere.
   */
  readonly layers?: readonly PartLayer[];
  /**
   * Draw order across the whole body, low to high. This is what puts the far arm behind the torso
   * and the near arm in front — a 2D rig has no z-buffer, so the order is authored.
   */
  readonly order: number;
  /** Silhouette erosion in px; see limb.ts. Left undefined to take the shared default. */
  readonly erode?: number;
  /**
   * Brightness offset applied before shading, for DEPTH SEPARATION.
   *
   * A side-on 2D figure reads by overlap, and two adjacent parts sharing a ramp merge into one
   * shape — the near arm vanishes into the torso. The reference asset pack solves this by giving
   * far-side limbs a different (darker) colour rather than by offsetting them in x, which keeps the
   * view flat and head-on the way a platformer needs. Negative sits a part behind.
   */
  readonly shadeBias?: number;
  /**
   * Flat colour for CODED mode — the silhouette-tuning view.
   *
   * The reference asset pack ships its template as flat, distinct colours per body part, and that
   * is the right way to judge a silhouette: shading and texture actively hide part boundaries and
   * proportion errors. These are the pack's EXACT measured colours for the matching part, so a
   * coded render can be diffed against a reference frame numerically instead of by eye.
   */
  readonly coded?: Rgb;
}

/**
 * Resolve a part's full appearance for one pixel: walk the layers front-to-back, fall through to
 * the base surface. Each layer is evaluated with ITS OWN palette, so armour reads as metal over
 * cloth rather than as a recolour of the same ramp.
 */
export function shadePart(part: Part, ctx: PartCtx, layerColors: readonly (typeof ctx.colors)[]): Rgb {
  const layers = part.layers;
  if (layers) {
    for (let i = 0; i < layers.length; i++) {
      const hit = layers[i].shade({ ...ctx, colors: layerColors[i] });
      if (hit) return hit;
    }
  }
  return part.surface(ctx);
}

/** Precompute the swatches for a part and each of its layers — `colorsFor` is not free per-pixel. */
export function partPalettes(part: Part): {
  base: ReturnType<typeof colorsFor>;
  layers: ReturnType<typeof colorsFor>[];
} {
  return {
    base: colorsFor([...part.ramp]),
    layers: (part.layers ?? []).map((layer) => colorsFor([...layer.ramp])),
  };
}

// ---- layer helpers -----------------------------------------------------------------------------
//
// Equipment is overwhelmingly "cover a band of the part" — a cuff, a bracer, a belt, a boot. These
// make that a declaration rather than per-item geometry maths.

/**
 * Cover a band along the part, optionally limited to part of its circumference.
 *
 * `from`/`to` are in `along` units; `wrap` limits |around| so a strap can sit on the front of a
 * limb without wrapping all the way round. Because both are surface coordinates, the band stays
 * put under any pose — which is the whole point of the coordinate system.
 */
export function band(
  from: number,
  to: number,
  shade: PartShader,
  wrap = 1,
): LayerShader {
  return (ctx) =>
    ctx.along >= from && ctx.along <= to && Math.abs(ctx.around) <= wrap ? shade(ctx) : null;
}

/** Cover one side of the part — `+1` = the positive-`around` half. For asymmetric kit. */
export function side(sign: 1 | -1, shade: PartShader): LayerShader {
  return (ctx) => (Math.sign(ctx.around) === sign ? shade(ctx) : null);
}
