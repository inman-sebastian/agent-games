// material-lab.ts — an interactive lab for the material rendering system. Renders every material
// through the SAME shared compositor the game uses (client/src/render/cave-render.ts), each coloured
// by its own shader (client/src/render/materials/*). Two views: isolated top-lit swatches, and a
// real world-gen vein field so you can see materials feathering into the rock in context.
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { clamp01 } from '../src/render/palette';
import { STRATA, oreAt, all, hashXY } from '@delve/shared';
import { oreMaterial, collectTwinkleEdges } from '../src/render/materials';
import type { Material, TwinkleEdge } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

setStrata(STRATA);

// one scratch buffer at logical resolution; everything renders into it then upscales pixelated
const lbuf = document.createElement('canvas');
const lb = lbuf.getContext('2d')!;

// ---- swatches: rock + every ore that has a material, each an isolated top-lit block ----
interface Swatch {
  name: string;
  materialAt?: (column: number, row: number) => Material | null; // undefined → plain rock
}
const swatches: Swatch[] = [{ name: 'Rock' }];
for (const ore of all('ore')) {
  const material = oreMaterial(ore.id);
  if (material) swatches.push({ name: ore.name, materialAt: () => material });
}

const SWATCH_COLS = 5;
const SWATCH_ROWS = 4;
const SWATCH_DEPTH = 120; // representative depth (sets the Rock swatch's strata palette)
const OPEN_TOP = 1; // rows of open space above each block, so it reads top-lit
const LABEL_H = 20;
const GAP = 10;

const SWATCH_MAX_WIDTH = 900; // wrap swatches into rows so every material stays visible

function renderSwatches(scale: number): void {
  const canvas = document.getElementById('swatches') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const cellW = SWATCH_COLS * T * scale;
  const cellH = SWATCH_ROWS * T * scale;
  const perRow = Math.max(1, Math.floor((SWATCH_MAX_WIDTH + GAP) / (cellW + GAP)));
  const rows = Math.ceil(swatches.length / perRow);
  const rowH = cellH + LABEL_H;
  canvas.width = Math.min(swatches.length, perRow) * (cellW + GAP) - GAP;
  canvas.height = rows * (rowH + GAP) - GAP;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  swatches.forEach((swatch, i) => {
    lbuf.width = SWATCH_COLS * T;
    lbuf.height = SWATCH_ROWS * T;
    lb.imageSmoothingEnabled = false;
    const solid = (_c: number, r: number): boolean => r >= SWATCH_DEPTH + OPEN_TOP; // open top → top-lit
    composeBand(lb, solid, 0, SWATCH_DEPTH, SWATCH_COLS, SWATCH_ROWS, SWATCH_COLS, -1, swatch.materialAt);
    const x = (i % perRow) * (cellW + GAP);
    const y = Math.floor(i / perRow) * (rowH + GAP);
    g.drawImage(lbuf, 0, 0, SWATCH_COLS * T, SWATCH_ROWS * T, x, y, cellW, cellH);
    g.fillStyle = '#b9c4d2';
    g.font = '600 11px ui-sans-serif';
    g.fillText(swatch.name, x + cellW / 2, y + cellH + LABEL_H / 2);
  });
}

// ---- field: real world-gen veins around a dug shaft + chamber, feathering into the rock ----
const FIELD_COLS = 46;
const FIELD_ROWS = 26;
let fieldSeed = 1234;

// The field is composited ONCE into an offscreen buffer; a per-frame loop blits it and draws each
// exposed, lit vein's animated twinkle on top (the baked surface can't animate, so twinkle is an
// overlay — exactly how the game will drive material.twinkle).
const fieldBaked = document.createElement('canvas');
const fbctx = fieldBaked.getContext('2d')!;

interface FieldState {
  bandLeft: number;
  bandTop: number;
  scale: number;
  shaftColumn: number;
  chamberRow: number;
  lw: number;
  lh: number;
  solid: (c: number, r: number) => boolean;
  materialAt: (c: number, r: number) => Material | null;
  edges: TwinkleEdge[]; // exposed lit cluster faces, one glint each (computed once at bake)
}
let field: FieldState | null = null;

