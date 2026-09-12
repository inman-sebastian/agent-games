// humanoid.ts — ONE template over the generic rig: a side-on biped, at the decided character scale.
//
// Scale: 2 x 3 TILES = 32 x 48 art px (see issue #47). The reference asset pack uses 48x48 frames,
// which corroborates the height. Origin is the FEET at (0, 0) with y increasing downward, so a pose
// drops straight onto a ground contact point without an offset — which is what foot IK will want.
//
// Every colour is Resurrect-64 (docs/PALETTE.md). Each part gets a 6-stop ramp, exactly like a
// stratum, so a character sits in the same tonal system as the rock it stands on.
import { clothSurface, plateSurface } from './limb';
import { band, type Part } from './part';
import { solveTwoBone } from './ik';
import type { Rig, Skeleton } from './rig';

// ---- proportions (art px, feet at y = 0, up is negative) --------------------------------------
//
// MEASURED off the reference asset pack's colour-coded template, not estimated. Its idle frame is
// 48x48 but the FIGURE is only 29px tall (y 11..39) and 18px wide — the rest of the frame is
// headroom for animation overshoot, which is a thing worth knowing before matching a "48px
// character".
//
// Per-part extents from that frame, feet at 0 (the template segments each body part by colour):
//   head       8px tall,  8px wide, y -28..-21
//   torso      two segments: chest y -19..-14, pelvis y -14..-9, 7-8px wide
//   shoulder  -19    hip  -11    knee  -6    ankle  -1
//   upper arm  4px wide   forearm 3px   thigh 6px   shin 3px
//
// Those are scaled by 48/29 onto our decided figure height. NOTE THE TENSION: the reference figure
// is ~1.8 tiles tall, while DELVE committed to Terraria's 2x3 tiles (a 48px figure). We keep the
// committed scale and borrow the reference's PROPORTIONS — so this is the reference's shape at
// Terraria's size.
//
// What the measurements corrected, and it was the opposite of what the previous pass guessed:
// vertically it was already within 1-3px, but every part was too NARROW. The reference head and
// torso are the SAME width (8px each), and its thighs are 6px where ours were 4.3. "Blob" was never
// a width problem — it was the single-bulb torso having no waist.
export const HEIGHT = 48;
const Y_ANKLE = -2;
const Y_KNEE = -10;
const Y_HIP = -17;
const Y_WAIST = -24;
const Y_SHOULDER = -31;
const Y_NECK = -33;
const Y_HEAD_TOP = -46;
const Y_ELBOW = -24;
const Y_HAND = -17;

// Bone lengths, so IK has something to solve against. A bone does NOT change length when a limb
// moves, which is exactly what the old midpoint-knee walk violated.
//
// Two traps here, both hit on the first attempt:
//
// 1. These must be POSITIVE. Deriving them as `Y_HIP - Y_KNEE` gives -7, because y increases
//    downward while the joint constants are upward measurements. A negative length inverts the
//    solver — the knee solved ABOVE the hip and the elbow above the shoulder, which is what put a
//    forearm across the character's face.
// 2. They must total MORE than the joint span they cover. Hip to ankle is 15px; bones summing to
//    exactly 15 leave the leg permanently straight, with no slack to bend at all. Real standing
//    posture has a slightly bent knee, so the chain is deliberately a little longer than the gap.
// Slack is 1px total, not 2: at 8+9 against a 15px span the solver put the knee 4px off the
// hip→ankle line, which on a 15px leg reads as a permanent crouch rather than a standing bend.
const FEMUR = 8;
const TIBIA = 8;
const HUMERUS = 8;
const ULNA = 8;

// Stride, measured off the reference's walk sheet: its near foot sweeps ~14px on a 28px figure —
// half the figure's height. Scaled to ours that's ~±5px, kept inside the leg's reach so the chain
// never has to straighten out to hit its target. The first pass used ±3 and read as a shuffle.
const STRIDE = 10;
const FOOT_LIFT = 5;
const ARM_SWING = 10;
// NO near/far x offset: the view is flat side-on, and depth is carried by VALUE (`shadeBias`), the
// way the reference distinguishes its near and far limbs by colour rather than by position.
const X_NEAR = 0;
const X_FAR = 0;

