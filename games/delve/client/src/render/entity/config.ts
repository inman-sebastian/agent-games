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

export const DEFAULT_CONFIG: HumanoidConfig = {
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

  rHead: 6.5,
  rChest: 6.5,
  rPelvis: 5.4,
  rThigh: 5.2,
  rShin: 4.4,
  rUpperArm: 3.4,
  rForearm: 2.7,

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
