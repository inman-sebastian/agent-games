// fluid.ts — the pixel fluid on the GPU (#87): owns the state buffers and runs fluid.wgsl's passes, brushes
// and drawing. The rule itself is client/src/fluid/rule.ts's; this only moves it onto a device.
//
// A pass is rule.ts's three stages as dispatches: `headSteps` head relaxations ping-ponging between two head
// buffers, then fall (state → scratch) and flow (scratch → state), so the current state always ends where
// it started. Each pass needs its own uniform buffer (`queue.writeBuffer` calls all land before the command
// buffer runs), so up to MAX_PASSES_PER_STEP are prepared up front and reused.
import noiseWgsl from './noise.wgsl?raw';
import fluidWgsl from './fluid.wgsl?raw';
import { DEFAULT_PARAMS, HEAD_UNITS, LAVA, WATER, type FluidParams } from '../../fluid/rule';

const WORKGROUP = 8;
export const MAX_PASSES_PER_STEP = 64;
const FLUID_UNIFORM_BYTES = 32;
const BRUSH_UNIFORM_BYTES = 24;

export type BrushMode = 'water' | 'lava' | 'erase';

export interface GpuFluid {
  readonly width: number;
  readonly height: number;
  /** The pass the next step starts at. */
  readonly pass: number;
  /** Replace the whole state and start again from pass 0. */
  reset(state: Uint32Array<ArrayBuffer>): void;
  /** Replace the rock mask (1 = rock), e.g. after a dig. */
  setSolid(solid: Uint8Array): void;
  /** Run `passes` passes (at most MAX_PASSES_PER_STEP) in one submit. */
  step(passes: number): void;
  /** Pour or erase liquid in a disc of `radius` art pixels around (x, y). */
  brush(x: number, y: number, radius: number, mode: BrushMode): void;
  /** Draw the liquid over whatever `target` holds, into a render pass. */
  draw(target: GPUTextureView, format: GPUTextureFormat, load: 'clear' | 'load'): void;
  /** The current state, read back. */
  read(): Promise<Uint32Array>;
  params: FluidParams;
  destroy(): void;
}

