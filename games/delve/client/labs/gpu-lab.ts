// gpu-lab.ts — the WebGPU spike (#69). One carved screen of the real world, rendered two ways:
//
//   cpu   the Canvas 2D path the game uses — composeBand for the rock, lighting.ts for the light
//   gpu   the WebGPU compute pipeline in client/src/render/gpu/, fed the same world and light field
//   diff  both, once, and a heatmap of where they disagree
//
// It answers the spike's questions with numbers: what a full frame costs each way at this window size,
// and how close the GPU port is, pixel for pixel. `window.gpuLab` exposes both for `pnpm probe --eval`.
// Pure dev tool.
import { STRATA, solidAt, surfaceAt, oreAt, SUB } from '@delve/shared';
import { setStrata, composeBand, T, hashXY } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { oreMaterial, collectTwinkleEdges } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';
import type { LightField } from '../src/render/lighting';
import { createGpuRenderer, GpuUnavailable, bandFor } from '../src/render/gpu/renderer';
import { createWorldWindow } from '../src/render/gpu/world-window';
import type { GpuRenderer } from '../src/render/gpu/renderer';

setStrata(STRATA);

// ---- the scene ------------------------------------------------------------------------------------

const query = new URLSearchParams(location.search);
const number = (key: string, fallback: number): number => {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? value : fallback;
};
const SEED = number('seed', 12345);
const LAMP_INTENSITY = 0.9 + 0.16 * 3.4; // index.ts: LAMP_BASE_INTENSITY + LAMP_REACH_GAIN × base reach
const DIFF_SMALL = 8; // a channel difference up to this reads as "the same colour" on screen
const COST_SMOOTHING = 0.1;

type Mode = 'gpu' | 'cpu' | 'diff';
let mode: Mode = (['gpu', 'cpu', 'diff'] as const).find((m) => m === query.get('mode')) ?? 'gpu';
let lightingOn = query.get('light') !== '0';
let panning = query.get('pan') === '1';

const centre = { column: number('c', 2400 * SUB), row: number('r', 26) };
let camera = { ...centre };

// A shaft down from the surface, a chamber, and a long tunnel — so the frame has sky, hills, strata,
// eroded edges, stalactites, and somewhere for the lamp's light to go.
const dug = new Set<string>();
const carve = (column: number, row: number): void => {
  dug.add(`${column},${row}`);
};
for (let row = surfaceAt(SEED, centre.column) - 1; row <= centre.row + 3; row++) {
  carve(centre.column, row);
  carve(centre.column + 1, row);
}
for (let row = centre.row - 2; row <= centre.row + 3; row++) {
  for (let column = centre.column - 5; column <= centre.column + 6; column++) carve(column, row);
}
for (let column = centre.column - 60; column <= centre.column + 60; column++) {
  carve(column, centre.row + 2);
  carve(column, centre.row + 3);
}
const isSolid = (column: number, row: number): boolean =>
  solidAt(SEED, column, row) && !dug.has(`${column},${row}`);
const surfaceOf = (column: number): number => surfaceAt(SEED, column);
// Ores on both paths unless `?ores=0`: the materials are what #73 ported, and what the diff checks.
const oresOn = query.get('ores') !== '0';
const materialAt = (column: number, row: number) =>
  oresOn ? oreMaterial(oreAt(SEED, column, row)) : null;
// The GPU renderer's persistent mirror of the world around the view (the lab never digs after load).
const worldWindow = createWorldWindow({
  solid: isSolid,
  material: (column, row) => (materialAt(column, row) ? oreAt(SEED, column, row) : 0),
  surface: surfaceOf,
});

// ---- canvases -------------------------------------------------------------------------------------

// ---- twinkle ---------------------------------------------------------------------------------------
// The ore edges' twinkle, frozen at `?time=` so both paths draw the same glints and the diff can check
// that the GPU ADDS them as Canvas 2D's `lighter` does (#75). Lit the way the game lights it: full within
// a block of the lamp, falling off over its base reach.
const TWINKLE_TIME = number('time', 3.7);
const LAMP_REACH_CELLS = 3.4 * SUB;
const lampCell = { column: centre.column + 0.5, row: centre.row + 1 };
const litAt = (column: number, row: number): number => {
  const distance = Math.hypot(column - lampCell.column, row - lampCell.row);
  return Math.max(0.14, 1 - Math.max(0, distance - SUB) / (LAMP_REACH_CELLS + 0.5 * SUB));
};

