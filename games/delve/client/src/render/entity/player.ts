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
import { SUB, type MinerState } from '@delve/shared';
import { PLAYER_SPRITES, type PlayerAnim } from './sprites';
import { drawSprite, type SpriteAnim, type SpriteLight, type SpriteSkin } from './sprite';
import { MINER_SKIN, PLAYER_LAMP } from './skin';

/**
 * Which animation plays for a miner state.
 *
 * The names are looked up in a REGISTRY rather than imported, so the same mapping serves any entity
 * whose animations use these names — the player, a trial character, and eventually an enemy.
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
 * One full walk cycle covers this much ground, in tiles.
 *
 * THE NUMBER THAT MADE THE WALK LOOK BROKEN. The cycle was driven by wall-clock time at the pack's
 * authored 1.08s, and DELVE's run speed is 6 tiles a second — so one cycle covered 6.5 TILES. That
 * is a 3.2-tile stride on a character 0.9 tiles wide, which is why the feet skated, and it is also
 * why the animation read as slow: 8 frames spread over 1.08s is 7.4fps against 60fps movement.
 *
 * Locking the cycle to distance instead fixes both at once. At a plausible 1.1-block step the cycle
 * completes in 0.37s at full speed, which is the same 8 frames at about 22fps — and the feet turn
 * over in proportion to the ground, so there is nothing left to skate. No new art; the frames were
 * always there, being shown too slowly.
 *
 * Expressed in CELLS after the 2x2 split (#44), so the physical stride is unchanged: a cell is half
 * a block, so 2.2 blocks is 4.4 cells.
 */
const STRIDE_TILES = 2.2 * SUB;

/**
 * Pick the animation and frame for a miner state.
 *
 * `walked` is the total horizontal distance the player has travelled, in tiles, and LOCOMOTION IS
 * DRIVEN BY IT rather than by the clock — see `STRIDE_TILES`. Everything else is driven by `ms`,
 * because an idle breath or a mining swing has no ground speed to lock to.
 *
 * `run` uses the WALK cycle rather than the run cycle deliberately: the pack's run is a sprint with
 * a long airborne stride, and DELVE's run speed is a brisk walk. Swapping to the run cycle belongs
 * with a sprint mechanic, not with the current single movement speed.
 */
export function poseFor(
  state: MinerState,
  ms: number,
  walked = 0,
  registry: Readonly<Record<string, SpriteAnim>> = PLAYER_SPRITES,
): PlayerPose {
  // Falls back to `idle`, which every entity has, so a registry missing an animation degrades to a
  // held pose rather than throwing. A pack with no `walk` is a real case — see docs/SPRITES.md.
  const anim = registry[FOR_STATE[state]] ?? registry.idle;
  // An airborne pose holds rather than looping — a jump is an arc, not a cycle, so cycling through
  // its frames while hanging in the air reads as flailing.
  if (state === 'jump' || state === 'fall') {
    return { anim, frame: state === 'jump' ? 1 : Math.min(anim.frames - 1, 3) };
  }
  if (state === 'run') {
    // Phase-locked to the ground. A fraction of a stride maps straight onto a frame, so the cycle
    // can never drift out of step with the distance actually covered.
    const phase = (((walked / STRIDE_TILES) % 1) + 1) % 1;
    return { anim, frame: Math.min(anim.frames - 1, Math.floor(phase * anim.frames)) };
  }
  const total = anim.durations.reduce((a, b) => a + b, 0);
  let t = ((ms % total) + total) % total;
  for (let i = 0; i < anim.frames; i++) {
    t -= anim.durations[i];
    if (t < 0) return { anim, frame: i };
  }
  return { anim, frame: anim.frames - 1 };
}

/** How long the renderer takes to carry the figure up a step the sim already resolved, in seconds. */
export const STEP_LIFT_TIME = 0.11;

/**
 * How far BELOW its true position the figure should be drawn, in tiles, `age` seconds into a step-up
 * of `tiles`.
 *
 * Eased out rather than linear: a step is fast at the start and settles, which is what a leg pushing
 * off does. Linear reads as a lift rather than a step.
 */
export function stepLift(tiles: number, age: number): number {
  if (age >= STEP_LIFT_TIME) return 0;
  const t = 1 - age / STEP_LIFT_TIME; // 1 → 0
  return tiles * t * t; // ease-out quad
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
