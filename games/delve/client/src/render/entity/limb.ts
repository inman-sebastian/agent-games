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
// Default cap extension. Well below 1 (a true capsule) because blocky limbs are what read as a
// character at this scale — see `Limb.cap`.
const DEFAULT_CAP = 0.35;

// Rim darkening, shared by the part surfaces. Module-level so the rig lab can drive it live without
// threading a config through every per-pixel call — this is read once per pixel, so an extra
// argument here is measurably worse than a module read.
let rimDarken = 0.14;
export const setRimDarken = (v: number): void => {
  rimDarken = v;
};
const EDGE_NOISE_FREQ = 0.5;

/**
 * A limb is a TAPERED capsule: a segment (a → b) with a radius at each end, in LOGICAL ART PIXELS.
 *
 * Taper isn't decoration — a uniform capsule can't express a thigh (thick at the hip, narrower at
 * the knee) or a forearm, so every limb would read as a sausage. `radiusTo` defaults to `radius`,
 * which keeps a plain capsule a one-field declaration.
 */
export interface Limb {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  /** Radius at `a` (proximal). */
  readonly radius: number;
  /** Radius at `b` (distal). Defaults to `radius` — i.e. no taper. */
  readonly radiusTo?: number;
  /** Silhouette erosion in px (default `DEFAULT_ERODE`). 0 = a machine-perfect capsule edge. */
  readonly erode?: number;
  /**
   * How far the rounded END CAPS extend past the joints, as a fraction of the radius.
   * 1 = a true capsule (hemispherical caps); 0 = flat ends exactly at the joints.
   *
   * This matters far more than it sounds. A capsule's drawn length is `bone + 2 * radius`, so a
   * short fat limb becomes a long blob — a 7px femur at radius 5 draws 17px tall, taller than the
   * whole torso, which is exactly how the legs came to dominate the figure. The reference pack's
   * thigh is 6px wide and 7px tall over a 5px bone, which no capsule can produce: its limbs are
   * BLOCKS with a slight overhang, not capsules. Low values give that.
   */
  readonly cap?: number;
}

/**
 * Per-pixel inputs handed to a part's shader.
 *
 * The important pair is `along`/`around` — the pixel's position on the part's SURFACE, stable under
 * rotation and pose. That's what lets appearance be authored once and land correctly in every frame:
 * armour, dirt, a device strapped to a forearm are all just functions over (along, around), exactly
 * as a material shader is a function over world coordinates.
 *
 * `localX`/`localY` are frame-space and therefore rotate WITH the limb — fine for seeding texture
 * noise, wrong for placing a feature. A detail pinned to a frame coordinate swims across the body as
 * it moves; pinned to a surface coordinate it stays put.
 */
export interface PartCtx {
  // ---- surface coordinates (author features against these) ----
  /**
   * Position down the part: 0 at the proximal joint (a), 1 at the distal (b).
   *
   * Runs slightly OUTSIDE 0..1 inside the rounded end caps, deliberately. Clamping would give every
   * pixel in a cap the same value, collapsing the hemisphere to one band and smearing anything
   * authored there — and the caps are the joints, which is where equipment attaches. Shaders that
   * need a strict 0..1 should clamp at the point of use.
   */
  along: number;
  /**
   * Position across the part, -1 at one silhouette edge to +1 at the other, 0 on the spine.
   *
   * Read as a cylinder seen side-on, this is `sin(angle)` around the circumference — so a shader
   * wanting true cylindrical wrap uses `asin(around)`, giving ±90°. The far half of the
   * circumference is never rasterized (a 2D capsule only shows its front), which is the behaviour
   * you want: a marking on the back of an arm shouldn't show from the front. Which half is visible
   * is a property of the part's facing, not of this value.
   */
  around: number;