const LIT_RADIUS = 13; // tiles from the lamp within which veins are "lit" enough to twinkle

function bakeField(scale: number, lamp: boolean, depth: number): void {
  const bandLeft = 0;
  const bandTop = depth;
  const shaftColumn = FIELD_COLS >> 1;
  const chamberRow = depth + (FIELD_ROWS >> 1);

  // carve a shaft down the centre + a chamber, so vein faces are exposed (and lit)
  const dug = new Set<string>();
  for (let r = bandTop; r <= chamberRow; r++) dug.add(`${shaftColumn},${r}`);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -3; dx <= 3; dx++) dug.add(`${shaftColumn + dx},${chamberRow + dy}`);
  const solid = (c: number, r: number): boolean => r > 0 && !dug.has(`${c},${r}`);
  const materialAt = (c: number, r: number): Material | null => oreMaterial(oreAt(fieldSeed, c, r));

  const lw = FIELD_COLS * T;
  const lh = FIELD_ROWS * T;
  fieldBaked.width = lw;
  fieldBaked.height = lh;
  fbctx.imageSmoothingEnabled = false;
  composeBand(fbctx, solid, bandLeft, bandTop, FIELD_COLS, FIELD_ROWS, FIELD_COLS, -1, materialAt);
  if (lamp) {
    const lighting = createLighting();
    lighting.addLight(shaftColumn * T + 8, chamberRow * T + 8, 0, LAMP_COLOR, 1.7);
    lighting.render({
      g: fbctx,
      LW: lw,
      LH: lh,
      T,
      camX: bandLeft * T,
      camY: bandTop * T,
      SURFACE: -1,
      solidTile: solid,
    });
  }

  const canvas = document.getElementById('field') as HTMLCanvasElement;
  canvas.width = lw * scale;
  canvas.height = lh * scale;
  canvas.getContext('2d')!.imageSmoothingEnabled = false;

  // group exposed same-material tiles into lit cluster edges — one twinkle each (see fx.ts)
  const litOf = (c: number, r: number): number =>
    clamp01(1 - Math.hypot(c - shaftColumn, r - chamberRow) / LIT_RADIUS);
  const edges = collectTwinkleEdges({
    bandLeft,
    bandTop,
    cols: FIELD_COLS,
    rows: FIELD_ROWS,
    solid,
    materialAt,
    lit: litOf,
    seedAt: (c, r) => hashXY(c, r, 55),
  });

  field = { bandLeft, bandTop, scale, shaftColumn, chamberRow, lw, lh, solid, materialAt, edges };
}

function animate(now: number): void {
  const fs = field;
  if (fs) {
    const g = (document.getElementById('field') as HTMLCanvasElement).getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, fs.lw * fs.scale, fs.lh * fs.scale);
    g.drawImage(fieldBaked, 0, 0, fs.lw, fs.lh, 0, 0, fs.lw * fs.scale, fs.lh * fs.scale);
    g.save();
    g.globalCompositeOperation = 'lighter'; // glints add light
    const time = now / 1000;
    for (const edge of fs.edges) {
      edge.material.twinkle!({
        g,
        x0: edge.x0 * fs.scale,
        y0: edge.y0 * fs.scale,
        x1: edge.x1 * fs.scale,
        y1: edge.y1 * fs.scale,
        scale: fs.scale,
        time,
        seed: edge.seed,
        litAt: edge.litAt,
      });
    }
    g.restore();
  }
  requestAnimationFrame(animate);
}

// ---- controls ----
const el = (id: string): HTMLElement => document.getElementById(id)!;
function renderAll(): void {
  const scale = parseInt((el('zoom') as HTMLInputElement).value, 10);
  const depth = parseInt((el('depth') as HTMLInputElement).value, 10);
  const lamp = (el('lamp') as HTMLInputElement).checked;
  el('zoomv').textContent = scale + '×';
  el('depthv').textContent = String(depth);
  renderSwatches(scale);
  bakeField(scale, lamp, depth);
}
for (const input of document.querySelectorAll('input')) input.addEventListener('input', renderAll);
el('regen').addEventListener('click', () => {
  fieldSeed = (Math.random() * 1e9) | 0;
  renderAll();
});
renderAll();
requestAnimationFrame(animate);
