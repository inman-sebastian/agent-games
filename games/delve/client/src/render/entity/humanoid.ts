// humanoid.ts — ONE template over the generic rig: a side-on biped, at the decided character scale.
//
// Scale: 2 x 3 TILES = 32 x 48 art px (issue #47). Origin is the FEET at (0, 0) with y increasing
// downward, so a pose drops straight onto a ground contact point without an offset — which is what
// foot IK wants.
//
// PROPORTIONS ARE MEASURED, not estimated. The reference asset pack's idle frame is 48x48 but its
// FIGURE is only 29px tall (y 11..39) and 18px wide; the rest is headroom for animation overshoot.
// Per-part extents read off its colour-coded template, feet at 0: head 8x8 at y -28..-21; torso in
// two segments (chest -19..-14, pelvis -14..-9) 7-8px wide; shoulder -19, hip -11, knee -6, ankle
// -1; upper arm 4px wide, forearm 3px, thigh 6px, shin 3px. Scaled by 48/29 onto our height.
//
// The reference figure is ~1.8 tiles tall while DELVE committed to Terraria's 2x3, so this is the
// reference's PROPORTIONS at Terraria's SIZE.
//
// Every colour is Resurrect-64 (docs/PALETTE.md); each part carries a 6-stop ramp exactly like a
// stratum, so a character sits in the same tonal system as the rock it stands on.
//
// All tunables live in config.ts and are driven live by labs/entity-lab.html — they were module
// constants, which meant every silhouette guess cost a code edit, a commit and a screenshot.
import { clothSurface, plateSurface } from './limb';
import { band } from './part';
import { solveTwoBone } from './ik';
import { BUILDS, DEFAULT_CONFIG, type HumanoidConfig } from './config';
import type { Rig, Skeleton } from './rig';

export const HEIGHT = 48;

