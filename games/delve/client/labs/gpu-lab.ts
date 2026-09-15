// gpu-lab.ts — the WebGPU spike (#69). One carved screen of the real world, rendered two ways:
//
//   cpu   the Canvas 2D path the game uses — composeBand for the rock, lighting.ts for the light
//   gpu   the WebGPU compute pipeline in client/src/render/gpu/, fed the same world and light field
//   diff  both, once, and a heatmap of where they disagree
//
// It answers the spike's questions with numbers: what a full frame costs each way at this window size,
// and how close the GPU port is, pixel for pixel. `window.gpuLab` exposes both for `pnpm probe --eval`.
//
// It is also the RENDER GATE (#80): `gpuLab.gate()` diffs a fixed set of views — near the surface, down
// through the strata to bedrock, lit and unlit — and fails on drift past the tolerance measured when the
// port landed. composeBand is the golden image, so an art change needs its TypeScript and WGSL twins to
// agree, not a re-blessed PNG. Run it with `pnpm render-gate` (tools/README.md).
import { STRATA, solidAt, surfaceAt, oreAt, SUB, shapeAt, skyRowAt } from '@delve/shared';
import { setStrata, composeBand, T, hashXY } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { oreMaterial, allOreMaterials, collectTwinkleEdges } from '../src/render/materials';
import { drawPlayer, placePlayer, poseFor } from '../src/render/entity/player';
import { createQuadBatch } from '../src/render/gpu/quads';
import { hexRgb } from '../src/render/palette';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';
import type { FieldPlan } from '../src/render/lighting';
import { bandFor, createGpuRenderer, GpuUnavailable } from '../src/render/gpu/renderer';
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
const HISTOGRAM_BUCKETS = 10;

type Mode = 'gpu' | 'cpu' | 'diff';
let mode: Mode = (['gpu', 'cpu', 'diff'] as const).find((m) => m === query.get('mode')) ?? 'gpu';
let lightingOn = query.get('light') !== '0';
let panning = query.get('pan') === '1';

let centre = { column: number('c', 2400 * SUB), row: number('r', 26) };
let camera = { ...centre };

// A shaft down from the surface, a chamber, and a long tunnel — so the frame has sky, hills, strata,
// eroded edges, and somewhere for the lamp's light to go.
const dug = new Set<string>();
const carve = (column: number, row: number): void => {
  dug.add(`${column},${row}`);
};
function carveAround({ column, row }: { column: number; row: number }): void {
  for (let r = surfaceAt(SEED, column) - 1; r <= row + 3; r++) {
    carve(column, r);
    carve(column + 1, r);
  }
  for (let r = row - 2; r <= row + 3; r++) {
    for (let c = column - 5; c <= column + 6; c++) carve(c, r);
  }
  for (let c = column - 60; c <= column + 60; c++) {
    carve(c, row + 2);
    carve(c, row + 3);
  }
}
carveAround(centre);
const isSolid = (column: number, row: number): boolean =>
  solidAt(SEED, column, row) && !dug.has(`${column},${row}`);
const surfaceOf = (column: number): number => skyRowAt(SEED, column);
/**
 * The slope sampler (#94): while it's on, every solid cell next to open space near the centre takes one of the
 * four slopes by a hash of the cell — the world's heightmap has no overhangs, so its ceiling slopes would
 * otherwise never reach the gate.
 */
let sampleSlopes = query.get('slopes') === '1';
const shapeOf = (column: number, row: number): number => {
  if (sampleSlopes && Math.abs(column - centre.column) < 40 && Math.abs(row - centre.row) < 20) {
    const open = (c: number, r: number): boolean => !isSolid(c, r);
    if (
      open(column, row - 1) ||
      open(column, row + 1) ||
      open(column - 1, row) ||
      open(column + 1, row)
    )
      return 1 + ((Math.imul((column * 73856093) ^ (row * 19349663), 0x9e3779b1) >>> 29) % 4);
  }
  return shapeAt(SEED, column, row);
};
// Ores on both paths unless `?ores=0`: the materials are what #73 ported, and what the diff checks.
const oresOn = query.get('ores') !== '0';
const materialAt = (column: number, row: number) =>
  oresOn ? oreMaterial(oreAt(SEED, column, row)) : null;