/** Draw the twinkle glints for the band onto `g` (additively), band-relative like composeBand. */
function drawTwinkle(g: CanvasRenderingContext2D): void {
  const { bandLeft, bandTop } = band();
  const edges = collectTwinkleEdges({
    bandLeft,
    bandTop,
    cols,
    rows,
    solid: isSolid,
    materialAt,
    lit: litAt,
    seedAt: (column, row) => hashXY(column, row, 55),
    minLit: 0.2,
  });
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const edge of edges) {
    edge.material.twinkle!({ ...edge, g, scale: 1, time: TWINKLE_TIME });
  }
  g.restore();
}

const cpuCanvas = document.getElementById('cpu') as HTMLCanvasElement;
const gpuCanvas = document.getElementById('gpu') as HTMLCanvasElement;
const cpu = cpuCanvas.getContext('2d', { willReadFrequently: true })!;
const hud = document.getElementById('hud') as HTMLElement;
const lighting = createLighting();

let cols = 0;
let rows = 0;
function fit(): void {
  cols = Math.max(24, Math.floor(innerWidth / (T * UPSCALE)));
  rows = Math.max(16, Math.floor(innerHeight / (T * UPSCALE)));
  cpuCanvas.width = cols * T;
  cpuCanvas.height = rows * T;
  cpu.imageSmoothingEnabled = false;
  for (const canvas of [cpuCanvas, gpuCanvas]) {
    canvas.style.width = `${cols * T * UPSCALE}px`;
    canvas.style.height = `${rows * T * UPSCALE}px`;
  }
}

const band = (): { bandLeft: number; bandTop: number } => ({
  bandLeft: camera.column - (cols >> 1),
  bandTop: camera.row - (rows >> 1),
});

const lightingView = (): { LW: number; LH: number; T: number; camX: number; camY: number } => {
  const { bandLeft, bandTop } = band();
  return { LW: cols * T, LH: rows * T, T, camX: bandLeft * T, camY: bandTop * T };
};

/** The lamp, in the chamber, re-added before each use because a lighting pass consumes its emitters. */
function addLamp(): void {
  lighting.addLight((centre.column + 0.5) * T, (centre.row + 1) * T, 0, LAMP_COLOR, LAMP_INTENSITY);
}

// ---- the two renderers ------------------------------------------------------------------------------

function renderCpu(): number {
  const started = performance.now();
  const { bandLeft, bandTop } = band();
  composeBand(cpu, isSolid, bandLeft, bandTop, cols, rows, surfaceOf, materialAt);
  drawTwinkle(cpu);
  if (lightingOn) {
    addLamp();
    lighting.render({ g: cpu, ...lightingView(), surfaceAt: surfaceOf, solidTile: isSolid });
  }
  return performance.now() - started;
}

let gpu: GpuRenderer | null = null;
// The GPU path's layers: nothing under (the lab has no damage), and the glints.
const underLayer = document.createElement('canvas');
const glintLayer = document.createElement('canvas');
// WebGPU can't copy from a canvas that has never had a context, so both get theirs up front.
underLayer.getContext('2d');
glintLayer.getContext('2d', { willReadFrequently: true });
let glintPixels = 0;
let gpuError = '';

function renderGpu(): number {
  if (!gpu) return 0;
  const { bandLeft, bandTop } = band();
  if (lightingOn) addLamp();
  const field: LightField = lighting.field({
    ...lightingView(),
    surfaceAt: surfaceOf,
    solidTile: isSolid,
  });
  // The lab's camera sits on cell boundaries, so the GPU band is exactly the CPU band being diffed.
  const gpuBand = bandFor(bandLeft * T, bandTop * T, cols * T, rows * T);
  worldWindow.follow(gpuBand.left, gpuBand.top, gpuBand.cols, gpuBand.rows);
  for (const layer of [underLayer, glintLayer]) {
    layer.width = cols * T;
    layer.height = rows * T;
  }
  drawTwinkle(glintLayer.getContext('2d', { willReadFrequently: true })!);
  const frameCost = gpu.render({
    camX: bandLeft * T,
    camY: bandTop * T,
    width: cols * T,
    height: rows * T,
    world: worldWindow,
    light: field,
    lighting: lightingOn,
    layers: {
      under: underLayer,
      glint: glintLayer,
      box: { x: 0, y: 0, width: cols * T, height: rows * T },
    },
  });
  // The CPU side of a GPU frame, split: the light field (lighting.ts), the world upload, the encode.
  const fieldMs = lighting.fieldMs;
  costSplit = { fieldMs, uploadMs: frameCost.prepareMs, encodeMs: frameCost.encodeMs };
  return fieldMs + frameCost.prepareMs + frameCost.encodeMs;
}
let costSplit = { fieldMs: 0, uploadMs: 0, encodeMs: 0 };

