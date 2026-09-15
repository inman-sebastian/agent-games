// renderer.ts — DELVE's WebGPU renderer (#69 spike, #71 core). A frame is:
//
//   1. rock     compute passes over the band of cells under the screen (rock.wgsl): the eroded mask,
//               jump-flooded edge distances, then shade — background, sky, top-lit stone, contact
//               shadow — into the `scene` texture
//   1b. light   compute passes over the light grid (light.wgsl): seed the emitters, relax the field
//               through open space and rock, finish into the glow and brightness the present reads
//   1c. entities one instanced render pass (quads.wgsl): particles, motes, the reticle and the player's
//               sprite from the atlas, into the `entities` texture
//   2. present  one screen-space fragment pass (present.wgsl): scene, damage and twinkle, entities, the 2D
//               overlay (only floating text now), then the glow, dithered scrim and vignette, into `frame`
//   3. blit     frame → the canvas (blit.wgsl)
//
// The world is a persistent `WorldWindow` (world-window.ts), uploaded only when it changes; the light
// field starts from lighting.ts's `plan()`; the tuning constants are generated from the TypeScript that owns
// them (constants.ts). Materials, sprites and twinkle as GPU passes are later children of #68.
import { rampAt, bgFor, SKY_TOP, SKY_HORIZON, mix } from '../cave-render';
import { T, TEX, hexRgb, colorsFor } from '../palette';
import { DITHER_STEPS, LMARGIN, SEED_FLOATS } from '../lighting';
import type { FieldPlan } from '../lighting';
import type { WorldWindow } from './world-window';
import { CONSTANTS_WGSL } from './constants';
import noiseWgsl from './noise.wgsl?raw';
import surfacesWgsl from './surfaces.wgsl?raw';
import rockWgsl from './rock.wgsl?raw';
import { materialsWgsl } from './materials';
import lightWgsl from './light.wgsl?raw';
import presentWgsl from './present.wgsl?raw';
import quadsWgsl from './quads.wgsl?raw';
import { QUAD_FLOATS, createShelfPacker, type QuadBatch } from './quads';
import blitWgsl from './blit.wgsl?raw';

const WORKGROUP = 8;
/** Jump-flooding steps, largest first, plus the extra step-1 pass ("JFA+1") that mops up its errors.
 * 32 is enough: nothing past ~36 px from an opening changes a pixel (the top light has clamped to 0). */
const JFA_STEPS: readonly number[] = [32, 16, 8, 4, 2, 1, 1];
const BAND_UNIFORM_BYTES = 256;
const PRESENT_UNIFORM_BYTES = 88;
const LIGHT_UNIFORM_BYTES = 56;
/** Bytes of one light.wgsl `LightCell`: two vec3f, aligned to 12. */
const LIGHT_CELL_BYTES = 24;
/** The sprite atlas's side, in pixels. The player's whole frame set is a few hundred 48-pixel frames. */
const ATLAS_SIZE = 2048;
/** Emitters the GPU seeds. The game has one (the lamp); past this many, the extra are dropped. */
const MAX_SEEDS = 64;
const FRAME_FORMAT: GPUTextureFormat = 'rgba8unorm';

/** One frame to draw. */
export interface GpuFrame {
  /** The camera: the exact world pixel at the screen's top-left. Fractional, as the game's is. */
  camX: number;
  camY: number;
  /** The screen, in art pixels. */
  width: number;
  height: number;
  /** The world around the view. The renderer keeps it following the view. */
  world: WorldWindow;
  /** This view's light field plan (lighting.ts `plan`); the GPU propagates it. */
  light: FieldPlan;
  /** false: the rock scene alone, no light — for diffing the rock. */
  lighting?: boolean;
  /** false: skip the darkness scrim (the debug panel's `fog`). */
  scrim?: boolean;
  /** The entity pass: particles, the player, … as quads, drawn over damage and twinkle (quads.ts). */
  quads?: QuadBatch;
  /** What the game still draws with Canvas 2D over the entities (floating text), screen-sized and
   *  transparent. Leave it out on frames where it's empty: uploading it is a full-screen copy. */
  overlay?: HTMLCanvasElement | OffscreenCanvas;
  /**
   * The two 2D layers that sit between the rock and the overlay, as the Canvas 2D frame draws them:
   * damage cracks (composited source-over) and twinkle glints (drawn `lighter` onto transparent pixels,
   * and ADDED). Screen-sized canvases, but only `box` — the lamp's reach, in screen pixels — is uploaded
   * and read, because nothing else can be on them.
   */
  layers?: {
    under: HTMLCanvasElement | OffscreenCanvas;
    glint: HTMLCanvasElement | OffscreenCanvas;
    box: { x: number; y: number; width: number; height: number };
  };
}

