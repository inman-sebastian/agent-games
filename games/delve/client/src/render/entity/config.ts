// config.ts — every tunable of the humanoid template, in one place, so the lab can drive them live.
//
// These were module constants, which meant tuning the silhouette cost a code edit, a commit and a
// screenshot per guess. That loop ran eight times in one session without converging — the values
// need to be dialled against a moving figure, not reasoned about. So they're a config object now,
// `humanoid.ts` takes one, and `labs/entity-lab.html` binds sliders to it.
//
// DEFAULTS are the measured-and-then-tuned values; the lab's "copy TS" button emits a replacement
// for this block so a dialled-in figure lands back in the repo rather than staying in a browser tab.

export interface HumanoidConfig {
  // ---- skeleton (art px, feet at y = 0, up is negative) ----
  yAnkle: number;
  yKnee: number;
  yHip: number;
  yWaist: number;
  yShoulder: number;
  yNeck: number;
  yHeadTop: number;
  yElbow: number;
  yHand: number;

  // ---- bone lengths (POSITIVE; must sum slightly above the span they cover — see humanoid.ts) ----
  femur: number;
  tibia: number;
  humerus: number;
  ulna: number;
  /** Knee bend direction. Elbows take the opposite. */
  kneeBend: 1 | -1;
  elbowBend: 1 | -1;

  // ---- gait ----
  stride: number;
  footLift: number;
  armSwing: number;
  bob: number;
  /** How far a limb may stretch past its bone length to reach an end effector (1 = not at all). */
  stretch: number;

  /**
   * Tilt of the whole upper body, in px of x travel at the head, interpolated down to 0 at the hip.
   *
   * NEGATIVE leans BACK, which is what the reference does: its head sits 2.5 reference px behind its
   * hip and its shoulders 1.5 behind. Reading that off the art as a FORWARD lean was wrong, and only
   * measuring settled it. The value is set so the HEAD'S CENTRE lands 2.5px back, not its crown —
   * measuring at the crown put the head visibly off the shoulders.
   */
  lean: number;

  /**
   * Base body build. The reference pack ships ONE androgynous template, so this is ours, not
   * borrowed: a pair of proportion multipliers over the same rig and the same parts.
   *
   * Kept as a multiplier set rather than two hand-tuned skeletons so proportions live in exactly
   * one place, and so equipment authored against surface coordinates keeps fitting either build
   * without per-build art.
   */
  build: BodyBuild;

  /**
   * How far the arms hang OUTBOARD of the body centreline.
   *
   * Near and far limbs otherwise sit at x=0 (the flat side-on view), which buries them inside a
   * 13px-wide torso — the coded view showed the near arm covering the whole chest.
   */
  armOffset: number;

  /**
   * How far limb end caps extend past their joints, as a fraction of the radius (see `Limb.cap`).
   *
   * The single most load-bearing silhouette value: a capsule draws `bone + 2 * radius` long, so at
   * 1 the legs are longer than the torso regardless of what the bone lengths say.
   */
  limbCap: number;

  /**
   * How far the legs sit either side of the body centreline.
   *
   * Same problem the arms had: a 10px-wide near thigh at x=0 completely covers a 9.6px-wide pelvis,
   * so the torso looked tiny when it was merely hidden. The reference offsets its near leg to one
   * side of the pelvis rather than stacking them.
   */
  legOffset: number;

  // ---- part widths (radii, art px; every one measured off the reference — see humanoid.ts) ----
  rHead: number;
  /** Torso at the shoulder — its widest point. */
  rChest: number;
  /** Torso at its narrowest. The reference torso pinches mid-way, which is what reads as a waist. */
  rWaist: number;
  /** Torso at the hip. */
  rPelvis: number;
  rThigh: number;
  rShin: number;
  rUpperArm: number;
  rForearm: number;
  rFoot: number;

  /**
   * How far the hand sits outboard of the shoulder, on top of `armOffset`. Measured at 2.5 reference
   * px on the reference's idle.
   *
   * It also caps how bent the arm can be: push the hand far enough out and the shoulder-to-hand
   * distance meets the bone reach, at which point the elbow straightens and the arm reads as a
   * diagonal bar rather than a limb.
   */
  handSplay: number;
  /** How far the pelvis hangs below the hip joint, so the torso overlaps the legs as the reference's does. */
  torsoDrop: number;

