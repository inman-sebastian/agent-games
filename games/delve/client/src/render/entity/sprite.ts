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
// Frames are UPSCALED at draw time by an integer factor, never resampled, so every edge stays hard.
import type { Rgb } from '../palette';
import { TEMPLATE_PALETTE } from './sprites/palette';

/** One layer's pixels for one frame. `x`/`y` place the cel in the frame; indices are row-major. */
export interface SpriteCel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * `w * h` TEMPLATE_PALETTE indices, base64-encoded. 0 is TRANSPARENT; n is palette entry n - 1.
   *
   * Base64 rather than an array literal because a generated module full of thousands of integers is
   * unreadable either way, and this form is a tenth the size.
   */
  readonly data: string;
}

export interface SpriteLayer {
  /** The slot this is — a body part, a weapon, or baked FX. See `PLAYER_SLOTS`. */
  readonly name: string;
  /** One entry per frame; `null` where the layer is empty in that frame. */
  readonly cels: readonly (SpriteCel | null)[];
}

export interface SpriteAnim {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly frames: number;
  /**
   * The canvas row the feet stand on — NOT the canvas bottom.
   *
   * The pack pads its canvas for animation overshoot, so the figure's feet sit eight rows above the
   * bottom edge. Anchoring to the canvas floated the character by exactly that much. Airborne poses
   * deliberately reach below this row, which is why it is the modal contact row, not the lowest.
   */
  readonly ground: number;
  /** Per-frame duration in ms, straight from the source file. */
  readonly durations: readonly number[];
  /** Bottom-to-top paint order, exactly as authored. */
  readonly layers: readonly SpriteLayer[];
}

/**
 * How a sprite is coloured, and therefore how equipment is worn.
 *
 * `colors` remaps the TEMPLATE PALETTE — one entry per template colour, so a pixel's code resolves
 * the same way in every animation. That global mapping is the point: the pack's own layering is
 * inconsistent enough that some animations paint a stray head-coloured pixel onto an arm layer, and
 * a per-layer mapping would recolour it wrongly. `null` leaves a colour as authored.
 *
 * `hide` drops whole slots — baked FX a caller renders itself, or a body part an equipment layer
 * fully replaces. `tint` overrides everything, for silhouettes and hit flashes.
 */
export interface SpriteSkin {
  readonly colors?: readonly (string | null)[];
  readonly hide?: readonly string[];
  readonly tint?: Rgb;
}

const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const decoded = new WeakMap<SpriteCel, Uint8Array>();

/** Base64 indices, decoded once per cel and kept — a redraw is then a table read. */
function indicesOf(cel: SpriteCel): Uint8Array {
  const hit = decoded.get(cel);
  if (hit) return hit;
  const bytes =
    typeof atob === 'function'
      ? atob(cel.data)
      : Buffer.from(cel.data, 'base64').toString('binary');
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  decoded.set(cel, out);
  return out;
}

/** The resolved colour table for a skin, cached so a remap costs one parse per distinct skin. */
const ramps = new Map<string, readonly Rgb[]>();

function rampFor(skin: SpriteSkin | undefined): readonly Rgb[] {
  const key = (skin?.colors ?? []).join();
  const hit = ramps.get(key);
  if (hit) return hit;
  const made = TEMPLATE_PALETTE.map((base, i) => hexToRgb(skin?.colors?.[i] ?? base));
  ramps.set(key, made);
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
  } = {},
): void {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const f = ((frame % anim.frames) + anim.frames) % anim.frames;
  const skin = options.skin;
  const colors = rampFor(skin);
  const hidden = skin?.hide;
  // Anchor on the animation's GROUND ROW, not the canvas edge — see `SpriteAnim.ground`.
  const baseX = originX - Math.floor((anim.w * scale) / 2);
  const baseY = originY - anim.ground * scale;

  for (const layer of anim.layers) {
    if (hidden?.includes(layer.name)) continue;
    const cel = layer.cels[f];
    if (!cel) continue;
    const indices = indicesOf(cel);

    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        const index = indices[y * cel.w + x];
        if (index === 0) continue;
        const rgb = skin?.tint ?? colors[index - 1];
        if (!rgb) continue; // an index past the template palette — a hole, not a crash
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
    const indices = indicesOf(cel);
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
