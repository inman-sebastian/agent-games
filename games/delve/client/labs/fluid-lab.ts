// fluid-lab.ts — interactive surface water (#89): flat water bodies in a carved screen of the real world, with
// a spring-ripple surface (client/src/fluid/surface.ts), splashes, and a pixel water shader
// (render/gpu/water.wgsl). Step 1 of the plan in docs/FLUIDS.md: the look and the feel, no flow yet.
//
// Mouse: click drops a pebble · drag through the water stirs it.
// Keys: N next scene · R reset · space pause · P snap the water to art pixels (for comparison).
// `window.fluidLab` exposes controls and stats for `pnpm probe`.
import { STRATA, solidAt, surfaceAt, SUB } from '@delve/shared';
import { setStrata, composeBand, buildMask, T } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import {
  createSurface,
  WATER_SURFACE,
  type Surface,
  type SurfaceParams,
} from '../src/fluid/surface';
import waterWgsl from '../src/render/gpu/water.wgsl?raw';

setStrata(STRATA);

const GRAVITY = 736; // engine.GRAVITY in art px/s² — pebbles and droplets fall with the player

// ---- the band ---------------------------------------------------------------------------------------------

const cols = Math.max(24, Math.floor(innerWidth / (T * UPSCALE)));
const rows = Math.max(16, Math.floor(innerHeight / (T * UPSCALE)));
const width = cols * T;
const height = rows * T;
const bandLeft = 2400 * SUB - (cols >> 1);
const bandTop = 180; // deep enough that there's no sky
const SEED = 12345;
const dug = new Set<string>();
const built = new Set<string>();
const key = (column: number, row: number): string => `${column},${row}`;
const isSolid = (column: number, row: number): boolean =>
  built.has(key(column, row)) || (solidAt(SEED, column, row) && !dug.has(key(column, row)));
const carve = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) dug.add(key(bandLeft + c, bandTop + r));
};
const build = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) built.add(key(bandLeft + c, bandTop + r));
};

// ---- palettes ------------------------------------------------------------------------------------------------

interface Kind {
  surface: SurfaceParams;
  /** Look uniforms: surface line, body tint (rgb 0–255, a = tint opacity). */
  colours: number[][];
  /** waver amplitude px (0: off), frequency, speed, glint density */
  waver: number[];
  droplet: string;
}

const WATER: Kind = {
  surface: WATER_SURFACE,
  colours: [
    [143, 211, 255, 1], // #8fd3ff surface line
    [77, 101, 180, 0.55], // #4d65b4 body, see-through
  ],
  waver: [0, 0.35, 3, 0.012],
  droplet: '#8fd3ff',
};

const LAVA: Kind = {
  // thick: slower, stiffer ripples that die fast and never throw far (slow in time, lesson 2)
  surface: { waveSpeed: 40, tension: 30, damping: 4, maxOffset: 4 },
  colours: [
    [251, 255, 134, 1], // #fbff86 surface line
    [232, 59, 59, 0.92], // #e83b3b body, nearly opaque
  ],
  waver: [0, 0.2, 1.2, 0.012],
  droplet: '#f9c22b',
};

// ---- bodies ----------------------------------------------------------------------------------------------------

interface Body {
  kind: Kind;
  /** The level's art-pixel row. */
  level: number;
  /** Art-pixel columns x0 ≤ x < x1. */
  x0: number;
  x1: number;
  /** Per column (relative to x0): the lowest open row of the water below the level. */
  bottom: Int32Array;
  surface: Surface;
}

let open = new Uint8Array(width * height);
let bodies: Body[] = [];

/** A body filling the open pixels at and below `level` across columns x0..x1 (art px). */
function makeBody(kind: Kind, level: number, x0: number, x1: number): Body {
  const bottom = new Int32Array(x1 - x0).fill(level - 1);
  for (let x = x0; x < x1; x++) {
    if (!open[level * width + x]) continue;
    let y = level;
    while (y + 1 < height && open[(y + 1) * width + x]) y++;
    bottom[x - x0] = y;
  }
  return { kind, level, x0, x1, bottom, surface: createSurface(x1 - x0, kind.surface) };
}

interface Scene {
  name: string;
  hint: string;
  setup(): { kind: Kind; levelRow: number; c0: number; c1: number }[];
}

