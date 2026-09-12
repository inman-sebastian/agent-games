// rig-reference.ts — the reference figure's measured proportions, and how to measure ours the same way.
//
// The purchased reference pack ships its animations as layered .aseprite files, one layer per body
// part, so each part's exact pixel extent is readable rather than guessable. What lives here is the
// MEASUREMENTS taken off it — numbers, not art, because all game art is authored (root CLAUDE.md).
// Re-deriving them needs the pack; the numbers alone are enough to hold the silhouette.
//
// Shared by `rig-measure.ts` (the CLI report) and `rig.test.ts` (the gate), so the report and the
// test can never disagree about what "close to the reference" means.
import { buildHumanoid, idlePose, CODED } from '../client/src/render/entity/humanoid';
import { drawRig, rigPalettes } from '../client/src/render/entity/rig';
import type { HumanoidConfig } from '../client/src/render/entity/config';

/** The reference figure is 29px tall and ours is 48 by decision (2x3 tiles), so everything scales. */
export const REF_HEIGHT = 29;
export const OUR_HEIGHT = 48;
export const K = OUR_HEIGHT / REF_HEIGHT;

export const W = 80;
export const H = 72;
export const GROUND = H - 8; // room below the feet, so an overshoot is visible rather than clipped

/**
 * Measured off `Idle/Player Idle 48x48.aseprite`, frame 0, per layer, with the feet at y = 0 and up
 * negative. `top`/`bottom` are the pixel index of the layer's first and last row. Layer extents are
 * UNCLIPPED — the reference's torso layer is 7px wide whether or not an arm covers its edge, which
 * is why ours has to be measured part-by-part to compare.
 *
 * `width` (the widest row) IS NOT A USEFUL TARGET ON ITS OWN and is kept only for the report. It was
 * the metric here first and it hid every real fault for five rounds: the reference's leg is a
 * diagonal staircase 2-5px wide, ours was an 8px vertical slab, and both have the same widest row.
 * Shape lives in `PROFILES` below.
 */
export const REFERENCE = {
  head: { top: -29, bottom: -22, width: 8 },
  torso: { top: -20, bottom: -10, width: 7 },
  armNear: { top: -20, bottom: -11, width: 4 },
  armFar: { top: -20, bottom: -11, width: 4 },
  legNear: { top: -12, bottom: -1, width: 5 },
  // 6, matching the pack exactly — its back leg really does hit 6 on one row. That was written off
  // as an artifact while the capsule primitive could not reproduce a one-row bulge; the authored
  // width profile can, so the target is the pack's own number again.
  legFar: { top: -12, bottom: -1, width: 6 },
  figure: { top: -29, bottom: -1, width: 18 },
} as const;

export type GroupName = keyof typeof REFERENCE;

/**
 * The shape of each reference part, row by row — which is the thing that actually had to be matched.
 *
 * `widths` is each row's pixel count, top to bottom. `drift` is each row's centre relative to the
 * TOP row's centre, so it encodes the part's ANGLE: the reference's idle sweeps each limb diagonally
 * across the body, and a limb hanging vertically is most of why ours read as a mannequin.
 *
 * Signs are in OUR frame, where +x is the facing direction. The sheet faces -x, so drift is negated
 * from the measurement. Numbers are reference px; ours get resampled onto the same row count before
 * comparing, since our figure is 48px tall to the reference's 29.
 */
export interface Profile {
  readonly widths: readonly number[];
  readonly drift: readonly number[];
}

export const PROFILES: Record<Exclude<GroupName, 'figure'>, Profile> = {
  // A near-circular octagon. The only part whose shape we already had about right.
  head: { widths: [4, 6, 8, 8, 8, 8, 6, 4], drift: [0, 0, 0, 0, 0, 0, 0, 0] },
  // Wide at the shoulder, pinched at the waist, flared at the hip, then tapering to the crotch.
  torso: {
    widths: [6, 7, 7, 7, 6, 5, 6, 7, 5, 3, 1],
    drift: [0, -0.5, -0.5, 0.5, 0, 0.5, 1, 1.5, 0.5, 0.5, 0.5],
  },
  // Note the far limbs are drawn NARROWER than the near ones, not just darker.
  armNear: {
    widths: [2, 3, 4, 4, 3, 2, 2, 3, 3, 3],
    drift: [0, 0.5, 1, 2, 2.5, 3, 3, 2.5, 2.5, 2.5],
  },
  armFar: {
    widths: [1, 1, 1, 1, 2, 3, 3, 3, 4, 3],
    drift: [0, -1, -1, -0.5, -1, -2, -3, -3.5, -4, -4],
  },
  legNear: {
    widths: [2, 3, 5, 5, 5, 4, 4, 3, 3, 3, 3, 3],
    drift: [0, -0.5, -0.5, -0.5, 0.5, 1, 2, 2.5, 3.5, 3.5, 4.5, 4.5],
  },
  legFar: {
    widths: [2, 3, 5, 6, 4, 3, 2, 2, 2, 2, 3, 3],
    drift: [0, -0.5, -0.5, -1, -2, -2.5, -3, -3, -3, -3, -3.5, -3.5],
  },
};

export interface ProfileError {
  /** Mean absolute width error, in reference px. */
  width: number;
  /** Mean absolute centre-drift error, in reference px — how wrong the limb's ANGLE is. */
  drift: number;
  /** Ours, resampled onto the reference's row count, for printing next to it. */
  widths: number[];
  drift_: number[];
}