export function createGpuFluid(device: GPUDevice, width: number, height: number): GpuFluid {
  const module = device.createShaderModule({ label: 'fluid', code: noiseWgsl + fluidWgsl });
  const pipeline = (entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label: entryPoint,
      layout: 'auto',
      compute: { module, entryPoint },
    });
  const headPipeline = pipeline('fluid_head');
  const fallPipeline = pipeline('fluid_fall');
  const flowPipeline = pipeline('fluid_flow');
  const brushPipeline = pipeline('fluid_brush');
  const pixels = width * height;
  const storage = (): GPUBuffer =>
    device.createBuffer({
      size: pixels * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  const stateBuffer = storage();
  const scratch = storage();
  const heads = [storage(), storage()];
  const solidBuffer = storage();
  const uniform = (bytes: number): GPUBuffer =>
    device.createBuffer({ size: bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const passBuffers = Array.from({ length: MAX_PASSES_PER_STEP }, () =>
    uniform(FLUID_UNIFORM_BYTES),
  );
  const brushBuffer = uniform(BRUSH_UNIFORM_BYTES);
  const drawBuffer = uniform(8);
  device.queue.writeBuffer(drawBuffer, 0, new Uint32Array([width, height]));

  const group = (
    target: GPUComputePipeline | GPURenderPipeline,
    entries: Record<number, GPUBuffer>,
  ): GPUBindGroup =>
    device.createBindGroup({
      layout: target.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([binding, buffer]) => ({
        binding: Number(binding),
        resource: { buffer },
      })),
    });
  // head: from head buffer h to 1 - h, against the state as the pass starts
  const headGroups = [0, 1].map((h) =>
    group(headPipeline, {
      0: passBuffers[0],
      1: solidBuffer,
      2: stateBuffer,
      4: heads[h],
      5: heads[1 - h],
    }),
  );
  const fallGroups = passBuffers.map((passBuffer) =>
    group(fallPipeline, { 0: passBuffer, 1: solidBuffer, 2: stateBuffer, 3: scratch }),
  );
  // flow reads whichever head buffer the relaxation ended in
  const flowGroups = passBuffers.map((passBuffer) =>
    [0, 1].map((h) =>
      group(flowPipeline, {
        0: passBuffer,
        1: solidBuffer,
        2: scratch,
        3: stateBuffer,
        4: heads[h],
      }),
    ),
  );
  const brushGroup = group(brushPipeline, {
    0: passBuffers[0],
    1: solidBuffer,
    6: brushBuffer,
    7: stateBuffer,
  });
  let currentHead = 0;

  let pass = 0;
  let params: FluidParams = { ...DEFAULT_PARAMS };

  function writePass(buffer: GPUBuffer, passNumber: number): void {
    const bytes = new Uint32Array(FLUID_UNIFORM_BYTES / 4);
    bytes[0] = width;
    bytes[1] = height;
    bytes[2] = passNumber >>> 0;
    bytes[3] = params.energy;
    bytes[4] = params.sight;
    bytes[5] = params.chance[WATER];
    bytes[6] = params.chance[LAVA];
    device.queue.writeBuffer(buffer, 0, bytes);
  }

  const drawPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  function drawPipeline(format: GPUTextureFormat): GPURenderPipeline {
    let made = drawPipelines.get(format);
    if (!made) {
      const over: GPUBlendComponent = {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      };
      made = device.createRenderPipeline({
        label: 'fluid draw',
        layout: 'auto',
        vertex: { module, entryPoint: 'fluid_vertex' },
        fragment: {
          module,
          entryPoint: 'fluid_fragment',
          targets: [{ format, blend: { color: over, alpha: over } }],
        },
      });
      drawPipelines.set(format, made);
    }
    return made;
  }

  return {
    width,
    height,
    get pass() {
      return pass;
    },
    get params() {
      return params;
    },
    set params(next) {
      params = next;
    },
    reset(state) {
      device.queue.writeBuffer(stateBuffer, 0, state);
      const head = new Uint32Array(pixels);
      for (let y = 0; y < height; y++) head.fill(y * HEAD_UNITS, y * width, (y + 1) * width);
      device.queue.writeBuffer(heads[currentHead], 0, head);
      pass = 0;
    },
    setSolid(solid) {
      device.queue.writeBuffer(solidBuffer, 0, Uint32Array.from(solid));
    },
    step(passes) {
      const count = Math.min(MAX_PASSES_PER_STEP, Math.max(0, Math.floor(passes)));
      if (count === 0) return;
      const encoder = device.createCommandEncoder();
      const computePass = encoder.beginComputePass();
      const dispatch = (pipeline: GPUComputePipeline, bindGroup: GPUBindGroup): void => {
        computePass.setPipeline(pipeline);
        computePass.setBindGroup(0, bindGroup);
        computePass.dispatchWorkgroups(Math.ceil(width / WORKGROUP), Math.ceil(height / WORKGROUP));
      };
      for (let k = 0; k < count; k++) {
        writePass(passBuffers[k], pass + k);
        for (let h = 0; h < params.headSteps; h++) {
          dispatch(headPipeline, headGroups[currentHead]);
          currentHead = 1 - currentHead;
        }
        dispatch(fallPipeline, fallGroups[k]);
        dispatch(flowPipeline, flowGroups[k][currentHead]);
      }
      computePass.end();
      device.queue.submit([encoder.finish()]);
      pass += count;
    },
    brush(x, y, radius, mode) {
      writePass(passBuffers[0], pass);
      const bytes = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
      new Int32Array(bytes, 0, 3).set([Math.round(x), Math.round(y), Math.round(radius)]);
      new Uint32Array(bytes, 12, 3).set([
        mode === 'water' ? WATER - 1 : mode === 'lava' ? LAVA - 1 : 2,
        pass >>> 0,
        params.energy,
      ]);
      device.queue.writeBuffer(brushBuffer, 0, bytes);
      const encoder = device.createCommandEncoder();
      const computePass = encoder.beginComputePass();
      computePass.setPipeline(brushPipeline);
      computePass.setBindGroup(0, brushGroup);
      computePass.dispatchWorkgroups(Math.ceil(width / WORKGROUP), Math.ceil(height / WORKGROUP));
      computePass.end();
      device.queue.submit([encoder.finish()]);
    },
    draw(target, format, load) {
      const renderPipeline = drawPipeline(format);
      const group = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: solidBuffer } },
          { binding: 8, resource: { buffer: drawBuffer } },
          { binding: 9, resource: { buffer: stateBuffer } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target, loadOp: load, storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
      });
      renderPass.setPipeline(renderPipeline);
      renderPass.setBindGroup(0, group);
      renderPass.draw(3);
      renderPass.end();
      device.queue.submit([encoder.finish()]);
    },
    async read() {
      const staging = device.createBuffer({
        size: pixels * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(stateBuffer, 0, staging, 0, pixels * 4);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const copy = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      return copy;
    },
    destroy() {
      [
        stateBuffer,
        scratch,
        ...heads,
        solidBuffer,
        ...passBuffers,
        brushBuffer,
        drawBuffer,
      ].forEach((b) => b.destroy());
    },
  };
}
