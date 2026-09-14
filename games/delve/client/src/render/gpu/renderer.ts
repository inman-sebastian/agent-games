// renderer.ts — DELVE's WebGPU renderer (#69 spike, #71 core). A frame is:
//
//   1. rock     compute passes over the band of cells under the screen (rock.wgsl): the eroded mask,
//               jump-flooded edge distances, then shade — background, sky, top-lit stone, contact
//               shadow, stalactites — into the `scene` texture
//   2. present  one screen-space fragment pass (present.wgsl): scene, the 2D overlay, then the glow,
//               dithered scrim and vignette, into the `frame` texture
//   3. blit     frame → the canvas (blit.wgsl)
//
// The world is a persistent `WorldWindow` (world-window.ts), uploaded only when it changes; the light
// field is lighting.ts's `field()`; the tuning constants are generated from the TypeScript that owns
// them (constants.ts). Materials, sprites and twinkle as GPU passes are later children of #68.
import { rampAt, bgFor, SKY_TOP, SKY_HORIZON, mix } from '../cave-render';
import { T, TEX, hexRgb, colorsFor } from '../palette';
import { DITHER_STEPS } from '../lighting';
import type { LightField } from '../lighting';
import type { WorldWindow } from './world-window';
import { CONSTANTS_WGSL } from './constants';
import noiseWgsl from './noise.wgsl?raw';
import surfacesWgsl from './surfaces.wgsl?raw';
import rockWgsl from './rock.wgsl?raw';
import { materialsWgsl } from './materials';
import presentWgsl from './present.wgsl?raw';
import blitWgsl from './blit.wgsl?raw';

const WORKGROUP = 8;
/** Jump-flooding steps, largest first, plus the extra step-1 pass ("JFA+1") that mops up its errors.
 * 32 is enough: nothing past ~36 px from an opening changes a pixel (the top light has clamped to 0). */
const JFA_STEPS: readonly number[] = [32, 16, 8, 4, 2, 1, 1];
const BAND_UNIFORM_BYTES = 256;
const PRESENT_UNIFORM_BYTES = 72;
const FRAME_FORMAT: GPUTextureFormat = 'rgba8unorm';

/** One frame to draw. */
export interface GpuFrame {
  /** The camera: the exact world pixel at the screen's top-left. Fractional, as the game's is. */
  camX: number;
  camY: number;
  /** The screen, in art pixels. */
  width: number;
  height: number;
  /** The world around the view. Call `world.follow` for this view's band before rendering. */
  world: WorldWindow;
  light: LightField;
  /** false: the rock scene alone, no light — for diffing the rock. */
  lighting?: boolean;
  /** false: skip the darkness scrim (the debug panel's `fog`). */
  scrim?: boolean;
  /** What the game draws over the rock (particles, the player, …), screen-sized and transparent. */
  overlay?: HTMLCanvasElement | OffscreenCanvas;
}

/** The world pixel at the screen's top-left, rounded exactly as the game's `ctx.translate` rounds it. */
const screenOrigin = (camera: number): number => -Math.round(-camera);

/** The world cell band under a screen: every cell any screen pixel touches. */
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
    cols: Math.floor((originX + width - 1) / T) - left + 1,
    rows: Math.floor((originY + height - 1) / T) - top + 1,
  };
}

type Band = ReturnType<typeof bandFor>;

export interface GpuRenderer {
  /** Draw a frame. Returns its CPU-side cost; the GPU's finish time arrives later in `gpuMs`. */
  render(frame: GpuFrame): { prepareMs: number; encodeMs: number };
  /** The last frame, RGBA bytes, screen-sized. */
  readback(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
  /** Milliseconds from submitting the last frame to the GPU reporting it done. */
  readonly gpuMs: number;
  readonly adapter: string;
  /** The first GPU validation error, or null. Errors surface asynchronously — a shader that fails to
   *  compile doesn't throw, it just draws nothing — so this is how a HUD, or probe, gets to see one. */
  readonly lastError: string | null;
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
  const presentModule = shader('present', CONSTANTS_WGSL + noiseWgsl + presentWgsl);
  const blitModule = shader('blit', blitWgsl);
  const computePipeline = (entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: 'auto',
      compute: { module: rockModule, entryPoint },
    });
  const maskPipeline = computePipeline('mask_main');
  const jfaInitPipeline = computePipeline('jfa_init');
  const jfaStepPipeline = computePipeline('jfa_step');
  const shadePipeline = computePipeline('shade_main');
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

  const uniform = (bytes: number): GPUBuffer =>
    device.createBuffer({ size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bandBuffer = uniform(BAND_UNIFORM_BYTES);
  const presentBuffer = uniform(PRESENT_UNIFORM_BYTES);
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
    device.queue.writeBuffer(r.glowBuffer, 0, light.glow);
    device.queue.writeBuffer(r.brightBuffer, 0, light.bright);
    writePresent(frame, band, world, light);
    if (frame.overlay) {
      device.queue.copyExternalImageToTexture(
        { source: frame.overlay },
        { texture: r.overlay, premultipliedAlpha: true },
        [frame.width, frame.height],
      );
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

  function writePresent(frame: GpuFrame, band: Band, world: WorldWindow, light: LightField): void {
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
    glowBuffer: GPUBuffer;
    brightBuffer: GPUBuffer;
    overlay: GPUTexture;
    frame: GPUTexture;
    bindGroups: {
      mask: GPUBindGroup;
      jfaInit: GPUBindGroup;
      jfaSteps: GPUBindGroup[];
      shade: GPUBindGroup;
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
    ];

    return {
      shape,
      cellsBuffer,
      surfaceBuffer,
      glowBuffer,
      brightBuffer,
      overlay,
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
        }),
        blit: group(blitPipeline, { 0: frame.createView() }),
      },
      destroy: () => {
        buffers.forEach((b) => b.destroy());
        scene.destroy();
        overlay.destroy();
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
    readback,
    get gpuMs() {
      return gpuMs;
    },
    get lastError() {
      return lastError;
    },
    adapter:
      [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') ||
      'unknown adapter',
  };
}

function storageBuffer(device: GPUDevice, bytes: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(bytes / 4) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
