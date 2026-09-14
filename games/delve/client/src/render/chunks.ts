// chunks.ts — the rock chunk grid: its geometry, one chunk's bake, and which chunks a dig makes stale.
//
// The rock is expensive, so it is cached as world-anchored chunks (see docs/ARCHITECTURE.md, "The
// rock chunk pipeline"). Every place that bakes a chunk — the main thread, the Worker, the lab and the
// gate test — goes through `bakeChunk`, and every place that decides what a dig invalidates goes
// through `chunksReading`. Before this module those rules were restated in three files, and the
// patch-lab "check" was verifying a copy of the arithmetic rather than the code the game runs.
//
// The live cache (Map, Worker round trip, eviction) is `createChunkCache` at the bottom; everything
// above it is pure geometry plus one bake, so it can be tested without a browser.
import { composeBand, SHADE_INFLUENCE_CELLS, TOP_LIGHT_ROWS, T } from './cave-render';
import type { Material } from './materials';
import type { StrataResource } from '@delve/shared';

/** Chunk size in CELLS. Still the pre-split numbers, so a chunk covers a quarter of the world area it
 * used to — a queued tidy (docs/DESIGN.md, "Rendering perf"), not a correctness problem. */
export const CHUNK_COLS = 12;
export const CHUNK_ROWS = 6;

/**
 * Context each bake renders around its chunk, in CELLS, then crops away.
 *
 * At least the shading's influence radius, or a chunk disagrees with its neighbours at the seam. It
 * was 1 while a cell was a whole block; after the 2x2 split (#44) that left the worst seam pixel off
 * by 207 of 1020. The gate test (chunks.test.ts) holds it to the whole-region render.
 */
export const CHUNK_MARGIN = SHADE_INFLUENCE_CELLS;

export const chunkX = (column: number): number => Math.floor(column / CHUNK_COLS);
export const chunkY = (row: number): number => Math.floor(row / CHUNK_ROWS);
export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

/** What a bake needs to know about the world. All pure functions of a cell. */
export interface ChunkSources {
  readonly solid: (column: number, row: number) => boolean;
  readonly surfaceAt: (column: number) => number;
  readonly materialAt?: (column: number, row: number) => Material | null;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Pixel size of the padded scratch a bake renders into, for a given margin. */
export function scratchSize(margin = CHUNK_MARGIN): { width: number; height: number } {
  return { width: (CHUNK_COLS + 2 * margin) * T, height: (CHUNK_ROWS + 2 * margin) * T };
}

/**
 * Bake chunk `(cx, cy)` into `out` (CHUNK_COLS x CHUNK_ROWS cells), rendering it with `margin` cells of
 * context in `scratch` first. `scratch` must be `scratchSize(margin)`.
 *
 * `margin` is a parameter only so the gate test can prove a too-small one fails; the game never passes
 * it.
 */
export function bakeChunk(
  scratch: Context2D,
  out: Context2D,
  cx: number,
  cy: number,
  sources: ChunkSources,
  margin = CHUNK_MARGIN,
): void {
  composeBand(
    scratch,
    sources.solid,
    cx * CHUNK_COLS - margin,
    cy * CHUNK_ROWS - margin,
    CHUNK_COLS + 2 * margin,
    CHUNK_ROWS + 2 * margin,
    sources.surfaceAt,
    sources.materialAt,
  );
  const width = CHUNK_COLS * T;
  const height = CHUNK_ROWS * T;
  out.clearRect(0, 0, width, height);
  out.drawImage(scratch.canvas, margin * T, margin * T, width, height, 0, 0, width, height);
}

/**
 * The cells a bake of `(cx, cy)` reads, inclusive: its padded band, plus `TOP_LIGHT_ROWS` above it,
 * where the shading counts solid rock to seed the top-light. The Worker is sent exactly the dug cells
 * in this region, so if this under-reports, a Worker bake is wrong — the gate test bakes the way the
 * Worker does to hold it honest, and fails if the band's own margin is left out.
 *
 * Measured, and worth knowing: the `TOP_LIGHT_ROWS` extension has NO visible effect on a chunk's
 * core. The seed only changes pixels at least `CHUNK_MARGIN * T` (24px) below the band's top, and
 * the shading range is 22px, so by the time it could matter brightness has clamped. Leaving it out
 * passes the exact-match gate, even with a fixture built to isolate it. It stays because it is what
 * the bake READS, and that is the rule that can be proved; dropping it would cut roughly two chunk
 * rows of re-bakes from every dig, which is the saving on offer if dig cost ever matters.
 */
export function chunkReadRegion(
  cx: number,
  cy: number,
  margin = CHUNK_MARGIN,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: cx * CHUNK_COLS - margin,
    right: (cx + 1) * CHUNK_COLS - 1 + margin,
    top: cy * CHUNK_ROWS - margin - TOP_LIGHT_ROWS,
    bottom: (cy + 1) * CHUNK_ROWS - 1 + margin,
  };
}

