// chunk-worker.ts — bakes rock chunks off the main thread, so moving through fresh world never stalls
// the game loop. It renders with the SAME `bakeChunk` the main thread uses (chunks.ts), into an
// OffscreenCanvas, and ships the result back as a transferable ImageBitmap.
//
// The rock depends on dug state, so each request carries the dug cells inside the chunk's read region
// (chunkReadRegion). Ore is baked INTO the chunk through each ore's material shader, so the Worker also
// holds the world seed. Chunk geometry is imported, not sent: it used to arrive as an `init` config,
// restating the main thread's arithmetic, with a fallback of `T: 16, MARGIN: 1` that no longer matched
// anything.
import { setStrata, T } from './cave-render';
import { oreAt, solidAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from './materials';
import {
  CHUNK_COLS,
  CHUNK_ROWS,
  bakeChunk,
  scratchSize,
  type ChunkResult,
  type ChunkSources,
  type ChunkWorkerMessage,
} from './chunks';

const worker = self as unknown as DedicatedWorkerGlobalScope;

let worldSeed: number | null = null; // set by the 'world' message; nothing is baked before it
const size = scratchSize();
const scratch = new OffscreenCanvas(size.width, size.height).getContext('2d')!;
scratch.imageSmoothingEnabled = false;
const core = new OffscreenCanvas(CHUNK_COLS * T, CHUNK_ROWS * T);
const coreCtx = core.getContext('2d')!;
coreCtx.imageSmoothingEnabled = false;

worker.onmessage = (event: MessageEvent<ChunkWorkerMessage>): void => {
  const message = event.data;
  if (message.type === 'init') {
    setStrata(message.strata);
    return;
  }
  if (message.type === 'world') {
    worldSeed = message.seed;
    return;
  }
  const seed = worldSeed;
  if (seed === null) return; // the cache always sends the world first; never bake a guessed one

  const dug = message.dug;
  // The same solidity rule the main thread uses (engine.solidCell), over the dug cells it was sent.
  const sources: ChunkSources = {
    solid: (column, row) => solidAt(seed, column, row) && !dug.has(`${column},${row}`),
    surfaceAt: (column) => surfaceAt(seed, column),
    materialAt: (column, row) => oreMaterial(oreAt(seed, column, row)),
  };
  bakeChunk(scratch, coreCtx, message.cx, message.cy, sources);
  const bmp = core.transferToImageBitmap();
  const result: ChunkResult = { cx: message.cx, cy: message.cy, epoch: message.epoch, bmp };
  worker.postMessage(result, [bmp]);
};
