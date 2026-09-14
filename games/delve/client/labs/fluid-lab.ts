// fluid-lab.ts — the FLIP liquid (#88), over a carved screen of the real world.
//
// The rock is composeBand's, and the liquid collides with its eroded pixel mask. The sim runs in TypeScript
// (client/src/fluid/flip.ts) for now; the liquid is drawn on WebGPU at screen resolution, smooth and
// palette-banded (render/gpu/liquid.wgsl). `window.fluidLab` exposes stats and controls for `pnpm probe`.
//
// Mouse: left pours, right digs a cell, shift-left builds one.
// Keys: space pause · . one frame · N next scene · R reset scene.
// Query: ?scene=N &flip=0.9 &stiffness=133.
import { STRATA, solidAt, surfaceAt, SUB } from '@delve/shared';
import { setStrata, composeBand, buildMask, T } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { createFlip, FLIP_DEFAULTS, type FlipSim } from '../src/fluid/flip';
import liquidWgsl from '../src/render/gpu/liquid.wgsl?raw';

setStrata(STRATA);

const query = new URLSearchParams(location.search);
const number = (key: string, fallback: number): number => {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? value : fallback;
};
const SEED = number('seed', 12345);
const params = {
  ...FLIP_DEFAULTS,
  flipRatio: number('flip', FLIP_DEFAULTS.flipRatio),
  driftStiffness: number('stiffness', FLIP_DEFAULTS.driftStiffness),
};
let paused = false;

// ---- the band -------------------------------------------------------------------------------------------

const cols = Math.max(24, Math.floor(innerWidth / (T * UPSCALE)));
const rows = Math.max(16, Math.floor(innerHeight / (T * UPSCALE)));
const width = cols * T;
const height = rows * T;
const bandLeft = 2400 * SUB - (cols >> 1);
const bandTop = 180; // deep enough that there's no sky
const surfaceOf = (column: number): number => surfaceAt(SEED, column);
const dug = new Set<string>();
const built = new Set<string>();
const key = (column: number, row: number): string => `${column},${row}`;
const isSolid = (column: number, row: number): boolean =>
  built.has(key(column, row)) || (solidAt(SEED, column, row) && !dug.has(key(column, row)));
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

// ---- scenes -----------------------------------------------------------------------------------------------
// Cells are band-relative; fills are in cells too.

interface Scene {
  name: string;
  hint: string;
  setup(fill: (c0: number, r0: number, c1: number, r1: number) => void): void;
}

const SCENES: Scene[] = [
  {
    name: 'reservoir',
    hint: 'a reservoir behind a one-cell wall — right-drag the wall to breach it',
    setup(fill) {
      const wall = Math.floor(cols * 0.45);
      carve(3, 4, cols - 3, rows - 4);
      build(wall, 4, wall + 1, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      fill(3, 9, wall, rows - 4);
    },
  },
  {
    name: 'cascade',
    hint: 'a pool on a high shelf with a hole in its floor, falling down ledges',
    setup(fill) {
      carve(3, 3, cols - 3, rows - 3);
      build(3, rows - 4, cols - 3, rows - 3);
      const shelves = 4;
      for (let n = 1; n < shelves; n++) {
        const top = 8 + n * Math.floor((rows - 14) / shelves);
        const left = 6 + n * Math.floor((cols - 16) / shelves) - 6;
        build(left, top, left + 12, top + 1);
      }
      build(3, 8, 16, 9);
      build(15, 3, 16, 8);
      fill(3, 3, 15, 8);
      carve(12, 8, 13, 9); // the hole
    },
  },
  {
    name: 'basin',
    hint: 'an empty basin in the real rock — left-drag to pour',
    setup() {
      const mid = cols >> 1;
      carve(mid - 16, rows - 14, mid + 16, rows - 4);
      carve(mid - 3, 4, mid + 3, rows - 14);
    },
  },
];

// ---- canvases ------------------------------------------------------------------------------------------------

const rockCanvas = document.getElementById('rock') as HTMLCanvasElement;
const liquidCanvas = document.getElementById('liquid') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
rockCanvas.width = width;
rockCanvas.height = height;
const scale = UPSCALE * devicePixelRatio; // device pixels per art pixel
liquidCanvas.width = Math.round(width * scale);
liquidCanvas.height = Math.round(height * scale);
for (const canvas of [rockCanvas, liquidCanvas]) {
  canvas.style.width = `${width * UPSCALE}px`;
  canvas.style.height = `${height * UPSCALE}px`;
}
const rock = rockCanvas.getContext('2d')!;

// ---- WebGPU drawing --------------------------------------------------------------------------------------------

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
const module = device.createShaderModule({ label: 'liquid', code: liquidWgsl });
const additive: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
const splatPipeline = device.createRenderPipeline({
  label: 'splat',
  layout: 'auto',
  vertex: {
    module,
    entryPoint: 'splat_vertex',
    buffers: [
      {
        stepMode: 'instance',
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      },
    ],
  },
  fragment: {
    module,
    entryPoint: 'splat_fragment',
    targets: [{ format: 'r16float', blend: { color: additive, alpha: additive } }],
  },
});
const over: GPUBlendComponent = {
  srcFactor: 'one',
  dstFactor: 'one-minus-src-alpha',
  operation: 'add',
};
const compositePipeline = device.createRenderPipeline({
  label: 'composite',
  layout: 'auto',
  vertex: { module, entryPoint: 'composite_vertex' },
  fragment: {
    module,
    entryPoint: 'composite_fragment',
    targets: [{ format, blend: { color: over, alpha: over } }],
  },
});
const densityTexture = device.createTexture({
  size: [liquidCanvas.width, liquidCanvas.height],
  format: 'r16float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
const viewBuffer = device.createBuffer({
  size: 32,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
let particleBuffer = device.createBuffer({
  size: 8 * 1024,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
const splatGroup = device.createBindGroup({
  layout: splatPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: viewBuffer } }],
});
const compositeGroup = device.createBindGroup({
  layout: compositePipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: viewBuffer } },
    { binding: 1, resource: densityTexture.createView() },
  ],
});

/** The liquid's look, in art pixels — tuning for the author. */
const look = { splatRadius: 3.2, threshold: 0.9, rim: 1.5, deep: 14 };

function draw(sim: FlipSim): void {
  device.queue.writeBuffer(
    viewBuffer,
    0,
    new Float32Array([
      liquidCanvas.width,
      liquidCanvas.height,
      scale,
      look.splatRadius,
      look.threshold,
      look.rim,
      look.deep,
      0,
    ]),
  );
  const bytes = sim.count * 8;
  if (particleBuffer.size < bytes) {
    particleBuffer.destroy();
    particleBuffer = device.createBuffer({
      size: bytes * 2,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  if (sim.count > 0) device.queue.writeBuffer(particleBuffer, 0, sim.positions, 0, sim.count * 2);
  const encoder = device.createCommandEncoder();
  const splat = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: densityTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      },
    ],
  });
  if (sim.count > 0) {
    splat.setPipeline(splatPipeline);
    splat.setBindGroup(0, splatGroup);
    splat.setVertexBuffer(0, particleBuffer);
    splat.draw(6, sim.count);
  }
  splat.end();
  const composite = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      },
    ],
  });
  composite.setPipeline(compositePipeline);
  composite.setBindGroup(0, compositeGroup);
  composite.draw(3);
  composite.end();
  device.queue.submit([encoder.finish()]);
}

