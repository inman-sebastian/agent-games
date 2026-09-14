// fluid-lab.ts — the pixel fluid (#87), on the GPU, over a carved screen of the real world.
//
// The rock is drawn by composeBand (the reference renderer) and is the liquid's collision through its own
// eroded pixel mask (buildMask). The liquid runs on WebGPU (render/gpu/fluid.ts) and draws on a canvas
// above it. `window.fluidLab` exposes the checks for `pnpm probe --eval`; `parity()` is the one that
// matters: the same scene through the TypeScript twin and the GPU, which must agree exactly.
//
// Mouse: left pours (1 water · 2 lava · 3 erase), right digs a cell, shift-left builds one.
// Keys: space pause · . one frame · [ ] passes per frame · N next scene · R reset scene.
// Query: ?scene=N &passes=P &energy=E &sight=S &lava=chance(0–1024).
import { STRATA, solidAt, surfaceAt, SUB, hashXY } from '@delve/shared';
import { setStrata, composeBand, buildMask, T } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { createGpuFluid, MAX_PASSES_PER_STEP, type BrushMode } from '../src/render/gpu/fluid';
import {
  DEFAULT_PARAMS,
  LAVA,
  WATER,
  kindOf,
  liquid,
  stepFluid,
  createFluidGrid,
  type FluidGrid,
} from '../src/fluid/rule';

setStrata(STRATA);

const query = new URLSearchParams(location.search);
const number = (key: string, fallback: number): number => {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? value : fallback;
};
const SEED = number('seed', 12345);
const params = {
  ...DEFAULT_PARAMS,
  energy: number('energy', DEFAULT_PARAMS.energy),
  sight: number('sight', DEFAULT_PARAMS.sight),
  chance: [0, DEFAULT_PARAMS.chance[WATER], number('lava', DEFAULT_PARAMS.chance[LAVA])] as const,
};
let passesPerFrame = number('passes', 8);
let paused = false;

// ---- the band -------------------------------------------------------------------------------------------

const cols = Math.max(24, Math.floor(innerWidth / (T * UPSCALE)));
const rows = Math.max(16, Math.floor(innerHeight / (T * UPSCALE)));
const width = cols * T;
const height = rows * T;
// deep enough that there's no sky: the question here is the liquid, not the surface
const bandLeft = 2400 * SUB - (cols >> 1);
const bandTop = 180;
const surfaceOf = (column: number): number => surfaceAt(SEED, column);

const dug = new Set<string>();
const built = new Set<string>();
const key = (column: number, row: number): string => `${column},${row}`;
const isSolid = (column: number, row: number): boolean =>
  built.has(key(column, row)) || (solidAt(SEED, column, row) && !dug.has(key(column, row)));

// ---- scenes -----------------------------------------------------------------------------------------------
// Cells are band-relative. Each scene carves, builds, and fills pixels with liquid.

interface Scene {
  name: string;
  hint: string;
  setup(
    fill: (x0: number, y0: number, x1: number, y1: number, kind: number, energy: number) => void,
  ): void;
}

const carve = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      dug.add(key(bandLeft + c, bandTop + r));
      built.delete(key(bandLeft + c, bandTop + r));
    }
  }
};
const build = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) built.add(key(bandLeft + c, bandTop + r));
};

