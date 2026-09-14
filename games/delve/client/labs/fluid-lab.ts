// fluid-lab.ts — surface water (#89) in a carved screen of the real world. Water bodies are volumes that fill
// the cave from their lowest point (client/src/fluid/bodies.ts); digging moves them — over rims and through
// holes as streams — and each has a spring-ripple surface (client/src/fluid/surface.ts). Drawn by
// render/gpu/water.wgsl. The plan is in docs/FLUIDS.md.
//
// Mouse: click drops a pebble · drag through water stirs it · right-drag digs · shift-drag builds.
// Keys: hold W / L to pour water / lava at the cursor · N next scene · R reset · space pause ·
//       P snap the water to art pixels (for comparison).
// `window.fluidLab` exposes controls and stats for `pnpm probe`.
import { STRATA, solidAt, surfaceAt, SUB } from '@delve/shared';
import {
  setStrata,
  composeBand,
  buildMask,
  T,
  SHADE_INFLUENCE_CELLS,
} from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import {
  createSurface,
  WATER_SURFACE,
  type Surface,
  type SurfaceParams,
} from '../src/fluid/surface';
import {
  createWaterSim,
  WATER,
  LAVA,
  type Body,
  type Stream,
  type WaterSim,
} from '../src/fluid/bodies';
import waterWgsl from '../src/render/gpu/water.wgsl?raw';

setStrata(STRATA);

const GRAVITY = 736; // engine.GRAVITY in art px/s² — pebbles and droplets fall with the player
const POUR_RATE = 1200; // px of volume per second while W / L is held
const MAX_BODIES = 64;
const MAX_STREAMS = 32;

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

// ---- kinds ----------------------------------------------------------------------------------------------------

interface Kind {
  id: number;
  surface: SurfaceParams;
  /** surface line rgb; body tint rgb, a = opacity */
  colours: number[][];
  glint: number;
  droplet: string;
}

const KINDS: Record<number, Kind> = {
  [WATER]: {
    id: WATER,
    surface: WATER_SURFACE,
    colours: [
      [143, 211, 255, 1], // #8fd3ff
      [77, 101, 180, 0.55], // #4d65b4
    ],
    glint: 0.012,
    droplet: '#8fd3ff',
  },
  [LAVA]: {
    id: LAVA,
    // thick: slower, stiffer ripples that die fast and never throw far (slow in time)
    surface: { waveSpeed: 40, tension: 30, damping: 4, viscosity: 20, drag: 0.03, maxOffset: 4 },
    colours: [
      [251, 255, 134, 1], // #fbff86
      [232, 59, 59, 0.92], // #e83b3b
    ],
    glint: 0.012,
    droplet: '#f9c22b',
  },
};

// ---- scenes ------------------------------------------------------------------------------------------------------

interface Scene {
  name: string;
  hint: string;
  /** Carve and build, then return the liquid to pour: kind, art px, volume. */
  setup(): { kind: number; x: number; y: number; volume: number }[];
}

