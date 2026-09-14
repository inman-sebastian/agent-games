// chunks.test.ts — the rock chunk invariants, in the gate.
//
// Two bugs came out of this pipeline in one week (#44): chunks baked with too little context
// disagreed with their neighbours at the seams, and a dig refreshed too small a window, leaving stale
// shading around every fresh tunnel. Both are "a partial render must equal a complete one", which is
// what these assert — against the real `bakeChunk` and `chunksReading` the game and the Worker call.
//
// The reference for a chunk is THE SAME chunk baked with far more context than anything can read
// (REFERENCE_MARGIN). composeBand picks its strata ramp from the band's centre row, and a chunk's
// centre doesn't move with its margin, so the two share a ramp and can be required to match EXACTLY —
// the per-band ramp difference (#54) never enters into it.
//
// Rendered through soft-canvas.ts, since there is no 2D canvas here. Below the surface on purpose:
// the sky gradient is normalised per band, which is #54's banding, not a context bug.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { STRATA, oreAt, solidAt, surfaceAt } from '@delve/shared';
import { setStrata, T, SHADE_INFLUENCE_CELLS, TOP_LIGHT_ROWS } from './cave-render';
import { oreMaterial } from './materials';
import {
  CHUNK_COLS,
  CHUNK_ROWS,
  CHUNK_MARGIN,
  bakeChunk,
  chunkReadRegion,
  chunksReading,
  chunkKey,
  chunkX,
  chunkY,
  createChunkCache,
  scratchSize,
  type ChunkSources,
} from './chunks';
import { SoftCanvas } from './soft-canvas';

const SEED = 7;
const REFERENCE_MARGIN = SHADE_INFLUENCE_CELLS + TOP_LIGHT_ROWS + 1; // past anything a bake reads
// A window of chunks well below the surface (rows are cells; the surface is near row 0).
const CX0 = 3;
const CY0 = 30;
const NX = 3;
const NY = 3;

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', SoftCanvas); // cave-render makes its scratch canvases with this
  setStrata(STRATA);
});
afterAll(() => vi.unstubAllGlobals());

const surface = (column: number): number => surfaceAt(SEED, column);
const material = (column: number, row: number) => oreMaterial(oreAt(SEED, column, row));

/** The world as the MAIN THREAD sees it: every dug cell. */
const fullSources = (dug: Set<string>): ChunkSources => ({
  solid: (c, r) => solidAt(SEED, c, r) && !dug.has(`${c},${r}`),
  surfaceAt: surface,
  materialAt: material,
});

/** The world as the WORKER sees it for one chunk: only the dug cells inside its read region. */
function workerSources(dug: Set<string>, cx: number, cy: number, margin: number): ChunkSources {
  const region = chunkReadRegion(cx, cy, margin);
  const visible = new Set(
    [...dug].filter((key) => {
      const [c, r] = key.split(',').map(Number);
      return c >= region.left && c <= region.right && r >= region.top && r <= region.bottom;
    }),
  );
  return fullSources(visible);
}

function bake(cx: number, cy: number, sources: ChunkSources, margin: number): Uint8ClampedArray {
  const { width, height } = scratchSize(margin);
  const scratch = new SoftCanvas(width, height).getContext('2d');
  const out = new SoftCanvas(CHUNK_COLS * T, CHUNK_ROWS * T);
  bakeChunk(
    scratch as unknown as CanvasRenderingContext2D,
    out.getContext('2d') as unknown as CanvasRenderingContext2D,
    cx,
    cy,
    sources,
    margin,
  );
  return out.data;
}

// A reference bake depends only on the chunk and the dug set, and several tests ask for the same ones.
// It is by far the most expensive thing here, so each is computed once.
const references = new Map<string, Uint8ClampedArray>();
function reference(cx: number, cy: number, dug: Set<string>): Uint8ClampedArray {
  const key = `${chunkKey(cx, cy)}|${[...dug].sort().join(';')}`;
  let data = references.get(key);
  if (!data) {
    data = bake(cx, cy, fullSources(dug), REFERENCE_MARGIN);
    references.set(key, data);
  }
  return data;
}

const differingPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      count++;
  }
  return count;
};

/**
 * A tunnel and a shaft placed ON PURPOSE two cells from a chunk seam each way — inside the shading's
 * reach (SHADE_INFLUENCE_CELLS) but outside a one-cell margin, so a chunk that can't see them has to
 * shade differently. A fixture that merely happens to cross a seam can miss that entirely.
 */
function carvedTunnel(): Set<string> {
  const dug = new Set<string>();
  const verticalSeam = (CX0 + 1) * CHUNK_COLS; // first column of the second chunk across
  const horizontalSeam = (CY0 + 2) * CHUNK_ROWS; // first row of the third chunk down
  // shaft: right edge two cells left of the vertical seam, running through all three chunk rows
  for (let row = CY0 * CHUNK_ROWS; row < (CY0 + NY) * CHUNK_ROWS; row++)
    for (const column of [verticalSeam - 4, verticalSeam - 3]) dug.add(`${column},${row}`);
  // tunnel: body-height, bottom row two cells above the horizontal seam, crossing the vertical seam
  for (let column = verticalSeam - 10; column < verticalSeam + 10; column++)
    for (let row = horizontalSeam - 6; row <= horizontalSeam - 3; row++)
      dug.add(`${column},${row}`);
  // a slot lying just ABOVE the middle chunk row's band, over unbroken rock: the case where only the
  // top-light seed (the TOP_LIGHT_ROWS lookup above a band) can see the opening
  const middleBandTop = (CY0 + 1) * CHUNK_ROWS - CHUNK_MARGIN;
  for (let column = verticalSeam + 2; column < verticalSeam + 9; column++)
    for (const row of [middleBandTop - 1, middleBandTop - 2]) dug.add(`${column},${row}`);
  return dug;
}

describe('a chunk bake has all the context it needs', () => {
  it('matches the same chunk baked with unlimited context, exactly — as the Worker bakes it', () => {
    const dug = carvedTunnel();
    for (let cy = CY0; cy < CY0 + NY; cy++) {
      for (let cx = CX0; cx < CX0 + NX; cx++) {
        const game = bake(cx, cy, workerSources(dug, cx, cy, CHUNK_MARGIN), CHUNK_MARGIN);
        expect(differingPixels(game, reference(cx, cy, dug)), `chunk ${chunkKey(cx, cy)}`).toBe(0);
      }
    }
  });

  it('would not, with the margin a chunk used to have', () => {
    // The #44 seam bug, kept as proof the test above can fail: MARGIN 1 was fine while a cell was a
    // block and is visibly wrong now.
    const dug = carvedTunnel();
    let differing = 0;
    for (let cy = CY0; cy < CY0 + NY; cy++) {
      for (let cx = CX0; cx < CX0 + NX; cx++) {
        const tooLittle = bake(cx, cy, fullSources(dug), 1);
        differing += differingPixels(tooLittle, reference(cx, cy, dug));
      }
    }
    expect(differing).toBeGreaterThan(0);
  });
});