// ---- the diff ---------------------------------------------------------------------------------------

interface DiffStats {
  /** Pixels the twinkle glints cover in this frame — a diff with none hasn't tested the blend. */
  glintPixels: number;
  pixels: number;
  identical: number;
  withinSmall: number;
  maxDifference: number;
  meanDifference: number;
  /** The first few pixels that differ by more than DIFF_SMALL, to go and look at. */
  outliers: { x: number; y: number; cpu: number[]; gpu: number[] }[];
}
let diffStats: DiffStats | null = null;

async function runDiff(): Promise<DiffStats | null> {
  if (!gpu) return null;
  renderCpu();
  renderGpu();
  const { pixels: gpuPixels } = await gpu.readback();
  glintPixels = glintLayer
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, cols * T, rows * T)
    .data.filter((value, index) => index % 4 === 3 && value > 0).length;
  const cpuImage = cpu.getImageData(0, 0, cols * T, rows * T);
  const cpuPixels = cpuImage.data;
  let identical = 0;
  let withinSmall = 0;
  let maxDifference = 0;
  let total = 0;
  const outliers: DiffStats['outliers'] = [];
  const width = cols * T;
  const heat = cpu.createImageData(cols * T, rows * T);
  for (let i = 0; i < cpuPixels.length; i += 4) {
    const difference = Math.max(
      Math.abs(cpuPixels[i] - gpuPixels[i]),
      Math.abs(cpuPixels[i + 1] - gpuPixels[i + 1]),
      Math.abs(cpuPixels[i + 2] - gpuPixels[i + 2]),
    );
    total += difference;
    if (difference === 0) identical++;
    if (difference <= DIFF_SMALL) withinSmall++;
    if (difference > maxDifference) maxDifference = difference;
    if (difference > DIFF_SMALL && outliers.length < 24) {
      const pixel = i / 4;
      outliers.push({
        x: pixel % width,
        y: Math.floor(pixel / width),
        cpu: [cpuPixels[i], cpuPixels[i + 1], cpuPixels[i + 2]],
        gpu: [gpuPixels[i], gpuPixels[i + 1], gpuPixels[i + 2]],
      });
    }
    // the CPU frame, dimmed, with small differences in yellow and large ones in red
    const grey = (cpuPixels[i] + cpuPixels[i + 1] + cpuPixels[i + 2]) / 9;
    const [r, g, b] =
      difference === 0
        ? [grey, grey, grey]
        : difference <= DIFF_SMALL
          ? [251, 185, 84]
          : [232, 59, 59];
    heat.data.set([r, g, b, 255], i);
  }
  cpu.putImageData(heat, 0, 0);
  const pixels = cpuPixels.length / 4;
  diffStats = {
    glintPixels,
    pixels,
    identical,
    withinSmall,
    maxDifference,
    meanDifference: total / pixels,
    outliers,
  };
  return diffStats;
}

// ---- the loop -----------------------------------------------------------------------------------------

const cost = { cpuMs: 0, gpuCpuMs: 0, frameMs: 0, fieldMs: 0, uploadMs: 0, encodeMs: 0 };
let lastFrame = performance.now();
let panClock = 0;
const smooth = (previous: number, sample: number): number =>
  previous === 0 ? sample : previous + (sample - previous) * COST_SMOOTHING;

function frame(now: number): void {
  cost.frameMs = smooth(cost.frameMs, now - lastFrame);
  lastFrame = now;
  if (panning && ++panClock % 4 === 0) camera = { ...camera, column: camera.column + 1 };
  cpuCanvas.hidden = mode === 'gpu';
  gpuCanvas.hidden = mode !== 'gpu';
  if (mode === 'cpu') cost.cpuMs = smooth(cost.cpuMs, renderCpu());
  if (mode === 'gpu') {
    cost.gpuCpuMs = smooth(cost.gpuCpuMs, renderGpu());
    cost.fieldMs = smooth(cost.fieldMs, costSplit.fieldMs);
    cost.uploadMs = smooth(cost.uploadMs, costSplit.uploadMs);
    cost.encodeMs = smooth(cost.encodeMs, costSplit.encodeMs);
  }
  drawHud();
  requestAnimationFrame(frame);
}