const SCENES: Scene[] = [
  {
    name: 'pool',
    hint: 'a wide pool — click to drop pebbles, drag through the water to stir it',
    setup() {
      carve(3, 4, cols - 3, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      return [{ kind: WATER, levelRow: Math.floor(rows * 0.45), c0: 3, c1: cols - 3 }];
    },
  },
  {
    name: 'cave pools',
    hint: 'water in basins of the real rock, at different levels',
    setup() {
      const mid = cols >> 1;
      carve(4, rows - 12, mid - 2, rows - 4);
      carve(mid + 2, rows - 16, cols - 4, rows - 6);
      carve(4, 4, cols - 4, rows - 16);
      carve(mid - 8, rows - 16, mid - 4, rows - 12);
      return [
        { kind: WATER, levelRow: rows - 9, c0: 4, c1: mid - 2 },
        { kind: WATER, levelRow: rows - 12, c0: mid + 2, c1: cols - 4 },
      ];
    },
  },
  {
    name: 'water and lava',
    hint: 'the same surface, thick: lava ripples slowly and stiffly',
    setup() {
      const mid = cols >> 1;
      carve(3, 6, mid - 1, rows - 4);
      carve(mid + 1, 6, cols - 3, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      return [
        { kind: WATER, levelRow: Math.floor(rows * 0.5), c0: 3, c1: mid - 1 },
        { kind: LAVA, levelRow: Math.floor(rows * 0.5), c0: mid + 1, c1: cols - 3 },
      ];
    },
  },
];

// ---- canvases, GPU --------------------------------------------------------------------------------------------

const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const spriteCanvas = document.getElementById('sprites') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
// the water draws at device resolution so its surface moves smoothly; the rock inside it stays pixelated
const deviceScale = UPSCALE * devicePixelRatio;
sceneCanvas.width = Math.round(width * deviceScale);
sceneCanvas.height = Math.round(height * deviceScale);
spriteCanvas.width = width;
spriteCanvas.height = height;
for (const canvas of [sceneCanvas, spriteCanvas]) {
  canvas.style.width = `${width * UPSCALE}px`;
  canvas.style.height = `${height * UPSCALE}px`;
}
let snap = false;
const sprites = spriteCanvas.getContext('2d')!;
const rockCanvas = Object.assign(document.createElement('canvas'), { width, height });
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
const context = sceneCanvas.getContext('webgpu')!;
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });
const module = device.createShaderModule({ label: 'water', code: waterWgsl });
const pipeline = device.createRenderPipeline({
  label: 'water',
  layout: 'auto',
  vertex: { module, entryPoint: 'water_vertex' },
  fragment: { module, entryPoint: 'water_fragment', targets: [{ format }] },
});
const rockTexture = device.createTexture({
  size: [width, height],
  format: 'rgba8unorm',
  usage:
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
});
/** Look: 32 bytes of header, 4 colour vec4s, 2 waver vec4s. */
const LOOK_BYTES = 32 + 16 * 4 + 8 * 4;
const lookBuffer = device.createBuffer({
  size: LOOK_BYTES,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const columnBuffer = device.createBuffer({
  size: width * 16,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const openBuffer = device.createBuffer({
  size: width * height * 4,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: lookBuffer } },
    { binding: 1, resource: rockTexture.createView() },
    { binding: 2, resource: { buffer: columnBuffer } },
    { binding: 3, resource: { buffer: openBuffer } },
  ],
});
const columnData = new Float32Array(width * 4);

function refreshRock(): void {
  composeBand(rock, isSolid, bandLeft, bandTop, cols, rows, (column) => surfaceAt(SEED, column));
  device.queue.copyExternalImageToTexture({ source: rockCanvas }, { texture: rockTexture }, [
    width,
    height,
  ]);
  const mask = buildMask(isSolid, width, height, bandLeft, bandTop);
  open = new Uint8Array(width * height);
  for (let i = 0; i < open.length; i++) open[i] = mask[i] ? 0 : 1;
  device.queue.writeBuffer(openBuffer, 0, Uint32Array.from(open));
}

let sceneIndex = 0;
function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  dug.clear();
  built.clear();
  const specs = SCENES[sceneIndex].setup();
  refreshRock();
  bodies = specs.map((spec) => makeBody(spec.kind, spec.levelRow * T, spec.c0 * T, spec.c1 * T));
  pebbles.length = 0;
  droplets.length = 0;
}

