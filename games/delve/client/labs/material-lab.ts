// material-lab.ts — inspect materials through the SAME compositor the game uses (cave-render.ts +
// client/src/render/materials/*). Interactive layout: a sidebar grid of every material (click to
// select) + two fixed-size preview panes — the selected material's SURFACE and a CAVE SYSTEM showing
// materials feathering into rock and each other. The panes are a fixed size; `scale` zooms the render
// INSIDE them (never resizes the box). Fully URL-param driven, and `?ui=0` renders a single bare
// preview at the top-left framed by shot.sh's w/h/scale — so material shots need no Playwright.
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { STRATA, all, oreAt, hashXY, vnoise } from '@delve/shared';
import { oreMaterial, collectTwinkleEdges } from '../src/render/materials';
import type { Material, TwinkleEdge } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

setStrata(STRATA);

const BOX_W = 520; // fixed preview-pane size (px); scale zooms the render within it
const BOX_H = 340;

// ---- material catalogue ----
// Two kinds share this list: STRATA (the background rock of a depth band — no shader; it renders as
// plain rock in that depth's blended palette, so we preview it just by digging at that depth) and
// ORES (a shader baked into specific tiles). Selecting a stratum jumps the preview to its depth.
interface Mat {
  slug: string;
  label: string;
  kind: 'strata' | 'ore';
  band: [number, number];
  id?: number; // ore id (to find a vein of this material in the cave); undefined = strata/plain rock
  materialAt?: (column: number, row: number) => Material | null;
}
const slugify = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
const MATS: Mat[] = [];

// strata first (shallow → deep); each spans from its `top` to the next stratum's `top`
const strata = [...all('strata')].sort((a, b) => a.top - b.top);
strata.forEach((s, i) => {
  const bottom = strata[i + 1]?.top ?? s.top + 140;
  MATS.push({ slug: slugify(s.id), label: s.id, kind: 'strata', band: [s.top, bottom] });
});

for (const ore of all('ore')) {
  const material = oreMaterial(ore.id);
  if (material)
    MATS.push({
      slug: slugify(ore.name),
      label: ore.name,
      kind: 'ore',
      band: ore.band as [number, number],
      id: ore.id,
      materialAt: () => material,
    });
}
const matBySlug = (slug: string): Mat => MATS.find((m) => m.slug === slug) ?? MATS[0];
const bandMid = (m: Mat): number => Math.floor((m.band[0] + m.band[1]) / 2);

// ---- state (URL params) ----
const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const state = {
  mat: params.get('mat') ?? 'gold',
  view: params.get('view') ?? 'both', // 'both' | 'surface' | 'cave'
  scale: num('scale', 2), // default to the game's on-screen scale (2× the 16px art)
  lit: num('lit', 1) === 1,
  depth: num('depth', 0), // 0 → derive from the selected material's band
  seed: num('seed', 1234),
  w: num('w', 8), // bare-shot block size (tiles)
  h: num('h', 6),
  ui: num('ui', 1) === 1,
};
if (!state.depth) state.depth = bandMid(matBySlug(state.mat));

// ---- rendering helpers (draw at logical res into a canvas; caller sets CSS display size) ----
function lamp(
  g: CanvasRenderingContext2D,
  lw: number,
  lh: number,
  worldX: number,
  worldY: number,
  bandLeft: number,
  bandTop: number,
  solid: (c: number, r: number) => boolean,
): void {
  const lighting = createLighting();
  lighting.addLight(worldX, worldY, 0, LAMP_COLOR, 1.9);
  lighting.render({
    g,
    LW: lw,
    LH: lh,
    T,
    camX: bandLeft * T,
    camY: bandTop * T,
    SURFACE: -1,
    solidTile: solid,
  });
}

// the selected material as a top-lit block (row 0 open → top light), optional lamp
function renderSurface(
  canvas: HTMLCanvasElement,
  m: Mat,
  cols: number,
  rows: number,
  depth: number,
): void {
  canvas.width = cols * T;
  canvas.height = rows * T;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const solid = (_c: number, r: number): boolean => r >= depth + 1;
  composeBand(g, solid, 0, depth, cols, rows, cols, -1, m.materialAt);
  if (state.lit) lamp(g, cols * T, rows * T, (cols >> 1) * T, (depth + 1) * T, 0, depth, solid);
}

