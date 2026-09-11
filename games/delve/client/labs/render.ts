// render.ts — the render harness entry. Draws EXACTLY one world region through the shared
// modules into a canvas sized to the crop, so a visual check is one tiny image of precisely the
// thing (captured headless via shot.sh). Driven entirely by URL params (see render.html).
import { T, setStrata, composeBand, hexRgb } from '../src/render/cave-render';
import { WIDTH, SURFACE, STRATA, blockAt, oreAt } from '@delve/shared';
import { ORE_ART, drawOreBlock } from '../src/render/ore-art';
import { drawMiner } from '../src/render/sprites';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

const DEFAULT_SEED = 12345;
const DEFAULT_CENTER_ROW = 100;
const DEFAULT_COLS = 18;
const DEFAULT_ROWS = 14;
const DEFAULT_SCALE = 3;
const DEFAULT_VISION = 9;
const LAMP_BASE_INTENSITY = 0.9; // lamp seed brightness at vision 0
const LAMP_VISION_GAIN = 0.16; // added per unit of vision
const ORE_EMIT_INTENSITY = 0.9; // seed strength for exposed-ore glow in the harness

setStrata(STRATA);

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number =>
  params.has(key) ? Number(params.get(key)) : fallback;
const seed = num('seed', DEFAULT_SEED);
const centerColumn = num('c', WIDTH >> 1);
const centerRow = num('r', DEFAULT_CENTER_ROW);
const cols = num('w', DEFAULT_COLS);
const rows = num('h', DEFAULT_ROWS);
const scale = num('scale', DEFAULT_SCALE);
const cave = params.get('cave') || 'shaft';
const applyLamp = num('lamp', 1);
const showMiner = num('miner', 1);
const vision = num('vision', DEFAULT_VISION);

const bandLeft = centerColumn - (cols >> 1);
const bandTop = centerRow - (rows >> 1);

// carve a cave shape into a dug set
const dug = new Set<string>();
if (cave === 'shaft') {
  for (let row = bandTop; row <= centerRow; row++) dug.add(`${centerColumn},${row}`); // shaft down the centre
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) dug.add(`${centerColumn + dx},${centerRow + dy}`); // chamber
}
const solidTile = (column: number, row: number): boolean =>
  row > SURFACE && !dug.has(`${column},${row}`);

const LW = cols * T;
const LH = rows * T;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
canvas.width = LW;
canvas.height = LH;
g.imageSmoothingEnabled = false;
canvas.style.width = `${LW * scale}px`;
canvas.style.height = `${LH * scale}px`;

// rock + background + stalactites, at this depth
composeBand(g, solidTile, bandLeft, bandTop, cols, rows, WIDTH, SURFACE);

// ore blocks (all of them — the harness always reveals ore; use lamp=0 for raw art)
for (let row = bandTop; row < bandTop + rows; row++) {
  for (let column = bandLeft; column < bandLeft + cols; column++) {
    if (!solidTile(column, row)) continue;
    const oreId = blockAt(seed, column, row).ore;
    const art = oreId ? ORE_ART[oreId] : null;
    if (!art || art.dim) continue;
    const sameOre = (dColumn: number, dRow: number): boolean =>
      solidTile(column + dColumn, row + dRow) &&
      oreAt(seed, column + dColumn, row + dRow) === oreId;
    drawOreBlock(g, art, (column - bandLeft) * T, (row - bandTop) * T, column, row, 0, sameOre);
  }
}

if (showMiner) drawMiner(g, (centerColumn - bandLeft) * T, (centerRow - bandTop) * T, 'down', 0);

// lighting: camX/camY map this crop's screen pixels to world pixels
if (applyLamp) {
  const lighting = createLighting();
  const camX = bandLeft * T;
  const camY = bandTop * T;
  lighting.addLight(
    centerColumn * T + 8,
    centerRow * T + 8,
    0,
    LAMP_COLOR,
    LAMP_BASE_INTENSITY + LAMP_VISION_GAIN * vision,
  );
  for (let row = bandTop; row < bandTop + rows; row++) {
    for (let column = bandLeft; column < bandLeft + cols; column++) {
      if (!solidTile(column, row)) continue;
      const oreId = blockAt(seed, column, row).ore;
      const art = oreId ? ORE_ART[oreId] : null;
      if (!art || art.dim) continue;
      // seed the glow at the exposed open face so it floods the shaft, not the rock behind
      let emitColumn = column;
      let emitRow = row;
      if (!solidTile(column, row - 1)) emitRow = row - 1;
      else if (!solidTile(column, row + 1)) emitRow = row + 1;
      else if (!solidTile(column - 1, row)) emitColumn = column - 1;
      else if (!solidTile(column + 1, row)) emitColumn = column + 1;
      if (emitColumn === column && emitRow === row) continue;
      const [r, gg, b] = hexRgb(art.c[2]);
      lighting.addLight(
        emitColumn * T + (T >> 1),
        emitRow * T + (T >> 1),
        1,
        [r / 255, gg / 255, b / 255],
        ORE_EMIT_INTENSITY,
      );
    }
  }
  lighting.render({ g, LW, LH, T, camX, camY, SURFACE: -1, solidTile });
}

document.title = 'ready'; // signal for headless capture
