// sprite.ts — layered, index-mapped sprite frames, and the runtime that draws them.
//
// This replaces the procedural rig for character art (issue #47). Five rounds of fitting a
// parametric skeleton to the reference pack landed at 73% silhouette overlap and a figure that still
// did not read as the same character; the frames themselves are exact by definition. No IK, no
// generated gait — a frame is a frame.
//
// WHAT IS STILL PROCEDURAL, and why the layering matters. A pixel does not store a COLOUR, it stores
// an INDEX into its layer's ramp. That is the pixel-mapping idea from the UV-encoding devlog applied
// to a 2D sprite: the frame says *where to look*, and what it finds there is swappable. So one set
// of frames serves every skin tone, every armour set and every material, because re-skinning a body
// part is substituting that layer's ramp — the same trick the material system already uses for rock.
//
// Layers are per body part (head, torso, arms, legs), which is what makes equipment tractable: a
// chest piece overrides the torso layer's ramp without touching the animation, and a helmet is a new
// layer painted over the head's.
//
// Frames are UPSCALED at draw time by an integer factor, never resampled — the pack's figure is 29px
// on a 48px canvas and DELVE's character is 2x3 tiles, so the art is drawn at whole-pixel scale to
// keep every edge hard.
import type { Rgb } from '../palette';

/** One layer's pixels for one frame. `x`/`y` place the cel in the frame; indices are row-major. */
export interface SpriteCel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * `w * h` palette indices, base64-encoded. 0 is TRANSPARENT; n maps to `palette[n - 1]`.
   *
   * Base64 rather than an array literal because a generated module full of thousands of integers is
   * unreadable either way, and this form is a tenth the size.
   */
  readonly data: string;
}

export interface SpriteLayer {
  /** The Aseprite layer name — the body part this is. */
  readonly name: string;
  /** Colours this layer's indices refer to, as `#rrggbb`. Swap this to re-skin the part. */
  readonly palette: readonly string[];
  /** One entry per frame; `null` where the layer is empty in that frame. */
  readonly cels: readonly (SpriteCel | null)[];
}

export interface SpriteAnim {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly frames: number;
  /** Per-frame duration in ms, straight from the source file. */
  readonly durations: readonly number[];
  /** Bottom-to-top paint order, exactly as authored. */
  readonly layers: readonly SpriteLayer[];
}

/** A per-layer ramp override: layer name → replacement palette. This is how equipment is worn. */
export type SpriteSkin = Readonly<Record<string, readonly string[]>>;

const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Decoded indices and resolved colours, cached per (layer, palette) so a redraw is a table read. */
interface Prepared {
  readonly indices: Uint8Array;
  readonly colors: readonly Rgb[];
}
const cache = new WeakMap<SpriteCel, Map<string, Prepared>>();

function prepare(cel: SpriteCel, palette: readonly string[]): Prepared {
  let byPalette = cache.get(cel);
  if (!byPalette) {
    byPalette = new Map();
    cache.set(cel, byPalette);
  }
  const key = palette.join();
  const hit = byPalette.get(key);
  if (hit) return hit;
  const bytes =
    typeof atob === 'function'
      ? atob(cel.data)
      : Buffer.from(cel.data, 'base64').toString('binary');
  const indices = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) indices[i] = bytes.charCodeAt(i);
  const made: Prepared = { indices, colors: palette.map(hexToRgb) };
  byPalette.set(key, made);
  return made;
}

/**
 * Draw one frame into `img`, with the sprite's ORIGIN (bottom-centre of the canvas) at
 * `originX`/`originY` — the same contract the rig used, so a sprite drops onto a ground contact
 * point without an offset.
 *
 * `scale` must be a whole number. A sprite is never resampled: pixel art scaled by 1.5 has soft
 * edges no palette can fix.
 */
export function drawSprite(
  img: ImageData,
  anim: SpriteAnim,
  frame: number,
  originX: number,
  originY: number,
  options: {
    readonly scale?: number;
    /** Mirror horizontally. Flipping INDICES is exact; flipping drawn pixels is not. */
    readonly flip?: boolean;
    readonly skin?: SpriteSkin;
    /** Replace every opaque pixel with this — silhouettes, hit flashes, shadows. */
    readonly tint?: Rgb;
  } = {},
): void {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const f = ((frame % anim.frames) + anim.frames) % anim.frames;
  // The sprite's own origin: bottom-centre of its canvas, which is where the feet sit.
  const baseX = originX - Math.floor((anim.w * scale) / 2);
  const baseY = originY - anim.h * scale;

  for (const layer of anim.layers) {
    const cel = layer.cels[f];
    if (!cel) continue;
    const palette = options.skin?.[layer.name] ?? layer.palette;
    const { indices, colors } = prepare(cel, palette);

    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        const index = indices[y * cel.w + x];
        if (index === 0) continue;
        const rgb = options.tint ?? colors[index - 1];
        if (!rgb) continue; // a skin with a shorter ramp than the frame uses
        const sx = options.flip ? anim.w - 1 - (cel.x + x) : cel.x + x;
        const sy = cel.y + y;
        // Rasterize the upscale: fill the whole destination block, never sample a source pixel.
        for (let dy = 0; dy < scale; dy++) {
          const py = baseY + sy * scale + dy;
          if (py < 0 || py >= img.height) continue;
          for (let dx = 0; dx < scale; dx++) {
            const px = baseX + sx * scale + dx;
            if (px < 0 || px >= img.width) continue;
            const i = (py * img.width + px) * 4;
            img.data[i] = rgb[0];
            img.data[i + 1] = rgb[1];
            img.data[i + 2] = rgb[2];
            img.data[i + 3] = 255;
          }
        }
      }
    }
  }
}

/** Which frame an animation is on at time `ms`, honouring the authored per-frame durations. */
export function frameAt(anim: SpriteAnim, ms: number): number {
  const total = anim.durations.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let t = ((ms % total) + total) % total;
  for (let i = 0; i < anim.frames; i++) {
    t -= anim.durations[i];
    if (t < 0) return i;
  }
  return anim.frames - 1;
}

/** The frame's opaque pixel mask, for tests and for measuring against the source. */
export function spriteMask(anim: SpriteAnim, frame: number): Uint8Array {
  const out = new Uint8Array(anim.w * anim.h);
  for (const layer of anim.layers) {
    const cel = layer.cels[frame];
    if (!cel) continue;
    const { indices } = prepare(cel, layer.palette);
    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        if (indices[y * cel.w + x] === 0) continue;
        const px = cel.x + x;
        const py = cel.y + y;
        if (px < 0 || py < 0 || px >= anim.w || py >= anim.h) continue;
        out[py * anim.w + px] = 1;
      }
    }
  }
  return out;
}