const SCENES: Scene[] = [
  {
    name: 'reservoir',
    hint: 'a reservoir behind a one-cell wall — right-drag the wall to breach it',
    setup() {
      const wall = Math.floor(cols * 0.45);
      carve(3, 4, cols - 3, rows - 4);
      build(wall, 4, wall + 1, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      const depth = (rows - 4 - 10) * T;
      return [{ kind: WATER, x: 5 * T, y: 5 * T, volume: (wall - 3) * T * depth }];
    },
  },
  {
    name: 'pool over a cave',
    hint: 'a pool with a cave under its floor — right-drag down through the floor',
    setup() {
      const mid = cols >> 1;
      carve(mid - 12, 4, mid + 12, 12);
      carve(4, rows - 12, cols - 4, rows - 4);
      return [{ kind: WATER, x: mid * T, y: 5 * T, volume: 24 * T * 5 * T }];
    },
  },
  {
    name: 'terraces',
    hint: 'basins stepping down — hold W over the top one',
    setup() {
      carve(3, 3, cols - 3, rows - 3);
      const steps = 4;
      const stepWidth = Math.floor((cols - 6) / steps);
      for (let n = 0; n < steps; n++) {
        const floor = 10 + n * Math.floor((rows - 14) / steps);
        const left = 3 + n * stepWidth;
        build(left, floor, left + stepWidth, floor + 1);
        build(left + stepWidth - 1, floor - 3, left + stepWidth, floor);
      }
      build(3, rows - 4, cols - 3, rows - 3);
      return [];
    },
  },
  {
    name: 'water and lava',
    hint: 'the same model, thick: lava ripples slowly and stiffly',
    setup() {
      const mid = cols >> 1;
      carve(3, 6, mid - 1, rows - 4);
      carve(mid + 1, 6, cols - 3, rows - 4);
      build(3, rows - 4, cols - 3, rows - 3);
      const volume = (mid - 4) * T * Math.floor(rows * 0.45) * T;
      return [
        { kind: WATER, x: 5 * T, y: 7 * T, volume },
        { kind: LAVA, x: (mid + 3) * T, y: 7 * T, volume },
      ];
    },
  },
];

// ---- canvases, GPU ------------------------------------------------------------------------------------------------

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
const sprites = spriteCanvas.getContext('2d')!;
const rockCanvas = Object.assign(document.createElement('canvas'), { width, height });
const rock = rockCanvas.getContext('2d')!;
let snap = false;

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
const storage = (bytes: number): GPUBuffer =>
  device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
/** Look: 32 bytes of header, 4 colour vec4s, 2 glint vec4s. */
const LOOK_BYTES = 32 + 16 * 4 + 8 * 4;
const lookBuffer = device.createBuffer({
  size: LOOK_BYTES,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const liquidBuffer = storage(width * height * 4);
const bodyBuffer = storage(MAX_BODIES * 32);
const offsetBuffer = storage(width * 16 * 4);
const streamBuffer = storage(MAX_STREAMS * 32);
const openBuffer = storage(width * height * 4);
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: lookBuffer } },
    { binding: 1, resource: rockTexture.createView() },
    { binding: 2, resource: { buffer: liquidBuffer } },
    { binding: 3, resource: { buffer: bodyBuffer } },
    { binding: 4, resource: { buffer: offsetBuffer } },
    { binding: 5, resource: { buffer: streamBuffer } },
    { binding: 6, resource: { buffer: openBuffer } },
  ],
});

// ---- the water ----------------------------------------------------------------------------------------------------

let open = new Uint8Array(width * height);
let sim: WaterSim = createWaterSim(width, height, open);
/** Each body's surface, by body id, over the columns its liquid spans. */
const surfaces = new Map<number, { surface: Surface; x0: number }>();

/** How long the last dig's parts took, ms — the lab's own profiler for rock changes. */
const digTimings: Record<string, number> = {};
const timed = <T>(label: string, work: () => T): T => {
  const started = performance.now();
  const result = work();
  digTimings[label] = Number((performance.now() - started).toFixed(1));
  return result;
};

function refreshRock(): void {
  timed('composeBand', () =>
    composeBand(rock, isSolid, bandLeft, bandTop, cols, rows, (column) => surfaceAt(SEED, column)),
  );
  timed('uploadRock', () =>
    device.queue.copyExternalImageToTexture({ source: rockCanvas }, { texture: rockTexture }, [
      width,
      height,
    ]),
  );
  const mask = timed('buildMask', () => buildMask(isSolid, width, height, bandLeft, bandTop));
  timed('uploadOpen', () => {
    open = new Uint8Array(width * height);
    for (let i = 0; i < open.length; i++) open[i] = mask[i] ? 0 : 1;
    device.queue.writeBuffer(openBuffer, 0, Uint32Array.from(open));
  });
}

/**
 * What's shown this frame, read once from the sim: which body index each pixel shows, and for each body the
 * columns it spans and its top and bottom row in each. Open air above a body's water, up to rock or another
 * body, is marked with AIR_ABOVE and the body's index: a surface higher than the body's level (a surge, a
 * crest) is drawn there.
 */
const AIR_ABOVE = 0x10000;
interface Shown {
  liquid: Uint32Array<ArrayBuffer>;
  spans: Map<
    number,
    { index: number; x0: number; x1: number; tops: Int32Array; bottoms: Int32Array }
  >;
}
let shownFrame: Shown = { liquid: new Uint32Array(0), spans: new Map() };