// an organic, seed-varied cavern in real world-gen, so several materials feather into the rock + each
// other. Regen (new seed) changes both the cave shape and the ore, so it's never the same cave twice.
let caveEdges: TwinkleEdge[] = [];
let caveBaked: ImageData | null = null;

// centre the cave window on a vein of the selected material, so clicking it reliably shows it in situ
function caveBandLeft(m: Mat, cols: number, midRow: number): number {
  if (m.id === undefined) return 0; // rock — nothing to centre on
  for (let c = 0; c < 800; c++)
    for (let dr = -3; dr <= 3; dr++)
      if (oreAt(state.seed, c, midRow + dr) === m.id) return Math.max(0, c - (cols >> 1));
  return 0;
}

function renderCave(
  canvas: HTMLCanvasElement,
  m: Mat,
  cols: number,
  rows: number,
  depth: number,
): void {
  canvas.width = cols * T;
  canvas.height = rows * T;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const cy = depth + (rows >> 1);
  const bandLeft = caveBandLeft(m, cols, cy);
  const cx = bandLeft + (cols >> 1);
  const caveSeed = (state.seed * 2654435761) >>> 0;
  // organic caverns from world-noise (varied per seed) + a guaranteed open pocket for the lamp
  const open = (c: number, r: number): boolean =>
    r > 0 && (Math.hypot(c - cx, r - cy) < 3.5 || vnoise(c * 0.15, r * 0.15, caveSeed) > 0.58);
  const solid = (c: number, r: number): boolean => r > 0 && !open(c, r);
  const materialAt = (c: number, r: number): Material | null =>
    oreMaterial(oreAt(state.seed, c, r));
  composeBand(g, solid, bandLeft, depth, cols, rows, cols, -1, materialAt);
  const litRadius = Math.max(6, Math.min(cols, rows) * 0.6);
  const litOf = (c: number, r: number): number =>
    Math.max(0, 1 - Math.hypot(c - cx, r - cy) / litRadius);
  if (state.lit) lamp(g, cols * T, rows * T, cx * T + 8, cy * T + 8, bandLeft, depth, solid);
  caveEdges = collectTwinkleEdges({
    bandLeft,
    bandTop: depth,
    cols,
    rows,
    solid,
    materialAt,
    lit: litOf,
    seedAt: (c, r) => hashXY(c, r, 55),
  });
  caveBaked = g.getImageData(0, 0, cols * T, rows * T);
}

// tile counts that fill a fixed box at the current zoom (ceil so it always covers; box crops overflow)
const fitCols = (boxPx: number): number => Math.max(2, Math.ceil(boxPx / (T * state.scale)));
const cssSize = (canvas: HTMLCanvasElement): void => {
  canvas.style.width = `${canvas.width * state.scale}px`;
  canvas.style.height = `${canvas.height * state.scale}px`;
};

let animGen = 0;

function render(): void {
  animGen++;
  const m = matBySlug(state.mat);
  const depth = state.depth;

  if (!state.ui) {
    // bare mode for shot.sh: one preview at top-left, framed by w/h/scale
    document.getElementById('ui')!.classList.add('hidden');
    const app = document.getElementById('app')!;
    app.style.padding = '0';
    app.innerHTML = '';
    const canvas = document.createElement('canvas');
    if (state.view === 'cave') renderCave(canvas, m, state.w, state.h, depth);
    else renderSurface(canvas, m, state.w, state.h, depth);
    cssSize(canvas);
    app.append(canvas);
    if (state.view === 'cave') animateCave(canvas);
    return;
  }

  renderSidebar();
  const cols = fitCols(BOX_W);
  const rows = fitCols(BOX_H);
  const surfacePane = document.getElementById('surfacePane')!;
  const cavePane = document.getElementById('cavePane')!;
  surfacePane.style.display = state.view === 'cave' ? 'none' : '';
  cavePane.style.display = state.view === 'surface' ? 'none' : '';
  document.getElementById('surfaceLabel')!.textContent = `Surface — ${m.label}`;

  if (state.view !== 'cave') {
    const box = document.getElementById('surfaceBox')!;
    box.innerHTML = '';
    const canvas = document.createElement('canvas');
    renderSurface(canvas, m, cols, rows, depth);
    cssSize(canvas);
    box.append(canvas);
  }
  if (state.view !== 'surface') {
    const box = document.getElementById('caveBox')!;
    box.innerHTML = '';
    const canvas = document.createElement('canvas');
    renderCave(canvas, m, cols, rows, depth);
    cssSize(canvas);
    box.append(canvas);
    animateCave(canvas);
  }
}

