// chunk-worker.ts — generates rectangular rock chunks off the main thread so moving through
// fresh world never stalls the game loop. Uses the SAME renderer as the main thread
// (cave-render) into an OffscreenCanvas, and ships the finished chunk back as a transferable
// ImageBitmap (zero-copy). A chunk is a CW×CH tile block addressed by (cx, cy); rock shape
// depends only on dug state, so each request carries the dug tiles overlapping its region. The
// strata palette is posted in the init message, so the Worker needn't load the entity registry.
import { composeBand, setStrata } from './cave-render';
import type { StrataResource } from './types';

interface WorkerConfig {
  T: number;
  CW: number;
  CH: number;
  SURFACE: number;
  MARGIN: number;
  strata?: readonly StrataResource[];
}
type IncomingMessage =
  { type: 'init'; cfg: WorkerConfig } | { type: 'chunk'; cx: number; cy: number; dug: Set<string> };

const worker = self as unknown as DedicatedWorkerGlobalScope;

let cfg: WorkerConfig = { T: 16, CW: 12, CH: 6, SURFACE: 0, MARGIN: 1 };
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
  if (message.type !== 'chunk') return;

  const { T, CW, CH, SURFACE, MARGIN } = cfg;
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
  const solidTile = (column: number, row: number): boolean =>
    row > SURFACE && !dug.has(`${column},${row}`);

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
    SURFACE,
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
