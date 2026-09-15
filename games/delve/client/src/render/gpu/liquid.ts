// liquid.ts — the liquid picture on the GPU (#96): liquid.wgsl's pipelines, fed the CPU's per-cell plan
// (`planLiquid`). The TypeScript renderer (fluid/terraria-liquid-render.ts) is the reference it's gated against
// (liquid-lab's `gate()`). How it's split: docs/FLUIDS.md, "On the GPU".
import noiseWgsl from './noise.wgsl?raw';
import liquidWgsl from './liquid.wgsl?raw';
import { CONSTANTS_WGSL } from './constants';
import { MOLTEN_FLOW } from '../palette';
import {
  LAVA_BANDS,
  LAVA_COOLING_BASE,
  LAVA_COOLING_DEPTH,
  LAVA_COOLING_RANGE,
  PLAN_BEHIND,
  PLAN_DRAWN,
  PLAN_SOLID,
  PLAN_STRIDE,
  SEE_THROUGH_BODY,
  SEE_THROUGH_DEEP,
  SURFACE_FRAME_Y,
  TILE,
  UNITS_PER_PIXEL,
} from '../../fluid/terraria-liquid-render';
import type { LiquidStyle } from '../../fluid/liquid-render';

const WORKGROUP = 8;
const PARAMS_BYTES = 40;
/**
 * Relaxation steps for lava's heat. After n steps every pixel within n of open air has its exact distance, and
 * the rest stay far. Heat is zero past the deepest cooling depth, so that many steps give the exact heat.
 */
export const HEAT_STEPS = Math.ceil(LAVA_COOLING_DEPTH * (LAVA_COOLING_BASE + LAVA_COOLING_RANGE));

const float = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : String(value);

const LIQUID_CONSTANTS = [
  `const TILE: i32 = ${TILE};`,
  `const SURFACE_FRAME_Y: i32 = ${SURFACE_FRAME_Y};`,
  `const UNITS_PER_PIXEL: i32 = ${UNITS_PER_PIXEL};`,
  `const PLAN_STRIDE: i32 = ${PLAN_STRIDE};`,
  `const PLAN_DRAWN: i32 = ${PLAN_DRAWN};`,
  `const PLAN_SOLID: i32 = ${PLAN_SOLID};`,
  `const PLAN_BEHIND: i32 = ${PLAN_BEHIND};`,
  `const LAVA_COOLING_DEPTH: f32 = ${float(LAVA_COOLING_DEPTH)};`,
  `const LAVA_COOLING_BASE: f32 = ${float(LAVA_COOLING_BASE)};`,
  `const LAVA_COOLING_RANGE: f32 = ${float(LAVA_COOLING_RANGE)};`,
  `const SEE_THROUGH_DEEP: f32 = ${float(SEE_THROUGH_DEEP)};`,
  `const SEE_THROUGH_BODY: f32 = ${float(SEE_THROUGH_BODY)};`,
  `const MOLTEN_FLOW: f32 = ${float(MOLTEN_FLOW)};`,
].join('\n');

/** One refresh of the picture: what the target is laid from. */
export interface LiquidRefresh {
  readonly plan: Int32Array<ArrayBuffer>;
  /** Per art pixel: 1 where the rock mask is open. */
  readonly open: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly frame: number;
  readonly lava: boolean;
}

/** One frame's colour: the scene under water (RGBA), where the band is in the world, and the clock. */
export interface LiquidColour {
  readonly scene: Uint8ClampedArray<ArrayBuffer>;
  readonly originX: number;
  readonly originY: number;
  readonly time: number;
  readonly style: LiquidStyle;
}

export interface LiquidGpu {
  /** Upload a plan and lay the kinds (and lava's heat) from it: once per refresh. */
  refresh(input: LiquidRefresh): void;
  /** Colour the last refresh over `scene`, and read it back as RGBA. */
  colour(input: LiquidColour): Promise<Uint8ClampedArray>;
}

