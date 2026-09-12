// surface.ts — SURFACE COORDINATES for an imported sprite cel: the pixel-mapping pipeline.
//
// This is the whole idea from the UV-encoding devlog, made concrete for 2D pixel art. A sprite pixel
// should not store a colour — it should store WHERE TO LOOK, and something else decides what is
// there. `skin.ts` is the one-dimensional version of that: index → colour, a flat lookup. This is the
// two-dimensional version: pixel → (along, around) on the body part's surface, sampled by a SHADER.
//
// Why bother, when a colour table already works. Three things the flat version cannot do:
//
//   * Equipment with real shading. The pack is a template with 2-5 shades per part, so a colour
//     table can only ever produce 2-5 shades. Sampled at a surface coordinate, a material produces
//     as many bands as it likes — the shade count stops being a property of the imported art.
//   * The SAME materials as the world. `clothSurface` and `plateSurface` take a `PartCtx`, which is
//     exactly what this produces, and they are built from the same `colorsFor` swatches and Bayer
//     dither as the rock. So a steel pauldron is the metal material, not an imitation of it.
//   * Features placed by position rather than by colour. A trim line at `along > 0.8`, a belt across
//     the torso, a boot below the shin's midpoint: authored once against coordinates, applied to
//     every animation, because the coordinates are derived per frame from the silhouette itself.
//
// HOW THE COORDINATES ARE DERIVED. `along` and `around` come from scanning the part's dominant axis,
// which matches the contract the procedural rig used, so equipment authored for either works on
// both. `depth` and the shading normal come from a DISTANCE TRANSFORM of the part mask rather than
// from an assumed limb axis — that way a foot, a fist or a curled-up roll pose shades correctly
// without anyone declaring which way it points.
import { clamp01, type Rgb, type RockColors } from '../palette';
import type { PartCtx } from './limb';
import type { SpriteCel } from './sprite';

/** Per-pixel surface data for one cel, in cel-local row-major order. */
export interface SurfaceMap {
  readonly w: number;
  readonly h: number;
  /** 0 at the part's start along its dominant axis, 1 at its end. */
  readonly along: Float32Array;
  /** -1 at one silhouette edge, +1 at the other, 0 on the spine. */
  readonly around: Float32Array;
  /** 0 at the silhouette, 1 deepest inside — a thickness cue, from the distance transform. */
  readonly depth: Float32Array;
  /** Outward surface normal, from the gradient of the distance field. */
  readonly normalX: Float32Array;
  readonly normalY: Float32Array;
}

const cache = new WeakMap<SpriteCel, SurfaceMap>();

/** Derive (and cache) the surface map for a cel. One pass per cel for the life of the process. */
export function surfaceOf(cel: SpriteCel, indices: Uint8Array): SurfaceMap {
  const hit = cache.get(cel);
  if (hit) return hit;
  const made = derive(cel.w, cel.h, indices);
  cache.set(cel, made);
  return made;
}

function derive(w: number, h: number, indices: Uint8Array): SurfaceMap {
  const n = w * h;
  const along = new Float32Array(n);
  const around = new Float32Array(n);
  const depth = new Float32Array(n);
  const normalX = new Float32Array(n);
  const normalY = new Float32Array(n);
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && indices[y * w + x] !== 0;

  // ---- along / around, by scanning the dominant axis -------------------------------------------
  // Rows for a part that is taller than it is wide, columns otherwise. A limb's `along` should run
  // down the limb, and for an outstretched arm or a foot that is horizontal, not vertical.
  const rows = h >= w;
  const lines = rows ? h : w;
  const across = rows ? w : h;
  const first: number[] = [];
  for (let i = 0; i < lines; i++) {
    let lo = -1;
    let hi = -1;
    for (let j = 0; j < across; j++) {
      if (!(rows ? solid(j, i) : solid(i, j))) continue;
      if (lo < 0) lo = j;
      hi = j;
    }
    first.push(lo);
    if (lo < 0) continue;
    // The run's full extent, not each island: a part with a one-pixel gap is still one part, and
    // measuring islands separately would restart `around` mid-limb.
    const centre = (lo + hi) / 2;
    const half = Math.max(0.5, (hi - lo) / 2);
    for (let j = lo; j <= hi; j++) {
      const idx = rows ? i * w + j : j * w + i;
      if (indices[idx] === 0) continue;
      around[idx] = (j - centre) / half;
    }
  }
  const used = first.map((lo, i) => (lo >= 0 ? i : -1)).filter((i) => i >= 0);
  const lineFrom = used.length ? used[0] : 0;
  const lineTo = used.length ? used[used.length - 1] : 0;
  const span = Math.max(1, lineTo - lineFrom);
  for (let i = lineFrom; i <= lineTo; i++) {
    const t = (i - lineFrom) / span;
    for (let j = 0; j < across; j++) {
      const idx = rows ? i * w + j : j * w + i;
      if (indices[idx] === 0) continue;
      along[idx] = t;
    }
  }

  // ---- depth + normal, from a chamfer distance transform ---------------------------------------
  // Two passes with 3-4 weights: exact enough at this size (cels are tens of pixels) and it needs no
  // assumption about the part's shape, which is the point — a fist and a thigh both shade correctly.
  const INF = 1e9;
  const dist = new Float32Array(n).fill(INF);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : dist[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (indices[i] === 0) {
        dist[i] = 0;
        continue;
      }
      dist[i] = Math.min(
        dist[i],
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (indices[i] === 0) continue;
      dist[i] = Math.min(
        dist[i],
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  }
  let maxD = 0;
  for (let i = 0; i < n; i++) if (indices[i] !== 0) maxD = Math.max(maxD, dist[i]);
  const scale = maxD > 0 ? 1 / maxD : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (indices[i] === 0) continue;
      depth[i] = clamp01(dist[i] * scale);
      // Outward normal: down the distance gradient, which points from deep toward the silhouette.
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const len = Math.hypot(gx, gy);
      if (len < 1e-6) {
        normalX[i] = 0;
        normalY[i] = -1; // deepest point of a flat region: treat it as facing the light
      } else {
        normalX[i] = -gx / len;
        normalY[i] = -gy / len;
      }
    }
  }

  return { w, h, along, around, depth, normalX, normalY };
}