function scanShown(): void {
  const liquid = new Uint32Array(width * height);
  const spans: Shown['spans'] = new Map();
  const indexOf = new Map(sim.bodies.slice(0, MAX_BODIES).map((body, index) => [body.id, index]));
  for (let i = 0; i < width * height; i++) {
    const body = sim.bodyAt(i);
    if (!body) continue;
    const index = indexOf.get(body.id);
    if (index === undefined) continue;
    liquid[i] = index + 1;
    const x = i % width;
    const y = (i - x) / width;
    let span = spans.get(body.id);
    if (!span) {
      span = {
        index,
        x0: x,
        x1: x + 1,
        tops: new Int32Array(width).fill(-1),
        bottoms: new Int32Array(width).fill(-1),
      };
      spans.set(body.id, span);
    }
    if (x < span.x0) span.x0 = x;
    if (x + 1 > span.x1) span.x1 = x + 1;
    if (span.tops[x] < 0) span.tops[x] = y; // row-major: the first seen is the highest
    span.bottoms[x] = y;
  }
  // the open air over each body's water, column by column from the bottom
  for (let x = 0; x < width; x++) {
    let over = 0;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      if (liquid[i] !== 0) over = liquid[i];
      else if (!open[i]) over = 0;
      else if (over !== 0) liquid[i] = AIR_ABOVE | over;
    }
  }
  shownFrame = { liquid, spans };
}

/** Each column's drawn surface as the previous frame left it, to carry across the sim's changes. */
type Carried = { id: number; trueTop: number; drawnTop: number; velocity: number }[][];

function captureSurfaces(): Carried {
  const carried: Carried = Array.from({ length: width }, () => []);
  for (const [id, span] of shownFrame.spans) {
    const entry = surfaces.get(id);
    if (!entry) continue;
    for (let x = span.x0; x < span.x1; x++) {
      const top = span.tops[x];
      if (top < 0) continue;
      const c = x - entry.x0;
      if (c < 0 || c >= entry.surface.columns) continue;
      carried[x].push({
        id,
        trueTop: top,
        drawnTop: top + entry.surface.offset[c],
        velocity: entry.surface.velocity[c],
      });
    }
  }
  return carried;
}

/**
 * Rebuild each body's surface over its columns, carrying the drawn surface across whatever the sim just did.
 * A column keeps its drawn height as an offset from its new true top, so when a dig joins a pool to empty
 * space the high side and the empty side start as one big displacement, and the surface wave carries it as a
 * surge that settles at the true level. (Moving shown pixels instead, top first, left a wall of water
 * standing where the rock had been.) A column new to water rises from its floor.
 */
function syncSurfaces(carried: Carried | null): void {
  const next = new Map<number, { surface: Surface; x0: number }>();
  const live = new Set(sim.bodies.map((body) => body.id));
  for (const body of sim.bodies) {
    const span = shownFrame.spans.get(body.id);
    if (!span) continue;
    const columns = span.x1 - span.x0;
    // no cap: a surge is as big as the difference it's levelling
    const surface = createSurface(columns, { ...KINDS[body.kind].surface, maxOffset: height });
    for (let c = 0; c < columns; c++) {
      const x = span.x0 + c;
      const top = span.tops[x];
      if (top < 0 || !carried) continue;
      let best: Carried[number][number] | null = null;
      for (const candidate of carried[x]) {
        // its own surface, or one merged into it: never another body's that still exists (the pool above)
        if (candidate.id !== body.id && live.has(candidate.id)) continue;
        if (Math.abs(candidate.trueTop - top) > CARRY_REACH) continue;
        if (!best || Math.abs(candidate.trueTop - top) < Math.abs(best.trueTop - top))
          best = candidate;
      }
      if (best) {
        surface.offset[c] = best.drawnTop - top;
        surface.velocity[c] = best.velocity;
      } else {
        surface.offset[c] = span.bottoms[x] + 1 - top;
      }
    }
    next.set(body.id, { surface, x0: span.x0 });
  }
  surfaces.clear();
  for (const [id, entry] of next) surfaces.set(id, entry);
}
/** How far a column's true top can move in one step and still carry its drawn surface, art px. */
const CARRY_REACH = 320;

let sceneIndex = 0;
function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  dug.clear();
  built.clear();
  const pours = SCENES[sceneIndex].setup();
  refreshRock();
  sim = createWaterSim(width, height, open);
  surfaces.clear();
  for (const pour of pours) sim.add(pour.kind, pour.x, pour.y, pour.volume);
  scanShown();
  syncSurfaces(null);
  pebbles.length = 0;
  droplets.length = 0;
}