type LayerSource = HTMLCanvasElement | OffscreenCanvas;

/** The world pixel at the screen's top-left, rounded exactly as the game's `ctx.translate` rounds it. */
const screenOrigin = (camera: number): number => -Math.round(-camera);

/**
 * The world cell band under a screen: every cell any screen pixel touches. Its size is the most cells a screen of
 * this size can touch, wherever the camera is, so it doesn't change while the screen doesn't: sized to the cells
 * actually touched, it was a cell wider or not as the camera crossed a cell, and each change reallocated the
 * renderer's buffers and textures and rebuilt the world window from world queries.
 */
export function bandFor(
  camX: number,
  camY: number,
  width: number,
  height: number,
): { originX: number; originY: number; left: number; top: number; cols: number; rows: number } {
  const originX = screenOrigin(camX);
  const originY = screenOrigin(camY);
  const left = Math.floor(originX / T);
  const top = Math.floor(originY / T);
  return {
    originX,
    originY,
    left,
    top,
    cols: Math.floor((width + T - 2) / T) + 1,
    rows: Math.floor((height + T - 2) / T) + 1,
  };
}

type Band = ReturnType<typeof bandFor>;

export interface GpuRenderer {
  /** Draw a frame. Returns its CPU-side cost; the GPU's finish time arrives later in `gpuMs`. */
  render(frame: GpuFrame): { prepareMs: number; encodeMs: number };
  /** The last frame, RGBA bytes, screen-sized. */
  readback(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
  /**
   * Where a baked sprite frame sits in the atlas, uploading it the first time its key is seen. Draw it
   * with `quads.image` in the same frame: a full atlas starts again from empty, which moves slots.
   */
  sprite(key: string, source: HTMLCanvasElement | OffscreenCanvas): { x: number; y: number };
  /** Milliseconds from submitting the last frame to the GPU reporting it done. */
  readonly gpuMs: number;
  readonly adapter: string;
  /** The first GPU validation error, or null. Errors surface asynchronously — a shader that fails to
   *  compile doesn't throw, it just draws nothing — so this is how a HUD, or probe, gets to see one. */
  readonly lastError: string | null;
  /** Resolves, with the browser's reason, if the GPU device is lost — a crash, a driver reset, the GPU
   *  being unplugged. Nothing renders after that, so the game treats it like having no WebGPU at all. */
  readonly lost: Promise<string>;
}

/** Why a renderer couldn't be made, as a sentence for the page. */
export class GpuUnavailable extends Error {}

export async function createGpuRenderer(canvas: HTMLCanvasElement): Promise<GpuRenderer> {
  if (!navigator.gpu) {
    throw new GpuUnavailable('This browser has no WebGPU (navigator.gpu is missing).');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new GpuUnavailable('WebGPU is present but no GPU adapter was offered.');
  const device = await adapter.requestDevice();
  let lastError: string | null = null;
  device.addEventListener('uncapturederror', (event) => {
    const message = (event as GPUUncapturedErrorEvent).error.message;
    console.error(`DELVE GPU: ${message}`);
    // Keep the FIRST: one bad shader invalidates every command buffer after it, and those follow-on
    // errors say nothing about the cause.
    lastError ??= message;
  });
  const context = canvas.getContext('webgpu');
  if (!context) throw new GpuUnavailable('The canvas refused a WebGPU context.');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

  const shader = (label: string, code: string): GPUShaderModule =>
    device.createShaderModule({ label, code });
  const rockModule = shader(
    'rock',
    CONSTANTS_WGSL + noiseWgsl + surfacesWgsl + materialsWgsl() + rockWgsl,
  );
  const lightModule = shader('light', CONSTANTS_WGSL + lightWgsl);
  const presentModule = shader('present', CONSTANTS_WGSL + noiseWgsl + presentWgsl);
  const blitModule = shader('blit', blitWgsl);
  const computePipeline = (entryPoint: string, module = rockModule): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: 'auto',
      compute: { module, entryPoint },
    });
  const maskPipeline = computePipeline('mask_main');
  const jfaInitPipeline = computePipeline('jfa_init');
  const jfaStepPipeline = computePipeline('jfa_step');
  const shadePipeline = computePipeline('shade_main');
  const lightSeedPipeline = computePipeline('light_seed', lightModule);
  const lightStepPipeline = computePipeline('light_step', lightModule);
  const lightFinishPipeline = computePipeline('light_finish', lightModule);
  const fullScreenPipeline = (
    module: GPUShaderModule,
    vertex: string,
    fragment: string,
    format: GPUTextureFormat,
  ): GPURenderPipeline =>
    device.createRenderPipeline({
      label: fragment,
      layout: 'auto',
      vertex: { module, entryPoint: vertex },
      fragment: { module, entryPoint: fragment, targets: [{ format }] },
    });
  const presentPipeline = fullScreenPipeline(
    presentModule,
    'composite_vertex',
    'composite_fragment',
    FRAME_FORMAT,
  );
  const blitPipeline = fullScreenPipeline(blitModule, 'blit_vertex', 'blit_fragment', canvasFormat);
  const quadsModule = shader('quads', quadsWgsl);
  const premultipliedOver: GPUBlendComponent = {
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
    operation: 'add',
  };
  const quadsPipeline = device.createRenderPipeline({
    label: 'quads',
    layout: 'auto',
    vertex: {
      module: quadsModule,
      entryPoint: 'quad_vertex',
      buffers: [
        {
          stepMode: 'instance',
          arrayStride: QUAD_FLOATS * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module: quadsModule,
      entryPoint: 'quad_fragment',
      targets: [
        { format: FRAME_FORMAT, blend: { color: premultipliedOver, alpha: premultipliedOver } },
      ],
    },
  });
  const atlas = device.createTexture({
    label: 'sprite atlas',
    size: [ATLAS_SIZE, ATLAS_SIZE],
    format: FRAME_FORMAT,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const packer = createShelfPacker(ATLAS_SIZE);
  const screenBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let quadBuffer = device.createBuffer({
    size: 256 * QUAD_FLOATS * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const quadsGroup = device.createBindGroup({
    layout: quadsPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: screenBuffer } },
      { binding: 1, resource: atlas.createView() },
    ],
  });

  function sprite(key: string, source: LayerSource): { x: number; y: number } {
    let placed = packer.place(key, source.width, source.height);
    if (!placed) {
      packer.reset();
      placed = packer.place(key, source.width, source.height);
      if (!placed) throw new Error(`sprite ${key} is larger than the ${ATLAS_SIZE}px atlas`);
    }
    if (placed.fresh) {
      device.queue.copyExternalImageToTexture(
        { source },
        { texture: atlas, origin: [placed.slot.x, placed.slot.y], premultipliedAlpha: true },
        [source.width, source.height],
      );
    }
    return { x: placed.slot.x, y: placed.slot.y };
  }

  const uniform = (bytes: number): GPUBuffer =>
    device.createBuffer({ size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bandBuffer = uniform(BAND_UNIFORM_BYTES);
  const presentBuffer = uniform(PRESENT_UNIFORM_BYTES);
  const lightBuffer = uniform(LIGHT_UNIFORM_BYTES);
  const seedBuffer = storageBuffer(device, MAX_SEEDS * SEED_FLOATS * 4);
  // One uniform per jump-flooding step: queue writes all land before the command buffer runs, so a
  // single step buffer rewritten between passes would hold only the last value for every pass.
  const jfaStepBuffers = JFA_STEPS.map((step) => {
    const buffer = uniform(4);
    device.queue.writeBuffer(buffer, 0, new Int32Array([step]));
    return buffer;
  });
  // The 8-bit alpha lighting.ts's Uint8ClampedArray stores for each darkness level, rounding included.
  const alphaSteps = Float32Array.from(
    new Uint8ClampedArray(DITHER_STEPS + 1).map((_, level) => (level / DITHER_STEPS) * 255),
  );
  const alphaBuffer = storageBuffer(device, alphaSteps.byteLength);
  device.queue.writeBuffer(alphaBuffer, 0, alphaSteps);

  let sized: Sized | null = null;
  let uploaded: { version: number; cells: Uint32Array<ArrayBuffer> | null } = {
    version: -1,
    cells: null,
  };
  let gpuMs = 0;

  function render(frame: GpuFrame): { prepareMs: number; encodeMs: number } {
    const started = performance.now();
    const band = bandFor(frame.camX, frame.camY, frame.width, frame.height);
    const { world, light } = frame;
    // The window covers the band for the rock and the light grid, which reaches LMARGIN cells further
    // (and a cell more, for the grid's floor against the band's rounded origin).
    const reachOut = LMARGIN + 1;
    world.follow(
      band.left - reachOut,
      band.top - reachOut,
      band.cols + 2 * reachOut,
      band.rows + 2 * reachOut,
    );
    const shape: Shape = {
      width: frame.width,
      height: frame.height,
      bandCols: band.cols,
      bandRows: band.rows,
      windowCells: world.cells.length,
      windowCols: world.cols,
      gridCells: light.gridW * light.gridH,
    };
    if (!sized || !sameShape(sized.shape, shape)) {
      sized?.destroy();
      sized = allocate(shape);
      canvas.width = frame.width;
      canvas.height = frame.height;
      uploaded = { version: -1, cells: null };
    }
    const r = sized;
    // The world window only uploads when it changed — a dig, or the window moving — which is the whole
    // point of keeping it. Reallocating forces an upload, above.
    if (world.version !== uploaded.version || world.cells !== uploaded.cells) {
      device.queue.writeBuffer(r.cellsBuffer, 0, world.cells);
      device.queue.writeBuffer(r.surfaceBuffer, 0, world.surface);
      uploaded = { version: world.version, cells: world.cells };
    }
    writeBand(band, world);
    writeLight(light, world);
    writePresent(frame, band, world, light, clampBox(frame.layers?.box, frame.width, frame.height));
    if (frame.overlay) {
      device.queue.copyExternalImageToTexture(
        { source: frame.overlay },
        { texture: r.overlay, premultipliedAlpha: true },
        [frame.width, frame.height],
      );
    }
    const quadCount = frame.quads?.count ?? 0;
    if (frame.quads && quadCount > 0) {
      const bytes = quadCount * QUAD_FLOATS * 4;
      if (quadBuffer.size < bytes) {
        quadBuffer.destroy();
        quadBuffer = device.createBuffer({
          size: Math.max(bytes, quadBuffer.size * 2),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }
      device.queue.writeBuffer(quadBuffer, 0, frame.quads.data, 0, quadCount * QUAD_FLOATS);
    }
    device.queue.writeBuffer(screenBuffer, 0, new Float32Array([frame.width, frame.height]));
    const box = clampBox(frame.layers?.box, frame.width, frame.height);
    if (frame.layers && box.width > 0 && box.height > 0) {
      const copyBox = (source: LayerSource, texture: GPUTexture): void =>
        device.queue.copyExternalImageToTexture(
          { source, origin: [box.x, box.y] },
          { texture, origin: [box.x, box.y], premultipliedAlpha: true },
          [box.width, box.height],
        );
      copyBox(frame.layers.under, r.under);
      copyBox(frame.layers.glint, r.glint);
    }
    const prepared = performance.now();

    const encoder = device.createCommandEncoder();
    const groups = r.bindGroups;
    const bandWidth = band.cols * T;
    const bandHeight = band.rows * T;
    const dispatch = (pipeline: GPUComputePipeline, group: GPUBindGroup): void => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(bandWidth / WORKGROUP), Math.ceil(bandHeight / WORKGROUP));
      pass.end();
    };
    dispatch(maskPipeline, groups.mask);
    dispatch(jfaInitPipeline, groups.jfaInit);
    groups.jfaSteps.forEach((group) => dispatch(jfaStepPipeline, group));
    dispatch(shadePipeline, groups.shade);

    // The light field: seed into A, relax an even number of steps (A → B → A …), finish from A.
    const lightPass = encoder.beginComputePass();
    const lightGroups = Math.ceil(light.gridW / WORKGROUP);
    const lightRows = Math.ceil(light.gridH / WORKGROUP);
    const lightDispatch = (pipeline: GPUComputePipeline, group: GPUBindGroup): void => {
      lightPass.setPipeline(pipeline);
      lightPass.setBindGroup(0, group);
      lightPass.dispatchWorkgroups(lightGroups, lightRows);
    };
    lightDispatch(lightSeedPipeline, groups.lightSeed);
    const steps = light.reach + (light.reach % 2);
    for (let step = 0; step < steps; step++) {
      lightDispatch(lightStepPipeline, step % 2 === 0 ? groups.lightStepAB : groups.lightStepBA);
    }
    lightDispatch(lightFinishPipeline, groups.lightFinish);
    lightPass.end();

    const fullScreenPass = (
      target: GPUTextureView,
      pipeline: GPURenderPipeline,
      group: GPUBindGroup,
    ): void => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    const entityPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: r.entities.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    if (quadCount > 0) {
      entityPass.setPipeline(quadsPipeline);
      entityPass.setBindGroup(0, quadsGroup);
      entityPass.setVertexBuffer(0, quadBuffer);
      entityPass.draw(6, quadCount);
    }
    entityPass.end();
    fullScreenPass(r.frame.createView(), presentPipeline, groups.present);
    fullScreenPass(context!.getCurrentTexture().createView(), blitPipeline, groups.blit);
    device.queue.submit([encoder.finish()]);
    const submitted = performance.now();
    void device.queue.onSubmittedWorkDone().then(() => {
      gpuMs = performance.now() - submitted;
    });
    return { prepareMs: prepared - started, encodeMs: submitted - prepared };
  }

  function writeBand(band: Band, world: WorldWindow): void {
    let deepestSky = -Infinity;
    for (let column = 0; column < band.cols; column++) {
      const local = Math.min(world.cols - 1, Math.max(0, band.left + column - world.left));
      deepestSky = Math.max(deepestSky, (world.surface[local] + 1) * T - band.top * T);
    }
    const ramp = rampAt(Math.max(1, band.top + (band.rows >> 1)));
    const colours = colorsFor(ramp);
    const background = bgFor(ramp);
    const bytes = new ArrayBuffer(BAND_UNIFORM_BYTES);
    const u32 = new Uint32Array(bytes);
    const i32 = new Int32Array(bytes);
    const f32 = new Float32Array(bytes);
    u32[0] = band.cols * T;
    u32[1] = band.rows * T;
    i32[2] = band.left * T;
    i32[3] = band.top * T;
    i32[4] = band.left;
    i32[5] = band.top;
    u32[6] = band.cols;
    u32[7] = band.rows;
    u32[8] = TEX;
    f32[9] = deepestSky;
    i32[10] = world.left;
    i32[11] = world.top;
    u32[12] = world.cols;
    u32[13] = world.rows;
    const colour = (offset: number, rgb: readonly number[]): void => {
      f32.set([rgb[0], rgb[1], rgb[2], 255], offset / 4);
    };
    colour(64, hexRgb(mix(background.top, background.bot, 0.5)));
    colour(80, hexRgb(background.sil));
    colour(96, hexRgb(SKY_TOP));
    colour(112, hexRgb(SKY_HORIZON));
    const stoneBands = [
      colours.center,
      colours.deep,
      colours.body,
      colours.body2,
      colours.lit,
      colours.rimA,
    ];
    stoneBands.forEach((rgb, index) => colour(128 + index * 16, rgb));
    colour(224, colours.rimB);
    colour(240, colours.rimRock);
    device.queue.writeBuffer(bandBuffer, 0, bytes);
  }

  function writeLight(light: FieldPlan, world: WorldWindow): void {
    const bytes = new ArrayBuffer(LIGHT_UNIFORM_BYTES);
    const u32 = new Uint32Array(bytes);
    const i32 = new Int32Array(bytes);
    const seedCount = Math.min(MAX_SEEDS, light.seedCount); // ponytail: extra emitters dropped; grow MAX_SEEDS when something emits
    u32[0] = light.gridW;
    u32[1] = light.gridH;
    i32[2] = light.tileLeft;
    i32[3] = light.tileTop;
    i32[4] = world.left;
    i32[5] = world.top;
    u32[6] = world.cols;
    u32[7] = world.rows;
    i32[8] = light.sweepX0;
    i32[9] = light.sweepY0;
    i32[10] = light.sweepX1;
    i32[11] = light.sweepY1;
    u32[12] = seedCount;
    u32[13] = 1; // hue cap: the game's setting; lighting.ts's per-channel clamp is a light-lab option
    device.queue.writeBuffer(lightBuffer, 0, bytes);
    if (seedCount > 0) {
      device.queue.writeBuffer(seedBuffer, 0, light.seeds, 0, seedCount * SEED_FLOATS);
    }
  }

  function writePresent(
    frame: GpuFrame,
    band: Band,
    world: WorldWindow,
    light: FieldPlan,
    box: { x: number; y: number; width: number; height: number },
  ): void {
    const bytes = new ArrayBuffer(PRESENT_UNIFORM_BYTES);
    const u32 = new Uint32Array(bytes);
    const i32 = new Int32Array(bytes);
    const f32 = new Float32Array(bytes);
    u32[0] = frame.width;
    u32[1] = frame.height;
    i32[2] = band.originX;
    i32[3] = band.originY;
    i32[4] = band.left * T;
    i32[5] = band.top * T;
    i32[6] = light.tileLeft;
    i32[7] = light.tileTop;
    f32[8] = frame.camX;
    f32[9] = frame.camY;
    u32[10] = light.gridW;
    u32[11] = light.gridH;
    i32[12] = world.left;
    u32[13] = world.cols;
    u32[14] = frame.lighting === false ? 0 : 1;
    u32[15] = frame.scrim === false ? 0 : 1;
    u32[16] = frame.overlay ? 1 : 0;
    u32[17] = frame.layers && box.width > 0 && box.height > 0 ? 1 : 0;
    i32[18] = box.x;
    i32[19] = box.y;
    i32[20] = box.width;
    i32[21] = box.height;
    device.queue.writeBuffer(presentBuffer, 0, bytes);
  }

  interface Shape {
    width: number;
    height: number;
    bandCols: number;
    bandRows: number;
    windowCells: number;
    windowCols: number;
    gridCells: number;
  }

  const sameShape = (a: Shape, b: Shape): boolean =>
    (Object.keys(a) as (keyof Shape)[]).every((key) => a[key] === b[key]);

  interface Sized {
    shape: Shape;
    cellsBuffer: GPUBuffer;
    surfaceBuffer: GPUBuffer;
    overlay: GPUTexture;
    entities: GPUTexture;
    under: GPUTexture;
    glint: GPUTexture;
    frame: GPUTexture;
    bindGroups: {
      mask: GPUBindGroup;
      jfaInit: GPUBindGroup;
      jfaSteps: GPUBindGroup[];
      shade: GPUBindGroup;
      lightSeed: GPUBindGroup;
      lightStepAB: GPUBindGroup;
      lightStepBA: GPUBindGroup;
      lightFinish: GPUBindGroup;
      present: GPUBindGroup;
      blit: GPUBindGroup;
    };
    destroy(): void;
  }

  function allocate(shape: Shape): Sized {
    const bandPixels = shape.bandCols * T * (shape.bandRows * T);
    const cellsBuffer = storageBuffer(device, shape.windowCells * 4);
    const surfaceBuffer = storageBuffer(device, shape.windowCols * 4);
    const maskBuffer = storageBuffer(device, bandPixels * 4);
    const seedsA = storageBuffer(device, bandPixels * 8);
    const seedsB = storageBuffer(device, bandPixels * 8);
    const glowBuffer = storageBuffer(device, shape.gridCells * 4);
    const brightBuffer = storageBuffer(device, shape.gridCells * 4);
    const lightA = storageBuffer(device, shape.gridCells * LIGHT_CELL_BYTES);
    const lightB = storageBuffer(device, shape.gridCells * LIGHT_CELL_BYTES);
    const texture = (label: string, width: number, height: number, usage: number): GPUTexture =>
      device.createTexture({ label, size: [width, height], format: FRAME_FORMAT, usage });
    const scene = texture(
      'scene',
      shape.bandCols * T,
      shape.bandRows * T,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    );
    const overlay = texture(
      'overlay',
      shape.width,
      shape.height,
      GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    );
    const layerUsage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT;
    const under = texture('under', shape.width, shape.height, layerUsage);
    const entities = texture('entities', shape.width, shape.height, layerUsage);
    const glint = texture('glint', shape.width, shape.height, layerUsage);
    const frame = texture(
      'frame',
      shape.width,
      shape.height,
      GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    );

    const group = (
      pipeline: GPUComputePipeline | GPURenderPipeline,
      entries: Record<number, GPUBindingResource>,
    ): GPUBindGroup =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: Object.entries(entries).map(([binding, resource]) => ({
          binding: Number(binding),
          resource,
        })),
      });
    const buffer = (b: GPUBuffer): GPUBufferBinding => ({ buffer: b });

    // Jump flooding ping-pongs A → B → A …; the shade pass reads whichever the last step wrote.
    const jfaSteps = jfaStepBuffers.map((stepBuffer, index) =>
      group(jfaStepPipeline, {
        0: buffer(bandBuffer),
        3: buffer(index % 2 === 0 ? seedsA : seedsB),
        4: buffer(index % 2 === 0 ? seedsB : seedsA),
        8: buffer(stepBuffer),
      }),
    );
    const finalSeeds = JFA_STEPS.length % 2 === 0 ? seedsA : seedsB;
    const buffers = [
      cellsBuffer,
      surfaceBuffer,
      maskBuffer,
      seedsA,
      seedsB,
      glowBuffer,
      brightBuffer,
      lightA,
      lightB,
    ];

    return {
      shape,
      cellsBuffer,
      surfaceBuffer,
      overlay,
      entities,
      under,
      glint,
      frame,
      bindGroups: {
        mask: group(maskPipeline, {
          0: buffer(bandBuffer),
          1: buffer(cellsBuffer),
          2: buffer(maskBuffer),
        }),
        jfaInit: group(jfaInitPipeline, {
          0: buffer(bandBuffer),
          2: buffer(maskBuffer),
          4: buffer(seedsA),
        }),
        jfaSteps,
        lightSeed: group(lightSeedPipeline, {
          0: buffer(lightBuffer),
          2: buffer(seedBuffer),
          4: buffer(lightA),
        }),
        lightStepAB: group(lightStepPipeline, {
          0: buffer(lightBuffer),
          1: buffer(cellsBuffer),
          3: buffer(lightA),
          4: buffer(lightB),
        }),
        lightStepBA: group(lightStepPipeline, {
          0: buffer(lightBuffer),
          1: buffer(cellsBuffer),
          3: buffer(lightB),
          4: buffer(lightA),
        }),
        lightFinish: group(lightFinishPipeline, {
          0: buffer(lightBuffer),
          3: buffer(lightA),
          5: buffer(glowBuffer),
          6: buffer(brightBuffer),
        }),
        shade: group(shadePipeline, {
          0: buffer(bandBuffer),
          1: buffer(cellsBuffer),
          2: buffer(maskBuffer),
          3: buffer(finalSeeds),
          5: buffer(surfaceBuffer),
          7: scene.createView(),
        }),
        present: group(presentPipeline, {
          0: buffer(presentBuffer),
          1: scene.createView(),
          2: overlay.createView(),
          3: buffer(glowBuffer),
          4: buffer(brightBuffer),
          5: buffer(surfaceBuffer),
          6: buffer(alphaBuffer),
          7: under.createView(),
          8: glint.createView(),
          9: entities.createView(),
        }),
        blit: group(blitPipeline, { 0: frame.createView() }),
      },
      destroy: () => {
        buffers.forEach((b) => b.destroy());
        scene.destroy();
        overlay.destroy();
        entities.destroy();
        under.destroy();
        glint.destroy();
        frame.destroy();
      },
    };
  }

  async function readback(): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    if (!sized) return { width: 0, height: 0, pixels: new Uint8Array(0) };
    const { width, height } = sized.frame;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256; // copies must be row-aligned to 256
    const staging = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: sized.frame }, { buffer: staging, bytesPerRow }, [
      width,
      height,
    ]);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(staging.getMappedRange());
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      const start = row * bytesPerRow;
      pixels.set(padded.subarray(start, start + width * 4), row * width * 4);
    }
    staging.unmap();
    staging.destroy();
    return { width, height, pixels };
  }

  const info = adapter.info;
  return {
    render,
    sprite,
    readback,
    get gpuMs() {
      return gpuMs;
    },
    get lastError() {
      return lastError;
    },
    lost: device.lost.then((info) => info.message || info.reason || 'unknown reason'),
    adapter:
      [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') ||
      'unknown adapter',
  };
}

/** A layer box clipped to the screen, in whole pixels; an empty box when there are no layers. */
function clampBox(
  box: { x: number; y: number; width: number; height: number } | undefined,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  if (!box) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function storageBuffer(device: GPUDevice, bytes: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(bytes / 4) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