// redraw the cave's animated twinkle over its baked surface each frame
function animateCave(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d')!;
  const baked = caveBaked;
  const edges = caveEdges;
  const gen = animGen;
  const frame = (now: number): void => {
    if (gen !== animGen || !baked) return;
    g.putImageData(baked, 0, 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const time = now / 1000;
    for (const e of edges)
      e.material.twinkle?.({
        g,
        x0: e.x0,
        y0: e.y0,
        x1: e.x1,
        y1: e.y1,
        scale: 1,
        time,
        seed: e.seed,
        litAt: e.litAt,
      });
    g.restore();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderSidebar(): void {
  const sidebar = document.getElementById('sidebar')!;
  sidebar.innerHTML = '';
  let lastKind = '';
  for (const m of MATS) {
    if (m.kind !== lastKind) {
      lastKind = m.kind;
      const head = document.createElement('div');
      head.className = 'group';
      head.textContent = m.kind === 'strata' ? 'Strata (rock by depth)' : 'Ores';
      sidebar.append(head);
    }
    const cell = document.createElement('div');
    cell.className = 'swatch' + (m.slug === state.mat ? ' sel' : '');
    const canvas = document.createElement('canvas');
    renderSurface(canvas, m, 5, 4, bandMid(m)); // small fixed swatch (its own strata context)
    canvas.style.width = '92px';
    canvas.style.height = `${(92 / (5 * T)) * (4 * T)}px`;
    cell.append(canvas);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = m.label;
    cell.append(label);
    cell.addEventListener('click', () => {
      state.mat = m.slug;
      state.depth = bandMid(m); // jump the cave to where this material lives
      updateDepthInput();
      sync();
      render();
    });
    sidebar.append(cell);
  }
}

// ---- controls ----
function sync(): void {
  const q = new URLSearchParams();
  q.set('mat', state.mat);
  q.set('view', state.view);
  q.set('scale', String(state.scale));
  q.set('lit', state.lit ? '1' : '0');
  q.set('depth', String(state.depth));
  history.replaceState(null, '', `?${q}`);
}
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const viewSel = el<HTMLSelectElement>('view');
const litBox = el<HTMLInputElement>('lit');
const scaleInput = el<HTMLInputElement>('scale');
const depthInput = el<HTMLInputElement>('depth');
function updateDepthInput(): void {
  depthInput.value = String(state.depth);
  el('depthv').textContent = String(state.depth);
}
viewSel.value = state.view;
litBox.checked = state.lit;
scaleInput.value = String(state.scale);
el('scalev').textContent = `${state.scale}×`;
updateDepthInput();

viewSel.addEventListener('change', () => ((state.view = viewSel.value), sync(), render()));
litBox.addEventListener('change', () => ((state.lit = litBox.checked), sync(), render()));
scaleInput.addEventListener('input', () => {
  state.scale = +scaleInput.value;
  el('scalev').textContent = `${state.scale}×`;
  sync();
  render();
});
depthInput.addEventListener('input', () => {
  state.depth = +depthInput.value;
  el('depthv').textContent = String(state.depth);
  sync();
  render();
});
el('regen').addEventListener('click', () => ((state.seed = (Math.random() * 1e9) | 0), render()));

render();