const SCENES: Scene[] = [
  {
    name: 'reservoir',
    hint: 'a settled reservoir behind a one-cell wall — right-drag the wall to breach it',
    setup(fill) {
      const wall = Math.floor(cols * 0.45);
      carve(3, 4, cols - 3, rows - 4);
      build(wall, 4, wall + 1, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      fill(3 * T, 9 * T, wall * T, (rows - 4) * T, WATER, 0);
    },
  },
  {
    name: 'cascade',
    hint: 'a pool on a high shelf with a hole in its floor, falling down ledges',
    setup(fill) {
      carve(3, 3, cols - 3, rows - 3);
      build(3, rows - 4, cols - 3, rows - 3);
      const shelves = 4;
      for (let n = 0; n < shelves; n++) {
        const top = 8 + n * Math.floor((rows - 14) / shelves);
        const left = 3 + n * Math.floor((cols - 10) / shelves);
        build(left, top, left + 10, top + 1);
      }
      build(3, 3, 4, 8);
      build(12, 3, 13, 8);
      fill(4 * T, 3 * T, 12 * T, 8 * T, WATER, params.energy);
      carve(9, 8, 10, 9); // the hole
    },
  },
  {
    name: 'lava meets water',
    hint: 'a lava pocket above a water pool, joined by a shaft — lava sinks through water',
    setup(fill) {
      const mid = cols >> 1;
      carve(mid - 12, rows - 12, mid + 12, rows - 4);
      carve(mid - 1, 8, mid + 1, rows - 12);
      carve(mid - 8, 4, mid + 8, 8);
      build(mid - 12, rows - 4, mid + 12, rows - 3);
      fill((mid - 12) * T, (rows - 8) * T, (mid + 12) * T, (rows - 4) * T, WATER, 0);
      fill((mid - 8) * T, 4 * T, (mid + 8) * T, 8 * T, LAVA, 0);
    },
  },
];

// ---- canvases, GPU ------------------------------------------------------------------------------------------

const rockCanvas = document.getElementById('rock') as HTMLCanvasElement;
const liquidCanvas = document.getElementById('liquid') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
for (const canvas of [rockCanvas, liquidCanvas]) {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * UPSCALE}px`;
  canvas.style.height = `${height * UPSCALE}px`;
}
const rock = rockCanvas.getContext('2d')!;

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) {
  hud.textContent = 'fluid-lab needs WebGPU';
  throw new Error('no WebGPU adapter');
}
const device = await adapter.requestDevice();
let gpuError: string | null = null;
device.addEventListener('uncapturederror', (event) => {
  gpuError ??= (event as GPUUncapturedErrorEvent).error.message;
  console.error(`fluid-lab GPU: ${gpuError}`);
});
const context = liquidCanvas.getContext('webgpu')!;
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'premultiplied' });
const fluid = createGpuFluid(device, width, height);
fluid.params = params;

let solid = new Uint8Array(width * height);
function refreshRock(): void {
  composeBand(rock, isSolid, bandLeft, bandTop, cols, rows, surfaceOf);
  solid = new Uint8Array(buildMask(isSolid, width, height, bandLeft, bandTop));
  fluid.setSolid(solid);
}

let sceneIndex = Math.min(SCENES.length - 1, Math.max(0, number('scene', 0)));
/** The scene's starting liquid, kept for parity. */
let initialState = new Uint32Array(width * height);

function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  dug.clear();
  built.clear();
  const state = new Uint32Array(width * height);
  const pending: [number, number, number, number, number, number][] = [];
  SCENES[sceneIndex].setup((...args) => pending.push(args));
  refreshRock();
  // Each fill floods the open pixels connected to its rectangle, no higher than its top and at most a cell
  // past its other sides — so the rock's eroded notches around a pool start full, as a generated lake's
  // would. A rectangle alone leaves hundreds of open notch pixels, and pressure rightly drains the top
  // rows into them, which scattered the surface into single-pixel spikes.
  for (const [x0, y0, x1, y1, kind, energy] of pending) {
    const inBounds = (x: number, y: number): boolean =>
      x >= Math.max(0, x0 - T) &&
      x < Math.min(width, x1 + T) &&
      y >= y0 &&
      y < Math.min(height, y1 + T);
    const queue: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) queue.push(y * width + x);
    while (queue.length > 0) {
      const i = queue.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (solid[i] || kindOf(state[i]) !== 0) continue;
      state[i] = liquid(kind, (hashXY(x, y, 7) & 1) === 1, energy);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y + 1],
      ]) {
        if (inBounds(nx, ny)) queue.push(ny * width + nx);
      }
    }
  }
  initialState = state;
  fluid.reset(state);
}

// ---- input --------------------------------------------------------------------------------------------------

let brushMode: BrushMode = 'water';
const pointer = { down: false, button: 0, shift: false, x: 0, y: 0 };
const toArt = (event: PointerEvent): { x: number; y: number } => {
  const box = liquidCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * width,
    y: ((event.clientY - box.top) / box.height) * height,
  };
};
liquidCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
liquidCanvas.addEventListener('pointerdown', (event) => {
  Object.assign(pointer, { down: true, button: event.button, shift: event.shiftKey }, toArt(event));
  liquidCanvas.setPointerCapture(event.pointerId);
});
liquidCanvas.addEventListener('pointermove', (event) => Object.assign(pointer, toArt(event)));
liquidCanvas.addEventListener('pointerup', () => (pointer.down = false));

function applyPointer(): void {
  if (!pointer.down) return;
  const column = bandLeft + Math.floor(pointer.x / T);
  const row = bandTop + Math.floor(pointer.y / T);
  if (pointer.button === 2 || pointer.shift) {
    const cell = key(column, row);
    const building = pointer.shift && pointer.button === 0;
    if (building ? built.has(cell) : !isSolid(column, row)) return;
    if (building) built.add(cell);
    else {
      built.delete(cell);
      dug.add(cell);
    }
    refreshRock();
    return;
  }
  fluid.brush(pointer.x, pointer.y, 4, brushMode);
}

addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'Digit1') brushMode = 'water';
  else if (event.code === 'Digit2') brushMode = 'lava';
  else if (event.code === 'Digit3') brushMode = 'erase';
  else if (event.code === 'Space') paused = !paused;
  else if (event.code === 'Period') runPasses(passesPerFrame);
  else if (event.code === 'BracketLeft') passesPerFrame = Math.max(1, passesPerFrame >> 1);
  else if (event.code === 'BracketRight') passesPerFrame = Math.min(256, passesPerFrame * 2);
  else if (event.code === 'KeyN') loadScene(sceneIndex + 1);
  else if (event.code === 'KeyR') loadScene(sceneIndex);
  else return;
  event.preventDefault();
});

// ---- the loop -----------------------------------------------------------------------------------------------

function runPasses(passes: number): void {
  for (let left = passes; left > 0; left -= MAX_PASSES_PER_STEP)
    fluid.step(Math.min(left, MAX_PASSES_PER_STEP));
}

const counts = { water: 0, lava: 0 };
let frameNumber = 0;
let stepMs = 0;
async function measure(): Promise<{ water: number; lava: number }> {
  const state = await fluid.read();
  let water = 0;
  let lava = 0;
  for (const value of state) {
    const kind = kindOf(value);
    if (kind === WATER) water++;
    else if (kind === LAVA) lava++;
  }
  Object.assign(counts, { water, lava });
  return { water, lava };
}

function frame(): void {
  applyPointer();
  if (!paused) {
    const started = performance.now();
    runPasses(passesPerFrame);
    void device.queue.onSubmittedWorkDone().then(() => {
      stepMs += (performance.now() - started - stepMs) * 0.1;
    });
  }
  fluid.draw(context.getCurrentTexture().createView(), format, 'clear');
  if (++frameNumber % 30 === 0) void measure();
  hud.innerHTML =
    `<b>DELVE · fluid lab</b> — ${SCENES[sceneIndex].name}: ${SCENES[sceneIndex].hint}\n` +
    `${width}×${height} art px   pass ${fluid.pass}   ${passesPerFrame} passes/frame${paused ? '   <b>paused</b>' : ''}   ~${stepMs.toFixed(1)} ms to GPU done\n` +
    `water ${counts.water}   lava ${counts.lava}   brush <b>${brushMode}</b>   energy ${params.energy}   sight ${params.sight}\n` +
    `left pour (1 water · 2 lava · 3 erase) · right dig · shift-left build · space pause · . step · [ ] passes · N scene · R reset` +
    (gpuError ? `\n<b>GPU error:</b> ${gpuError}` : '');
  requestAnimationFrame(frame);
}

// ---- checks for probe ----------------------------------------------------------------------------------------

/**
 * The scene's starting liquid, stepped `passes` passes through the TypeScript twin and through the GPU from
 * pass 0. The rule is integers and hashes, so they must agree exactly; any difference is a porting bug.
 */
async function parity(
  passes = 256,
): Promise<{ passes: number; identical: boolean; differing: number; first: unknown }> {
  const wasPaused = paused;
  paused = true;
  fluid.reset(initialState);
  const grid: FluidGrid = createFluidGrid(width, height, solid);
  grid.state = initialState.slice();
  for (let pass = 0; pass < passes; pass++) stepFluid(grid, pass, params);
  runPasses(passes);
  const gpu = await fluid.read();
  let differing = 0;
  let first: unknown = null;
  for (let i = 0; i < gpu.length; i++) {
    if (gpu[i] === grid.state[i]) continue;
    differing++;
    first ??= {
      x: i % width,
      y: Math.floor(i / width),
      cpu: grid.state[i].toString(16),
      gpu: gpu[i].toString(16),
    };
  }
  paused = wasPaused;
  return { passes, identical: differing === 0 && !gpuError, differing, first: gpuError ?? first };
}

Object.assign(window, {
  fluidLab: {
    parity,
    counts: measure,
    scene: loadScene,
    step: runPasses,
    pause: (value: boolean) => (paused = value),
    pour: (x: number, y: number, radius: number, mode: BrushMode) =>
      fluid.brush(x, y, radius, mode),
    dig: (c0: number, r0: number, c1: number, r1: number) => {
      carve(c0, r0, c1, r1);
      refreshRock();
    },
    error: () => gpuError,
    /** A text picture of a region: # rock, ~ water, * lava, . empty; lowercase-ish marks liquid inside rock. */
    dump: async (x0: number, y0: number, x1: number, y1: number) => {
      const state = await fluid.read();
      const rows: string[] = [];
      for (let y = y0; y < y1; y++) {
        let row = '';
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          const kind = kindOf(state[i]);
          row += solid[i] ? (kind ? '!' : '#') : kind === WATER ? '~' : kind === LAVA ? '*' : '.';
        }
        rows.push(row);
      }
      return rows;
    },
  },
});

loadScene(sceneIndex);
requestAnimationFrame(frame);