  // ---- texture + shading ----
  /** Frame-space position. Seed noise with this so texture rides the body. NOT for placing features. */
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

/**
 * Squared distance from p to the segment a→b, the parametric position `t` along it, and the SIGNED
 * perpendicular offset. `t` and `side` are the raw material for the surface coordinates — `t` was
 * already being computed here and thrown away.
 */
function segment(
  px: number,
  py: number,
  l: Limb,
): { d2: number; nx: number; ny: number; t: number; along: number; side: number } {
  const vx = l.bx - l.ax;
  const vy = l.by - l.ay;
  const wx = px - l.ax;
  const wy = py - l.ay;
  const len2 = vx * vx + vy * vy;
  const raw = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2; // UNCLAMPED — see the cap note below
  const t = clamp01(raw);
  const cx = l.ax + vx * t;
  const cy = l.ay + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  // Signed side: project onto the segment's left-hand perpendicular, so one silhouette edge is
  // negative and the other positive with a consistent handedness along the whole limb.
  const len = Math.sqrt(len2);
  const side = len === 0 ? dx : (dx * -vy + dy * vx) / len;
  // `along` keeps the UNCLAMPED projection. Clamping it (the obvious thing) makes every pixel in a
  // hemispherical cap share t=0 or t=1, so the whole cap collapses to one coordinate band and any
  // feature authored there smears — which the coordinate debug map showed plainly. Joints are
  // exactly where equipment attaches (a boot cuff, a knee pad, a pauldron), so the caps are the
  // last place that can afford a degenerate coordinate. Overshooting slightly past 0..1 in the caps
  // keeps it continuous and monotonic end to end.
  return { d2: dx * dx + dy * dy, nx: dx, ny: dy, t, along: raw, side };
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
  const rA = limb.radius;
  const rB = limb.radiusTo ?? limb.radius;
  const r = Math.max(rA, rB); // bounding radius, for the loop bounds and the cheap reject
  // Rock never has a geometrically perfect edge: its tile boundaries are nibbled by world noise so
  // nothing reads as machine-drawn. A bare capsule is exactly that machine edge, which is what makes
  // an otherwise-correct limb look computed next to the rock. So the radius is perturbed per-pixel
  // by body-space noise — the same trick, anchored to the body so it doesn't crawl.
  const erode = limb.erode ?? DEFAULT_ERODE;
  const cap = limb.cap ?? DEFAULT_CAP;
  const segLen = Math.hypot(limb.bx - limb.ax, limb.by - limb.ay);
  const minX = Math.max(0, Math.floor(Math.min(limb.ax, limb.bx) - r));
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(limb.ax, limb.bx) + r));
  const minY = Math.max(0, Math.floor(Math.min(limb.ay, limb.by) - r));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(limb.ay, limb.by) + r));
  const r2 = r * r;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Sample at the pixel CENTRE so the capsule is symmetric about its spine.
      const { d2, nx, ny, t, along, side } = segment(px + 0.5, py + 0.5, limb);
      if (d2 > (r + erode) * (r + erode)) continue; // cheap reject before the noise fetch
      // Clip the end caps: without this the limb runs a full radius past each joint.
      if (segLen > 0) {
        const overhang = (cap * r) / segLen;
        if (along < -overhang || along > 1 + overhang) continue;
      }
      // Taper: interpolate the radius along the limb. Clamped `t` (not the cap-overshooting `along`)
      // so the caps keep the radius of the end they belong to instead of shrinking past it.
      const rHere = rA + (rB - rA) * t;
      const bite = erode * vnoise(px * EDGE_NOISE_FREQ, py * EDGE_NOISE_FREQ, TEX_BODY + 31);
      const edge = rHere - bite;
      if (d2 > edge * edge) continue; // hard coverage — no partial alpha, ever

      const dist = Math.sqrt(d2);
      const inv = dist === 0 ? 0 : 1 / dist;
      const radial = edge === 0 ? 0 : dist / edge;
      // Surface normal of the capsule at this pixel, used for a cylindrical top-light that matches
      // the rock's "up-facing surfaces brightest" convention.
      const lambert = (nx * inv * lightDirX + ny * inv * lightDirY + 1) * 0.5;
      const brightness = clamp01(0.18 + lambert * 0.82);

      const rgb = shade({
        along,
        // Normalised to the ERODED edge, so `around` still reaches ±1 at the silhouette after the
        // noise bite — otherwise features would drift away from the edge wherever it was nibbled.
        around: edge === 0 ? 0 : clamp01Signed(side / edge),
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

/**
 * Rasterize an ellipse about the segment's midpoint — the `bulb` shape a head or torso uses.
 *
 * Same surface-coordinate contract as a limb, so a layer authored against (along, around) works on
 * either without knowing which it got: `along` runs a→b through the bulb, `around` spans the
 * silhouette. Same hard coverage threshold and the same body-anchored edge erosion, so a head sits
 * in the same visual language as an arm.
 */
export function rasterizeBulb(
  img: ImageData,
  a: { x: number; y: number },
  b: { x: number; y: number },
  rAcross: number,
  alongScale: number,
  shade: PartShader,
  colors: RockColors,
  erodePx = DEFAULT_ERODE,
  lightDirX = 0,
  lightDirY = -1,
): void {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy);
  if (len === 0) return;
  const ux = vx / len;
  const uy = vy / len;
  const rAlong = (len / 2) * alongScale;

  const bound = Math.ceil(Math.max(rAlong, rAcross) + erodePx + 1);
  const minX = Math.max(0, Math.floor(mx - bound));
  const maxX = Math.min(img.width - 1, Math.ceil(mx + bound));
  const minY = Math.max(0, Math.floor(my - bound));
  const maxY = Math.min(img.height - 1, Math.ceil(my + bound));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px + 0.5 - mx;
      const dy = py + 0.5 - my;
      // Decompose into the bulb's own axes: along the segment, and across it.
      const dAlong = dx * ux + dy * uy;
      const dAcross = dx * -uy + dy * ux;
      const bite = erodePx * vnoise(px * EDGE_NOISE_FREQ, py * EDGE_NOISE_FREQ, TEX_BODY + 31);
      const ra = rAlong - bite;
      const rc = rAcross - bite;
      if (ra <= 0 || rc <= 0) continue;
      const na = dAlong / ra;
      const nc = dAcross / rc;
      const radial2 = na * na + nc * nc;
      if (radial2 > 1) continue; // hard coverage — no partial alpha, ever

      // Surface normal on the ellipse, in world axes, for the same top-light convention as a limb.
      const gx = (na / ra) * ux + (nc / rc) * -uy;
      const gy = (na / ra) * uy + (nc / rc) * ux;
      const glen = Math.hypot(gx, gy) || 1;
      const lambert = ((gx / glen) * lightDirX + (gy / glen) * lightDirY + 1) * 0.5;

      const rgb = shade({
        along: clamp01(na * 0.5 + 0.5),
        around: clamp01Signed(nc),
        localX: px,
        localY: py,
        px,
        py,
        brightness: clamp01(0.18 + lambert * 0.82),
        depth: 1 - Math.sqrt(radial2),
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

/** Clamp to -1..1 (the signed sibling of `clamp01`). */
const clamp01Signed = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

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
  // Rim darkening, kept LIGHT on purpose. At 0.34 this was tuned against one big isolated limb; on
  // a body of many small parts it dominated — every part's rim is most of the part at 3px radius, so
  // the whole figure read muddy and adjacent parts met in a dark seam where their rims touched.
  // Live-tunable via the rig lab (`rimDarken`), because that is not a value anyone guesses.
  b -= (1 - ctx.depth) * rimDarken;
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

/** A smoother, brighter part surface for metal/armour — cf. `metalSurface`. */
export function plateSurface(ctx: PartCtx): Rgb {
  let b = ctx.brightness;
  b += (vnoise(ctx.localX * 0.1, ctx.localY * 0.1, TEX_BODY + 3) - 0.5) * 0.16;
  b += ctx.depth > 0.72 ? 0.12 : 0; // a tight spine highlight — reads as a hard, curved surface
  b -= (1 - ctx.depth) * rimDarken * 0.86; // see clothSurface — plate holds a touch more form
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

// Band order mirrors the materials' dark→light swatch ladder so a part sits in the same tonal space
// as the rock it stands on.
const bandCache = new Map<RockColors, Rgb[]>();
function bandsOf(colors: RockColors): Rgb[] {
  let bands = bandCache.get(colors);
  if (!bands) {
    bands = [
      colors.center,
      colors.deep,
      colors.body,
      colors.body2,
      colors.lit,
      colors.rimA,
      colors.rimB,
    ];
    bandCache.set(colors, bands);
  }
  return bands;
}

/**
 * DEBUG surface — the analogue of the authoring "map" in aarthificial's UV-encoding devlog, which
 * animates against a high-contrast intermediate because UV-encoded frames are unreadable. Nothing
 * here is unreadable, but the coordinate field still needs validating BEFORE features are authored
 * against it: stripes down `along` and across `around` make a discontinuity or a handedness flip
 * obvious, where a shaded limb would hide it.
 *
 * Bands are deliberately coarse and hard-edged — this is a measuring tool, not art.
 */
export function surfaceMapSurface(ctx: PartCtx): Rgb {
  // Coarse on purpose: at 8x4 the cells came out ~3x1.6px and read as stripes, which hides exactly
  // the discontinuities this view exists to expose.
  const alongBand = Math.floor(ctx.along * 5) % 2 === 0;
  const aroundBand = Math.floor((ctx.around + 1) * 1.5) % 2 === 0;
  // magenta/green checker = the two coordinates are independent and continuous; a smear or a
  // mirrored seam mid-limb means the handedness flipped.
  if (alongBand === aroundBand) return [232, 78, 160];
  return [96, 219, 128];
}

/** Build the shading swatches for a part from a 6-stop ramp — same call the strata/materials use. */
export const partColors = colorsFor;

/** Exposed so a lab can show the dither grain matches the rock's. */
export const DITHER_MATRIX = BAYER;