// ---- the sim -----------------------------------------------------------------------------------------------------

let solid = new Uint8Array(width * height);
let sim: FlipSim = createFlip(width, height, solid, params);
let sceneIndex = Math.min(SCENES.length - 1, Math.max(0, number('scene', 0)));

function refreshRock(): void {
  composeBand(rock, isSolid, bandLeft, bandTop, cols, rows, surfaceOf);
  solid = new Uint8Array(buildMask(isSolid, width, height, bandLeft, bandTop));
  sim.setSolid(solid);
}

function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  dug.clear();
  built.clear();
  const fills: [number, number, number, number][] = [];
  SCENES[sceneIndex].setup((...rect) => fills.push(rect));
  composeBand(rock, isSolid, bandLeft, bandTop, cols, rows, surfaceOf);
  solid = new Uint8Array(buildMask(isSolid, width, height, bandLeft, bandTop));
  sim = createFlip(width, height, solid, params);
  for (const [c0, r0, c1, r1] of fills) sim.fill(c0 * T, r0 * T, c1 * T, r1 * T);
}

// ---- input --------------------------------------------------------------------------------------------------------

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
  sim.pour(pointer.x, pointer.y, 5, 12);
}

addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'Space') paused = !paused;
  else if (event.code === 'Period') sim.step(1 / 60);
  else if (event.code === 'KeyN') loadScene(sceneIndex + 1);
  else if (event.code === 'KeyR') loadScene(sceneIndex);
  else return;
  event.preventDefault();
});

// ---- the loop ----------------------------------------------------------------------------------------------------

let simMs = 0;
function frame(): void {
  applyPointer();
  if (!paused) {
    const started = performance.now();
    sim.step(1 / 60);
    simMs += (performance.now() - started - simMs) * 0.1;
  }
  draw(sim);
  hud.innerHTML =
    `<b>DELVE · fluid lab</b> — ${SCENES[sceneIndex].name}: ${SCENES[sceneIndex].hint}\n` +
    `${width}×${height} art px   ${sim.count} particles   sim ${simMs.toFixed(1)} ms/frame (TypeScript)${paused ? '   <b>paused</b>' : ''}\n` +
    `flip ${params.flipRatio}   stiffness ${params.driftStiffness}\n` +
    `left pour · right dig · shift-left build · space pause · . step · N scene · R reset` +
    (gpuError ? `\n<b>GPU error:</b> ${gpuError}` : '');
  requestAnimationFrame(frame);
}

Object.assign(window, {
  fluidLab: {
    scene: loadScene,
    pause: (value: boolean) => (paused = value),
    stats: () => ({ particles: sim.count, simMs, gpuError }),
    dig: (c0: number, r0: number, c1: number, r1: number) => {
      carve(c0, r0, c1, r1);
      refreshRock();
    },
    pour: (x: number, y: number, radius: number, limit: number) => sim.pour(x, y, radius, limit),
    look,
  },
});

loadScene(sceneIndex);
requestAnimationFrame(frame);