// The GPU renderer's persistent mirror of the world around the view (the lab never digs after load).
const worldWindow = createWorldWindow({
  solid: isSolid,
  material: (column, row) => (materialAt(column, row) ? oreAt(SEED, column, row) : 0),
  shape: shapeOf,
  surface: surfaceOf,
});

// ---- canvases -------------------------------------------------------------------------------------

// ---- twinkle ---------------------------------------------------------------------------------------
// The ore edges' twinkle, frozen at `?time=` so both paths draw the same glints and the diff can check
// that the GPU ADDS them as Canvas 2D's `lighter` does (#75). Lit the way the game lights it: full within
// a block of the lamp, falling off over its base reach.
const TWINKLE_TIME = number('time', 3.7);
const LAMP_REACH_CELLS = 3.4 * SUB;
const litAt = (column: number, row: number): number => {
  const distance = Math.hypot(column - (centre.column + 0.5), row - (centre.row + 1));
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

// ---- entities ----------------------------------------------------------------------------------------
// The entity pass's parity (#83): the player standing in the chamber, a spray of particles at mixed sizes
// and alphas, and the mining reticle — drawn the Canvas 2D way on the CPU path (exactly as index.ts draws
// them) and as quads on the GPU. Band-relative screen pixels, like composeBand.
const PARTICLE_COLOURS = ['#fdf3d4', '#c28d75', '#7a4841', '#e83b3b', '#4d65b4'];
const PARTICLES = Array.from({ length: 48 }, (_, n) => ({
  dx: (hashXY(n, 1, 91) % 64) - 32,
  dy: (hashXY(n, 2, 91) % 40) - 28,
  size: hashXY(n, 3, 91) % 5 === 0 ? 2 : 1,
  colour: PARTICLE_COLOURS[hashXY(n, 4, 91) % PARTICLE_COLOURS.length],
  alpha: (1 + (hashXY(n, 5, 91) % 9)) / 10,
}));

function entityPlacement(): { originX: number; originY: number; footX: number; footY: number } {
  const { bandLeft, bandTop } = band();
  const originX = (centre.column + 0.5) * T - bandLeft * T;
  const originY = (centre.row + 1) * T - bandTop * T;
  // standing on the chamber's floor, which is the row below the carve (centre.row + 3)
  return { originX, originY, footX: originX, footY: (centre.row + 4) * T - bandTop * T };
}
const RETICLE = { dc: 3, dr: 3, colour: '#fdf3d4', alpha: 0.85 };

/** The screen box the entities cover — particles, the player and the reticle — for the gate's scoped check. */
function entityBox(): { x0: number; y0: number; x1: number; y1: number } {
  const { originX, originY } = entityPlacement();
  return { x0: originX - 40, y0: originY - 56, x1: originX + 40, y1: originY + 5 * T };
}

function drawEntitiesCpu(g: CanvasRenderingContext2D): void {
  const { originX, originY, footX, footY } = entityPlacement();
  for (const p of PARTICLES) {
    g.globalAlpha = p.alpha;
    g.fillStyle = p.colour;
    g.fillRect(Math.round(originX + p.dx), Math.round(originY + p.dy), p.size, p.size);
  }
  g.globalAlpha = 1;
  drawPlayer(g, poseFor('idle', 0), footX, footY, { scale: 1, facing: 'right' });
  const x = Math.floor(originX / T + RETICLE.dc) * T;
  const y = Math.floor(originY / T + RETICLE.dr) * T;
  g.globalAlpha = RETICLE.alpha;
  g.strokeStyle = RETICLE.colour;
  g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
  g.globalAlpha = 1;
}

const quads = createQuadBatch();
function entityQuads(renderer: GpuRenderer): typeof quads {
  const { originX, originY, footX, footY } = entityPlacement();
  quads.clear();
  for (const p of PARTICLES) {
    quads.rect(
      Math.round(originX + p.dx),
      Math.round(originY + p.dy),
      p.size,
      p.size,
      hexRgb(p.colour),
      p.alpha,
    );
  }
  const player = placePlayer(poseFor('idle', 0), footX, footY, { scale: 1, facing: 'right' });
  const slot = renderer.sprite(player.frame.key, player.frame.canvas);
  quads.image(
    player.x,
    player.y,
    player.frame.canvas.width,
    player.frame.canvas.height,
    slot.x,
    slot.y,
  );
  const x = Math.floor(originX / T + RETICLE.dc) * T;
  const y = Math.floor(originY / T + RETICLE.dr) * T;
  quads.outline(x, y, T, T, hexRgb(RETICLE.colour), RETICLE.alpha);
  return quads;
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
  // composed over the band the GPU shades (bandFor), which reaches a cell past the screen; the canvas crops it
  const shaded = bandFor(bandLeft * T, bandTop * T, cols * T, rows * T);
  composeBand(
    cpu,
    isSolid,
    bandLeft,
    bandTop,
    shaded.cols,
    shaded.rows,
    surfaceOf,
    materialAt,
    shapeOf,
  );
  drawTwinkle(cpu);
  drawEntitiesCpu(cpu);
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
  const field: FieldPlan = lighting.plan({
    ...lightingView(),
    surfaceAt: surfaceOf,
    solidTile: isSolid,
  });
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
    quads: entityQuads(gpu),
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
  /** Pixels by difference: index n counts differences of exactly n, the last bucket everything above. */
  histogram: number[];
  /** The same histogram inside `entityBox`, where a small broken sprite or particle can't hide. */
  entityHistogram: number[];
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
  const histogram = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  const entityHistogram = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  const entities = entityBox();
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
    histogram[Math.min(HISTOGRAM_BUCKETS - 1, difference)]++;
    const px = (i / 4) % (cols * T);
    const py = Math.floor(i / 4 / (cols * T));
    if (px >= entities.x0 && px < entities.x1 && py >= entities.y0 && py < entities.y1)
      entityHistogram[Math.min(HISTOGRAM_BUCKETS - 1, difference)]++;
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
    histogram,
    entityHistogram,
    outliers,
  };
  return diffStats;
}