/**
 * Every chunk whose bake reads cell `(column, row)` — a sufficient set to re-bake after a dig there,
 * since a bake's output depends only on what it reads. Derived from `chunkReadRegion` rather than
 * restated, so the invalidation rule and the Worker's view of the world can't drift apart.
 *
 * It is deliberately a little generous. The range index.ts used to hand-write stopped `MARGIN` rows
 * short of the read region below the dig. Checked while writing this module, that turned out to be
 * harmless: those chunks see the dig only through their top-light seed, which changes pixels at least
 * 24px deep, where brightness has already clamped to dark. But that rests on a clamp somewhere else in
 * the shader — "reads it" is the rule that can be proved, so it is the rule used.
 */
export function chunksReading(
  column: number,
  row: number,
  margin = CHUNK_MARGIN,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let cy = chunkY(row - margin); cy <= chunkY(row + margin + TOP_LIGHT_ROWS); cy++) {
    for (let cx = chunkX(column - margin); cx <= chunkX(column + margin); cx++) {
      const region = chunkReadRegion(cx, cy, margin);
      const reads =
        column >= region.left &&
        column <= region.right &&
        row >= region.top &&
        row <= region.bottom;
      if (reads) out.push([cx, cy]);
    }
  }
  return out;
}

// ---- the live cache ---------------------------------------------------------------------------------

/** A baked chunk's pixels, kept for blitting. */
export interface CachedChunk {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly ctx: Context2D;
}

/** Messages to the Worker. Geometry is NOT sent: both sides import it from this module. */
export type ChunkWorkerMessage =
  | { readonly type: 'init'; readonly strata: readonly StrataResource[] }
  | { readonly type: 'world'; readonly seed: number }
  | ChunkRequest;

/** A request to the Worker, and what comes back. `epoch` ties a result to the world it was asked for. */
export interface ChunkRequest {
  readonly type: 'chunk';
  readonly cx: number;
  readonly cy: number;
  readonly epoch: number;
  readonly dug: Set<string>;
}
export interface ChunkResult {
  readonly cx: number;
  readonly cy: number;
  readonly epoch: number;
  readonly bmp: ImageBitmap;
}

/** The slice of a Worker the cache uses — narrow so a test can stand in for it. */
export interface ChunkWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ChunkResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface ChunkCacheOptions {
  /** The world as the main thread sees it right now — read on every sync bake. */
  readonly sources: () => ChunkSources;
  /** Every dug cell key, for choosing what to send the Worker. */
  readonly dugKeys: () => Iterable<string>;
  /** Off-thread baker, or null to bake synchronously (no Worker/OffscreenCanvas support). */
  readonly worker: ChunkWorker | null;
  /** The current world's seed — the Worker needs it to bake ore and the surface. */
  readonly seed: () => number;
  /** The depth strata ramps, sent to the Worker once. */
  readonly strata: readonly StrataResource[];
  /** A canvas of the given pixel size with its 2D context. */
  readonly makeCanvas: (width: number, height: number) => CachedChunk;
  /** Start evicting once more chunks than this are cached. */
  readonly cacheLimit?: number;
  /** Keep chunks within this many chunks of the view when evicting. */
  readonly evictMargin?: number;
}

export interface ChunkStats {
  cached: number;
  inflight: number;
  bakes: number;
  bakeMs: number;
  syncBakes: number;
  lastSyncBakeMs: number;
}

/**
 * The rock chunk cache the game draws from: bakes chunks off-thread as they come into view (or
 * synchronously without a Worker), re-bakes what a dig makes stale, and evicts what is far away.
 */
