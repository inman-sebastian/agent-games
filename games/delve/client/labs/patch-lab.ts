// patch-lab — the chunk-context invariant, in a real browser canvas, with pictures.
//
// The same check `client/src/render/chunks.test.ts` runs in the gate (through a software canvas), here
// through Chrome's own 2D canvas so a blending or canvas difference can't hide behind the test double.
// Every chunk in a carved region is baked with the game's `bakeChunk` at CHUNK_MARGIN, and again with
// more context than anything can read; the two must match EXACTLY. They share a strata ramp — a
// chunk's band centre doesn't move with its margin — so the #54 per-band ramp difference never enters.
//
// `?margin=1` reproduces the #44 seam bug. Reports text (and the page title) so a headless check never
// reads pixels. This used to re-implement the chunk assembly itself, which made it a check of a copy.
import { setStrata, T, SHADE_INFLUENCE_CELLS, TOP_LIGHT_ROWS } from '../src/render/cave-render';
import { oreMaterial } from '../src/render/materials';
import {
  CHUNK_COLS,
  CHUNK_ROWS,
  CHUNK_MARGIN,
  bakeChunk,
  scratchSize,
  type ChunkSources,
} from '../src/render/chunks';
import { STRATA, oreAt, solidAt, surfaceAt } from '@delve/shared';

setStrata(STRATA);

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number =>
  params.has(key) ? +params.get(key)! : fallback;
const SEED = num('seed', 1);
const MARGIN = num('margin', CHUNK_MARGIN);
const CX0 = num('cx', 3);
const CY0 = num('cy', 30); // well below the surface: the sky gradient is #54, not a context bug
const NX = num('nx', 4);
const NY = num('ny', 4);
const REFERENCE_MARGIN = SHADE_INFLUENCE_CELLS + TOP_LIGHT_ROWS + 1;

// a tunnel and a shaft two cells from a seam each way — inside the shading's reach
const dug = new Set<string>();
const seamColumn = (CX0 + 1) * CHUNK_COLS;
const seamRow = (CY0 + 2) * CHUNK_ROWS;
for (let row = CY0 * CHUNK_ROWS; row < (CY0 + NY) * CHUNK_ROWS; row++)
  for (const column of [seamColumn - 4, seamColumn - 3]) dug.add(`${column},${row}`);
for (let column = seamColumn - 10; column < seamColumn + 10; column++)
  for (let row = seamRow - 6; row <= seamRow - 3; row++) dug.add(`${column},${row}`);

const sources: ChunkSources = {
  solid: (column, row) => solidAt(SEED, column, row) && !dug.has(`${column},${row}`),
  surfaceAt: (column) => surfaceAt(SEED, column),
  materialAt: (column, row) => oreMaterial(oreAt(SEED, column, row)),
};

function context(width: number, height: number): CanvasRenderingContext2D {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  return g;
}

function bake(cx: number, cy: number, margin: number): CanvasRenderingContext2D {
  const size = scratchSize(margin);
  const out = context(CHUNK_COLS * T, CHUNK_ROWS * T);
  bakeChunk(context(size.width, size.height), out, cx, cy, sources, margin);
  return out;
}

const assembled = context(NX * CHUNK_COLS * T, NY * CHUNK_ROWS * T);
let differing = 0;
let worstChunk = '';
let worstCount = 0;
for (let cy = CY0; cy < CY0 + NY; cy++) {
  for (let cx = CX0; cx < CX0 + NX; cx++) {
    const game = bake(cx, cy, MARGIN);
    const reference = bake(cx, cy, REFERENCE_MARGIN);
    const a = game.getImageData(0, 0, CHUNK_COLS * T, CHUNK_ROWS * T).data;
    const b = reference.getImageData(0, 0, CHUNK_COLS * T, CHUNK_ROWS * T).data;
    let count = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
        count++;
    differing += count;
    if (count > worstCount) {
      worstCount = count;
      worstChunk = `${cx},${cy}`;
    }
    assembled.drawImage(game.canvas, (cx - CX0) * CHUNK_COLS * T, (cy - CY0) * CHUNK_ROWS * T);
  }
}

const verdict = differing === 0 ? 'PASS' : 'FAIL';
const line =
  `${verdict} every chunk matches unlimited context exactly (margin ${MARGIN} vs ${REFERENCE_MARGIN})\n` +
  `differing pixels ${differing}${worstCount ? `  worst chunk ${worstChunk} (${worstCount})` : ''}\n` +
  `${NX}x${NY} chunks of ${CHUNK_COLS}x${CHUNK_ROWS} cells from ${CX0},${CY0}, seed ${SEED}`;

document.body.style.cssText =
  'background:#12141c;color:#e8e4d8;font:12px ui-monospace,monospace;padding:12px';
const out = document.createElement('pre');
out.id = 'result';
out.textContent = line;
assembled.canvas.style.cssText =
  'image-rendering:pixelated;width:' + NX * CHUNK_COLS * T * 2 + 'px';
document.body.append(out, assembled.canvas);
document.title = verdict;
console.log(line);
