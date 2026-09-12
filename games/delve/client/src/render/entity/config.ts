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
  //
  // JOINT HEIGHTS ARE DERIVED, NOT TUNED. Each one is placed so its part's bone spans exactly the
  // number of reference rows that part's width profile was measured from (see `PROFILE` in
  // humanoid.ts): leg 6 + 4 + 2, arm 5 + 5, torso 6 + 6, head 8. That is what lets an authored
  // profile land on the pixels it came from, and it is why there is nothing to search here any more.
  yAnkle: number;
  yKnee: number;
  yHip: number;
  yWaist: number;
  yShoulder: number;
  yNeck: number;
  yHeadTop: number;
  yElbow: number;
  yHand: number;

  // ---- bone lengths (POSITIVE; slack for the IK to bend into comes from `stretch`) ----
  femur: number;
  tibia: number;
  humerus: number;
  ulna: number;
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
   * Fraction of the cycle each foot spends PLANTED. Above 0.5 the two overlap, giving double
   * support — both feet down at once.
   *
   * The textbook walk figure is 0.62, which gives 24% double support. The reference is far more
   * stylised than that: four of its eight frames have both feet flat on the ground at full spread,
   * so half its cycle is double support. Ours planted one foot at the widest stance, and the
   * whole-figure walk profile caught it as a 2px bottom row against the reference's 16.
   */
  duty: number;

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
   * How far each ANKLE sits outboard of its own hip — near foot forward, far foot back.
   *
   * This is the angle. The reference's idle sweeps each limb diagonally across the body: its near
   * leg runs 4.5px forward from hip to foot over 11 rows, its far leg 3.5px back. Ours hung both
   * legs vertically, and a limb drawn as a vertical slab instead of a diagonal stroke is most of
   * why the figure read as a mannequin rather than a person. Bounding-box measurements cannot see
   * this at all, which is how it survived five rounds of tuning.
   */
  stanceSplay: number;
  /**
   * The same, for the far side — and it is NOT the mirror of the near side, on either limb pair.
   *
   * A standing figure is not symmetric about its own depth axis: the reference's near leg runs 4.5px
   * forward while its far leg runs only 3.5px back, and its arms go the other way round, 2.5px on
   * the near side against 4px on the far. Mirroring one value made the far arm's angle the single
   * worst number on the board while every other part was already inside a pixel.
   */
  stanceSplayFar: number;
  handSplayFar: number;

  /**
   * What share of the leg's splay the KNEE takes, and the ARM's the elbow. Both read straight off
   * the reference's per-row centre drift, and they go opposite ways.
   *
   * Its leg drifts barely at all for four rows then accelerates: the thigh hangs near-vertical and
   * the shin swings forward, so the knee takes only about a fifth of the splay despite being
   * halfway down. Its arm is the reverse — all the drift happens above the elbow and the forearm
   * hangs almost straight, so the elbow overshoots the hand. Placing both joints proportionally
   * gave two straight angled sticks instead of two bent limbs.
   */
  kneeLead: number;
  elbowLead: number;

  /**
   * How far the legs sit either side of the body centreline.
   *
   * Same problem the arms had: a 10px-wide near thigh at x=0 completely covers a 9.6px-wide pelvis,
   * so the torso looked tiny when it was merely hidden. The reference offsets its near leg to one
   * side of the pelvis rather than stacking them.
   */
  legOffset: number;

  /**
   * Overall thickness multiplier over the authored width profiles (see `PROFILE` in humanoid.ts).
   *
   * This replaced nine per-part radii plus a cap fraction and two far-narrowing factors. Those
   * existed to make a smooth capsule approximate a hand-drawn staircase, and hand-searching that
   * coupled space is what stalled the silhouette for five rounds. The profiles are the reference's
   * own measured widths, so there is nothing left to fit — only one knob for building bigger or
   * slimmer characters off the same template.
   */
  girth: number;

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
  /**
   * How far the toe sits ahead of the ankle.
   *
   * Small, because the reference's IDLE has no foot nub at all — its leg simply continues at 3px to
   * the ground. A longer foot showed up in the row profile as the bottom rows widening to 5 against
   * the reference's 3. The foot exists for the walk, where the pack does colour it separately, and
   * to give foot IK something to plant.
   */
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
  armOffset: 5,
  legOffset: 6.4,
  stanceSplay: 5.2, // ref 4.5 forward
  stanceSplayFar: 4, // ref 3.5 back
  handSplayFar: 2.8, // ref 4.0 back
  kneeLead: 0.32,
  elbowLead: 1.28,
  handSplay: 4, // ref 2.5 forward
  torsoDrop: 4.5,

  // Every joint here is a reference row x 48/29 — see the note on the interface. Nothing estimated.
  yAnkle: -4.1, // ref -2.5
  yKnee: -10.8, // ref -6.5
  yHip: -19.9, // ref -12
  yWaist: -24.8, // ref -15
  yShoulder: -33.1, // ref -20
  yNeck: -34.8, // ref -21 — one row above the shoulder, the reference's own neck gap
  yHeadTop: -47.5, // ref -29; the span is 12 not 13.2 because a stroke draws bone + 1 rows and the
  //                 head, unlike every other part, shares a boundary row with nothing above it
  yElbow: -25.7, // ref -15.5
  yHand: -18.2, // ref -11

  // Each bone slightly overshoots its joint span, so the chain has somewhere to bend. With no slack
  // the joint might as well not exist, which is how the arms read when humerus + ulna summed exactly
  // to the shoulder-to-hand distance: a pair of stiff diagonal bars.
  femur: 9.6,
  tibia: 7.1,
  humerus: 7.9,
  ulna: 7.9,
  kneeBend: 1,
  elbowBend: 1,

  // Gait, also measured — with one correction that mattered. The reference's planted foot travels
  // 13px across the 8-frame walk, but that is travel across the FRAME: 7 of those 13 are the static
  // hip offset (the hips sit 3.5px either side of the centreline) and more comes from its foot
  // ROTATING through toe-off. The ankle's own swing about its own hip is about +-4px, so a stride
  // read straight off the foot travel is roughly double what it should be — which is what turned our
  // walk into a pair of straight-legged splits, the IK straightening because the target was out of
  // reach on every frame.
  stride: 17,
  // footLift and armSwing are MEASURED, never fitted: a width profile barely changes when a foot
  // lifts or an arm swings, so the fit drives both to zero and calls it an improvement. A walk with
  // a dragging foot and dead arms is wrong whatever the silhouette number says.
  footLift: 3.3, // ref 2
  armSwing: 10,
  bob: 2.5,
  stretch: 1.2,
  duty: 0.84,
  lean: -2.8,

  footLen: 2.5,
  footDrop: 0.5,

  girth: 1.01,

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
