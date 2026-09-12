// rig-fit.ts — fit the humanoid's placement knobs by MAXIMISING silhouette overlap.
//
// Hand-guessing placement is what stalled the character for five rounds: every value that fixed one
// part broke another, because they are coupled and a human cannot hold a dozen of them at once. This
// runs coordinate descent on the overlap that rig-overlay.ts reports and prints the result, which
// moved the figure from 68% to 79% in seconds.
//
// It optimises PLACEMENT only — offsets, splays, lean, joint leads, gait. The SHAPES are authored
// width profiles read off the reference (see `PROFILE` in humanoid.ts) and are not up for fitting.
//
// THE OBJECTIVE IS WEIGHTED PER PART, and that matters more than it sounds. Fitting a single scalar
// — whole-figure overlap — let it trade a small part for a large one: it zeroed the far arm's angle,
// collapsed the foot to nothing and opened a four-pixel neck gap, because none of those cost many
// pixels. Every part now carries equal weight regardless of its area, so a 1px-wide far bicep is
// worth as much as the torso.
//
// It also scores the WALK, not just the idle. Idle-only scoring is how an inverted knee-bend sign
// survived: at rest a leg is nearly straight and the sign does not show.
//
// Needs the purchased pack, same as rig-overlay.ts.
//
//   pnpm --filter delve exec tsx tools/rig-fit.ts ~/pack/Idle/'Player Idle 48x48.png'
import { DEFAULT_CONFIG, type HumanoidConfig } from '../client/src/render/entity/config';
import {
  GROUPS,
  K,
  PROFILES,
  WALK_WIDTHS,
  measure,
  render,
  resample,
  walkWidths,
} from './rig-reference';
import { execSync } from 'node:child_process';

const PACK = process.argv[2];
const ref = JSON.parse(
  execSync(`python3 -c "
from PIL import Image; import json
im = Image.open('${PACK}').convert('RGBA').crop((0,0,48,48)); px = im.load()
print(json.dumps([(x,y) for y in range(48) for x in range(48) if px[x,y][3]]))
"`).toString(),
) as [number, number][];

// The pack's idle frame, mirrored to our facing and upscaled, for the overlap term.
const src = new Set(ref.map(([x, y]) => `${47 - x},${y}`));
const scaled: [number, number][] = [];
for (let y = 0; y < Math.ceil(48 * K); y++)
  for (let x = 0; x < Math.ceil(48 * K); x++)
    if (src.has(`${Math.floor(x / K)},${Math.floor(y / K)}`)) scaled.push([x, y]);
const align = (p: [number, number][]): { bot: number; cx: number } => ({
  bot: Math.max(...p.map((q) => q[1])),
  cx: (Math.min(...p.map((q) => q[0])) + Math.max(...p.map((q) => q[0]))) / 2,
});
const A = align(scaled);

function overlap(cfg: HumanoidConfig): number {
  const img = render(cfg);
  const ours: [number, number][] = [];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]) ours.push([x, y]);
  if (ours.length === 0) return 0;
  const B = align(ours);
  const shifted = new Set(
    scaled.map(([x, y]) => `${Math.round(x - A.cx + B.cx)},${y - A.bot + B.bot}`),
  );
  const mine = new Set(ours.map(([x, y]) => `${x},${y}`));
  let inter = 0;
  for (const k of mine) if (shifted.has(k)) inter++;
  return inter / (mine.size + shifted.size - inter);
}

/** Walk score, sampled coarsely — the fit calls this thousands of times. */
function walkCost(cfg: HumanoidConfig, samples = 16): number {
  const ours = Array.from({ length: samples }, (_, i) => walkWidths(cfg, i / samples));
  let sum = 0;
  for (const refRow of WALK_WIDTHS) {
    let best = Infinity;
    for (const raw of ours) {
      if (raw.length === 0) continue;
      const r = resample(raw, refRow.length);
      let e = 0;
      for (let i = 0; i < refRow.length; i++) e += Math.abs(r[i] - refRow[i]);
      best = Math.min(best, e / refRow.length + Math.abs(raw.length / K - refRow.length) * 0.5);
    }
    sum += best === Infinity ? 50 : best;
  }
  return sum / WALK_WIDTHS.length;
}

const PARTS = (Object.keys(PROFILES) as (keyof typeof PROFILES)[]).filter((k) => k in GROUPS);

/**
 * Lower is better. Three terms, all in reference px so they are directly comparable:
 * every part's own shape error (equal weight each), the walk, and the idle's overlap.
 */
function cost(cfg: HumanoidConfig): number {
  const { shapes } = measure(cfg);
  let parts = 0;
  for (const name of PARTS) parts += shapes[name].width + shapes[name].drift;
  return parts / PARTS.length + walkCost(cfg) + (1 - overlap(cfg)) * 8;
}

// footLift and armSwing are deliberately ABSENT. A whole-figure width profile barely changes when a
// foot lifts or an arm swings, so the fit drives both to zero and scores it as an improvement — a
// blind spot, not a result. They stay measured.
const KNOBS: [keyof HumanoidConfig, number, number, number][] = [
  ['armOffset', 3, 9, 0.4],
  ['handSplay', 0, 9, 0.4],
  ['handSplayFar', 0, 9, 0.4],
  ['legOffset', 2, 9, 0.4],
  ['stanceSplay', 0, 11, 0.4],
  ['stanceSplayFar', 0, 11, 0.4],
  ['lean', -8, 4, 0.4],
  ['kneeLead', -0.4, 1.2, 0.08],
  ['elbowLead', -0.4, 1.6, 0.08],
  ['torsoDrop', 0, 7, 0.5],
  ['girth', 0.85, 1.2, 0.02],
  ['stride', 6, 30, 1],
  ['bob', 0, 6, 0.5],
  ['duty', 0.5, 0.92, 0.02],
];

let cfg = { ...DEFAULT_CONFIG };
let best = cost(cfg);
console.log(
  `start cost ${best.toFixed(3)}  (overlap ${(overlap(cfg) * 100).toFixed(1)}%, walk ${walkCost(cfg).toFixed(2)})`,
);
for (let pass = 0; pass < 3; pass++) {
  for (const [key, lo, hi, step] of KNOBS) {
    let bestV = cfg[key] as number;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const trial = { ...cfg, [String(key)]: Number(v.toFixed(3)) } as HumanoidConfig;
      const c = cost(trial);
      if (c < best - 1e-9) {
        best = c;
        bestV = Number(v.toFixed(3));
      }
    }
    (cfg as unknown as Record<string, number>)[String(key)] = bestV;
  }
  console.log(
    `pass ${pass + 1}: cost ${best.toFixed(3)}  (overlap ${(overlap(cfg) * 100).toFixed(1)}%, walk ${walkCost(cfg).toFixed(2)})`,
  );
}
console.log('\nbest values:');
for (const [key] of KNOBS) console.log(`  ${String(key)}: ${cfg[key]},`);