const KINDS = [WATER, LAVA];

function draw(time: number): void {
  columnData.fill(0);
  for (let x = 0; x < width; x++) columnData[4 * x] = 1; // top > bottom: dry
  for (const body of bodies) {
    for (let i = 0; i < body.x1 - body.x0; i++) {
      if (body.bottom[i] < body.level) continue;
      const at = 4 * (body.x0 + i);
      columnData[at] = body.level + body.surface.offset[i];
      columnData[at + 1] = body.bottom[i];
      columnData[at + 2] = KINDS.indexOf(body.kind);
    }
  }
  device.queue.writeBuffer(columnBuffer, 0, columnData);
  const look = new Float32Array(LOOK_BYTES / 4);
  new Uint32Array(look.buffer, 0, 2).set([width, height]);
  look[2] = time;
  look[3] = deviceScale;
  new Uint32Array(look.buffer, 16, 1).set([snap ? 1 : 0]);
  KINDS.forEach((kind, k) => {
    kind.colours.forEach((colour, band) => look.set(colour, 8 + (k * 2 + band) * 4));
    look.set(kind.waver, 24 + k * 4);
  });
  device.queue.writeBuffer(lookBuffer, 0, look);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 1],
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

// ---- pebbles and droplets ------------------------------------------------------------------------------------

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  submerged: boolean;
  colour: string;
}
const pebbles: Mote[] = [];
const droplets: Mote[] = [];

function bodyAt(x: number): Body | undefined {
  return bodies.find(
    (body) => x >= body.x0 && x < body.x1 && body.bottom[Math.floor(x) - body.x0] >= body.level,
  );
}
const surfaceY = (body: Body, x: number): number =>
  body.level + body.surface.offset[Math.floor(x) - body.x0];

/** Something crossed the surface at x at vertical speed vy: ripple it, and throw droplets if it's fast. */
function splash(body: Body, x: number, vy: number, size: number): void {
  const local = x - body.x0;
  const push = Math.sign(vy) * Math.min(Math.abs(vy) * 0.35, 260);
  body.surface.disturb(local, push, size);
  const count = Math.min(14, Math.floor(Math.abs(vy) / 40));
  for (let n = 0; n < count; n++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = Math.abs(vy) * (0.25 + Math.random() * 0.35);
    droplets.push({
      x: x + (Math.random() - 0.5) * size,
      y: surfaceY(body, x) - 1,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      submerged: false,
      colour: body.kind.droplet,
    });
  }
}

function stepMotes(dt: number): void {
  for (const pebble of pebbles) {
    const body = bodyAt(pebble.x);
    const wasSubmerged = pebble.submerged;
    pebble.vy += GRAVITY * dt * (pebble.submerged ? 0.15 : 1);
    if (pebble.submerged) pebble.vy *= 1 - 3 * dt; // water drags it
    pebble.y += pebble.vy * dt;
    if (body) {
      const surface = surfaceY(body, pebble.x);
      pebble.submerged = pebble.y >= surface;
      if (pebble.submerged && !wasSubmerged) splash(body, pebble.x, pebble.vy, 3);
      if (pebble.y >= body.bottom[Math.floor(pebble.x) - body.x0]) pebble.y = Infinity;
    } else if (pebble.y >= height || !open[Math.floor(pebble.y) * width + Math.floor(pebble.x)]) {
      pebble.y = Infinity;
    }
  }
  for (let i = pebbles.length - 1; i >= 0; i--)
    if (!Number.isFinite(pebbles[i].y)) pebbles.splice(i, 1);

  for (const drop of droplets) {
    drop.vy += GRAVITY * dt;
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    const body = bodyAt(drop.x);
    const ix = Math.floor(drop.x);
    const iy = Math.floor(drop.y);
    const gone =
      ix < 0 ||
      iy < 0 ||
      ix >= width ||
      iy >= height ||
      !open[iy * width + ix] ||
      (drop.vy > 0 && body !== undefined && drop.y >= surfaceY(body, drop.x));
    if (gone) {
      if (body && drop.vy > 0) body.surface.disturb(drop.x - body.x0, drop.vy * 0.04, 1);
      drop.y = Infinity;
    }
  }
  for (let i = droplets.length - 1; i >= 0; i--)
    if (!Number.isFinite(droplets[i].y)) droplets.splice(i, 1);
}

