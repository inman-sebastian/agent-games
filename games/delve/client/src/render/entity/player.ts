// player.ts — draw the player's imported sprite into a 2D context, and choose which animation.
//
// The bridge between two different drawing models. `drawSprite` writes PIXELS into an ImageData,
// because that is the only way to resolve a template index or sample a material per pixel. The game
// draws through a canvas context. Doing a getImageData/putImageData over the whole frame every tick
// to bridge that would be absurd, so each distinct frame is rasterized once into a small offscreen
// canvas and `drawImage`d from then on.
//
// The cache is what makes the material path affordable at all: a procedural material costs a shader
// call per pixel, and a cached frame costs it ZERO times after the first. There are only a few
// hundred distinct (animation, frame, facing, skin) combinations for a character, so the whole set
// converges within seconds of play and never recomputes.
import type { MinerState } from '@delve/shared';
import { PLAYER_SPRITES, type PlayerAnim } from './sprites';
import { drawSprite, type SpriteAnim, type SpriteLight, type SpriteSkin } from './sprite';
import { MINER_SKIN, PLAYER_LAMP } from './skin';

/**
 * Which animation plays for a miner state.
 *
 * The pack has far more animations than the sim has states — crouch, roll, push, pull, ledge climb,
 * air spin — and they stay unused until a mechanic asks for them. Mapping them speculatively would
 * be guessing at gameplay that does not exist yet. Which animation waits on which mechanic: #50.
 *
 * `mine` has no dedicated animation in the pack, so it borrows the idle: the swing is already
 * carried by the pickaxe and the dig particles. That is a placeholder, and the honest fix is a
 * mining animation rather than a cleverer mapping (#49).
 */
const FOR_STATE: Readonly<Record<MinerState, PlayerAnim>> = {
  idle: 'idle',
  run: 'walk',
  jump: 'jump',
  fall: 'jump',
  mine: 'idle',
};

/** The sprite an entity should show, plus how far through it. */
export interface PlayerPose {
  readonly anim: SpriteAnim;
  readonly frame: number;
}

/**
 * Pick the animation and frame for a miner state at time `ms`.
 *
 * `run` uses the WALK cycle rather than the run cycle deliberately: the pack's run is a sprint with
 * a long airborne stride, and DELVE's run speed is a brisk walk. Swapping to the run cycle belongs
 * with a sprint mechanic, not with the current single movement speed.
 */
export function poseFor(state: MinerState, ms: number, speed = 1): PlayerPose {
  const anim = PLAYER_SPRITES[FOR_STATE[state]];
  // An airborne pose holds rather than looping — a jump is an arc, not a cycle, so cycling through
  // its frames while hanging in the air reads as flailing.
  if (state === 'jump' || state === 'fall') {
    return { anim, frame: state === 'jump' ? 1 : Math.min(anim.frames - 1, 3) };
  }
  const total = anim.durations.reduce((a, b) => a + b, 0) / Math.max(0.1, speed);
  let t = ((ms % total) + total) % total;
  for (let i = 0; i < anim.frames; i++) {
    t -= anim.durations[i] / Math.max(0.1, speed);
    if (t < 0) return { anim, frame: i };
  }
  return { anim, frame: anim.frames - 1 };
}

// ---- the offscreen frame cache ------------------------------------------------------------------

interface Baked {
  readonly canvas: HTMLCanvasElement;
  /** Where the sprite's ground row sits inside the canvas, so the caller can align feet to a tile. */
  readonly ground: number;
}

const baked = new Map<string, Baked>();

/**
 * Rasterize one frame at one scale, or return the cached canvas.
 *
 * `skinId` is part of the key and must change whenever the skin does. It is a caller-supplied string
 * rather than something derived from the skin object, because a skin holds shader functions and
 * resolved colour tables — there is nothing cheap to hash, and hashing it per frame would cost more
 * than the draw it is meant to save.
 */
function bake(
  anim: SpriteAnim,
  frame: number,
  scale: number,
  flip: boolean,
  skin: SpriteSkin,
  skinId: string,
  light: SpriteLight,
): Baked {
  const key = `${anim.name}|${frame}|${scale}|${flip ? 1 : 0}|${skinId}`;
  const hit = baked.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = anim.w * scale;
  canvas.height = anim.h * scale;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  // Draw at the canvas's own ground row, then record it: the caller aligns that row to the ground.
  drawSprite(img, anim, frame, Math.floor(canvas.width / 2), anim.ground * scale, {
    scale,
    flip,
    skin,
    light,
  });
  ctx.putImageData(img, 0, 0);
  const made: Baked = { canvas, ground: anim.ground * scale };
  baked.set(key, made);
  return made;
}

/** Drop every cached frame. Call this after changing a skin's ramps, or the old art keeps showing. */
export function clearPlayerCache(): void {
  baked.clear();
}

export interface DrawPlayerOptions {
  readonly scale?: number;
  readonly facing?: 'left' | 'right';
  readonly skin?: SpriteSkin;
  /** Must change whenever `skin` does — it is the cache key. */
  readonly skinId?: string;
  readonly light?: SpriteLight;
}

/**
 * Draw the player with its FEET at `(footX, footY)` in context pixels.
 *
 * Feet rather than top-left, because that is the only anchor that stays put: the figure's height
 * changes between animations (a crouch is 21px where an idle is 30) and its canvas is padded for
 * overshoot, so anchoring anywhere else makes the character bob when the animation changes.
 */
export function drawPlayer(
  g: CanvasRenderingContext2D,
  pose: PlayerPose,
  footX: number,
  footY: number,
  options: DrawPlayerOptions = {},
): void {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const skin = options.skin ?? MINER_SKIN;
  const frame = bake(
    pose.anim,
    pose.frame,
    scale,
    options.facing === 'left',
    skin,
    options.skinId ?? 'miner',
    options.light ?? PLAYER_LAMP,
  );
  // Snap to whole pixels: a sprite drawn at a fractional offset is resampled by the browser, which
  // softens every edge the hard-threshold rasterizer went to the trouble of keeping.
  g.drawImage(
    frame.canvas,
    Math.round(footX - frame.canvas.width / 2),
    Math.round(footY - frame.ground),
  );
}