function setMode(next: Mode): void {
  mode = next;
  if (mode === 'diff') void runDiff();
}

function drawHud(): void {
  const stats = diffStats;
  const percent = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(2)}%`;
  hud.innerHTML =
    `<b>DELVE · GPU lab</b> — ${cols}×${rows} cells, ${cols * T}×${rows * T} art px\n` +
    `[1] gpu  [2] cpu  [3] diff   now <b>${mode}</b>   [L] lighting ${lightingOn ? 'on' : 'off'}   [P] pan ${panning ? 'on' : 'off'}   arrows move\n` +
    (gpu
      ? `adapter  ${gpu.adapter}${gpu.lastError ? `   <b>GPU error:</b> ${gpu.lastError}` : ''}\n`
      : `<b>no WebGPU:</b> ${gpuError}\n`) +
    `\nframe    ${cost.frameMs.toFixed(1)} ms between frames\n` +
    `cpu      ${cost.cpuMs.toFixed(1)} ms  composeBand${lightingOn ? ' + lighting' : ''}\n` +
    `gpu      ${cost.gpuCpuMs.toFixed(1)} ms on the CPU (field ${cost.fieldMs.toFixed(1)} + world upload ${cost.uploadMs.toFixed(1)} + encode ${cost.encodeMs.toFixed(1)})  ${gpu ? gpu.gpuMs.toFixed(1) : '—'} ms to GPU done\n` +
    (stats
      ? `diff     identical ${percent(stats.identical, stats.pixels)}  within ${DIFF_SMALL}: ${percent(stats.withinSmall, stats.pixels)}  max ${stats.maxDifference}  mean ${stats.meanDifference.toFixed(3)}\n`
      : '');
}

addEventListener('keydown', (event: KeyboardEvent) => {
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (event.code === 'Digit1') setMode('gpu');
  else if (event.code === 'Digit2') setMode('cpu');
  else if (event.code === 'Digit3') setMode('diff');
  else if (event.code === 'KeyL') lightingOn = !lightingOn;
  else if (event.code === 'KeyP') panning = !panning;
  else if (moves[event.code]) {
    const [dc, dr] = moves[event.code];
    camera = { column: camera.column + dc * 4, row: camera.row + dr * 4 };
  } else return;
  event.preventDefault();
  if (mode === 'diff') void runDiff();
});

addEventListener('resize', fit);
fit();

try {
  gpu = await createGpuRenderer(gpuCanvas);
} catch (error) {
  gpuError = error instanceof GpuUnavailable ? error.message : String(error);
  mode = 'cpu';
}

Object.assign(window, {
  gpuLab: {
    runDiff,
    setMode,
    cost: () => ({ ...cost, gpuMs: gpu?.gpuMs ?? null }),
    size: () => ({ cols, rows, width: cols * T, height: rows * T }),
    adapter: () => gpu?.adapter ?? gpuError,
    /** Where this frame's twinkle glints are, with the CPU and GPU colour at each — the additive blend's check. */
    glints: async () => {
      const width = cols * T;
      const height = rows * T;
      renderCpu();
      renderGpu();
      const { pixels: gpuPixels } = gpu ? await gpu.readback() : { pixels: new Uint8Array(0) };
      const cpuPixels = cpu.getImageData(0, 0, width, height).data;
      const layer = glintLayer.getContext('2d')!.getImageData(0, 0, width, height).data;
      const found: { x: number; y: number; cpu: number[]; gpu: number[] }[] = [];
      for (let i = 3; i < layer.length; i += 4) {
        if (layer[i] === 0) continue;
        const pixel = (i - 3) / 4;
        const j = pixel * 4;
        found.push({
          x: pixel % width,
          y: Math.floor(pixel / width),
          cpu: [cpuPixels[j], cpuPixels[j + 1], cpuPixels[j + 2]],
          gpu: [gpuPixels[j], gpuPixels[j + 1], gpuPixels[j + 2]],
        });
      }
      return found;
    },
  },
});
if (mode === 'diff') void runDiff();
requestAnimationFrame(frame);
