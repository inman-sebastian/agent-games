// renderer.ts — the WebGPU spike's renderer (#69): one band of the world, drawn by compute shaders
// that port cave-render.ts's `composeBand` and lighting.ts's per-pixel composite, then presented to a
// canvas sized to the art resolution. It reads the same world predicates, strata ramps, tuning
// constants (gpu/constants.ts) and light field (`LightingInstance.field`) as the Canvas 2D renderer,
// so the two can be put side by side and diffed pixel for pixel.
//
// Out of scope for the spike, deliberately: material shaders (every solid pixel is plain stone, as in
// composeBand without `materialAt`), sprites, and any game integration.
import { rampAt, bgFor, SKY_TOP, SKY_HORIZON, TOP_LIGHT_ROWS, mix } from '../cave-render';
import { T, TEX, hexRgb, colorsFor } from '../palette';
import { DITHER_STEPS } from '../lighting';
import type { LightField } from '../lighting';
import { CONSTANTS_WGSL } from './constants';
import noiseWgsl from './noise.wgsl?raw';
import rockWgsl from './rock.wgsl?raw';
import lightWgsl from './light.wgsl?raw';
import presentWgsl from './present.wgsl?raw';

const WORKGROUP = 8;
/** Jump-flooding steps, largest first, plus the extra step-1 pass ("JFA+1") that mops up its errors.
 * 32 is enough: nothing past ~36 px from an opening changes a pixel (the top light has clamped to 0). */
const JFA_STEPS: readonly number[] = [32, 16, 8, 4, 2, 1, 1];
const BAND_UNIFORM_BYTES = 240;
const LIGHT_UNIFORM_BYTES = 48;
const NO_TOP_LIGHT = 1e6;

export type SolidTile = (column: number, row: number) => boolean;

/** One view to draw: a band of world cells, its solidity and surface, and its light field. */
export interface GpuView {
  bandLeft: number;
  bandTop: number;
  cols: number;
  rows: number;
  isSolid: SolidTile;
  surfaceAt: (column: number) => number;
  light: LightField;
  /** false: skip the darkness scrim, like lighting.ts's debug view. */
  scrim?: boolean;
  /** false: no lighting pass at all — the rock scene as composeBand draws it. */
  lighting?: boolean;
}

export interface GpuRenderer {
  /** Draw a view. Returns the CPU-side cost; the GPU's finish time arrives later in `gpuMs`. */
  render(view: GpuView): { prepareMs: number; encodeMs: number };
  /** The last rendered frame, RGBA bytes, `width × height` art pixels. */
  readback(): Promise<Uint8Array>;
  /** Milliseconds from submitting the last frame to the GPU reporting it done. */
  readonly gpuMs: number;
  readonly adapter: string;
}

/** Why a renderer couldn't be made, as a sentence for the page. */
export class GpuUnavailable extends Error {}