/** The body at a point, and its surface row there: its liquid, or the body just below a crest. */
function waterAt(x: number, y: number): { body: Body; surfaceY: number } | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= width || iy < 0 || iy >= height) return null;
  for (let k = 0; k <= 10 && iy + k < height; k++) {
    const body = sim.bodyAt((iy + k) * width + ix);
    if (!body) continue;
    const entry = surfaces.get(body.id);
    const offset = entry
      ? entry.surface.offset[Math.min(entry.surface.columns - 1, Math.max(0, ix - entry.x0))]
      : 0;
    const top = shownFrame.spans.get(body.id)?.tops[ix] ?? -1;
    return { body, surfaceY: (top >= 0 ? top : iy + k) + offset };
  }
  return null;
}

function disturbAt(body: Body, x: number, speed: number, radius: number): void {
  const entry = surfaces.get(body.id);
  if (entry) entry.surface.disturb(x - entry.x0, speed, radius);
}

// ---- drawing --------------------------------------------------------------------------------------------------------

/** Over an open lip the surface bends down to the sheet leaving it, over this many sheet thicknesses… */
const SPILLWAY_REACH_PER_THICKNESS = 2;
const SPILLWAY_MIN_REACH = 6;
const SPILLWAY_MAX_REACH = 24;

function draw(time: number): void {
  const info = new Float32Array(MAX_BODIES * 8);
  const offsets = new Float32Array(width * 16);
  let offsetCount = 0;
  for (const body of sim.bodies.slice(0, MAX_BODIES)) {
    const span = shownFrame.spans.get(body.id);
    const entry = surfaces.get(body.id);
    if (!span) continue;
    const columns = span.x1 - span.x0;
    const start = Math.min(offsetCount, offsets.length - columns);
    // each column's surface: its shown top row plus the spring's offset (the shader's level is 0)
    for (let c = 0; c < columns; c++) {
      const top = span.tops[span.x0 + c];
      const spring = entry ? (entry.surface.offset[span.x0 + c - entry.x0] ?? 0) : 0;
      offsets[start + c] = (top >= 0 ? top : height) + spring;
    }
    // over a lip it pours from, the surface bends down to the top of the sheet leaving it
    for (const stream of sim.streams) {
      // (a jet out of a gap under water leaves the surface above it alone)
      if (stream.from !== body.id || stream.continues || !stream.free) continue;
      const lipColumn = stream.x - span.x0;
      const lipSurface = stream.top - stream.thickness;
      const reach = Math.min(
        SPILLWAY_MAX_REACH,
        Math.max(SPILLWAY_MIN_REACH, stream.thickness * SPILLWAY_REACH_PER_THICKNESS),
      );
      for (let c = 0; c < columns; c++) {
        const t = 1 - Math.abs(c - lipColumn) / reach;
        if (t <= 0) continue;
        const bend = t * t * (3 - 2 * t); // smoothstep: flat far off, steepest at the lip
        const bent = offsets[start + c] + (lipSurface - offsets[start + c]) * bend;
        offsets[start + c] = Math.max(offsets[start + c], bent);
      }
    }
    offsetCount = start + columns;
    info.set([0, span.x0, columns, start, body.kind === LAVA ? 1 : 0], span.index * 8);
  }
  device.queue.writeBuffer(liquidBuffer, 0, shownFrame.liquid);
  device.queue.writeBuffer(bodyBuffer, 0, info);
  device.queue.writeBuffer(offsetBuffer, 0, offsets);
  const sheets = sheetsOf(sim.streams);
  const streamData = new Float32Array(MAX_STREAMS * 8);
  const streamCount = Math.min(MAX_STREAMS, sheets.length);
  sheets.slice(0, streamCount).forEach((stream, index) => {
    streamData.set(
      [
        stream.x,
        stream.top,
        stream.bottom,
        stream.kind === LAVA ? 1 : 0,
        stream.flow,
        stream.thickness,
        stream.side,
        stream.speed,
      ],
      index * 8,
    );
  });
  device.queue.writeBuffer(streamBuffer, 0, streamData);

  const look = new Float32Array(LOOK_BYTES / 4);
  new Uint32Array(look.buffer, 0, 2).set([width, height]);
  look[2] = time;
  look[3] = deviceScale;
  new Uint32Array(look.buffer, 16, 2).set([snap ? 1 : 0, streamCount]);
  [KINDS[WATER], KINDS[LAVA]].forEach((kind, k) => {
    kind.colours.forEach((colour, band) => look.set(colour, 8 + (k * 2 + band) * 4));
    look[24 + k * 4] = kind.glint;
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

// ---- pebbles and droplets -------------------------------------------------------------------------------------------

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

/** Something crossed the surface at x at vertical speed vy: ripple it, and throw droplets if it's fast. */
function splash(body: Body, x: number, surfaceY: number, vy: number, size: number): void {
  disturbAt(body, x, Math.sign(vy) * Math.min(Math.abs(vy) * 0.35, 260), size);
  const count = Math.min(14, Math.floor(Math.abs(vy) / 40));
  for (let n = 0; n < count; n++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = Math.abs(vy) * (0.25 + Math.random() * 0.35);
    droplets.push({
      x: x + (Math.random() - 0.5) * size,
      y: surfaceY - 1,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      submerged: false,
      colour: KINDS[body.kind].droplet,
    });
  }
}

const solidAtPixel = (x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= width || y >= height || !open[Math.floor(y) * width + Math.floor(x)];

function stepMotes(dt: number): void {
  for (const pebble of pebbles) {
    const wasSubmerged = pebble.submerged;
    pebble.vy += GRAVITY * dt * (pebble.submerged ? 0.15 : 1);
    if (pebble.submerged) pebble.vy *= 1 - 3 * dt;
    pebble.y += pebble.vy * dt;
    const water = waterAt(pebble.x, pebble.y);
    pebble.submerged = water !== null && pebble.y >= water.surfaceY;
    if (water && pebble.submerged && !wasSubmerged)
      splash(water.body, pebble.x, water.surfaceY, pebble.vy, 3);
    if (solidAtPixel(pebble.x, pebble.y)) pebble.y = Infinity;
  }
  for (let i = pebbles.length - 1; i >= 0; i--)
    if (!Number.isFinite(pebbles[i].y)) pebbles.splice(i, 1);

  for (const drop of droplets) {
    drop.vy += GRAVITY * dt;
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    const water = drop.vy > 0 ? waterAt(drop.x, drop.y) : null;
    if (water && drop.y >= water.surfaceY) {
      disturbAt(water.body, drop.x, drop.vy * 0.04, 1);
      drop.y = Infinity;
    } else if (solidAtPixel(drop.x, drop.y)) {
      drop.y = Infinity;
    }
  }
  for (let i = droplets.length - 1; i >= 0; i--)
    if (!Number.isFinite(droplets[i].y)) droplets.splice(i, 1);
}

/**
 * One sheet per pour: a chain's segments (run off little ledges) as one fall from the first lip to where it
 * finally lands. Drawn apart, a ledge's own segment showed as a box on the lip.
 */
function sheetsOf(streams: readonly Stream[]): Stream[] {
  const sheets: Stream[] = [];
  for (const stream of streams) {
    const last = sheets[sheets.length - 1];
    if (last && last.from === stream.from && stream.continues)
      sheets[sheets.length - 1] = { ...last, bottom: stream.bottom };
    else sheets.push(stream);
  }
  return sheets;
}

/** A stream landing keeps disturbing the surface it pours into, where its sheet comes down. */
function streamsRipple(): void {
  for (const sheet of sheetsOf(sim.streams)) {
    const fallTime = Math.sqrt((2 * Math.max(0, sheet.bottom - sheet.top)) / GRAVITY);
    const x = sheet.x + sheet.side * (sheet.speed * fallTime + sheet.thickness / 2);
    const water = waterAt(x, sheet.bottom);
    if (water)
      disturbAt(water.body, x, 30 + 20 * Math.sin(elapsed * 17 + sheet.x), 2 + sheet.thickness / 2);
  }
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

// ---- input ------------------------------------------------------------------------------------------------------------

const pointer = { down: false, moved: false, button: 0, shift: false, x: 0, y: 0, lastY: 0 };
const toArt = (event: PointerEvent): { x: number; y: number } => {
  const box = spriteCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * width,
    y: ((event.clientY - box.top) / box.height) * height,
  };
};
spriteCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
spriteCanvas.addEventListener('pointerdown', (event) => {
  const at = toArt(event);
  Object.assign(pointer, {
    down: true,
    moved: false,
    button: event.button,
    shift: event.shiftKey,
    x: at.x,
    y: at.y,
    lastY: at.y,
  });
  spriteCanvas.setPointerCapture(event.pointerId);
});
spriteCanvas.addEventListener('pointermove', (event) => {
  const at = toArt(event);
  if (pointer.down && Math.hypot(at.x - pointer.x, at.y - pointer.y) > 2) pointer.moved = true;
  Object.assign(pointer, at);
});
spriteCanvas.addEventListener('pointerup', () => {
  if (!pointer.moved && pointer.button === 0 && !pointer.shift)
    pebbles.push({ x: pointer.x, y: pointer.y, vx: 0, vy: 0, submerged: false, colour: '' });
  pointer.down = false;
});

/**
 * Re-render only what a change to one cell can affect. A full recompose of the band and its mask took
 * 120–215 ms a dig, the lag spike when digging. The rock is re-rendered in a strip of columns around the cell —
 * full height, so the strata colours match the band's — and only the middle, where the shading can have
 * changed, is copied back; the mask is rebuilt for a few cells around it. `fluidLab.verifyRock()` checks the
 * patched result against a full recompose.
 */
function refreshRockAround(column: number, row: number): void {
  const reach = SHADE_INFLUENCE_CELLS + 1; // cells a change can shade
  const margin = reach + 2; // context either side of what's copied back
  const s0 = Math.max(0, column - margin);
  const s1 = Math.min(cols, column + margin + 1);
  const k0 = Math.max(0, column - reach);
  const k1 = Math.min(cols, column + reach + 1);
  timed('composeStrip', () => {
    const strip = Object.assign(document.createElement('canvas'), { width: (s1 - s0) * T, height });
    composeBand(strip.getContext('2d')!, isSolid, bandLeft + s0, bandTop, s1 - s0, rows, (c) =>
      surfaceAt(SEED, c),
    );
    rock.clearRect(k0 * T, 0, (k1 - k0) * T, height);
    rock.drawImage(
      strip,
      (k0 - s0) * T,
      0,
      (k1 - k0) * T,
      height,
      k0 * T,
      0,
      (k1 - k0) * T,
      height,
    );
  });
  timed('uploadRock', () =>
    device.queue.copyExternalImageToTexture(
      { source: rockCanvas, origin: [k0 * T, 0] },
      { texture: rockTexture, origin: [k0 * T, 0] },
      [(k1 - k0) * T, height],
    ),
  );
  timed('patchMask', () => {
    const m0 = Math.max(0, column - 2);
    const m1 = Math.min(cols, column + 3);
    const r0 = Math.max(0, row - 2);
    const r1 = Math.min(rows, row + 3);
    const w = (m1 - m0) * T;
    const h = (r1 - r0) * T;
    const mask = buildMask(isSolid, w, h, bandLeft + m0, bandTop + r0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) open[(r0 * T + y) * width + m0 * T + x] = mask[y * w + x] ? 0 : 1;
    }
    const rowsFrom = r0 * T * width;
    device.queue.writeBuffer(
      openBuffer,
      rowsFrom * 4,
      Uint32Array.from(open.subarray(rowsFrom, r1 * T * width)),
    );
  });
}

function dig(column: number, row: number, building: boolean): void {
  const cell = key(bandLeft + column, bandTop + row);
  if (building ? built.has(cell) : !isSolid(bandLeft + column, bandTop + row)) return;
  if (building) built.add(cell);
  else {
    built.delete(cell);
    dug.add(cell);
  }
  refreshRockAround(column, row);
  timed('setOpen', () => sim.setOpen(open));
}

function applyPointer(dt: number): void {
  if (!pointer.down) return;
  if (pointer.button === 2 || pointer.shift) {
    dig(
      Math.floor(pointer.x / T),
      Math.floor(pointer.y / T),
      pointer.shift && pointer.button === 0,
    );
    return;
  }
  if (!pointer.moved) return;
  // stirring: the pointer's vertical motion across and under the surface
  const water = waterAt(pointer.x, pointer.y) ?? waterAt(pointer.x, pointer.lastY);
  if (water) {
    const vy = (pointer.y - pointer.lastY) / dt;
    const crossed = pointer.lastY < water.surfaceY !== pointer.y < water.surfaceY;
    if (crossed) splash(water.body, pointer.x, water.surfaceY, vy, 4);
    else if (pointer.y > water.surfaceY && pointer.y - water.surfaceY < 24)
      disturbAt(water.body, pointer.x, vy * 0.08, 5);
  }
  pointer.lastY = pointer.y;
}

const held = new Set<string>();
let paused = false;
addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'KeyW' || event.code === 'KeyL') held.add(event.code);
  else if (event.code === 'KeyN') loadScene(sceneIndex + 1);
  else if (event.code === 'KeyR') loadScene(sceneIndex);
  else if (event.code === 'Space') paused = !paused;
  else if (event.code === 'KeyP') snap = !snap;
  else return;
  event.preventDefault();
});
addEventListener('keyup', (event: KeyboardEvent) => held.delete(event.code));

