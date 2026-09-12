// rig.ts — a generic parts-and-joints rig, and the draw loop that turns one into pixels.
//
// DELIBERATELY NOT HUMANOID. Enemies here may end up spiders, bats or worms, and the first
// non-biped would force a rewrite of anything that assumed two arms and two legs. So a rig is just
// a bag of named joints plus a list of parts that span them; `humanoid.ts` is ONE template over
// this, not the thing itself.
//
// A 2D rig has no depth buffer, so paint order is authored per part (`Part.order`) rather than
// derived. That's what puts the far arm behind the torso and the near arm in front.
import { clamp01, type Rgb } from '../palette';
import { rasterizeLimb, rasterizeBulb, snap, type PartCtx } from './limb';
import { shadePart, partPalettes, type Part } from './part';

/** Magenta, so a part that forgot to declare a coded colour is impossible to miss. */
const CODED_FALLBACK: Rgb = [255, 0, 255];

export interface Joint {
  x: number;
  y: number;
}

/** A pose: every joint the rig's parts reference, in ART PIXELS relative to the figure's origin. */
export type Skeleton = Record<string, Joint>;

export interface Rig {
  readonly parts: readonly Part[];
}

/** Precomputed swatches per part, keyed by part id — `colorsFor` is far too slow per-pixel. */
export type RigPalettes = Record<string, ReturnType<typeof partPalettes>>;

export function rigPalettes(rig: Rig): RigPalettes {
  const out: RigPalettes = {};
  for (const part of rig.parts) out[part.id] = partPalettes(part);
  return out;
}

/**
 * Draw a posed rig into `img`, at `originX/originY` in the image's pixel space.
 *
 * Parts are painted in `order`, low to high. Joints are SNAPPED to the pixel grid here, once, so
 * everything downstream rasterizes on-grid: solve a pose (or an IK target) in float, and the
 * rounding happens at exactly one place instead of drifting through the maths.
 */
export function drawRig(
  img: ImageData,
  rig: Rig,
  pose: Skeleton,
  palettes: RigPalettes,
  originX: number,
  originY: number,
  override?: (ctx: PartCtx) => Rgb,
  /**
   * CODED mode: every part renders as its flat `coded` colour, no shading and no texture.
   *
   * This is the silhouette view, and it's the mode to work in while proportions are being settled —
   * shading hides exactly the errors you're looking for. It mirrors how the reference asset pack
   * ships its template.
   */
  coded = false,
): void {
  const ordered = [...rig.parts].sort((a, b) => a.order - b.order);
  for (const part of ordered) {
    const from = pose[part.from];
    const to = pose[part.to];
    if (!from || !to) continue; // a template may omit joints a variant part doesn't use
    const a = { x: snap(originX + from.x), y: snap(originY + from.y) };
    const b = { x: snap(originX + to.x), y: snap(originY + to.y) };
    const pal = palettes[part.id];
    const bias = part.shadeBias ?? 0;
    const flat = part.coded ?? CODED_FALLBACK;
    const shade =
      override ??
      (coded
        ? (): Rgb => flat
        : (ctx: PartCtx): Rgb =>
            bias === 0
              ? shadePart(part, ctx, pal.layers)
              : shadePart(part, { ...ctx, brightness: clamp01(ctx.brightness + bias) }, pal.layers));

    if (part.shape.kind === 'limb') {
      rasterizeLimb(
        img,
        {
          ax: a.x,
          ay: a.y,
          bx: b.x,
          by: b.y,
          radius: part.shape.rFrom,
          radiusTo: part.shape.rTo,
          erode: part.erode,
          cap: part.cap,
        },
        shade,
        pal.base,
      );
    } else {
      rasterizeBulb(img, a, b, part.shape.rAcross, part.shape.alongScale, shade, pal.base, part.erode);
    }
  }
}

/** Linear blend between two poses — the crude version of what a state machine will drive. */
export function blendPose(a: Skeleton, b: Skeleton, t: number): Skeleton {
  const out: Skeleton = {};
  for (const key of Object.keys(a)) {
    const ja = a[key];
    const jb = b[key] ?? ja;
    out[key] = { x: ja.x + (jb.x - ja.x) * t, y: ja.y + (jb.y - ja.y) * t };
  }
  return out;
}
