// patch-lab — does the rock bake the same way in CHUNKS as it does in one piece?
//
// The game renders rock as cached chunks and re-bakes them when you dig. That is only correct if a
// chunk carries enough context to shade identically to a full-region bake: the shading reads a
// falloff range sideways AND seeds the top-light from the rows above, so a region rendered in small
// independent pieces can disagree with itself at every seam.
//
// The bug this exists to catch (#44): a dig used to repaint a 3x3-cell window instead of re-baking,
// which left stale rock around every freshly mined tunnel — the lamp appeared to stick to the one
// cell that got redrawn, while anything dug before the last reload looked perfect, because a reload
// bakes every chunk at once.
//
//   A — one composeBand over the whole carved region (the reference)
//   B — the same region assembled from CW x CH chunk bakes, each with its own MARGIN of context
//
// Reports numbers as text so a headless check reads the result without looking at pixels.
import { composeBand, T, setStrata, SHADE_INFLUENCE_CELLS } from '../src/render/cave-render';
import { STRATA, solidAt, surfaceAt } from '@delve/shared';

setStrata(STRATA);

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? +params.get(k)! : d);
const SEED = num('seed', 1);
const COL = num('c', 60);
const ROW = num('r', 80);
// the game's chunk geometry, which is what's being validated
const CW = num('cw', 12);
const CH = num('ch', 6);
const MARGIN = num('margin', SHADE_INFLUENCE_CELLS); // the game's own choice; override to compare
const CHUNKS_X = num('nx', 4);
const CHUNKS_Y = num('ny', 6);

const COLS = CW * CHUNKS_X;
const ROWS = CH * CHUNKS_Y;
const bandLeft = COL;
const bandTop = ROW;

// An L-shaped tunnel 4 cells tall — a real body height, crossing several chunk seams.
const dug = new Set<string>();
for (let i = 0; i < CW * 2 + 5; i++)
  for (let d = 0; d < 4; d++) dug.add(`${COL + 6 + i},${ROW + 14 + d}`);
for (let j = 0; j < CH * 3; j++)
  for (let d = 0; d < 2; d++) dug.add(`${COL + 6 + d},${ROW + 4 + j}`);

const surfaceOf = (column: number): number => surfaceAt(SEED, column);
const solid = (column: number, row: number): boolean =>
  solidAt(SEED, column, row) && !dug.has(`${column},${row}`);

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  return [cv, g];
}

// A — the whole region in one bake
const [whole, wctx] = canvasOf(COLS * T, ROWS * T);
composeBand(wctx, solid, bandLeft, bandTop, COLS, ROWS, surfaceOf);

// B — the same region assembled from chunk bakes, exactly as the game does it
const [tiled, tctx] = canvasOf(COLS * T, ROWS * T);
const [scratch, sctx] = canvasOf((CW + 2 * MARGIN) * T, (CH + 2 * MARGIN) * T);
for (let ky = 0; ky < CHUNKS_Y; ky++) {
  for (let kx = 0; kx < CHUNKS_X; kx++) {
    const chunkCol = bandLeft + kx * CW;
    const chunkRow = bandTop + ky * CH;
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    composeBand(
      sctx,
      solid,
      chunkCol - MARGIN,
      chunkRow - MARGIN,
      CW + 2 * MARGIN,
      CH + 2 * MARGIN,
      surfaceOf,
    );
    tctx.drawImage(
      scratch,
      MARGIN * T,
      MARGIN * T,
      CW * T,
      CH * T,
      kx * CW * T,
      ky * CH * T,
      CW * T,
      CH * T,
    );
  }
}

const a = wctx.getImageData(0, 0, whole.width, whole.height).data;
const b = tctx.getImageData(0, 0, tiled.width, tiled.height).data;
let differing = 0;
let worst = 0;
let compared = 0;
// The region's own outer edge has no context in EITHER render, so it is not part of the question.
const inset = SHADE_INFLUENCE_CELLS * T;
for (let y = inset; y < whole.height - inset; y++) {
  for (let x = inset; x < whole.width - inset; x++) {
    const i = (y * whole.width + x) * 4;
    compared++;
    const d =
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]) +
      Math.abs(a[i + 3] - b[i + 3]);
    if (d > 0) differing++;
    if (d > worst) worst = d;
  }
}
// The verdict is on the WORST pixel, not on exact equality. A broad, tiny difference is expected
// and by design: composeBand picks its strata ramp from the middle row of the band it is given, so
// a chunk and a whole region legitimately choose slightly different rock colours. That shifts a
// fifth of the pixels by a step or two and is invisible. A CONTEXT failure looks completely
// different — a few pixels wrong by a lot, at the seams — which is what this threshold catches:
// at MARGIN 1 the worst pixel is off by 207 of a possible 1020; at the influence radius, by 5.
const WORST_ALLOWED = 12; // ~1% of one channel
const pct = (differing / compared) * 100;
const verdict = worst <= WORST_ALLOWED ? 'PASS' : 'FAIL';
const line =
  `${verdict} chunk-bake matches whole-bake (worst ${worst} <= ${WORST_ALLOWED})\n` +
  `worst channel sum ${worst} of 1020 — the seam/context metric, the one that matters\n` +
  `differing ${differing}/${compared} px (${pct.toFixed(3)}%) — expected: per-band strata ramp\n` +
  `region ${COLS}x${ROWS} cells in ${CHUNKS_X}x${CHUNKS_Y} chunks of ${CW}x${CH} (margin ${MARGIN})`;

document.body.style.cssText =
  'background:#12141c;color:#e8e4d8;font:12px ui-monospace,monospace;padding:12px';
const out = document.createElement('pre');
out.id = 'result';
out.textContent = line;
document.body.appendChild(out);
for (const [label, cv] of [
  ['A — one bake', whole],
  ['B — chunk bakes', tiled],
] as const) {
  const h = document.createElement('div');
  h.textContent = label;
  cv.style.cssText = 'image-rendering:pixelated;display:block;margin:4px 0 10px';
  document.body.append(h, cv);
}
document.title = verdict;
console.log(line);
