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
import type { Rig, Skeleton } from './rig';

// ---- proportions (art px, feet at y = 0, up is negative) --------------------------------------
// Stylised rather than anatomical: a slightly large head reads better at 48px than true proportion.
export const HEIGHT = 48;
const Y_ANKLE = -3;
const Y_KNEE = -14;
const Y_HIP = -25;
const Y_SHOULDER = -37;
const Y_NECK = -38;
const Y_HEAD_TOP = -47;
const Y_ELBOW = -30;
const Y_HAND = -23;
// Near/far limb separation — small, because a side-on figure reads by overlap, not by distance.
const X_NEAR = 2;
const X_FAR = -2;

// ---- ramps (all Resurrect-64) ------------------------------------------------------------------
const CLOTH = ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff']; // blue overalls
const SKIN = ['#2e222f', '#694f62', '#966c6c', '#ab947a', '#cd683d', '#e6904e'];
const HELMET = ['#2e222f', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#f9c22b']; // warm, lamp-lit
const BOOT = ['#2e222f', '#3e3546', '#4c3e24', '#676633', '#a2a947', '#cddf6c'];

/** Boots as a layer on the shin rather than a separate part — the layering claim, applied. */
const bootLayer = { id: 'boot', ramp: BOOT, shade: band(0.72, 1.12, plateSurface) };

// ---- the parts --------------------------------------------------------------------------------
// `order` is authored because a 2D rig has no z-buffer: far limbs, then the body, then near limbs.
export const HUMANOID: Rig = {
  parts: [
    // far side — behind the torso
    { id: 'armFar.upper', from: 'shoulderFar', to: 'elbowFar', shape: { kind: 'limb', rFrom: 3.4, rTo: 3 }, ramp: CLOTH, surface: clothSurface, order: 0 },
    { id: 'armFar.fore', from: 'elbowFar', to: 'handFar', shape: { kind: 'limb', rFrom: 3, rTo: 2.4 }, ramp: SKIN, surface: clothSurface, order: 0 },
    { id: 'legFar.thigh', from: 'hipFar', to: 'kneeFar', shape: { kind: 'limb', rFrom: 5, rTo: 4.2 }, ramp: CLOTH, surface: clothSurface, order: 1 },
    { id: 'legFar.shin', from: 'kneeFar', to: 'ankleFar', shape: { kind: 'limb', rFrom: 4, rTo: 3.2 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 1 },

    // body
    { id: 'torso', from: 'hip', to: 'neck', shape: { kind: 'bulb', rAcross: 7, alongScale: 1.05 }, ramp: CLOTH, surface: clothSurface, order: 2 },
    { id: 'head', from: 'neck', to: 'headTop', shape: { kind: 'bulb', rAcross: 6, alongScale: 1.25 }, ramp: HELMET, surface: plateSurface, order: 3 },

    // near side — in front
    { id: 'legNear.thigh', from: 'hipNear', to: 'kneeNear', shape: { kind: 'limb', rFrom: 5, rTo: 4.2 }, ramp: CLOTH, surface: clothSurface, order: 4 },
    { id: 'legNear.shin', from: 'kneeNear', to: 'ankleNear', shape: { kind: 'limb', rFrom: 4, rTo: 3.2 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 4 },
    { id: 'armNear.upper', from: 'shoulderNear', to: 'elbowNear', shape: { kind: 'limb', rFrom: 3.4, rTo: 3 }, ramp: CLOTH, surface: clothSurface, order: 5 },
    { id: 'armNear.fore', from: 'elbowNear', to: 'handNear', shape: { kind: 'limb', rFrom: 3, rTo: 2.4 }, ramp: SKIN, surface: clothSurface, order: 5 },
  ],
};

/** The neutral standing pose. Everything else is a deviation from this. */
export function idlePose(): Skeleton {
  return {
    hip: { x: 0, y: Y_HIP },
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
  const lift = Math.cos(p * Math.PI * 2);
  const bob = Math.abs(Math.sin(p * Math.PI * 2)) * 1.5;

  for (const joint of ['hip', 'neck', 'headTop', 'shoulderNear', 'shoulderFar'] as const) {
    pose[joint].y += bob;
  }

  const leg = (knee: string, ankle: string, phase: number): void => {
    const s = Math.sin(phase * Math.PI * 2);
    const c = Math.cos(phase * Math.PI * 2);
    pose[knee].x += s * 3;
    pose[ankle].x += s * 6;
    pose[ankle].y -= Math.max(0, c) * 4; // the foot only lifts on its forward half
  };
  leg('kneeNear', 'ankleNear', p);
  leg('kneeFar', 'ankleFar', p + 0.5);

  // Arms counter-swing the legs — the cheapest cue that reads as walking rather than sliding.
  pose.elbowNear.x -= swing * 2;
  pose.handNear.x -= swing * 3.5;
  pose.elbowFar.x += swing * 2;
  pose.handFar.x += swing * 3.5;
  pose.handNear.y += lift * 1.5;
  pose.handFar.y -= lift * 1.5;
  return pose;
}
