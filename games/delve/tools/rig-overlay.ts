// rig-overlay.ts — per-pixel overlap of our silhouette against the reference's, and a diff map.
//
// The measurement that should have existed first. Per-part extents, then per-part width profiles,
// both still let the figure be wrong in ways the number could not express — the only question that
// cannot be gamed is "how many of the same pixels are lit". This reports intersection-over-union
// against the pack's own frame, plus a map of exactly where the two disagree, which is what turned
// five rounds of guessing into a handful of targeted fixes.
//
// Needs the PURCHASED reference pack, which is not committed (all game art is authored — see the
// root CLAUDE.md). Pass a frame sheet's path; frame 0 is used.
//
//   pnpm --filter delve exec tsx tools/rig-overlay.ts ~/pack/Idle/'Player Idle 48x48.png'
//
// Requires python3 with Pillow, only to decode the PNG.
import { DEFAULT_CONFIG } from '../client/src/render/entity/config';
import { K, render } from './rig-reference';
import { execSync } from 'node:child_process';

const PACK = process.argv[2];
const ref = JSON.parse(
  execSync(`python3 -c "
from PIL import Image; import json
im = Image.open('${PACK}').convert('RGBA').crop((0,0,48,48))
px = im.load()
pts = [(x,y) for y in range(48) for x in range(48) if px[x,y][3]]
print(json.dumps(pts))
"`).toString(),
) as [number, number][];

const img = render(DEFAULT_CONFIG);
const ours: [number, number][] = [];
for (let y = 0; y < img.height; y++)
  for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3]) ours.push([x, y]);

// Reference faces -x; mirror it, then upscale by K the correct way round: walk the DESTINATION
// pixels and sample back, so nothing can be dropped or double-counted.
const src = new Set(ref.map(([x, y]) => `${47 - x},${y}`));
const scaled = new Set<string>();
for (let y = 0; y < Math.ceil(48 * K); y++)
  for (let x = 0; x < Math.ceil(48 * K); x++)
    if (src.has(`${Math.floor(x / K)},${Math.floor(y / K)}`)) scaled.add(`${x},${y}`);
const pts = [...scaled].map((s) => s.split(',').map(Number) as [number, number]);
const align = (p: [number, number][]): { bot: number; cx: number } => ({
  bot: Math.max(...p.map((q) => q[1])),
  cx: (Math.min(...p.map((q) => q[0])) + Math.max(...p.map((q) => q[0]))) / 2,
});
const a = align(pts);
const b = align(ours);
const shifted = new Set(pts.map(([x, y]) => `${Math.round(x - a.cx + b.cx)},${y - a.bot + b.bot}`));
const mine = new Set(ours.map(([x, y]) => `${x},${y}`));
let inter = 0;
for (const k of mine) if (shifted.has(k)) inter++;
const union = mine.size + shifted.size - inter;
console.log(`reference ${shifted.size}px   ours ${mine.size}px   overlap ${inter}px`);
console.log(
  `IoU ${((inter / union) * 100).toFixed(1)}%   ours covers ${((inter / shifted.size) * 100).toFixed(1)}% of the reference`,
);
// Where the disagreement is: # both, O ours only, R reference only.
const all = [...new Set([...mine, ...shifted])].map(
  (k) => k.split(',').map(Number) as [number, number],
);
const [x0, x1] = [Math.min(...all.map((q) => q[0])), Math.max(...all.map((q) => q[0]))];
const [y0, y1] = [Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[1]))];
console.log('\n# both   O ours only   R reference only\n');
for (let y = y0; y <= y1; y++) {
  let row = '  ';
  for (let x = x0; x <= x1; x++) {
    const k = `${x},${y}`;
    row += mine.has(k) ? (shifted.has(k) ? '#' : 'O') : shifted.has(k) ? 'R' : '.';
  }
  console.log(row);
}