// ---- ramps (all Resurrect-64) ------------------------------------------------------------------
const CLOTH = ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff']; // blue overalls
const SKIN = ['#2e222f', '#694f62', '#966c6c', '#ab947a', '#cd683d', '#e6904e'];
const HELMET = ['#2e222f', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#f9c22b'];
const BOOT = ['#2e222f', '#3e3546', '#4c3e24', '#676633', '#a2a947', '#cddf6c'];

// ---- coded colours: the reference template's EXACT per-part colours -----------------------------
//
// Measured off the pack's idle frame, so a coded render of our rig can be diffed against a
// reference frame numerically rather than judged by eye. Not Resurrect-64 and not meant to be —
// these never ship, they're a measuring instrument.
const CODED = {
  head: [0x5f, 0xcd, 0xe4],
  chest: [0xdf, 0x71, 0x26],
  pelvis: [0xb3, 0x5b, 0x20],
  armFarU: [0x6a, 0xbe, 0x30],
  armFarL: [0x99, 0xe5, 0x50],
  armNearU: [0x95, 0x17, 0x99],
  armNearL: [0xaf, 0x1a, 0xb2],
  legFar: [0xd1, 0xcc, 0x60],
  legNearU: [0xce, 0x50, 0x50],
  legNearL: [0xac, 0x32, 0x32],
  foot: [0xfb, 0xf2, 0x36],
} as const satisfies Record<string, readonly [number, number, number]>;

/**
 * Build the rig for a config.
 *
 * Boots and the helmet are LAYERS rather than parts. The helmet was a part first and that failed
 * instructively: its segment came out 5px long, the shape's `alongScale` shrank it further, and it
 * rendered as a flat pancake on a blob. As a layer it inherits the head's shape and just claims the
 * top of its surface, which is what `along` is for.
 *
 * `order` is authored because a 2D rig has no z-buffer: far limbs, body, near limbs. The far side
 * also carries a negative `shadeBias`, which is how depth reads now that near and far sit at the
 * same x — the reference distinguishes them by colour rather than by position, which keeps the view
 * flat and head-on the way a platformer needs.
 */
export function buildHumanoid(cfg: HumanoidConfig = DEFAULT_CONFIG): Rig {
  const bootLayer = { id: 'boot', ramp: BOOT, shade: band(cfg.bootFrom, 1.12, plateSurface) };
  const helmetLayer = { id: 'helmet', ramp: HELMET, shade: band(cfg.helmetFrom, 1.1, plateSurface) };
  const far = cfg.farBias;
  const taper = 0.85;
  const b = BUILDS[cfg.build];
  // Torso segments are TALLER THAN WIDE on purpose. A bulb is an ellipse, so a segment that is
  // wider than it is tall reads unmistakably as a bust — the chest was 13px wide by 8px tall. The
  // reference's torso is blocky and uniform, which is why it reads as a torso; the closest thing
  // this shape vocabulary has is an ellipse elongated along the body.
  const torsoAlong = 1.5;
  return {
    parts: [
      // far side
      { id: 'armFar.upper', from: 'shoulderFar', to: 'elbowFar', shape: { kind: 'limb', rFrom: cfg.rUpperArm * b.limb, rTo: cfg.rUpperArm * b.limb * taper }, ramp: CLOTH, surface: clothSurface, order: 0, shadeBias: far, cap: cfg.limbCap, coded: [...CODED.armFarU] as [number, number, number] },
      { id: 'armFar.fore', from: 'elbowFar', to: 'handFar', shape: { kind: 'limb', rFrom: cfg.rForearm * b.limb, rTo: cfg.rForearm * b.limb * taper }, ramp: SKIN, surface: clothSurface, order: 0, shadeBias: far, cap: cfg.limbCap, coded: [...CODED.armFarL] as [number, number, number] },
      { id: 'legFar.thigh', from: 'hipFar', to: 'kneeFar', shape: { kind: 'limb', rFrom: cfg.rThigh * b.limb, rTo: cfg.rThigh * b.limb * taper }, ramp: CLOTH, surface: clothSurface, order: 1, shadeBias: far, cap: cfg.limbCap, coded: [...CODED.legFar] as [number, number, number] },
      { id: 'legFar.shin', from: 'kneeFar', to: 'ankleFar', shape: { kind: 'limb', rFrom: cfg.rShin * b.limb, rTo: cfg.rShin * b.limb * 0.72 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 1, shadeBias: far, cap: cfg.limbCap, coded: [...CODED.legFar] as [number, number, number] },

      // body — two torso segments, because one bulb has no waist and that is what read as "fat".
      // The chest runs waist→NECK rather than waist→shoulder: ending at the shoulder left a visible
      // gap between the torso and the head, which the coded view made obvious.
      { id: 'pelvis', from: 'hip', to: 'waist', shape: { kind: 'bulb', rAcross: cfg.rPelvis * b.pelvis, alongScale: torsoAlong }, ramp: CLOTH, surface: clothSurface, order: 2, coded: [...CODED.pelvis] as [number, number, number] },
      { id: 'chest', from: 'waist', to: 'neck', shape: { kind: 'bulb', rAcross: cfg.rChest * b.chest, alongScale: torsoAlong }, ramp: CLOTH, surface: clothSurface, order: 3, coded: [...CODED.chest] as [number, number, number] },
      { id: 'head', from: 'neck', to: 'headTop', shape: { kind: 'bulb', rAcross: cfg.rHead, alongScale: 1.0 }, ramp: SKIN, surface: clothSurface, layers: [helmetLayer], order: 4, shadeBias: cfg.headBias, coded: [...CODED.head] as [number, number, number] },

      // near side
      { id: 'legNear.thigh', from: 'hipNear', to: 'kneeNear', shape: { kind: 'limb', rFrom: cfg.rThigh * b.limb, rTo: cfg.rThigh * b.limb * taper }, ramp: CLOTH, surface: clothSurface, order: 5, cap: cfg.limbCap, coded: [...CODED.legNearU] as [number, number, number] },
      { id: 'legNear.shin', from: 'kneeNear', to: 'ankleNear', shape: { kind: 'limb', rFrom: cfg.rShin * b.limb, rTo: cfg.rShin * b.limb * 0.72 }, ramp: CLOTH, surface: clothSurface, layers: [bootLayer], order: 5, cap: cfg.limbCap, coded: [...CODED.legNearL] as [number, number, number] },
      { id: 'armNear.upper', from: 'shoulderNear', to: 'elbowNear', shape: { kind: 'limb', rFrom: cfg.rUpperArm * b.limb, rTo: cfg.rUpperArm * b.limb * taper }, ramp: CLOTH, surface: clothSurface, order: 6, cap: cfg.limbCap, coded: [...CODED.armNearU] as [number, number, number] },
      { id: 'armNear.fore', from: 'elbowNear', to: 'handNear', shape: { kind: 'limb', rFrom: cfg.rForearm * b.limb, rTo: cfg.rForearm * b.limb * taper }, ramp: SKIN, surface: clothSurface, order: 6, cap: cfg.limbCap, coded: [...CODED.armNearL] as [number, number, number] },
    ],
  };
}

/** The neutral standing pose. Everything else is a deviation from this. */
export function idlePose(cfg: HumanoidConfig = DEFAULT_CONFIG): Skeleton {
  // `lean` tilts the upper body forward, scaled by height above the hip, so the hip stays planted
  // and the head travels furthest — the reference's walk leans, and a stiff vertical spine is part
  // of what reads as lifeless.
  const t = (y: number): number =>
    cfg.lean === 0 ? 0 : (cfg.lean * (cfg.yHip - y)) / (cfg.yHip - cfg.yHeadTop);
  const off = cfg.armOffset * BUILDS[cfg.build].shoulder;
  const leg = cfg.legOffset;
  return {
    hip: { x: 0, y: cfg.yHip },
    waist: { x: t(cfg.yWaist), y: cfg.yWaist },
    shoulder: { x: t(cfg.yShoulder), y: cfg.yShoulder },
    neck: { x: t(cfg.yNeck), y: cfg.yNeck },
    headTop: { x: t(cfg.yHeadTop), y: cfg.yHeadTop },
    // Legs sit either side of centre for the same reason the arms do — stacked on the centreline,
    // the near thigh completely hides the pelvis behind it.
    hipNear: { x: leg, y: cfg.yHip },
    kneeNear: { x: leg, y: cfg.yKnee },
    ankleNear: { x: leg, y: cfg.yAnkle },
    hipFar: { x: -leg, y: cfg.yHip },
    kneeFar: { x: -leg, y: cfg.yKnee },
    ankleFar: { x: -leg, y: cfg.yAnkle },
    // Arms hang OUTBOARD. At x≈0 they sit inside a 13px-wide torso, which is why the coded view
    // showed the near arm covering the whole chest. `build.shoulder` narrows the stance slightly.
    shoulderNear: { x: t(cfg.yShoulder) + off, y: cfg.yShoulder },
    elbowNear: { x: t(cfg.yElbow) + off, y: cfg.yElbow },
    handNear: { x: t(cfg.yHand) + off, y: cfg.yHand },
    shoulderFar: { x: t(cfg.yShoulder) - off, y: cfg.yShoulder },
    elbowFar: { x: t(cfg.yElbow) - off, y: cfg.yElbow },
    handFar: { x: t(cfg.yHand) - off, y: cfg.yHand },
  };
}

/**
 * A walk pose at phase `p` (0..1), generated rather than keyframed — a gait is a function of time
 * and speed, which is what "all art is procedural" has to mean for animation as much as texture.
 *
 * The pose sets END EFFECTORS (feet, hands) and lets IK place the joints between. That is the
 * difference between a leg that bends and a rod that pivots: a knee's position is determined by the
 * hip, the foot and two fixed bone lengths, and is never a midpoint.
 */
export function walkPose(p: number, cfg: HumanoidConfig = DEFAULT_CONFIG): Skeleton {
  const pose = idlePose(cfg);
  const swing = Math.sin(p * Math.PI * 2);
  const bob = Math.abs(Math.sin(p * Math.PI * 2)) * cfg.bob;

  for (const joint of [
    'hip',
    'waist',
    'shoulder',
    'neck',
    'headTop',
    'shoulderNear',
    'shoulderFar',
  ] as const) {
    pose[joint].y += bob;
  }

  const leg = (hip: string, knee: string, ankle: string, phase: number): void => {
    const s = Math.sin(phase * Math.PI * 2);
    const c = Math.cos(phase * Math.PI * 2);
    pose[ankle].x = pose[hip].x + s * (cfg.stride / 2);
    pose[ankle].y = cfg.yAnkle - Math.max(0, c) * cfg.footLift; // lifts only on its forward half
    pose[knee] = solveTwoBone(pose[hip], pose[ankle], cfg.femur, cfg.tibia, cfg.kneeBend);
  };
  leg('hipNear', 'kneeNear', 'ankleNear', p);
  leg('hipFar', 'kneeFar', 'ankleFar', p + 0.5);

  const arm = (shoulder: string, elbow: string, hand: string, dir: number): void => {
    pose[hand].x = pose[shoulder].x - dir * swing * (cfg.armSwing / 2);
    pose[hand].y = cfg.yHand;
    pose[elbow] = solveTwoBone(pose[shoulder], pose[hand], cfg.humerus, cfg.ulna, cfg.elbowBend);
  };
  arm('shoulderNear', 'elbowNear', 'handNear', 1);
  arm('shoulderFar', 'elbowFar', 'handFar', -1);
  return pose;
}

/** The rig at default config, for callers that don't tune. */
export const HUMANOID = buildHumanoid();