describe('a dig re-bakes every chunk it changes', () => {
  // Start from a baked window, dig cell by cell, re-bake ONLY what `chunksReading` names (the way the
  // game does, Worker-style), and demand the result equals baking everything from scratch.
  function digAndCompare(
    affected: (column: number, row: number) => Array<[number, number]>,
  ): number {
    const dug = carvedTunnel();
    const cache = new Map<string, Uint8ClampedArray>();
    for (let cy = CY0; cy < CY0 + NY; cy++)
      for (let cx = CX0; cx < CX0 + NX; cx++)
        cache.set(chunkKey(cx, cy), bake(cx, cy, fullSources(dug), CHUNK_MARGIN));

    // new digs: a side passage across a seam, and a short shaft above a lower chunk
    const digs: Array<[number, number]> = [];
    const baseColumn = CX0 * CHUNK_COLS + CHUNK_COLS - 2;
    const baseRow = (CY0 + 1) * CHUNK_ROWS - 3;
    for (let i = 0; i < 6; i++) digs.push([baseColumn + i, baseRow], [baseColumn + i, baseRow + 1]);
    for (let k = 0; k < 4; k++)
      digs.push([CX0 * CHUNK_COLS + 9, (CY0 + NY - 1) * CHUNK_ROWS - TOP_LIGHT_ROWS - k]);

    for (const [column, row] of digs) {
      dug.add(`${column},${row}`);
      for (const [cx, cy] of affected(column, row)) {
        if (!cache.has(chunkKey(cx, cy))) continue; // outside the window: nothing cached to go stale
        cache.set(
          chunkKey(cx, cy),
          bake(cx, cy, workerSources(dug, cx, cy, CHUNK_MARGIN), CHUNK_MARGIN),
        );
      }
    }

    let differing = 0;
    for (let cy = CY0; cy < CY0 + NY; cy++)
      for (let cx = CX0; cx < CX0 + NX; cx++)
        differing += differingPixels(cache.get(chunkKey(cx, cy))!, reference(cx, cy, dug));
    return differing;
  }

  it('leaves no stale chunk behind', () => {
    expect(digAndCompare((column, row) => chunksReading(column, row))).toBe(0);
  });

  it('would, if a dig re-baked only the chunk it happened in', () => {
    // Proof the test above can fail. A dig near a seam changes the shading of the neighbouring chunks
    // too — the #44 "light sticks to the one redrawn cell" bug in its general form.
    expect(digAndCompare((column, row) => [[chunkX(column), chunkY(row)]])).toBeGreaterThan(0);
  });
});

describe('chunksReading', () => {
  it('names exactly the chunks whose read region contains the cell', () => {
    for (const [column, row] of [
      [0, 0],
      [-1, -1],
      [CHUNK_COLS * 5 - 1, CHUNK_ROWS * 40],
      [37, 211],
    ]) {
      const named = new Set(chunksReading(column, row).map(([cx, cy]) => chunkKey(cx, cy)));
      for (let cy = chunkY(row) - 10; cy <= chunkY(row) + 10; cy++) {
        for (let cx = chunkX(column) - 3; cx <= chunkX(column) + 3; cx++) {
          const r = chunkReadRegion(cx, cy);
          const reads = column >= r.left && column <= r.right && row >= r.top && row <= r.bottom;
          expect(named.has(chunkKey(cx, cy)), `cell ${column},${row} → chunk ${cx},${cy}`).toBe(
            reads,
          );
        }
      }
    }
  });
});

