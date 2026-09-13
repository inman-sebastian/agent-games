// player.test.ts — locomotion timing and the step-up lift (happy-dom).
//
// Both are pure functions over numbers, which is deliberate: the parts of the presentation layer
// with a decision in them should be assertable without rendering anything.
import { describe, it, expect } from 'vitest';
import { poseFor, stepLift, STEP_LIFT_TIME } from './player';
import { PLAYER_SPRITES } from './sprites';
import { SUB } from '@delve/shared';

const WALK = PLAYER_SPRITES.walk;
/** Must match STRIDE_TILES in player.ts; asserted below by measuring a full cycle. */
const STRIDE = 2.2 * SUB;

describe('the walk cycle is locked to the ground', () => {
  it('advances with distance, not with the clock', () => {
    // THE bug this fixes. The cycle used to run on wall time, so at 6 tiles a second one cycle
    // covered 6.5 tiles — a 3.2-tile stride on a character 0.9 tiles wide. The feet skated, and 8
    // frames over 1.08s is 7.4fps against 60fps movement.
    const still = poseFor('run', 0, 0);
    const later = poseFor('run', 5000, 0); // five seconds pass, no ground covered
    expect(later.frame, 'a stationary player holds its frame however long it waits').toBe(
      still.frame,
    );

    const moved = poseFor('run', 0, STRIDE / 2); // half a stride, no time at all
    expect(moved.frame, 'covering ground advances the cycle with the clock stopped').not.toBe(
      still.frame,
    );
  });

  it('completes exactly one cycle per stride', () => {
    const frames = [];
    const steps = WALK.frames * 4;
    for (let i = 0; i < steps; i++) frames.push(poseFor('run', 0, (STRIDE * i) / steps).frame);
    // Every frame is used, in order, once per cycle.
    expect(new Set(frames).size, 'the whole cycle is used across one stride').toBe(WALK.frames);
    expect(frames[0], 'a stride starts at frame 0').toBe(0);
    expect(poseFor('run', 0, STRIDE).frame, 'and wraps to frame 0 at the far end').toBe(0);
  });

  it('runs the cycle backwards-safely for negative distance', () => {
    // `walked` only ever grows in the game, but a phase derived from a modulo is one sign error away
    // from a negative frame index, and that would throw rather than look wrong.
    for (const d of [-0.1, -STRIDE, -99]) {
      const frame = poseFor('run', 0, d).frame;
      expect(frame, `distance ${d}`).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(WALK.frames);
    }
  });

  it('still holds a single frame while airborne', () => {
    // A jump is an arc, not a cycle; cycling through its frames mid-air reads as flailing.
    expect(poseFor('jump', 0, 0).frame).toBe(poseFor('jump', 9999, 99).frame);
    expect(poseFor('fall', 0, 0).frame).toBe(poseFor('fall', 9999, 99).frame);
  });

  it('drives non-locomotion states from the clock', () => {
    // Idle has no ground speed to lock to, so it must still breathe while standing still.
    const a = poseFor('idle', 0, 0).frame;
    const b = poseFor('idle', 500, 0).frame;
    expect(b, 'idle advances on time alone').not.toBe(a);
  });
});

describe('a step-up is carried up, not teleported', () => {
  it('starts at the full height and lands exactly on zero', () => {
    // The offset is how far BELOW its true position the figure is drawn, so it must begin at the
    // whole step and end at nothing — anything left over is a permanently sunken character.
    expect(stepLift(1, 0)).toBe(1);
    expect(stepLift(1, STEP_LIFT_TIME)).toBe(0);
    expect(stepLift(1, STEP_LIFT_TIME * 10)).toBe(0);
  });

  it('never rises back down', () => {
    let previous = Infinity;
    for (let age = 0; age <= STEP_LIFT_TIME; age += STEP_LIFT_TIME / 24) {
      const offset = stepLift(1, age);
      expect(offset, `age ${age.toFixed(3)}`).toBeLessThanOrEqual(previous);
      previous = offset;
    }
  });

  it('eases out rather than moving linearly', () => {
    // A step is fast off the back foot and settles. Linear reads as a lift, which is the thing this
    // exists to avoid — so most of the distance must be gone by the halfway point.
    const half = stepLift(1, STEP_LIFT_TIME / 2);
    expect(half, 'over half the rise is done at the midpoint').toBeLessThan(0.5);
  });

  it('scales with the height of the step', () => {
    expect(stepLift(2, 0)).toBe(2);
    expect(stepLift(2, STEP_LIFT_TIME / 2)).toBeCloseTo(stepLift(1, STEP_LIFT_TIME / 2) * 2, 10);
  });
});