/** Per-row width and centre-drift of an opaque mask, top to bottom, in ART px. */
export function profileOf(img: Buffer2D): { widths: number[]; drift: number[] } {
  const rows: [number, number][] = [];
  for (let y = 0; y < img.height; y++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi >= lo) rows.push([hi - lo + 1, (lo + hi) / 2]);
  }
  if (rows.length === 0) return { widths: [], drift: [] };
  const c0 = rows[0][1];
  return { widths: rows.map((r) => r[0]), drift: rows.map((r) => r[1] - c0) };
}

/** Resample a profile onto `n` rows by linear interpolation, so two heights can be compared. */
export function resample(values: readonly number[], n: number): number[] {
  if (values.length === 0) return Array.from({ length: n }, () => 0);
  if (values.length === 1) return Array.from({ length: n }, () => values[0]);
  return Array.from({ length: n }, (_, i) => {
    const t = (i * (values.length - 1)) / (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    return values[lo] + (values[hi] - values[lo]) * (t - lo);
  });
}

/** How far our part's shape is from the reference's, in reference px per row. */
export function profileError(
  ours: { widths: number[]; drift: number[] },
  ref: Profile,
): ProfileError {
  const n = ref.widths.length;
  const widths = resample(ours.widths, n).map((v) => v / K);
  const drift_ = resample(ours.drift, n).map((v) => v / K);
  const mean = (a: number[], b: readonly number[]): number =>
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / n;
  return { width: mean(widths, ref.widths), drift: mean(drift_, ref.drift), widths, drift_ };
}

/** Which coded colours make up each measured group — our parts are finer-grained than its layers. */
export const GROUPS: Record<GroupName, readonly (readonly [number, number, number])[]> = {
  head: [CODED.head],
  torso: [CODED.chest, CODED.pelvis],
  armNear: [CODED.armNearU, CODED.armNearL],
  armFar: [CODED.armFarU, CODED.armFarL],
  legNear: [CODED.legNearU, CODED.legNearL, CODED.foot],
  legFar: [CODED.legFar, CODED.footFar],
  figure: [],
};

export interface Extent {
  top: number;
  bottom: number;
  width: number;
  count: number;
}

export const ALL = '*all*';

type Buffer2D = { width: number; height: number; data: Uint8ClampedArray };

/** Group every opaque pixel by its exact colour, plus one `ALL` bucket for the whole image. */
export function extents(img: Buffer2D): Record<string, Extent> {
  const out: Record<string, Extent> = {};
  const rows: Record<string, Map<number, [number, number]>> = {};
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
      for (const g of [key, ALL]) {
        const e = (out[g] ??= { top: 1e9, bottom: -1e9, width: 0, count: 0 });
        e.top = Math.min(e.top, y);
        e.bottom = Math.max(e.bottom, y);
        e.count++;
        const r = (rows[g] ??= new Map());
        const span = r.get(y);
        r.set(y, span ? [Math.min(span[0], x), Math.max(span[1], x)] : [x, x]);
      }
    }
  }
  for (const [g, m] of Object.entries(rows)) {
    for (const [lo, hi] of m.values()) out[g].width = Math.max(out[g].width, hi - lo + 1);
  }
  return out;
}

/** Render the rig at idle in coded mode, optionally keeping only some parts. */
export function render(
  cfg: HumanoidConfig,
  keep?: (part: { coded?: readonly number[] }) => boolean,
): Buffer2D {
  const full = buildHumanoid(cfg);
  const rig = keep ? { parts: full.parts.filter(keep) } : full;
  // `drawRig` only ever indexes `width`/`data`, so a plain buffer stands in for ImageData in Node.
  const img: Buffer2D = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  drawRig(
    img as unknown as Parameters<typeof drawRig>[0],
    rig,
    idlePose(cfg),
    rigPalettes(rig),
    Math.floor(W / 2),
    GROUND,
    undefined,
    true,
  );
  return img;
}

/**
 * Measure each group with NOTHING ELSE DRAWN.
 *
 * This was the difference between a table that lied and one that didn't. Measuring the composited
 * render reported our torso as 5px against the reference's 7, because the arms sit right at the
 * torso's edge and hide it — and chasing that phantom would have made the chest two pixels too wide.
 */
export function measure(cfg: HumanoidConfig): {
  groups: Record<GroupName, Extent>;
  shapes: Record<Exclude<GroupName, 'figure'>, ProfileError>;
  byColour: Record<string, Extent>;
  uncoded: string[];
} {
  const groups = {} as Record<GroupName, Extent>;
  const shapes = {} as Record<Exclude<GroupName, 'figure'>, ProfileError>;
  const coded = new Set<string>();
  for (const [group, colors] of Object.entries(GROUPS) as [
    GroupName,
    readonly (readonly [number, number, number])[],
  ][]) {
    if (group === 'figure') continue;
    const keys = new Set(colors.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (const k of keys) coded.add(k);
    const img = render(
      cfg,
      (p) => !!p.coded && keys.has(`${p.coded[0]},${p.coded[1]},${p.coded[2]}`),
    );
    const e = extents(img)[ALL];
    if (e) groups[group] = e;
    shapes[group as Exclude<GroupName, 'figure'>] = profileError(
      profileOf(img),
      PROFILES[group as Exclude<GroupName, 'figure'>],
    );
  }
  const byColour = extents(render(cfg));
  groups.figure = byColour[ALL];
  return {
    groups,
    shapes,
    byColour,
    uncoded: Object.keys(byColour).filter((k) => k !== ALL && !coded.has(k)),
  };
}

/** An art-pixel row index as a REFERENCE-pixel offset from the ground, the unit the table is in. */
export const toRef = (y: number): number => (y - GROUND) / K;