// ---- the render gate ---------------------------------------------------------------------------------

/**
 * The views the gate diffs: the default screen with sky and hills, then one per stratum band down to
 * the bedrock above the floor (row 1400), each unlit (the rock and materials) and lit (the composite).
 * Columns vary so the ore pockets differ.
 */
const GATE_ROWS = [26, 120, 400, 700, 1000, 1250, 1385];
const STRATA_VIEWS = GATE_ROWS.flatMap((row, index) =>
  [false, true].map((lit) => ({ column: 2400 * SUB + index * 97, row, lit, label: 'strata' })),
);
/** The slope sampler's views, unlit and lit: all four slopes on the tunnel and chamber's faces. */
const SLOPE_VIEWS = [false, true].map((lit) => ({
  column: 2400 * SUB + 31,
  row: 160,
  lit,
  label: 'slopes',
}));

/**
 * The nearest pocket of an ore to the default column, scanning down (the world is 1400 rows deep) and
 * outward. A material whose ore never appears in a strata view would otherwise pass the gate untested.
 */
function findPocket(ore: number): { column: number; row: number } | null {
  for (let row = 20; row < 1400; row += 2) {
    for (let offset = 0; offset < 400; offset += 2) {
      const column = 2400 * SUB + offset;
      if (oreAt(SEED, column, row) === ore) return { column, row };
    }
  }
  return null;
}

/**
 * Tolerances, as fractions of the frame. The port isn't bit-exact everywhere: a few hundredths of a
 * percent of pixels sit on a float-rounding edge (a quantise threshold, a distance tie) and land on a
 * neighbouring band, some far off, so a max-difference limit would fail on noise.
 *
 * - Unlit, ≥99.9% of pixels identical: the rock and materials port exactly but for those edges
 *   (measured ≥99.96%).
 * - Every view, ≤0.1% of pixels off by more than GATE_OFF_LEVELS. Lighting's bilinear glow rounds
 *   differently by a level or two over most lit pixels, so "identical" says nothing there; past three
 *   levels is where a real change shows. Measured #82: ≤0.01% in every lit view. A light that stopped
 *   short (half the propagation steps) put 0.4% there, rock conducting like open space 1.4%.
 */