/** A material: one of the shared part surfaces plus the ramp it draws from. */
export interface SpriteMaterial {
  readonly shade: (ctx: PartCtx) => Rgb;
  readonly colors: RockColors;
}

/**
 * Where the light is, in SPRITE-LOCAL pixels. Off-canvas is fine and expected.
 *
 * A POSITION rather than a direction, because the interesting cases are both radial. The player
 * CARRIES the lamp — the game's emitter sits at the player's own centre — so a fixed overhead light
 * is wrong in a visible way: the body should radiate from the lamp and fall off toward the feet. And
 * an enemy is lit from outside, by a lamp somewhere off its own canvas, so the direction has to vary
 * across its body rather than being one vector.
 *
 * Coordinates are the sprite's OWN, never the mirrored ones, so the light is attached to the body and
 * turns with it — which is what a carried lamp does. A caller wanting a WORLD-fixed light on a
 * sprite that can face either way negates its x offset when the sprite is flipped.
 *
 * `reach` is the distance over which brightness falls to nothing, in sprite pixels. Without it a
 * lamp held at the chest lights the boots as strongly as the shoulders.
 */
export interface SpriteLight {
  readonly x: number;
  readonly y: number;
  readonly reach?: number;
}

/**
 * The value a part settles to where the light does not reach: the middle of the band ladder, so a
 * far-from-the-lamp part reads as flat rather than as black.
 */
const AMBIENT = 0.46;

/** A plain overhead light, for callers that do not care — the old fixed behaviour. */
export const OVERHEAD: SpriteLight = { x: 0, y: -1e6, reach: Infinity };

/**
 * Build the `PartCtx` a material shader expects for one pixel.
 *
 * `localX`/`localY` and `px`/`py` are FRAME-space, not cel-space, so noise and the Bayer dither ride
 * the body rather than the cel's bounding box — a cel's box moves frame to frame as the limb swings,
 * and anchoring texture to it would make the grain crawl across the character.
 */
export function partCtx(
  map: SurfaceMap,
  i: number,
  frameX: number,
  frameY: number,
  colors: RockColors,
  light: SpriteLight = OVERHEAD,
): PartCtx {
  // Direction from this pixel TOWARD the light, so a surface facing the lamp is brightest.
  let lx = light.x - frameX;
  let ly = light.y - frameY;
  const dist = Math.hypot(lx, ly) || 1;
  lx /= dist;
  ly /= dist;
  const lambert = (map.normalX[i] * lx + map.normalY[i] * ly + 1) * 0.5;
  // Falloff, smooth rather than linear so a carried lamp does not put a hard ring across the body.
  const reach = light.reach ?? Infinity;
  const near = reach === Infinity ? 1 : clamp01(1 - dist / reach);
  const fall = near * near * (3 - 2 * near); // smoothstep
  return {
    along: map.along[i],
    around: map.around[i],
    localX: frameX,
    localY: frameY,
    px: frameX,
    py: frameY,
    // Distance FLATTENS the relief toward mid rather than darkening toward black. The material's
    // job is form; actual darkness is the lighting pass's job, compositing over the whole frame —
    // multiplying here instead made the figure read dimmer than the same figure lit from overhead,
    // which is the wrong relationship between the two systems.
    brightness: clamp01(AMBIENT + (0.18 + lambert * 0.82 - AMBIENT) * fall),
    depth: map.depth[i],
    colors,
  };
}
