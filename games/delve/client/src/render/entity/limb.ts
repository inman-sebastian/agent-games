// limb.ts — the PROOF that a procedurally rasterized character part can read as the same art as the
// rock (see issue #47). Nothing else depends on this yet; it exists to be judged side-by-side with
// a material before the rig is built on top of it.
//
// THE RULE: never transform rasterized pixels — rasterize the transform. A limb is geometry between
// two joints in continuous space; we test each pixel against that geometry and write it at its final
// orientation. No ctx.rotate(), no drawImage scaling, no alpha edges — so a limb is exactly as crisp
// at 37° as at 0°, which is what a rotated sprite can never be.
//
// It shares the rock's texture DNA by construction, not by imitation: the same `colorsFor` ramp
// swatches and the same `quantize` (4×4 Bayer over banded swatches) the materials use.
//
// ONE DELIBERATE DIFFERENCE FROM MATERIALS — the anchor. Rock anchors noise AND dither in WORLD
// space, which is what makes it seamless across tiles. A character MOVES, so world-anchored texture
// would swim across the body as it walks. Entities anchor both in BODY space instead: same grain,
// same bands, stable on a moving object.
import { BAYER, clamp01, colorsFor, quantize, type Rgb, type RockColors } from '../palette';
import { vnoise } from '@delve/shared';

const TEX_BODY = 5171; // fixed seed for body-space texture noise (cf. TEX for world-space)
// Silhouette erosion, mirroring the rock's EDGE_EROSION: how far (px) the limb's edge is nibbled by
// body-space noise, and how coarse that nibble is. Small — enough to kill the machine-perfect arc
// without eating the anatomy.
const DEFAULT_ERODE = 0.7;
const EDGE_NOISE_FREQ = 0.5;

/** A limb is a capsule: a segment (a → b) with a radius, in LOGICAL ART PIXELS. */
export interface Limb {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly radius: number;
  /** Silhouette erosion in px (default `DEFAULT_ERODE`). 0 = a machine-perfect capsule edge. */
  readonly erode?: number;
}

/** Per-pixel inputs handed to a part's shader. All coordinates are BODY-space art pixels. */
export interface PartCtx {
  /** Position within the part's own frame — use this to seed noise so texture rides the body. */
  localX: number;
  localY: number;
  /** Pixel parity for the Bayer dither. Body-anchored, so the grain doesn't crawl. */
  px: number;
  py: number;
  /** Geometric light 0..1 before texture: 1 = facing the lamp, 0 = facing away. */
  brightness: number;
  /** 0 at the capsule's surface, 1 at its spine — cheap thickness cue. */
  depth: number;
  colors: RockColors;
}

export type PartShader = (ctx: PartCtx) => Rgb;

/** Squared distance from point p to segment a→b, plus the parametric position along it. */
function segment(px: number, py: number, l: Limb): { d2: number; nx: number; ny: number } {
  const vx = l.bx - l.ax;
  const vy = l.by - l.ay;
  const wx = px - l.ax;
  const wy = py - l.ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  const cx = l.ax + vx * t;
  const cy = l.ay + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  return { d2: dx * dx + dy * dy, nx: dx, ny: dy };
}

/**
 * Rasterize one limb into `img` (an ImageData the caller owns, in logical art pixels).
 *
 * Coverage is a HARD THRESHOLD — a pixel is in or out, never partially blended. That is the whole
 * crispness argument: anti-aliased limb edges are the fastest way to lose the pixel-art read.
 *
 * Joint positions are expected to be pre-quantised by the caller (see `snap`): solve IK in float,
 * round the joints to the pixel grid, then rasterize — so the foot lands within half a pixel of its
 * target while the drawn limb doesn't shimmer frame to frame.
 */