const GATE_UNLIT_IDENTICAL = 0.999;
const GATE_OFF_LEVELS = 3;
const GATE_OFF_FRACTION = 0.001;
/**
 * The same check inside the entity box (#83), where the particles and the player are a few hundred
 * pixels a whole-frame fraction can't see: unpremultiplied particles moved 98 of the box's 7,680 pixels
 * past three levels and passed the frame check. Clean views measure at most 9 (0.12%).
 */
const GATE_ENTITY_OFF_FRACTION = 0.005;

interface GateView {
  label: string;
  column: number;
  row: number;
  lit: boolean;
  identical: string;
  withinSmall: string;
  mean: number;
  histogram: number[];
  entityHistogram: number[];
  glints: number;
}

async function gate(): Promise<{ pass: boolean; failures: string[]; views: GateView[] }> {
  const failures: string[] = [];
  const views: GateView[] = [];
  if (!gpu) return { pass: false, failures: [`no WebGPU: ${gpuError}`], views };
  const restore = { centre, camera, lightingOn, mode };
  mode = 'diff'; // the loop draws nothing over the diff while the gate runs
  const percent = (fraction: number): string => `${(100 * fraction).toFixed(3)}%`;
  // one unlit view on a pocket of every registered material, its top face exposed on the tunnel's floor
  // (rows +2 and +3 from the centre) so the top light reaches it — buried ore is too dark to test much
  const materialViews = allOreMaterials().flatMap(([ore, material]) => {
    const pocket = findPocket(ore);
    if (!pocket) failures.push(`${material.name}: no pocket of ore ${ore} found to check`);
    return pocket
      ? [{ column: pocket.column, row: pocket.row - 4, lit: false, label: material.name }]
      : [];
  });
  let glintsSeen = 0;
  for (const view of [...STRATA_VIEWS, ...SLOPE_VIEWS, ...materialViews]) {
    sampleSlopes = view.label === 'slopes';
    centre = { column: view.column, row: view.row };
    camera = { ...centre };
    lightingOn = view.lit;
    carveAround(centre);
    worldWindow.reset();
    const stats = (await runDiff())!;
    const identical = stats.identical / stats.pixels;
    const withinSmall = stats.withinSmall / stats.pixels;
    glintsSeen += stats.glintPixels;
    views.push({
      ...view,
      identical: percent(identical),
      withinSmall: percent(withinSmall),
      mean: Number(stats.meanDifference.toFixed(4)),
      histogram: stats.histogram,
      entityHistogram: stats.entityHistogram,
      glints: stats.glintPixels,
    });
    const where = `${view.label} ${view.column},${view.row} ${view.lit ? 'lit' : 'unlit'}`;
    const off =
      stats.histogram.slice(GATE_OFF_LEVELS + 1).reduce((a, b) => a + b, 0) / stats.pixels;
    if (off > GATE_OFF_FRACTION)
      failures.push(
        `${where}: ${percent(off)} off by more than ${GATE_OFF_LEVELS} levels, above ${percent(GATE_OFF_FRACTION)}`,
      );
    const boxPixels = stats.entityHistogram.reduce((a, b) => a + b, 0);
    const entityOff =
      stats.entityHistogram.slice(GATE_OFF_LEVELS + 1).reduce((a, b) => a + b, 0) / boxPixels;
    if (entityOff > GATE_ENTITY_OFF_FRACTION)
      failures.push(
        `${where}: ${percent(entityOff)} of the entity box off by more than ${GATE_OFF_LEVELS} levels, above ${percent(GATE_ENTITY_OFF_FRACTION)}`,
      );
    if (!view.lit && identical < GATE_UNLIT_IDENTICAL)
      failures.push(
        `${where}: ${percent(identical)} identical, below ${percent(GATE_UNLIT_IDENTICAL)}`,
      );
  }
  // a gate whose views never drew a glint hasn't checked the additive blend
  if (glintsSeen === 0) failures.push('no view drew a twinkle glint');
  if (gpu.lastError) failures.push(`GPU error: ${gpu.lastError}`);
  ({ centre, camera, lightingOn, mode } = restore);
  sampleSlopes = false;
  worldWindow.reset();
  worldWindow.reset();
  const pass = failures.length === 0;
  document.title = pass ? 'PASS' : 'FAIL';
  return { pass, failures, views };
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
    gate,
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