export function createLiquidGpu(device: GPUDevice): LiquidGpu {
  const module = device.createShaderModule({
    label: 'liquid',
    code: `${CONSTANTS_WGSL}\n${LIQUID_CONSTANTS}\n${noiseWgsl}\n${liquidWgsl}`,
  });
  const pipeline = (entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: 'auto',
      compute: { module, entryPoint },
    });
  const kindsPipeline = pipeline('kinds_main');
  const seedPipeline = pipeline('heat_seed');
  const stepPipeline = pipeline('heat_step');
  const colourPipeline = pipeline('colour_main');

  const params = device.createBuffer({
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const storage = (bytes: number, extra = 0): GPUBuffer =>
    device.createBuffer({
      size: Math.max(4, Math.ceil(bytes / 4) * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra,
    });
  const palette = storage(11 * 3 * 4);

  interface Sized {
    key: string;
    plan: GPUBuffer;
    open: GPUBuffer;
    kinds: GPUBuffer;
    distA: GPUBuffer;
    distB: GPUBuffer;
    scene: GPUBuffer;
    colour: GPUBuffer;
    readback: GPUBuffer;
  }
  let sized: Sized | null = null;
  let last: LiquidRefresh | null = null;

  const allocate = (input: LiquidRefresh): Sized => {
    const key = `${input.width}x${input.height}:${input.cols}x${input.rows}`;
    if (sized && sized.key === key) return sized;
    const pixels = input.width * input.height;
    const bytes = pixels * 4;
    sized = {
      key,
      plan: storage(input.plan.byteLength),
      open: storage(bytes),
      kinds: storage(bytes),
      distA: storage(bytes),
      distB: storage(bytes),
      scene: storage(bytes),
      colour: storage(bytes),
      readback: device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    };
    return sized;
  };

  const writeParams = (input: LiquidRefresh, colour?: LiquidColour): void => {
    const data = new DataView(new ArrayBuffer(PARAMS_BYTES));
    data.setUint32(0, input.width, true);
    data.setUint32(4, input.height, true);
    data.setUint32(8, input.cols, true);
    data.setUint32(12, input.rows, true);
    data.setUint32(16, input.cell, true);
    data.setUint32(20, input.frame, true);
    data.setUint32(24, input.lava ? 1 : 0, true);
    data.setInt32(28, colour?.originX ?? 0, true);
    data.setInt32(32, colour?.originY ?? 0, true);
    data.setFloat32(36, colour?.time ?? 0, true);
    device.queue.writeBuffer(params, 0, data.buffer);
  };

  const run = (
    encoder: GPUCommandEncoder,
    compute: GPUComputePipeline,
    entries: [number, GPUBuffer][],
    input: LiquidRefresh,
  ): void => {
    const group = device.createBindGroup({
      layout: compute.getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(compute);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(
      Math.ceil(input.width / WORKGROUP),
      Math.ceil(input.height / WORKGROUP),
    );
    pass.end();
  };

  return {
    refresh(input) {
      const r = allocate(input);
      last = input;
      device.queue.writeBuffer(r.plan, 0, input.plan);
      device.queue.writeBuffer(r.open, 0, new Uint32Array(input.open));
      writeParams(input);
      const encoder = device.createCommandEncoder();
      run(
        encoder,
        kindsPipeline,
        [
          [0, params],
          [1, r.plan],
          [2, r.open],
          [3, r.kinds],
        ],
        input,
      );
      if (input.lava) {
        run(
          encoder,
          seedPipeline,
          [
            [0, params],
            [9, r.kinds],
            [5, r.distA],
          ],
          input,
        );
        let from = r.distA;
        let to = r.distB;
        for (let step = 0; step < HEAT_STEPS; step++) {
          run(
            encoder,
            stepPipeline,
            [
              [0, params],
              [9, r.kinds],
              [4, from],
              [5, to],
            ],
            input,
          );
          [from, to] = [to, from];
        }
        // the answer is in `from`; keep it in distA for the colour stage
        if (from !== r.distA) encoder.copyBufferToBuffer(from, 0, r.distA, 0, from.size);
      }
      device.queue.submit([encoder.finish()]);
    },

    async colour(input) {
      if (!sized || !last) throw new Error('liquid: colour before refresh');
      const r = sized;
      const style = input.style;
      const swatches = [
        style.surface,
        style.light,
        style.mid,
        style.deep,
        style.body,
        ...LAVA_BANDS,
      ];
      device.queue.writeBuffer(palette, 0, new Float32Array(swatches.flat()));
      device.queue.writeBuffer(
        r.scene,
        0,
        new Uint32Array(input.scene.buffer, input.scene.byteOffset, input.scene.byteLength / 4),
      );
      writeParams(last, input);
      const encoder = device.createCommandEncoder();
      const entries: [number, GPUBuffer][] = [
        [0, params],
        [9, r.kinds],
        [6, r.scene],
        [7, r.colour],
        [8, palette],
        [4, r.distA], // read only for lava, but the stage names it either way
      ];
      run(encoder, colourPipeline, entries, last);
      encoder.copyBufferToBuffer(r.colour, 0, r.readback, 0, r.readback.size);
      device.queue.submit([encoder.finish()]);
      await r.readback.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8ClampedArray(r.readback.getMappedRange().slice(0));
      r.readback.unmap();
      return pixels;
    },
  };
}