export function rasterizeLimb(
  img: ImageData,
  limb: Limb,
  shade: PartShader,
  colors: RockColors,
  lightDirX = 0,
  lightDirY = -1,
): void {
  const r = limb.radius;
  // Rock never has a geometrically perfect edge: its tile boundaries are nibbled by world noise so
  // nothing reads as machine-drawn. A bare capsule is exactly that machine edge, which is what makes
  // an otherwise-correct limb look computed next to the rock. So the radius is perturbed per-pixel
  // by body-space noise — the same trick, anchored to the body so it doesn't crawl.
  const erode = limb.erode ?? DEFAULT_ERODE;
  const minX = Math.max(0, Math.floor(Math.min(limb.ax, limb.bx) - r));
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(limb.ax, limb.bx) + r));
  const minY = Math.max(0, Math.floor(Math.min(limb.ay, limb.by) - r));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(limb.ay, limb.by) + r));
  const r2 = r * r;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Sample at the pixel CENTRE so the capsule is symmetric about its spine.
      const { d2, nx, ny } = segment(px + 0.5, py + 0.5, limb);
      if (d2 > (r + erode) * (r + erode)) continue; // cheap reject before the noise fetch
      const bite = erode * vnoise(px * EDGE_NOISE_FREQ, py * EDGE_NOISE_FREQ, TEX_BODY + 31);
      const edge = r - bite;
      if (d2 > edge * edge) continue; // hard coverage — no partial alpha, ever

      const dist = Math.sqrt(d2);
      const inv = dist === 0 ? 0 : 1 / dist;
      const radial = edge === 0 ? 0 : dist / edge;
      // Surface normal of the capsule at this pixel, used for a cylindrical top-light that matches
      // the rock's "up-facing surfaces brightest" convention.
      const lambert = (nx * inv * lightDirX + ny * inv * lightDirY + 1) * 0.5;
      const brightness = clamp01(0.18 + lambert * 0.82);

      const rgb = shade({
        localX: px,
        localY: py,
        px,
        py,
        brightness,
        depth: 1 - radial,
        colors,
      });

      const i = (py * img.width + px) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
}

/** Round a joint to the pixel grid. Solve in float, snap here, then rasterize. */
export const snap = (v: number): number => Math.round(v);

/**
 * The default part surface — the entity equivalent of `stoneSurface`. Same construction as the
 * materials (noise-perturbed brightness → `quantize` over ramp swatches), with the noise read in
 * BODY space so it rides the limb instead of swimming under it.
 */
export function clothSurface(ctx: PartCtx): Rgb {
  let b = ctx.brightness;
  // Octave scale matters more than amplitude here: the rock lumps at 0.16/0.45, and anything much
  // finer reads as per-pixel speckle rather than the same organic clumping.
  b += (vnoise(ctx.localX * 0.17, ctx.localY * 0.17, TEX_BODY) - 0.5) * 0.34;
  b += (vnoise(ctx.localX * 0.44, ctx.localY * 0.44 + 4, TEX_BODY + 7) - 0.5) * 0.16;
  b -= (1 - ctx.depth) * 0.34; // darken toward the silhouette edge so the limb reads round
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

/** A smoother, brighter part surface for metal/armour — cf. `metalSurface`. */
export function plateSurface(ctx: PartCtx): Rgb {
  let b = ctx.brightness;
  b += (vnoise(ctx.localX * 0.1, ctx.localY * 0.1, TEX_BODY + 3) - 0.5) * 0.16;
  b += ctx.depth > 0.72 ? 0.12 : 0; // a tight spine highlight — reads as a hard, curved surface
  b -= (1 - ctx.depth) * 0.3;
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

// Band order mirrors the materials' dark→light swatch ladder so a part sits in the same tonal space
// as the rock it stands on.
const bandCache = new Map<RockColors, Rgb[]>();
function bandsOf(colors: RockColors): Rgb[] {
  let bands = bandCache.get(colors);
  if (!bands) {
    bands = [colors.center, colors.deep, colors.body, colors.body2, colors.lit, colors.rimA, colors.rimB];
    bandCache.set(colors, bands);
  }
  return bands;
}

/** Build the shading swatches for a part from a 6-stop ramp — same call the strata/materials use. */
export const partColors = colorsFor;

/** Exposed so a lab can show the dither grain matches the rock's. */
export const DITHER_MATRIX = BAYER;
