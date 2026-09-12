// rig-fit.ts — fit the humanoid's placement knobs by MAXIMISING silhouette overlap.
//
// Hand-guessing placement is what stalled the character for five rounds: every value that fixed one
// part broke another, because they are coupled and a human cannot hold a dozen of them at once. This
// runs coordinate descent on the overlap that rig-overlay.ts reports and prints the result, which
// moved the figure from 68% to 79% in seconds.
//
// It optimises PLACEMENT only — offsets, splays, lean, joint leads. The SHAPES are authored width
// profiles read off the reference (see `PROFILE` in humanoid.ts) and are not up for fitting.
//
// It fits ONE frame, so it will happily trade a small part's accuracy for a large one's and will
// game the idle at the walk's expense — the foot collapsed to nothing when it was in the list, since
// the reference's idle has no foot nub. Pin anything the gait needs before trusting the output, and
// re-run `pnpm test` afterwards: the walk invariants are what catch an idle-only win.
//
// Needs the purchased pack, same as rig-overlay.ts.
//
//   pnpm --filter delve exec tsx tools/rig-fit.ts ~/pack/Idle/'Player Idle 48x48.png'
import { DEFAULT_CONFIG, type HumanoidConfig } from '../client/src/render/entity/config';
import { K, render } from './rig-reference';
import { execSync } from 'node:child_process';

const PACK = process.argv[2];
const ref = JSON.parse(
  execSync(`python3 -c "
from PIL import Image; import json
im = Image.open('${PACK}').convert('RGBA').crop((0,0,48,48)); px = im.load()
print(json.dumps([(x,y) for y in range(48) for x in range(48) if px[x,y][3]]))
"`).toString(),
) as [number, number][];
const src = new Set(ref.map(([x, y]) => `${47 - x},${y}`));
const scaled: [number, number][] = [];
for (let y = 0; y < Math.ceil(48 * K); y++)
  for (let x = 0; x < Math.ceil(48 * K); x++)
    if (src.has(`${Math.floor(x / K)},${Math.floor(y / K)}`)) scaled.push([x, y]);
const align = (p: [number, number][]) => ({
  bot: Math.max(...p.map((q) => q[1])),
  cx: (Math.min(...p.map((q) => q[0])) + Math.max(...p.map((q) => q[0]))) / 2,
});
const A = align(scaled);

function iou(cfg: HumanoidConfig): number {
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
  ['girth', 0.8, 1.3, 0.02],
];

let cfg = { ...DEFAULT_CONFIG };
let best = iou(cfg);
console.log(`start IoU ${(best * 100).toFixed(1)}%`);
for (let pass = 0; pass < 3; pass++) {
  for (const [key, lo, hi, step] of KNOBS) {
    let bestV = cfg[key] as number;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const trial = { ...cfg, [String(key)]: Number(v.toFixed(3)) } as HumanoidConfig;
      const s = iou(trial);
      if (s > best + 1e-9) {
        best = s;
        bestV = Number(v.toFixed(3));
      }
    }
    (cfg as unknown as Record<string, number>)[String(key)] = bestV;
  }
  console.log(`pass ${pass + 1}: IoU ${(best * 100).toFixed(1)}%`);
}
console.log('\nbest values:');
for (const [key] of KNOBS) console.log(`  ${String(key)}: ${cfg[key]},`);