// ---- ramps (all Resurrect-64) ------------------------------------------------------------------
const CLOTH = ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff']; // blue overalls
const SKIN = ['#2e222f', '#694f62', '#966c6c', '#ab947a', '#cd683d', '#e6904e'];
const HELMET = ['#2e222f', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#f9c22b']; // warm, lamp-lit
const BOOT = ['#2e222f', '#3e3546', '#4c3e24', '#676633', '#a2a947', '#cddf6c'];

/** Boots as a layer on the shin rather than a separate part — the layering claim, applied. */
const bootLayer = { id: 'boot', ramp: BOOT, shade: band(0.72, 1.12, plateSurface) };

/**
 * The helmet is a LAYER on the head covering its upper half, not a separate part.
 *
 * It was a part first, spanning its own short segment, and that was a mistake worth recording: the
 * segment came out 5px long, the shape's `alongScale` shrank it further, and the helmet rendered as
 * a flat pancake balanced on a blob. A layer sidesteps the geometry entirely — it inherits the
 * head's shape and just claims the top of its surface, which is exactly what `along` is for.
 */
const helmetLayer = { id: 'helmet', ramp: HELMET, shade: band(0.42, 1.1, plateSurface) };

// ---- the parts --------------------------------------------------------------------------------
// `order` is authored because a 2D rig has no z-buffer: far limbs, then the body, then near limbs.
export const HUMANOID: Rig = {
  parts: [
    // far side — behind the torso, and DARKER. That bias is what stops the near arm merging into
    // the torso now that there's no x offset to separate them.
    { id: 'armFar.upper', from: 'shoulderFar', to: 'elbowFar', shape: { kind: 'limb', rFrom: 3.3, rTo: 2.8 }, ramp: CLOTH, surface: clothSurface, order: 0, shadeBias: -0.3 },
    { id: 'armFar.fore', from: 'elbowFar', to: 'handFar', shape: { kind: 'limb', rFrom: 2.6, rTo: 2.2 }, ramp: SKIN, surface: clothSurface, order: 0, shadeBias: -0.3 },
    { id: 'legFar.thigh', from: 'hipFar', to: 'kneeFar', shape: { kind: 'limb', rFrom: 5, rTo: 4.2 }, ramp: CLOTH, surface: clothSurface, order: 1, shadeBias: -0.26 },
    { id: 'legFar.shin', from: 'kneeFar', to: 'ankleFar', shape: { kind: 'limb', rFrom: 4.2, rTo: 3 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 1, shadeBias: -0.26 },

    // body — TWO torso segments, because the reference has a distinct chest and pelvis. One bulb
    // had no waist, which is what actually read as "fat"; the width was never the problem.
    { id: 'pelvis', from: 'hip', to: 'waist', shape: { kind: 'bulb', rAcross: 5.4, alongScale: 1.15 }, ramp: CLOTH, surface: clothSurface, order: 2 },
    { id: 'chest', from: 'waist', to: 'shoulder', shape: { kind: 'bulb', rAcross: 6.5, alongScale: 1.1 }, ramp: CLOTH, surface: clothSurface, order: 3 },
    // Head as wide as the chest — measured, not stylised. shadeBias lifts it because a big round
    // bulb has a lot of rim and the surface's depth darkening drags the face into shadow.
    { id: 'head', from: 'neck', to: 'headTop', shape: { kind: 'bulb', rAcross: 6.5, alongScale: 1.0 }, ramp: SKIN, surface: clothSurface, layers: [helmetLayer], order: 4, shadeBias: 0.16 },

    // near side — in front, full brightness
    { id: 'legNear.thigh', from: 'hipNear', to: 'kneeNear', shape: { kind: 'limb', rFrom: 5.2, rTo: 4.4 }, ramp: CLOTH, surface: clothSurface, order: 5 },
    { id: 'legNear.shin', from: 'kneeNear', to: 'ankleNear', shape: { kind: 'limb', rFrom: 4.4, rTo: 3.2 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 5 },
    { id: 'armNear.upper', from: 'shoulderNear', to: 'elbowNear', shape: { kind: 'limb', rFrom: 3.4, rTo: 2.9 }, ramp: CLOTH, surface: clothSurface, order: 6 },
    { id: 'armNear.fore', from: 'elbowNear', to: 'handNear', shape: { kind: 'limb', rFrom: 2.7, rTo: 2.3 }, ramp: SKIN, surface: clothSurface, order: 6 },
  ],
};

/** The neutral standing pose. Everything else is a deviation from this. */
export function idlePose(): Skeleton {
  return {
    hip: { x: 0, y: Y_HIP },
    waist: { x: 0, y: Y_WAIST },
    shoulder: { x: 0, y: Y_SHOULDER },
    neck: { x: 0, y: Y_NECK },
    headTop: { x: 0, y: Y_HEAD_TOP },
    hipNear: { x: X_NEAR, y: Y_HIP },
    kneeNear: { x: X_NEAR, y: Y_KNEE },
    ankleNear: { x: X_NEAR, y: Y_ANKLE },
    hipFar: { x: X_FAR, y: Y_HIP },
    kneeFar: { x: X_FAR, y: Y_KNEE },
    ankleFar: { x: X_FAR, y: Y_ANKLE },
    shoulderNear: { x: X_NEAR, y: Y_SHOULDER },
    elbowNear: { x: X_NEAR + 1, y: Y_ELBOW },
    handNear: { x: X_NEAR + 2, y: Y_HAND },
    shoulderFar: { x: X_FAR, y: Y_SHOULDER },
    elbowFar: { x: X_FAR - 1, y: Y_ELBOW },
    handFar: { x: X_FAR - 2, y: Y_HAND },
  };
}

/**
 * A walk pose at phase `p` (0..1), generated rather than keyframed — a gait is a function of time
 * and speed, which is what "all art is procedural" means for animation as much as for texture.
 *
 * Crude on purpose: two counter-phased legs, counter-swinging arms, a body bob at twice the stride
 * frequency. It exists to exercise the rig across poses, not to be the final gait.
 */
export function walkPose(p: number): Skeleton {
  const pose = idlePose();
  const swing = Math.sin(p * Math.PI * 2);
  const bob = Math.abs(Math.sin(p * Math.PI * 2)) * 1.5;

  for (const joint of ['hip', 'waist', 'shoulder', 'neck', 'headTop', 'shoulderNear', 'shoulderFar'] as const) {
    pose[joint].y += bob;
  }

  // The pose sets END EFFECTORS (feet, hands) and lets IK place the joints between. That's the
  // difference between a leg that bends and a rod that pivots: a knee's position is determined by
  // the hip, the foot and two fixed bone lengths — never a midpoint.
  const leg = (hip: string, knee: string, ankle: string, phase: number, bend: 1 | -1): void => {
    const s = Math.sin(phase * Math.PI * 2);
    const c = Math.cos(phase * Math.PI * 2);
    pose[ankle].x = pose[hip].x + s * (STRIDE / 2);
    pose[ankle].y = Y_ANKLE - Math.max(0, c) * FOOT_LIFT; // the foot lifts only on its forward half
    pose[knee] = solveTwoBone(pose[hip], pose[ankle], FEMUR, TIBIA, bend);
  };
  // Knees bend BACKWARD, so both legs take the same sign; the mirror comes from the phase offset.
  leg('hipNear', 'kneeNear', 'ankleNear', p, -1);
  leg('hipFar', 'kneeFar', 'ankleFar', p + 0.5, -1);

  const arm = (shoulder: string, elbow: string, hand: string, dir: number, bend: 1 | -1): void => {
    pose[hand].x = pose[shoulder].x - dir * swing * (ARM_SWING / 2);
    pose[hand].y = Y_HAND;
    pose[elbow] = solveTwoBone(pose[shoulder], pose[hand], HUMERUS, ULNA, bend);
  };
  // Arms counter-swing the legs, and elbows bend FORWARD — the opposite sign to a knee, which is
  // why the bend direction is per-limb rather than a single global setting.
  arm('shoulderNear', 'elbowNear', 'handNear', 1, 1);
  arm('shoulderFar', 'elbowFar', 'handFar', -1, 1);
  return pose;
}