describe('the chunk cache', () => {
  // A stand-in Worker: it records requests and lets the test decide when (and in what order) they land.
  class FakeWorker {
    requests: Array<{ type: string; cx?: number; cy?: number; epoch?: number; seed?: number }> = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(message: { type: string }): void {
      this.requests.push(message);
    }
    chunkRequests() {
      return this.requests.filter((r) => r.type === 'chunk');
    }
    /** Deliver a result for a request, painted a flat colour so the test can tell which one landed. */
    land(request: { cx?: number; cy?: number; epoch?: number }, color: string): void {
      const bmp = Object.assign(new SoftCanvas(CHUNK_COLS * T, CHUNK_ROWS * T), { close() {} });
      const g = bmp.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, bmp.width, bmp.height);
      this.onmessage!({
        data: { cx: request.cx, cy: request.cy, epoch: request.epoch, bmp },
      } as MessageEvent);
    }
  }

  const makeCanvas = (width: number, height: number) => {
    const canvas = new SoftCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d') } as unknown as import('./chunks').CachedChunk;
  };
  const screen = () =>
    new SoftCanvas(64 * T, 64 * T).getContext('2d') as unknown as CanvasRenderingContext2D;

  function setup(dug = new Set<string>()) {
    const worker = new FakeWorker();
    const cache = createChunkCache({
      sources: () => fullSources(dug),
      dugKeys: () => dug,
      worker: worker as unknown as import('./chunks').ChunkWorker,
      seed: () => SEED,
      strata: STRATA,
      makeCanvas,
    });
    return { worker, cache, dug };
  }

  const pixelOf = (g: CanvasRenderingContext2D, x: number, y: number) =>
    Array.from(
      (g as unknown as import('./soft-canvas').SoftContext2D).getImageData(x, y, 1, 1).data,
    );

  it('drops a bake that was asked for by the previous world', () => {
    // The bug: new game / server hello cleared the cache, but bakes already queued in the Worker landed
    // afterwards and were stored as current — and a chunk that exists is never re-baked, so old-world
    // rock stayed on screen.
    const { worker, cache } = setup();
    cache.draw(screen(), CX0, CX0, CY0, CY0); // requests the visible chunk (and its ring)
    const oldRequest = worker.chunkRequests().find((r) => r.cx === CX0 && r.cy === CY0)!;

    cache.reset(); // a new world
    expect(worker.requests.at(-1)).toMatchObject({ type: 'world', seed: SEED });
    worker.land(oldRequest, '#ff0000'); // ...and the old bake arrives late

    expect(cache.stats().cached).toBe(0);
    const g = screen();
    cache.draw(g, CX0, CX0, CY0, CY0);
    expect(pixelOf(g, CX0 * CHUNK_COLS * T, CY0 * CHUNK_ROWS * T)).not.toEqual([255, 0, 0, 255]);
    // and the chunk was asked for again, in the new epoch
    const again = worker.chunkRequests().filter((r) => r.cx === CX0 && r.cy === CY0);
    expect(again.at(-1)!.epoch).toBeGreaterThan(oldRequest.epoch!);
  });

  it('re-bakes the chunk under the pick at once, and sends its neighbours to the Worker', () => {
    const { worker, cache, dug } = setup();
    cache.draw(screen(), CX0, CX0 + 1, CY0, CY0 + 1); // the view AND a prefetch ring around it
    const cached = new Set<string>();
    for (const request of worker.chunkRequests()) {
      worker.land(request, '#123456');
      cached.add(chunkKey(request.cx!, request.cy!));
    }
    const before = worker.chunkRequests().length;
    const stats = cache.stats();
    const syncBefore = stats.syncBakes;

    // a cell on the seam between the four cached chunks: every one of them reads it
    const column = (CX0 + 1) * CHUNK_COLS;
    const row = (CY0 + 1) * CHUNK_ROWS;
    dug.add(`${column},${row}`);
    cache.dig(column, row);

    expect(cache.stats().syncBakes).toBe(syncBefore + 1); // the chunk under the pick, synchronously
    const sent = worker
      .chunkRequests()
      .slice(before)
      .map((r) => chunkKey(r.cx!, r.cy!));
    const cachedReaders = chunksReading(column, row)
      .map(([cx, cy]) => chunkKey(cx, cy))
      .filter((key) => key !== chunkKey(chunkX(column), chunkY(row)))
      .filter((key) => cached.has(key)); // only what is cached can go stale
    expect(sent.sort()).toEqual(cachedReaders.sort());
  });

  it('bakes once more when a dig lands while a bake is in flight', () => {
    const { worker, cache, dug } = setup();
    cache.draw(screen(), CX0, CX0, CY0, CY0);
    const request = worker.chunkRequests().find((r) => r.cx === CX0 && r.cy === CY0)!;
    const column = CX0 * CHUNK_COLS + 4;
    const row = CY0 * CHUNK_ROWS + 2;
    dug.add(`${column},${row}`);
    cache.dig(column, row); // the in-flight request was sent with the OLD dug set

    const before = worker.chunkRequests().length;
    worker.land(request, '#123456');
    const followUp = worker.chunkRequests().slice(before);
    expect(followUp.map((r) => chunkKey(r.cx!, r.cy!))).toEqual([chunkKey(CX0, CY0)]);
    expect((followUp[0] as unknown as { dug: Set<string> }).dug.has(`${column},${row}`)).toBe(true);
  });
});