export async function createGpuRenderer(canvas: HTMLCanvasElement): Promise<GpuRenderer> {
  if (!navigator.gpu)
    throw new GpuUnavailable('This browser has no WebGPU (navigator.gpu is missing).');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new GpuUnavailable('WebGPU is present but no GPU adapter was offered.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new GpuUnavailable('The canvas refused a WebGPU context.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const rockModule = device.createShaderModule({
    label: 'rock',
    code: CONSTANTS_WGSL + noiseWgsl + rockWgsl,
  });
  const lightModule = device.createShaderModule({
    label: 'light',
    code: CONSTANTS_WGSL + noiseWgsl + lightWgsl,
  });
  const presentModule = device.createShaderModule({ label: 'present', code: presentWgsl });
  const computePipeline = (module: GPUShaderModule, entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: 'auto',
      compute: { module, entryPoint },
    });
  const maskPipeline = computePipeline(rockModule, 'mask_main');
  const jfaInitPipeline = computePipeline(rockModule, 'jfa_init');
  const jfaStepPipeline = computePipeline(rockModule, 'jfa_step');
  const shadePipeline = computePipeline(rockModule, 'shade_main');
  const lightPipeline = computePipeline(lightModule, 'light_main');
  const presentPipeline = device.createRenderPipeline({
    label: 'present',
    layout: 'auto',
    vertex: { module: presentModule, entryPoint: 'vertex_main' },
    fragment: { module: presentModule, entryPoint: 'fragment_main', targets: [{ format }] },
  });

  const uniform = (bytes: number): GPUBuffer =>
    device.createBuffer({ size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bandBuffer = uniform(BAND_UNIFORM_BYTES);
  const lightBuffer = uniform(LIGHT_UNIFORM_BYTES);
  // One uniform per jump-flooding step: queue writes all land before the command buffer runs, so a
  // single step buffer rewritten between passes would hold only the last value for every pass.
  const jfaStepBuffers = JFA_STEPS.map((step) => {
    const buffer = uniform(4);
    device.queue.writeBuffer(buffer, 0, new Int32Array([step]));
    return buffer;
  });
  const alphaSteps = new Uint8ClampedArray(DITHER_STEPS + 1).map(
    (_, level) => (level / DITHER_STEPS) * 255,
  );
  const alphaBuffer = storage(device, Float32Array.from(alphaSteps).byteLength);
  device.queue.writeBuffer(alphaBuffer, 0, Float32Array.from(alphaSteps));

  let resources: Resources | null = null;
  let gpuMs = 0;

  function render(view: GpuView): { prepareMs: number; encodeMs: number } {
    const started = performance.now();
    const width = view.cols * T;
    const height = view.rows * T;
    const { gridW, gridH } = view.light;
    if (!resources || !resources.fits(width, height, view.cols, view.rows, gridW, gridH)) {
      resources?.destroy();
      resources = allocate(width, height, view.cols, view.rows, gridW, gridH);
      canvas.width = width;
      canvas.height = height;
    }
    const r = resources;
    writeWorld(view, r);
    writeLight(view, r, width, height);
    const prepared = performance.now();

    const encoder = device.createCommandEncoder();
    const groups = r.bindGroups;
    const dispatch = (pipeline: GPUComputePipeline, group: GPUBindGroup): void => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP), Math.ceil(height / WORKGROUP));
      pass.end();
    };
    dispatch(maskPipeline, groups.mask);
    dispatch(jfaInitPipeline, groups.jfaInit);
    groups.jfaSteps.forEach((group) => dispatch(jfaStepPipeline, group));
    dispatch(shadePipeline, groups.shade);
    dispatch(lightPipeline, groups.light);

    const present = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 1],
        },
      ],
    });
    present.setPipeline(presentPipeline);
    present.setBindGroup(0, groups.present);
    present.draw(3);
    present.end();
    device.queue.submit([encoder.finish()]);
    const submitted = performance.now();
    void device.queue.onSubmittedWorkDone().then(() => {
      gpuMs = performance.now() - submitted;
    });
    return { prepareMs: prepared - started, encodeMs: submitted - prepared };
  }

  function writeWorld(view: GpuView, r: Resources): void {
    const { bandLeft, bandTop, cols, rows, isSolid, surfaceAt } = view;
    const paddedWidth = cols + 2;
    for (let row = -1; row <= rows; row++) {
      for (let column = -1; column <= cols; column++) {
        r.cells[(row + 1) * paddedWidth + (column + 1)] = isSolid(bandLeft + column, bandTop + row)
          ? 1
          : 0;
      }
    }
    device.queue.writeBuffer(r.cellsBuffer, 0, r.cells);

    let deepestSky = -Infinity;
    for (let column = 0; column < cols; column++) {
      let solidAbove = 0;
      for (let k = 1; k <= TOP_LIGHT_ROWS && isSolid(bandLeft + column, bandTop - k); k++)
        solidAbove++;
      r.columnSeed[column] = solidAbove >= TOP_LIGHT_ROWS ? NO_TOP_LIGHT : solidAbove * T;
      const skyBottom = (surfaceAt(bandLeft + column) + 1) * T - bandTop * T;
      r.columnSky[column] = skyBottom;
      deepestSky = Math.max(deepestSky, skyBottom);
    }
    device.queue.writeBuffer(r.columnSeedBuffer, 0, r.columnSeed);
    device.queue.writeBuffer(r.columnSkyBuffer, 0, r.columnSky);

    const ramp = rampAt(Math.max(1, bandTop + (rows >> 1)));
    const colours = colorsFor(ramp);
    const background = bgFor(ramp);
    const bytes = new ArrayBuffer(BAND_UNIFORM_BYTES);
    const u32 = new Uint32Array(bytes);
    const i32 = new Int32Array(bytes);
    const f32 = new Float32Array(bytes);
    u32[0] = cols * T;
    u32[1] = rows * T;
    i32[2] = bandLeft * T;
    i32[3] = bandTop * T;
    i32[4] = bandLeft;
    i32[5] = bandTop;
    u32[6] = cols;
    u32[7] = rows;
    u32[8] = TEX;
    f32[9] = deepestSky;
    const colour = (offset: number, rgb: readonly number[]): void => {
      f32.set([rgb[0], rgb[1], rgb[2], 255], offset / 4);
    };
    colour(48, hexRgb(mix(background.top, background.bot, 0.5)));
    colour(64, hexRgb(background.sil));
    colour(80, hexRgb(SKY_TOP));
    colour(96, hexRgb(SKY_HORIZON));
    const stoneBands = [
      colours.center,
      colours.deep,
      colours.body,
      colours.body2,
      colours.lit,
      colours.rimA,
    ];
    stoneBands.forEach((rgb, index) => colour(112 + index * 16, rgb));
    colour(208, colours.rimB);
    colour(224, colours.rimRock);
    device.queue.writeBuffer(bandBuffer, 0, bytes);
  }

  function writeLight(view: GpuView, r: Resources, width: number, height: number): void {
    const field = view.light;
    device.queue.writeBuffer(r.glowBuffer, 0, field.glow);
    device.queue.writeBuffer(r.brightBuffer, 0, field.bright);
    const bytes = new ArrayBuffer(LIGHT_UNIFORM_BYTES);
    const u32 = new Uint32Array(bytes);
    const i32 = new Int32Array(bytes);
    const f32 = new Float32Array(bytes);
    u32[0] = width;
    u32[1] = height;
    f32[2] = view.bandLeft * T;
    f32[3] = view.bandTop * T;
    i32[4] = field.tileLeft;
    i32[5] = field.tileTop;
    u32[6] = field.gridW;
    u32[7] = field.gridH;
    u32[8] = view.scrim === false ? 0 : 1;
    u32[9] = view.lighting === false ? 0 : 1;
    device.queue.writeBuffer(lightBuffer, 0, bytes);
  }

  interface Resources {
    cells: Uint32Array<ArrayBuffer>;
    columnSeed: Float32Array<ArrayBuffer>;
    columnSky: Float32Array<ArrayBuffer>;
    cellsBuffer: GPUBuffer;
    columnSeedBuffer: GPUBuffer;
    columnSkyBuffer: GPUBuffer;
    glowBuffer: GPUBuffer;
    brightBuffer: GPUBuffer;
    frame: GPUTexture;
    bindGroups: {
      mask: GPUBindGroup;
      jfaInit: GPUBindGroup;
      jfaSteps: GPUBindGroup[];
      shade: GPUBindGroup;
      light: GPUBindGroup;
      present: GPUBindGroup;
    };
    fits(
      width: number,
      height: number,
      cols: number,
      rows: number,
      gridW: number,
      gridH: number,
    ): boolean;
    destroy(): void;
  }

  function allocate(
    width: number,
    height: number,
    cols: number,
    rows: number,
    gridW: number,
    gridH: number,
  ): Resources {
    const pixels = width * height;
    const cells = new Uint32Array((cols + 2) * (rows + 2));
    const columnSeed = new Float32Array(cols);
    const columnSky = new Float32Array(cols);
    const cellsBuffer = storage(device, cells.byteLength);
    const columnSeedBuffer = storage(device, columnSeed.byteLength);
    const columnSkyBuffer = storage(device, columnSky.byteLength);
    const maskBuffer = storage(device, pixels * 4);
    const seedsA = storage(device, pixels * 8);
    const seedsB = storage(device, pixels * 8);
    const glowBuffer = storage(device, gridW * gridH * 4);
    const brightBuffer = storage(device, gridW * gridH * 4);
    const texture = (label: string, extra: number): GPUTexture =>
      device.createTexture({
        label,
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | extra,
      });
    const scene = texture('scene', 0);
    const frame = texture('frame', GPUTextureUsage.COPY_SRC);

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

    const all = [
      cellsBuffer,
      columnSeedBuffer,
      columnSkyBuffer,
      maskBuffer,
      seedsA,
      seedsB,
      glowBuffer,
      brightBuffer,
    ];
    return {
      cells,
      columnSeed,
      columnSky,
      cellsBuffer,
      columnSeedBuffer,
      columnSkyBuffer,
      glowBuffer,
      brightBuffer,
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
          5: buffer(columnSeedBuffer),
          6: buffer(columnSkyBuffer),
          7: scene.createView(),
        }),
        light: group(lightPipeline, {
          0: buffer(lightBuffer),
          1: scene.createView(),
          2: frame.createView(),
          3: buffer(glowBuffer),
          4: buffer(brightBuffer),
          5: buffer(columnSkyBuffer),
          6: buffer(alphaBuffer),
        }),
        present: group(presentPipeline, { 0: frame.createView() }),
      },
      fits: (w, h, c, rw, gw, gh) =>
        w === width && h === height && c === cols && rw === rows && gw === gridW && gh === gridH,
      destroy: () => {
        all.forEach((b) => b.destroy());
        scene.destroy();
        frame.destroy();
      },
    };
  }

  async function readback(): Promise<Uint8Array> {
    if (!resources) return new Uint8Array(0);
    const { width, height } = resources.frame;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256; // copies must be row-aligned to 256
    const staging = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: resources.frame }, { buffer: staging, bytesPerRow }, [
      width,
      height,
    ]);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(staging.getMappedRange());
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      pixels.set(
        padded.subarray(row * bytesPerRow, row * bytesPerRow + width * 4),
        row * width * 4,
      );
    }
    staging.unmap();
    staging.destroy();
    return pixels;
  }

  const info = adapter.info;
  return {
    render,
    readback,
    get gpuMs() {
      return gpuMs;
    },
    adapter:
      [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') ||
      'unknown adapter',
  };
}

function storage(device: GPUDevice, bytes: number): GPUBuffer {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(bytes / 4) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