export function createChunkCache(options: ChunkCacheOptions) {
  const { sources, dugKeys, makeCanvas } = options;
  const cacheLimit = options.cacheLimit ?? 400;
  const evictMargin = options.evictMargin ?? 12;
  let worker = options.worker;

  const chunks = new Map<string, CachedChunk>();
  /** In-flight Worker bakes. The value is true when a dig landed after the request was sent, so the
   * result is already stale and needs one more bake once it arrives. */
  const inflight = new Map<string, boolean>();
  const sentAt = new Map<string, number>();
  const size = scratchSize();
  const scratch = makeCanvas(size.width, size.height);
  scratch.ctx.imageSmoothingEnabled = false;

  // Bumped on every reset. A result carries the epoch it was requested in, so a bake that was queued
  // for the PREVIOUS world and lands after a new game or a server hello is dropped. Without it, clearing
  // the cache wasn't enough: those late results were stored as if current, and a chunk that exists is
  // never re-baked — so old-world rock stayed on screen in the new world.
  let epoch = 0;

  const stats: ChunkStats = {
    cached: 0,
    inflight: 0,
    bakes: 0,
    bakeMs: 0,
    syncBakes: 0,
    lastSyncBakeMs: 0,
  };
  const EMA = 0.1;

  function chunkFor(key: string): CachedChunk {
    const existing = chunks.get(key);
    if (existing) return existing;
    const created = makeCanvas(CHUNK_COLS * T, CHUNK_ROWS * T);
    chunks.set(key, created);
    return created;
  }

  function bakeNow(cx: number, cy: number): void {
    const start = performance.now();
    bakeChunk(scratch.ctx, chunkFor(chunkKey(cx, cy)).ctx, cx, cy, sources());
    stats.syncBakes++;
    stats.lastSyncBakeMs = performance.now() - start;
  }

  function dugForWorker(cx: number, cy: number): Set<string> {
    const region = chunkReadRegion(cx, cy);
    const out = new Set<string>();
    for (const key of dugKeys()) {
      const comma = key.indexOf(',');
      const column = +key.slice(0, comma);
      const row = +key.slice(comma + 1);
      if (
        column >= region.left &&
        column <= region.right &&
        row >= region.top &&
        row <= region.bottom
      )
        out.add(key);
    }
    return out;
  }

  function send(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    inflight.set(key, false);
    sentAt.set(key, performance.now());
    post({ type: 'chunk', cx, cy, epoch, dug: dugForWorker(cx, cy) });
  }

  const post = (message: ChunkWorkerMessage): void => worker?.postMessage(message);

  if (worker) {
    post({ type: 'init', strata: options.strata });
    post({ type: 'world', seed: options.seed() });
    worker.onmessage = (event) => {
      const { cx, cy, bmp } = event.data;
      if (event.data.epoch !== epoch) {
        bmp.close(); // asked for by a world that no longer exists
        return;
      }
      const key = chunkKey(cx, cy);
      const requested = sentAt.get(key);
      if (requested !== undefined) {
        sentAt.delete(key);
        stats.bakes++;
        const ms = performance.now() - requested;
        stats.bakeMs = stats.bakeMs === 0 ? ms : stats.bakeMs + (ms - stats.bakeMs) * EMA;
      }
      const staleOnArrival = inflight.get(key) === true;
      inflight.delete(key);
      const chunk = chunkFor(key);
      chunk.ctx.clearRect(0, 0, CHUNK_COLS * T, CHUNK_ROWS * T);
      chunk.ctx.drawImage(bmp, 0, 0);
      bmp.close();
      if (staleOnArrival) send(cx, cy); // the live dug set is complete now, so one more bake settles it
    };
    worker.onerror = () => {
      worker = null; // fall back to synchronous bakes
    };
  }

  /** Make sure `(cx, cy)` is on its way (Worker) — a no-op if it is cached or already requested. */
  function request(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    if (chunks.has(key) || inflight.has(key)) return;
    if (worker) send(cx, cy);
  }

  return {
    /** Blit the chunks covering the given chunk range into `g`, then prefetch and evict around it. */
    draw(g: CanvasRenderingContext2D, cx0: number, cx1: number, cy0: number, cy1: number): void {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const chunk = chunks.get(chunkKey(cx, cy));
          if (chunk) {
            g.drawImage(chunk.canvas, cx * CHUNK_COLS * T, cy * CHUNK_ROWS * T);
          } else {
            request(cx, cy);
            g.fillStyle = '#0b0e13'; // placeholder for the frame or two until it arrives
            g.fillRect(cx * CHUNK_COLS * T, cy * CHUNK_ROWS * T, CHUNK_COLS * T, CHUNK_ROWS * T);
          }
        }
      }
      if (worker) {
        // a ring around the view, so chunks are ready before they scroll in
        for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
          for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) request(cx, cy);
      } else {
        // no Worker: bake at most ONE missing chunk per frame, so a resize or teleport can't hitch
        search: for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++)
            if (!chunks.has(chunkKey(cx, cy))) {
              bakeNow(cx, cy);
              break search;
            }
      }
      if (chunks.size > cacheLimit) {
        for (const key of [...chunks.keys()]) {
          const comma = key.indexOf(',');
          const kx = +key.slice(0, comma);
          const ky = +key.slice(comma + 1);
          const far =
            kx < cx0 - evictMargin ||
            kx > cx1 + evictMargin ||
            ky < cy0 - evictMargin ||
            ky > cy1 + evictMargin;
          if (far) chunks.delete(key);
        }
      }
    },

    /**
     * A cell was dug: re-bake every cached chunk whose bake reads it. The chunk under the pick is
     * re-baked synchronously so digging stays instant; the rest go to the Worker. A chunk still being
     * baked is marked stale, so it bakes once more when it lands.
     */
    dig(column: number, row: number): void {
      const own = chunkKey(chunkX(column), chunkY(row));
      for (const [cx, cy] of chunksReading(column, row)) {
        const key = chunkKey(cx, cy);
        if (inflight.has(key)) {
          inflight.set(key, true);
          continue;
        }
        if (!chunks.has(key)) continue; // never baked: it will read the dug set when it is
        if (key === own || !worker) bakeNow(cx, cy);
        else send(cx, cy);
      }
    },

    /** The world changed (new game, server hello): forget every chunk and every bake in flight. */
    reset(): void {
      epoch++;
      chunks.clear();
      inflight.clear();
      sentAt.clear();
      post({ type: 'world', seed: options.seed() });
    },

    stats(): ChunkStats {
      stats.cached = chunks.size;
      stats.inflight = inflight.size;
      return stats;
    },
  };
}

export type ChunkCache = ReturnType<typeof createChunkCache>;
