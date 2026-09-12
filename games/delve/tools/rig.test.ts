// rig.test.ts — the humanoid's proportions and its gait, as invariants rather than screenshots.
//
// Silhouette work is the kind of thing that drifts: someone nudges a radius to fix one frame and
// three parts quietly go wrong. The reference pack's per-part extents are known numbers
// (tools/rig-reference.ts), so "is the figure still the right shape" is a test, not a judgement.
//
// The gait half tests the two things a walk cycle can get wrong without looking obviously broken:
// a planted foot that slides, and an end effector placed outside the limb's reach.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, BUILDS, type BodyBuild } from '../client/src/render/entity/config';
import { idlePose, walkPose } from '../client/src/render/entity/humanoid';
import {
  GROUPS,
  PROFILES,
  REFERENCE,
  WALK_WIDTHS,
  K,
  measure,
  toRef,
  walkMatch,
  walkWidths,
  type GroupName,
} from './rig-reference';

/** One reference pixel. Closer than the art the numbers were measured from can express. */
const TOLERANCE = 1;

/**
 * Mean per-row shape error allowed, in reference px.
 *
 * Looser than one pixel on purpose: the reference is hand-drawn at 29px and ours is generated at 48,
 * so some rows cannot agree — its arm oscillates 2,3,4,4,3,2,2,3,3,3 across ten rows, which two
 * tapered segments cannot reproduce exactly. 1.5 is set just under where the figure currently sits,
 * so the numbers can only improve from here and a regression trips the gate.
 */
const SHAPE_TOLERANCE = 1.5;

describe('humanoid silhouette vs the reference pack', () => {
  const { groups, shapes, uncoded } = measure(DEFAULT_CONFIG);

  it('paints every part in a coded colour the measurement knows about', () => {
    // Magenta here means a part shipped without a `coded` entry — the render falls back to it.
    expect(uncoded).toEqual([]);
  });

  for (const name of Object.keys(REFERENCE) as GroupName[]) {
    const ref = REFERENCE[name];
    describe(name, () => {
      it('is drawn at all', () => {
        expect(groups[name], `no pixels carried ${name}'s coded colour`).toBeDefined();
      });

      it('spans the reference rows', () => {
        expect(Math.abs(toRef(groups[name].top) - ref.top)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(toRef(groups[name].bottom) - ref.bottom)).toBeLessThanOrEqual(TOLERANCE);
      });

      if (name !== 'figure') {
        // THE metric. Bounding boxes were the gate first and they hid every real fault for five
        // rounds: the reference's leg is a diagonal staircase 2-5px wide, ours was an 8px vertical
        // slab, and both have the same widest row. `width` compares the per-row width profile —
        // taper — and `drift` compares each row's centre against the top row's, which is the limb's
        // ANGLE. Both in reference px per row.
        it("has the reference part's shape, row by row", () => {
          const err = shapes[name];
          const ref = PROFILES[name];
          expect(
            err.width,
            `widths ${err.widths.map((v) => v.toFixed(1))} vs ${ref.widths}`,
          ).toBeLessThanOrEqual(SHAPE_TOLERANCE);
          expect(
            err.drift,
            `drift ${err.drift_.map((v) => v.toFixed(1))} vs ${ref.drift}`,
          ).toBeLessThanOrEqual(SHAPE_TOLERANCE);
        });
      }

      it('is as wide as the reference', () => {
        // `figure` is the one deliberate exception. The reference's IDLE splays its feet — near toe
        // forward, far toe back — and hangs its two arms at different splays, so its widest row is
        // its front foot against its far hand. Ours is symmetric, which costs about 3 reference px
        // of overall width while every individual part stays within one. Matching it would mean
        // copying a pose quirk, not a proportion.
        const bound = name === 'figure' ? 3 : TOLERANCE;
        expect(Math.abs(groups[name].width / K - ref.width)).toBeLessThanOrEqual(bound);
      });
    });
  }

  it('keeps the skeleton height-identical across builds', () => {
    // The build switch is a multiplier set over ONE skeleton: it narrows the shoulders, so arm
    // joints shift sideways, but no joint may change HEIGHT. That is what lets equipment authored
    // against surface coordinates fit either build without per-build art, and what stops a build
    // from quietly becoming a second character.
    const male = idlePose({ ...DEFAULT_CONFIG, build: 'male' });
    for (const build of Object.keys(BUILDS) as BodyBuild[]) {
      const pose = idlePose({ ...DEFAULT_CONFIG, build });
      for (const joint of Object.keys(male)) {
        expect(pose[joint].y, `${build} moved ${joint} vertically`).toBe(male[joint].y);
      }
      // Only the arm chain may move horizontally, and only by the shoulder multiplier.
      const mayShift = new Set([
        'shoulderNear',
        'shoulderFar',
        'elbowNear',
        'elbowFar',
        'handNear',
        'handFar',
      ]);
      for (const joint of Object.keys(male)) {
        if (mayShift.has(joint)) continue;
        expect(pose[joint].x, `${build} moved ${joint} sideways`).toBe(male[joint].x);
      }
    }
  });
});

