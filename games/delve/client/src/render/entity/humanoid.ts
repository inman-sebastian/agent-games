// humanoid.ts — ONE template over the generic rig: a side-on biped, at the decided character scale.
//
// Scale: 2 x 3 TILES = 32 x 48 art px (issue #47). Origin is the FEET at (0, 0) with y increasing
// downward, so a pose drops straight onto a ground contact point without an offset — which is what
// foot IK wants.
//
// EVERY PROPORTION HERE IS MEASURED, none estimated. The reference pack ships its idle and walk as
// layered .aseprite files, one layer per body part (Head / Torso / Front Arm / Back Arm / Front Leg
// / Back Leg), so each part's exact pixel extent is readable rather than guessable. Read off the
// idle frame with feet at 0, in reference px:
//
//   head      rows -29..-22, 8 wide (an octagon: 4/6/8/8/8/8/6/4)
//   (a 1-row GAP at -21 — the reference deliberately detaches the head from the torso)
//   torso     rows -20..-10, 7 wide at the shoulder, pinching to 5 at -15, flaring to 7 at -13
//   arms      rows -20..-11, 4 wide at the upper arm, 3 at the forearm
//   legs      rows -12..-1: thigh 5-6 wide to about -8, shin 3-4 to -4, foot 3 wide and offset
//             1-2px forward
//   limb centres sit +-3.5px either side of the torso centreline, arms and legs alike
//
// Walk sheet, same method: the planted foot travels 13px across 8 frames, lifts 2px on its swing,
// and the torso bobs 2 rows. The reference figure is 29px tall, ours is 48 by decision, so every
// number above is scaled by 48/29 ~= 1.655 — the reference's PROPORTIONS at Terraria's SIZE.
//
// Two shape choices fall out of those measurements and are load-bearing:
//
//   * The TORSO IS A CAPSULE, not stacked ellipses. The reference torso is a near-uniform 7px column
//     with a waist pinch, and an ellipse cannot be that — it is widest at its middle and vanishes at
//     both ends, which is exactly why two stacked bulbs read as a bust with an hourglass join. A
//     tapered capsule holds its width along the bone, so rFrom/rTo give the chest-waist-hip profile
//     directly.
//   * The FEET ARE PARTS. The figure's widest row is its feet, and a shin capsule ending at the
//     ankle leaves the silhouette blunt. They also give foot IK an actual thing to plant.
//
// Every colour is Resurrect-64 (docs/PALETTE.md); each part carries a 6-stop ramp exactly like a
// stratum, so a character sits in the same tonal system as the rock it stands on.
//
// All tunables live in config.ts and are driven live by labs/rig-lab.html — they were module
// constants, which meant every silhouette guess cost a code edit, a commit and a screenshot.
import { clothSurface, plateSurface } from './limb';
import { band } from './part';
import { solveTwoBone } from './ik';
import { BUILDS, DEFAULT_CONFIG, type HumanoidConfig } from './config';
import type { PartShape } from './part';
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
export const CODED = {
  head: [0x5f, 0xcd, 0xe4],
  chest: [0xdf, 0x71, 0x26],
  pelvis: [0xb3, 0x5b, 0x20],
  armNearU: [0x6a, 0xbe, 0x30],
  armNearL: [0x99, 0xe5, 0x50],
  armFarU: [0x95, 0x17, 0x99],
  armFarL: [0xaf, 0x1a, 0xb2],
  legFar: [0xd1, 0xcc, 0x60],
  legNearU: [0xce, 0x50, 0x50],
  legNearL: [0xac, 0x32, 0x32],
  foot: [0xfb, 0xf2, 0x36],
  // The pack gives both feet one colour; the measurement needs them distinguishable, so the far
  // foot gets a darkened variant. Measurement-only, like the rest of this table.
  footFar: [0xbe, 0xb8, 0x1a],
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
 * also carries a negative `shadeBias`: the reference separates its near and far limbs by VALUE more
 * than by position, which is what keeps the view flat and head-on the way a platformer needs.
 */
export function buildHumanoid(cfg: HumanoidConfig = DEFAULT_CONFIG): Rig {
  const bootLayer = { id: 'boot', ramp: BOOT, shade: band(cfg.bootFrom, 1.12, plateSurface) };
  const helmetLayer = {
    id: 'helmet',
    ramp: HELMET,
    shade: band(cfg.helmetFrom, 1.1, plateSurface),
  };
  const far = cfg.farBias;
  const b = BUILDS[cfg.build];
  const cap = cfg.limbCap;
  const cloth = { ramp: CLOTH, surface: clothSurface } as const;
  const skin = { ramp: SKIN, surface: clothSurface } as const;
  const limb = (rFrom: number, rTo: number): PartShape => ({ kind: 'limb', rFrom, rTo });
  const coded = (c: readonly [number, number, number]): [number, number, number] => [...c];

  // Limbs hold a near-uniform width in the reference and get their rounded ends from the capsule
  // caps, so rFrom and rTo differ only where the reference actually tapers: shin toward the ankle,
  // thigh toward the knee.
  return {
    parts: [
      // ---- far side ----
      {
        id: 'armFar.upper',
        from: 'shoulderFar',
        to: 'elbowFar',
        shape: limb(cfg.rUpperArm * b.limb, cfg.rUpperArm * b.limb),
        ...cloth,
        order: 0,
        shadeBias: far,
        cap,
        coded: coded(CODED.armFarU),
      },
      {
        id: 'armFar.fore',
        from: 'elbowFar',
        to: 'handFar',
        shape: limb(cfg.rForearm * b.limb, cfg.rForearm * b.limb),
        ...skin,
        order: 0,
        shadeBias: far,
        cap,
        coded: coded(CODED.armFarL),
      },
      {
        id: 'legFar.thigh',
        from: 'hipFar',
        to: 'kneeFar',
        shape: limb(cfg.rThigh * b.limb, cfg.rThigh * b.limb * 0.82),
        ...cloth,
        order: 1,
        shadeBias: far,
        cap,
        coded: coded(CODED.legFar),
      },
      {
        id: 'legFar.shin',
        from: 'kneeFar',
        to: 'ankleFar',
        shape: limb(cfg.rShin * b.limb, cfg.rShin * b.limb * 0.82),
        ...cloth,
        layers: [bootLayer],
        order: 1,
        shadeBias: far,
        cap,
        coded: coded(CODED.legFar),
      },
      {
        id: 'legFar.foot',
        from: 'ankleFar',
        to: 'toeFar',
        shape: limb(cfg.rFoot * b.limb, cfg.rFoot * b.limb),
        ramp: BOOT,
        surface: plateSurface,
        order: 1,
        shadeBias: far,
        cap,
        coded: coded(CODED.footFar),
      },

      // ---- body ----
      // Two capsules, hip → waist → shoulder, so the reference's pinch reads as a waist. The chest
      // stops at the SHOULDER and the head starts at the NECK one pixel above it: that 1px gap is
      // the reference's own, not an accident, and closing it is what made the neck look swollen.
      {
        id: 'pelvis',
        from: 'crotch',
        to: 'waist',
        shape: limb(cfg.rPelvis * b.pelvis, cfg.rWaist * b.pelvis),
        ...cloth,
        order: 2,
        cap,
        coded: coded(CODED.pelvis),
      },
      {
        id: 'chest',
        from: 'waist',
        to: 'shoulder',
        shape: limb(cfg.rWaist * b.chest, cfg.rChest * b.chest),
        ...cloth,
        order: 3,
        cap,
        coded: coded(CODED.chest),
      },
      {
        id: 'head',
        from: 'neck',
        to: 'headTop',
        shape: { kind: 'bulb', rAcross: cfg.rHead, alongScale: 1 },
        ...skin,
        layers: [helmetLayer],
        order: 4,
        shadeBias: cfg.headBias,
        coded: coded(CODED.head),
      },

      // ---- near side ----
      {
        id: 'legNear.thigh',
        from: 'hipNear',
        to: 'kneeNear',
        shape: limb(cfg.rThigh * b.limb, cfg.rThigh * b.limb * 0.82),
        ...cloth,
        order: 5,
        cap,
        coded: coded(CODED.legNearU),
      },
      {
        id: 'legNear.shin',
        from: 'kneeNear',
        to: 'ankleNear',
        shape: limb(cfg.rShin * b.limb, cfg.rShin * b.limb * 0.82),
        ...cloth,
        layers: [bootLayer],
        order: 5,
        cap,
        coded: coded(CODED.legNearL),
      },
      {
        id: 'legNear.foot',
        from: 'ankleNear',
        to: 'toeNear',
        shape: limb(cfg.rFoot * b.limb, cfg.rFoot * b.limb),
        ramp: BOOT,
        surface: plateSurface,
        order: 5,
        cap,
        coded: coded(CODED.foot),
      },
      {
        id: 'armNear.upper',
        from: 'shoulderNear',
        to: 'elbowNear',
        shape: limb(cfg.rUpperArm * b.limb, cfg.rUpperArm * b.limb),
        ...cloth,
        order: 6,
        cap,
        coded: coded(CODED.armNearU),
      },
      {
        id: 'armNear.fore',
        from: 'elbowNear',
        to: 'handNear',
        shape: limb(cfg.rForearm * b.limb, cfg.rForearm * b.limb),
        ...skin,
        order: 6,
        cap,
        coded: coded(CODED.armNearL),
      },
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
  // Hands hang wider than shoulders: the reference's back hand sits 6.5 reference px off the
  // centreline against the shoulder's 3.5, which is most of why its figure measures 18px wide.
  const hand = off + cfg.handSplay;
  const leg = cfg.legOffset;
  return {
    hip: { x: 0, y: cfg.yHip },
    // The reference torso reaches two rows BELOW the hip, overlapping the top of the legs. A pelvis
    // anchored at the hip joint cannot get there, so it hangs off its own joint.
    crotch: { x: 0, y: cfg.yHip + cfg.torsoDrop },
    waist: { x: t(cfg.yWaist), y: cfg.yWaist },
    shoulder: { x: t(cfg.yShoulder), y: cfg.yShoulder },
    neck: { x: t(cfg.yNeck), y: cfg.yNeck },
    headTop: { x: t(cfg.yHeadTop), y: cfg.yHeadTop },
    // Limbs sit +-3.5 reference px either side of the centreline — measured, not chosen. Stacked on
    // the centreline the near thigh completely hides the pelvis and the near arm covers the chest.
    hipNear: { x: leg, y: cfg.yHip },
    kneeNear: { x: leg, y: cfg.yKnee },
    ankleNear: { x: leg, y: cfg.yAnkle },
    toeNear: { x: leg + cfg.footLen, y: cfg.yAnkle + cfg.footDrop },
    hipFar: { x: -leg, y: cfg.yHip },
    kneeFar: { x: -leg, y: cfg.yKnee },
    ankleFar: { x: -leg, y: cfg.yAnkle },
    // At rest the reference splays its feet — near toe forward, far toe back. The walk pose
    // overrides both to point along the direction of travel.
    toeFar: { x: -leg - cfg.footLen, y: cfg.yAnkle + cfg.footDrop },
    shoulderNear: { x: t(cfg.yShoulder) + off, y: cfg.yShoulder },
    elbowNear: { x: t(cfg.yElbow) + off, y: cfg.yElbow },
    handNear: { x: t(cfg.yHand) + hand, y: cfg.yHand },
    shoulderFar: { x: t(cfg.yShoulder) - off, y: cfg.yShoulder },
    elbowFar: { x: t(cfg.yElbow) - off, y: cfg.yElbow },
    handFar: { x: t(cfg.yHand) - hand, y: cfg.yHand },
  };
}

/**
 * The walk cycle, as a small authored track rather than a sinusoid.
 *
 * WHY NOT IK-DRIVEN. The first version swung each ankle on a sine about its hip and let IK place the
 * knee. Two things were wrong with that, and both showed. A sine has no stance phase, so the planted
 * foot slid backwards and forwards under the body instead of staying put — the classic ice-skating
 * walk. And the sine's extremes asked for ankle positions outside the leg's reach on most frames, so
 * the solver straightened the leg every time and the whole gait read as a pair of stiff splits.
 *
 * WHY NOT A TRACED TRACE. The pack ships its walk as layered frames, so tracing its per-frame ankle
 * positions looked like the obvious answer. It isn't: read frame by frame, its "Front Leg" layer
 * holds a foot that travels FORWARD across four consecutive frames while still touching the ground,
 * which cannot happen to a planted foot in an in-place cycle. The layer assignment swaps at the
 * passing frames, where the two legs overlap and it makes no visual difference. So the pack can't be
 * traced joint-for-joint, but its AMPLITUDES are solid, and those are what carry the read.
 *
 * WHAT THIS IS, THEN: the standard four-beat walk — contact, mid-stance, toe-off, swing — at the
 * pack's measured amplitudes. The stance foot is pinned to the ground and travels backward at a
 * constant rate, which is what stops the slide; the swing foot returns on an arc. IK's job shrinks
 * to what it is actually good at: solving the knee and elbow from end effectors, and later fitting
 * the foot to drawn ground.
 */
const DUTY = 0.62; // fraction of the cycle a foot spends planted — the textbook walk figure

/**
 * Where one ankle sits at cycle phase `p` (0..1): `x` relative to that leg's REST hip x, `y` in
 * figure space (so 0 is the ground line).
 *
 * Deliberately not relative to the live hip. The hip bobs, and an ankle that tracked it would ride
 * the bob down into the floor and back out again on every step — the planted foot's whole job is to
 * stay where the world put it while the body moves over it.
 */
function anklePath(p: number, cfg: HumanoidConfig): { x: number; y: number } {
  const phase = p - Math.floor(p);
  const half = cfg.stride / 2;
  if (phase < DUTY) {
    // Stance: planted. Relative to the advancing body the foot travels backward at a CONSTANT rate.
    // Constant is the whole point — any easing in here is a foot sliding along the ground.
    return { x: half - (phase / DUTY) * cfg.stride, y: cfg.yAnkle };
  }
  // Swing: back to the front, lifting on an arc through the middle.
  const t = (phase - DUTY) / (1 - DUTY);
  return { x: -half + t * cfg.stride, y: cfg.yAnkle - Math.sin(t * Math.PI) * cfg.footLift };
}

/**
 * A walk pose at phase `p` (0..1), generated rather than keyframed frame-by-frame — a gait is a
 * function of time and speed, which is what "all art is procedural" has to mean for animation as
 * much as for texture.
 *
 * The pose sets END EFFECTORS (feet, hands) and lets IK place the joints between. That is the
 * difference between a leg that bends and a rod that pivots: a knee's position is determined by the
 * hip, the foot and two bone lengths, and is never a midpoint.
 */
export function walkPose(p: number, cfg: HumanoidConfig = DEFAULT_CONFIG): Skeleton {
  const pose = idlePose(cfg);
  const rest = idlePose(cfg); // unbobbed, so planted feet can be placed in world space
  // Two bobs per cycle, lowest at each contact — measured at 1 reference px either way.
  const bob = -Math.cos(p * Math.PI * 4) * (cfg.bob / 2);

  for (const joint of [
    'hip',
    'crotch',
    'waist',
    'shoulder',
    'neck',
    'headTop',
    'shoulderNear',
    'shoulderFar',
  ] as const) {
    pose[joint].y += bob;
  }

  const leg = (hip: string, knee: string, ankle: string, toe: string, phase: number): void => {
    const path = anklePath(phase, cfg);
    pose[ankle].x = rest[hip].x + path.x;
    pose[ankle].y = path.y;
    pose[knee] = solveTwoBone(
      pose[hip],
      pose[ankle],
      cfg.femur,
      cfg.tibia,
      cfg.kneeBend,
      cfg.stretch,
    );
    // The foot rides the ankle rigidly for now. Rolling it through the step (heel strike, toe-off)
    // is the same end-effector trick one level down, and belongs with the ground probe.
    pose[toe] = { x: pose[ankle].x + cfg.footLen, y: pose[ankle].y + cfg.footDrop };
  };
  leg('hipNear', 'kneeNear', 'ankleNear', 'toeNear', p);
  leg('hipFar', 'kneeFar', 'ankleFar', 'toeFar', p + 0.5);

  // Arms counter-swing the legs: the hand opposes the ankle on the same side, which is what a real
  // gait does to cancel the torso's rotation. Amplitude is its own knob because the pack's arm
  // layers are too noisy to measure — one of them is empty on a frame where the arm hides behind
  // the torso.
  const arm = (
    shoulder: string,
    elbow: string,
    hand: string,
    phase: number,
    rest: number,
  ): void => {
    const swing = anklePath(phase + 0.5, cfg).x / (cfg.stride || 1);
    pose[hand].x = pose[shoulder].x + rest + swing * cfg.armSwing;
    pose[hand].y = cfg.yHand + bob * 0.5;
    pose[elbow] = solveTwoBone(
      pose[shoulder],
      pose[hand],
      cfg.humerus,
      cfg.ulna,
      cfg.elbowBend,
      cfg.stretch,
    );
  };
  const splay = cfg.handSplay;
  arm('shoulderNear', 'elbowNear', 'handNear', p, splay);
  arm('shoulderFar', 'elbowFar', 'handFar', p + 0.5, -splay);
  return pose;
}

/** The rig at default config, for callers that don't tune. */
export const HUMANOID = buildHumanoid();
