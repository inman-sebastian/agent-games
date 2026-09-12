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
  /** Forward lean of the whole upper body, in px at the head. */
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

  // ---- part widths (radii, art px) ----
  rHead: number;
  rChest: number;
  rPelvis: number;
  rThigh: number;
  rShin: number;
  rUpperArm: number;
  rForearm: number;

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
  armOffset: 3,
  limbCap: 0.3,
  legOffset: 2.5,
  yAnkle: -2,
  yKnee: -10,
  yHip: -17,
  yWaist: -24,
  yShoulder: -31,
  yNeck: -33,
  yHeadTop: -46,
  yElbow: -24,
  yHand: -17,

  femur: 8,
  tibia: 8,
  humerus: 8,
  ulna: 8,
  kneeBend: -1,
  elbowBend: 1,

  stride: 10,
  footLift: 5,
  armSwing: 10,
  bob: 1.5,
  lean: 0,

  rHead: 6.4,
  rChest: 5.6,
  rPelvis: 5.2,
  rThigh: 5,
  rShin: 2.8,
  rUpperArm: 3.3,
  rForearm: 2.5,

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