function drawMotes(): void {
  sprites.clearRect(0, 0, width, height);
  for (const drop of droplets) {
    sprites.fillStyle = drop.colour;
    sprites.fillRect(Math.floor(drop.x), Math.floor(drop.y), 1, 1);
  }
  sprites.fillStyle = '#9babb2';
  for (const pebble of pebbles)
    sprites.fillRect(Math.floor(pebble.x) - 1, Math.floor(pebble.y) - 1, 2, 2);
}

// ---- input ------------------------------------------------------------------------------------------------------

const pointer = { down: false, moved: false, x: 0, y: 0, lastY: 0 };
const toArt = (event: PointerEvent): { x: number; y: number } => {
  const box = spriteCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * width,
    y: ((event.clientY - box.top) / box.height) * height,
  };
};
spriteCanvas.addEventListener('pointerdown', (event) => {
  const at = toArt(event);
  Object.assign(pointer, { down: true, moved: false, x: at.x, y: at.y, lastY: at.y });
  spriteCanvas.setPointerCapture(event.pointerId);
});
spriteCanvas.addEventListener('pointermove', (event) => {
  const at = toArt(event);
  if (pointer.down && Math.hypot(at.x - pointer.x, at.y - pointer.y) > 2) pointer.moved = true;
  Object.assign(pointer, at);
});
spriteCanvas.addEventListener('pointerup', () => {
  if (!pointer.moved) dropPebble(pointer.x, pointer.y);
  pointer.down = false;
});

function dropPebble(x: number, y: number): void {
  pebbles.push({ x, y, vx: 0, vy: 0, submerged: false, colour: '#9babb2' });
}

/** Dragging through the water stirs it: the pointer's vertical motion across and under the surface. */
function stir(dt: number): void {
  if (!pointer.down || !pointer.moved) return;
  const body = bodyAt(pointer.x);
  if (!body) return;
  const surface = surfaceY(body, pointer.x);
  const vy = (pointer.y - pointer.lastY) / dt;
  const crossed = pointer.lastY < surface !== pointer.y < surface;
  if (crossed) splash(body, pointer.x, vy, 4);
  else if (pointer.y > surface && pointer.y - surface < 24)
    body.surface.disturb(pointer.x - body.x0, vy * 0.08, 5);
  pointer.lastY = pointer.y;
}

let paused = false;
addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'KeyN') loadScene(sceneIndex + 1);
  else if (event.code === 'KeyR') loadScene(sceneIndex);
  else if (event.code === 'Space') paused = !paused;
  else if (event.code === 'KeyP') snap = !snap;
  else return;
  event.preventDefault();
});

// ---- the loop ---------------------------------------------------------------------------------------------------

let last = performance.now();
let elapsed = 0;
function frame(now: number): void {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (!paused) {
    elapsed += dt;
    stir(dt);
    stepMotes(dt);
    for (const body of bodies) body.surface.step(dt);
  }
  draw(elapsed);
  drawMotes();
  hud.innerHTML =
    `<b>DELVE · water lab</b> — ${SCENES[sceneIndex].name}: ${SCENES[sceneIndex].hint}\n` +
    `click drop a pebble · drag stir · N scene · R reset · space pause · P ${snap ? '<b>snapped to art pixels</b>' : 'smooth surface'}` +
    (gpuError ? `\n<b>GPU error:</b> ${gpuError}` : '');
  requestAnimationFrame(frame);
}

Object.assign(window, {
  fluidLab: {
    scene: loadScene,
    drop: dropPebble,
    splash: (x: number, speed: number) => {
      const body = bodyAt(x);
      if (body) splash(body, x, speed, 4);
    },
    stats: () => ({
      bodies: bodies.map((body) => ({ level: body.level, amplitude: body.surface.amplitude })),
      droplets: droplets.length,
      pebbles: pebbles.length,
      gpuError,
    }),
    pause: (value: boolean) => (paused = value),
    snap: (value: boolean) => (snap = value),
  },
});

loadScene(Number(new URLSearchParams(location.search).get('scene') ?? 0));
requestAnimationFrame(frame);