let poured = 0;
function pour(dt: number): void {
  const kind = held.has('KeyW') ? WATER : held.has('KeyL') ? LAVA : 0;
  if (!kind) return;
  poured += POUR_RATE * dt;
  const amount = Math.floor(poured);
  poured -= amount;
  sim.add(kind, pointer.x, pointer.y, amount);
}

// ---- the loop -----------------------------------------------------------------------------------------------------------

let last = performance.now();
let elapsed = 0;
function frame(now: number): void {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (!paused) {
    elapsed += dt;
    applyPointer(dt);
    pour(dt);
    const carried = captureSurfaces();
    sim.step(dt);
    scanShown();
    syncSurfaces(carried);
    streamsRipple();
    stepMotes(dt);
    for (const { surface } of surfaces.values()) surface.step(dt);
  }
  draw(elapsed);
  drawMotes();
  hud.innerHTML =
    `<b>DELVE · water lab</b> — ${SCENES[sceneIndex].name}: ${SCENES[sceneIndex].hint}\n` +
    `bodies ${sim.bodies.length}   streams ${sim.streams.length}   water ${sim.total(WATER)} px   lava ${sim.total(LAVA)} px\n` +
    `click pebble · drag stir · right-drag dig · shift-drag build · hold W/L pour · N scene · R reset · space pause · P ${snap ? '<b>snapped</b>' : 'smooth'}` +
    (gpuError ? `\n<b>GPU error:</b> ${gpuError}` : '');
  requestAnimationFrame(frame);
}