  // ---- foot ----
  /** How far the toe sits ahead of the ankle. The reference's foot is a small nub, offset forward. */
  footLen: number;
  /** How far the toe sits below the ankle, so the sole reads flat rather than pointed. */
  footDrop: number;

  // ---- shading ----
  /** How far a part's rim darkens toward its silhouette. Small parts need this small. */
  rimDarken: number;
  /** Far-side limbs sit this much darker, which is how depth reads without an x offset. */
  farBias: number;
  /** Lift on the head, because a big round bulb has a lot of rim. */
  headBias: number;
  /** Where the helmet starts on the head's surface (0 = neck, 1 = crown). */
  helmetFrom: number;
  /** Where the boot starts on the shin's surface. */
  bootFrom: number;
}

export type BodyBuild = 'male' | 'female';

/**
 * Proportion multipliers per build, applied to the measured base widths in `buildHumanoid`.
 *
 * Deliberately small deltas: the silhouette should read as the same body plan, not two species.
 * Male takes the V-taper (chest wider than hips), female the inverse, with slightly finer limbs.
 */
export const BUILDS: Record<
  BodyBuild,
  { chest: number; pelvis: number; limb: number; shoulder: number }
> = {
  male: { chest: 1.0, pelvis: 0.92, limb: 1.0, shoulder: 1.0 },
  female: { chest: 0.9, pelvis: 1.02, limb: 0.93, shoulder: 0.92 },
};

export const DEFAULT_CONFIG: HumanoidConfig = {
  build: 'male',
  armOffset: 6.2,
  limbCap: 0.25,
  legOffset: 5.8,
  handSplay: 4,
  torsoDrop: 1,

  // Joints: the reference's own joint rows, scaled by 48/29, and nothing here is estimated. They sit
  // INSIDE the drawn shape: a capsule's end cap overshoots its joint by cap x radius, so
  // every one of these is the reference's measured extent pulled in by that overshoot.
  yAnkle: -3,
  yKnee: -10.5,
  yHip: -18,
  yWaist: -24,
  yShoulder: -31,
  yNeck: -34,
  yHeadTop: -47.5,
  yElbow: -25,
  yHand: -19,

  // Each bone pair must OVERSHOOT the joint span it covers. With no slack the chain is permanently
  // straight and the joint might as well not exist — which is exactly how the arms read when the
  // humerus and ulna summed to the shoulder-to-hand distance, a pair of stiff diagonal bars.
  femur: 8,
  tibia: 8,
  humerus: 8,
  ulna: 7,
  kneeBend: -1,
  elbowBend: 1,

  // Gait, also measured — with one correction that mattered. The reference's planted foot travels
  // 13px across the 8-frame walk, but that is travel across the FRAME: 7 of those 13 are the static
  // hip offset (the hips sit 3.5px either side of the centreline) and more comes from its foot
  // ROTATING through toe-off. The ankle's own swing about its own hip is about +-4px, so a stride
  // read straight off the foot travel is roughly double what it should be — which is what turned our
  // walk into a pair of straight-legged splits, the IK straightening because the target was out of
  // reach on every frame.
  stride: 22,
  footLift: 3.3,
  armSwing: 7,
  bob: 3.3,
  stretch: 1.2,
  lean: -3.2,

  rHead: 6.8,
  rChest: 6.7,
  rWaist: 5,
  rPelvis: 6,
  rThigh: 4.6,
  rShin: 3.3,
  rUpperArm: 3.2,
  rForearm: 2.8,
  rFoot: 3,
  footLen: 5,
  footDrop: 0,

  rimDarken: 0.14,
  farBias: -0.28,
  headBias: 0.16,
  helmetFrom: 0.42,
  bootFrom: 0.72,
};

/** Emit a config as pasteable TypeScript, so lab tuning can land back in this file. */
export function configToTS(cfg: HumanoidConfig): string {
  const keys = Object.keys(DEFAULT_CONFIG) as (keyof HumanoidConfig)[];
  const body = keys.map((k) => `  ${k}: ${JSON.stringify(cfg[k])},`).join('\n');
  return `export const DEFAULT_CONFIG: HumanoidConfig = {\n${body}\n};`;
}
