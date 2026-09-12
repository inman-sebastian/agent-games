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
 * negative. `top`/`bottom` are the pixel index of the layer's first and last row; `width` is its
 * widest row. Layer extents are UNCLIPPED — the reference's torso layer is 7px wide whether or not
 * an arm covers its edge, which is why ours has to be measured part-by-part to compare.
 */
export const REFERENCE = {
  head: { top: -29, bottom: -22, width: 8 },
  torso: { top: -20, bottom: -10, width: 7 },
  armNear: { top: -20, bottom: -11, width: 4 },
  armFar: { top: -20, bottom: -11, width: 4 },
  legNear: { top: -12, bottom: -1, width: 5 },
  // 5, not the 6 its widest row reads: the pack's back leg hits 6 on exactly ONE row while its
  // front leg holds 5 across three, so 6 is a drawing artifact of the simpler far-side leg.
  legFar: { top: -12, bottom: -1, width: 5 },
  figure: { top: -29, bottom: -1, width: 18 },
} as const;

export type GroupName = keyof typeof REFERENCE;

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
  byColour: Record<string, Extent>;
  uncoded: string[];
} {
  const groups = {} as Record<GroupName, Extent>;
  const coded = new Set<string>();
  for (const [group, colors] of Object.entries(GROUPS) as [
    GroupName,
    readonly (readonly [number, number, number])[],
  ][]) {
    if (group === 'figure') continue;
    const keys = new Set(colors.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (const k of keys) coded.add(k);
    const e = extents(
      render(cfg, (p) => !!p.coded && keys.has(`${p.coded[0]},${p.coded[1]},${p.coded[2]}`)),
    )[ALL];
    if (e) groups[group] = e;
  }
  const byColour = extents(render(cfg));
  groups.figure = byColour[ALL];
  return {
    groups,
    byColour,
    uncoded: Object.keys(byColour).filter((k) => k !== ALL && !coded.has(k)),
  };
}

/** An art-pixel row index as a REFERENCE-pixel offset from the ground, the unit the table is in. */
export const toRef = (y: number): number => (y - GROUND) / K;