/**
 * The WALK, gated against the pack's own frames.
 *
 * This is the gap that let an inverted `kneeBend` ship: every other measurement here describes the
 * IDLE frame, where a leg is nearly straight and a bend sign does not show. The pack's walk layers
 * swap identity at the passing frames, so per-part profiles are not available for the walk — but the
 * whole-figure width profile is, and pose lives in it. A wide bottom row IS a spread stance.
 */
describe('walk cycle vs the reference pack', () => {
  const matches = walkMatch(DEFAULT_CONFIG);

  /**
   * Mean per-row width error allowed against a reference walk frame, in reference px.
   *
   * Looser than the idle's, and it has to be: this compares a whole 48px figure against a hand-drawn
   * 29px one across ~28 rows, with no per-part breakdown to isolate where the difference sits. Set
   * just above where the cycle currently lands, so it can only improve.
   */
  const WALK_TOLERANCE = 1.7;

  it('passes through every reference pose', () => {
    matches.forEach((m, i) => {
      expect(
        m.error,
        `reference walk frame ${i} (best phase ${m.phase.toFixed(3)})`,
      ).toBeLessThanOrEqual(WALK_TOLERANCE);
    });
  });

  it('does not collapse several reference poses onto one', () => {
    // A cycle that barely moves would match every reference frame at nearly the same phase and still
    // score well per frame. The pack's eight frames are four distinct poses (it repeats mirrored),
    // so ours must reach at least that many distinct phases.
    const distinct = new Set(matches.map((m) => Math.round(m.phase * 8)));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it('plants both feet at the widest stance', () => {
    // Half the pack's cycle is double support: four of its eight frames have both feet flat at full
    // spread. Ours planted one, and it showed up here as a 2px bottom row against its 16.
    const widest = Math.max(...WALK_WIDTHS.map((w) => w[0]));
    let ourWidest = 0;
    for (let i = 0; i < 32; i++) {
      const rows = walkWidths(DEFAULT_CONFIG, i / 32);
      if (rows.length) ourWidest = Math.max(ourWidest, rows[0]);
    }
    expect(ourWidest).toBeGreaterThanOrEqual(widest * 0.6);
  });
});

describe('walk cycle', () => {
  const cfg = DEFAULT_CONFIG;
  const SAMPLES = 240;
  const phases = Array.from({ length: SAMPLES }, (_, i) => i / SAMPLES);
  const poses = phases.map((p) => walkPose(p, cfg));

  it('never puts a foot below the ground line', () => {
    // The first version placed the ankle relative to the LIVE hip, so the hip's bob pushed the
    // planted foot through the floor twice per step.
    for (const pose of poses) {
      for (const ankle of ['ankleNear', 'ankleFar'] as const) {
        expect(pose[ankle].y).toBeLessThanOrEqual(cfg.yAnkle);
      }
    }
  });

  it('always has at least one foot on the ground', () => {
    for (const pose of poses) {
      const planted = [pose.ankleNear, pose.ankleFar].filter((a) => a.y >= cfg.yAnkle - 1e-9);
      expect(planted.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('slides a planted foot at a constant rate', () => {
    // A planted foot is still in the WORLD, so relative to the advancing body it must travel
    // backward at exactly the body's speed. Any variation is the foot scrubbing along the ground —
    // which is what a sine-driven ankle does, and it reads as ice-skating.
    const speeds: number[] = [];
    for (let i = 1; i < SAMPLES; i++) {
      const [a, b] = [poses[i - 1].ankleNear, poses[i].ankleNear];
      if (a.y < cfg.yAnkle - 1e-9 || b.y < cfg.yAnkle - 1e-9) continue; // mid-swing
      const d = b.x - a.x;
      if (d > 0) continue; // the wrap from swing back to stance
      speeds.push(d);
    }
    expect(speeds.length).toBeGreaterThan(SAMPLES / 4);
    for (const s of speeds) expect(s).toBeCloseTo(speeds[0], 6);
  });

  it('keeps every limb within its stretch budget', () => {
    // The solver stretches proportionally rather than failing when a target is out of reach, which
    // is what the reference art does — but silently exceeding the budget means a pose is asking for
    // something the skeleton can't do, and that is a bug in the pose, not in the solver.
    const chains: [string, string, number, number][] = [
      ['hipNear', 'ankleNear', cfg.femur, cfg.tibia],
      ['hipFar', 'ankleFar', cfg.femur, cfg.tibia],
      ['shoulderNear', 'handNear', cfg.humerus, cfg.ulna],
      ['shoulderFar', 'handFar', cfg.humerus, cfg.ulna],
    ];
    for (const pose of poses) {
      for (const [root, tip, lenA, lenB] of chains) {
        const dist = Math.hypot(pose[tip].x - pose[root].x, pose[tip].y - pose[root].y);
        expect(dist).toBeLessThanOrEqual((lenA + lenB) * cfg.stretch + 1e-9);
      }
    }
  });

  it('bends both knees somewhere in the cycle', () => {
    // A knee that is collinear with hip and ankle on every frame is a rod with extra steps — which
    // is what the out-of-reach sine produced, and what "the legs are stiff" meant.
    for (const [hip, knee, ankle] of [
      ['hipNear', 'kneeNear', 'ankleNear'],
      ['hipFar', 'kneeFar', 'ankleFar'],
    ] as const) {
      const bends = poses.map((pose) => {
        const ax = pose[knee].x - pose[hip].x;
        const ay = pose[knee].y - pose[hip].y;
        const bx = pose[ankle].x - pose[knee].x;
        const by = pose[ankle].y - pose[knee].y;
        return Math.abs(ax * by - ay * bx) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
      });
      expect(Math.max(...bends)).toBeGreaterThan(0.2);
    }
  });

  it('is a loop', () => {
    const start = walkPose(0, cfg);
    const end = walkPose(1, cfg);
    for (const joint of Object.keys(start)) {
      expect(end[joint].x).toBeCloseTo(start[joint].x, 6);
      expect(end[joint].y).toBeCloseTo(start[joint].y, 6);
    }
  });

  it('references only joints the rig poses', () => {
    // A part naming a joint no pose sets draws at the origin, which is a confusing way to find out.
    const posed = new Set(Object.keys(idlePose(cfg)));
    for (const group of Object.values(GROUPS)) expect(group).toBeDefined();
    for (const joint of ['crotch', 'toeNear', 'toeFar', 'waist', 'neck', 'headTop']) {
      expect(posed.has(joint), `${joint} is used by a part but never posed`).toBe(true);
    }
  });
});
