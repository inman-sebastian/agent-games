// chunk-worker.ts — generates rectangular rock chunks off the main thread so moving through
// fresh world never stalls the game loop. Uses the SAME renderer as the main thread
// (cave-render) into an OffscreenCanvas, and ships the finished chunk back as a transferable
// ImageBitmap (zero-copy). A chunk is a CW×CH tile block addressed by (cx, cy); rock shape
// depends only on dug state, so each request carries the dug tiles overlapping its region. Ore
// is baked INTO the chunk (via each ore's material shader) so veins feather into the rock exactly
// as they do everywhere else — so the Worker also carries the world seed + the material registry.
import { composeBand, setStrata } from './cave-render';
import { oreAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from './materials';
import type { Material } from './materials';
import type { StrataResource } from '@delve/shared';

interface WorkerConfig {
  T: number;
  CW: number;
  CH: number;
  MARGIN: number;
  strata?: readonly StrataResource[];
}
type IncomingMessage =
  | { type: 'init'; cfg: WorkerConfig }
  | { type: 'world'; seed: number }
  | { type: 'chunk'; cx: number; cy: number; dug: Set<string> };

const worker = self as unknown as DedicatedWorkerGlobalScope;

let cfg: WorkerConfig = { T: 16, CW: 12, CH: 6, MARGIN: 1 };
let worldSeed: number | null = null; // set by the 'world' message; ore is baked once it's known
let scratch: OffscreenCanvas | null = null;
let scratchCtx: OffscreenCanvasRenderingContext2D | null = null;
let core: OffscreenCanvas | null = null;
let coreCtx: OffscreenCanvasRenderingContext2D | null = null;

worker.onmessage = (event: MessageEvent<IncomingMessage>): void => {
  const message = event.data;
  if (message.type === 'init') {
    cfg = message.cfg;
    setStrata(cfg.strata ?? []);
    return;
  }
  if (message.type === 'world') {
    worldSeed = message.seed;
    return;
  }
  if (message.type !== 'chunk') return;

  const { T, CW, CH, MARGIN } = cfg;
  const paddedWidth = (CW + 2 * MARGIN) * T;
  const paddedHeight = (CH + 2 * MARGIN) * T;
  const coreWidth = CW * T;
  const coreHeight = CH * T;
  if (!scratch || scratch.width !== paddedWidth || scratch.height !== paddedHeight) {
    scratch = new OffscreenCanvas(paddedWidth, paddedHeight);
    scratchCtx = scratch.getContext('2d')!;
    scratchCtx.imageSmoothingEnabled = false;
    core = new OffscreenCanvas(coreWidth, coreHeight);
    coreCtx = core.getContext('2d')!;
    coreCtx.imageSmoothingEnabled = false;
  }

  const dug = message.dug; // Set of "column,row" keys dug within this chunk's region
  // The surface is a heightmap, so the worker computes it from the seed rather than being handed a
  // row — a function cannot cross a postMessage boundary.
  const seed = worldSeed;
  const surface = (column: number): number => (seed === null ? 0 : surfaceAt(seed, column));
  const solidTile = (column: number, row: number): boolean =>
    row > surface(column) && !dug.has(`${column},${row}`);

  // each solid tile's ore (if any) → its material, baked into the band so it feathers into the rock
  const materialAt: ((column: number, row: number) => Material | null) | undefined =
    seed === null ? undefined : (column, row) => oreMaterial(oreAt(seed, column, row));

  const bandLeft = message.cx * CW - MARGIN;
  const bandTop = message.cy * CH - MARGIN;
  composeBand(
    scratchCtx!,
    solidTile,
    bandLeft,
    bandTop,
    CW + 2 * MARGIN,
    CH + 2 * MARGIN,
    Infinity,
    surface,
    materialAt,
  );
  coreCtx!.clearRect(0, 0, coreWidth, coreHeight);
  coreCtx!.drawImage(
    scratch!,
    MARGIN * T,
    MARGIN * T,
    coreWidth,
    coreHeight,
    0,
    0,
    coreWidth,
    coreHeight,
  ); // drop the margin
  const bmp = core!.transferToImageBitmap();
  worker.postMessage({ cx: message.cx, cy: message.cy, bmp }, [bmp]);
};