Object.assign(window, {
  fluidLab: {
    scene: loadScene,
    dig: (c0: number, r0: number, c1: number, r1: number) => {
      carve(c0, r0, c1, r1);
      refreshRock();
      timed('setOpen', () => sim.setOpen(open));
    },
    pour: (kind: number, x: number, y: number, volume: number) => sim.add(kind, x, y, volume),
    drop: (x: number, y: number) =>
      pebbles.push({ x, y, vx: 0, vy: 0, submerged: false, colour: '' }),
    stats: () => ({
      bodies: sim.bodies.map((body) => ({
        id: body.id,
        kind: body.kind,
        volume: body.volume,
        level: sim.levelOf(body),
        capacity: body.fill.length,
        spills: body.spill >= 0,
        amplitude: surfaces.get(body.id)?.surface.amplitude ?? 0,
      })),
      streams: sim.streams.map((stream) => ({ ...stream })),
      water: sim.total(WATER),
      lava: sim.total(LAVA),
      gpuError,
    }),
    pause: (value: boolean) => (paused = value),
    digTimings: () => ({ ...digTimings }),
    digCell: (column: number, row: number) => dig(column, row, false),
    /** Pixels where the patched rock and mask differ from a full recompose — 0 if patching is exact. */
    verifyRock: () => {
      const patched = rock.getImageData(0, 0, width, height).data.slice();
      const patchedOpen = open.slice();
      refreshRock();
      const full = rock.getImageData(0, 0, width, height).data;
      let rockDiff = 0;
      for (let i = 0; i < full.length; i += 4) {
        if (
          full[i] !== patched[i] ||
          full[i + 1] !== patched[i + 1] ||
          full[i + 2] !== patched[i + 2]
        )
          rockDiff++;
      }
      let maskDiff = 0;
      for (let i = 0; i < open.length; i++) if (open[i] !== patchedOpen[i]) maskDiff++;
      return { rockDiff, maskDiff };
    },
    snap: (value: boolean) => (snap = value),
    cols,
    rows,
  },
});

loadScene(Number(new URLSearchParams(location.search).get('scene') ?? 0));
requestAnimationFrame(frame);
