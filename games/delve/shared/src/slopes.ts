// slopes.ts — sloped cells (#92): the static world's shape, from Terraria 1.4.0.5's "Smooth World" pass
// (WorldGen.cs:7564-7690), statement by statement. DELVE's world is computed per cell, so the pass — two loops over
// a finite world, one random generator, reading tiles it changed a moment earlier — is replayed over fixed chunks of
// columns. From column 0 rightward the chunks chain, so every seam reads what one continuous pass would; left of it
// each chunk starts from the unsmoothed world. WorldGen.genRand, one stream through the whole pass, becomes a hash per
// cell, so what the pass draws at a cell doesn't depend on how many cells a chunk visited before it. Checked
// exactly against Terraria's code on the same chunks (tools/terraria-oracle).
// Half bricks (DELVE has none: its cell already is one) are tracked while the pass runs, because its rules read
// them, and become full cells after. See docs/SLOPES.md.
import { surfaceAt } from './blocks';
import { tileRand } from './rng';

/** A cell with nothing in it. */
export const OPEN = -1;
/** A full solid cell. */
export const FULL = 0;
/** Terraria's slopes (Tile.Type_Slope*), named by the way the solid face runs: 1 and 2 are floors, 3 and 4 ceilings. */
/** Slope 1: open top-right; a floor descending to the right. */
export const SLOPE_DOWN_RIGHT = 1;
/** Slope 2: open top-left; a floor descending to the left. */
export const SLOPE_DOWN_LEFT = 2;
/** Slope 3: open bottom-right; a ceiling. */
export const SLOPE_UP_RIGHT = 3;
/** Slope 4: open bottom-left; a ceiling. */
export const SLOPE_UP_LEFT = 4;

/** Columns replayed together. */
export const SMOOTH_CHUNK = 64;
/** Rows the replay covers above the highest surface and below the lowest in (and beside) a chunk. */
const ROW_MARGIN = 3;

/**
 * One chunk's world while the pass runs: Terraria's tile bits for the columns `firstColumn`…, rows `firstRow`….
 * The columns either side of the chunk and rows beyond the window are the unsmoothed world, never changed.
 */
export interface SmoothGrid {
  readonly firstColumn: number;
  readonly firstRow: number;
  readonly width: number;
  readonly height: number;
  readonly active: Uint8Array;
  readonly slope: Uint8Array;
  readonly half: Uint8Array;
}

interface Smoothed {
  readonly seed: number;
  readonly chunk: number;
  readonly firstRow: number;
  readonly height: number;
  /** Per cell (column, then row), the shape: OPEN, FULL or a slope. */
  readonly shapes: Int8Array;
}

const CACHE_SIZE = 64;
const cache: (Smoothed | undefined)[] = new Array(CACHE_SIZE);

/** The shape of the static world at a cell: OPEN, FULL, or a slope 1–4. Pure: a function of (seed, column, row). */
export function shapeAt(seed: number, column: number, row: number): number {
  const chunk = Math.floor(column / SMOOTH_CHUNK);
  let smoothed: Smoothed;
  if (chunk >= 0) {
    smoothed = chainedChunk(seed, chunk);
  } else {
    const slot = chunk & (CACHE_SIZE - 1);
    const cached = cache[slot];
    smoothed = cached && cached.seed === seed && cached.chunk === chunk ? cached : smoothChunk(seed, chunk);
    cache[slot] = smoothed;
  }
  const y = row - smoothed.firstRow;
  if (y < 0) return OPEN;
  if (y >= smoothed.height) return FULL;
  return smoothed.shapes[(column - chunk * SMOOTH_CHUNK) * smoothed.height + y];
}

/** The chunk's unsmoothed grid (one column either side), ready for the pass. */
export function unsmoothedGrid(seed: number, chunk: number): SmoothGrid {
  const firstColumn = chunk * SMOOTH_CHUNK - 1;
  const width = SMOOTH_CHUNK + 2;
  let highest = Infinity;
  let lowest = -Infinity;
  for (let x = 0; x < width; x++) {
    const surface = surfaceAt(seed, firstColumn + x);
    highest = Math.min(highest, surface);
    lowest = Math.max(lowest, surface);
  }
  // the pass reads two rows below and one above the rows it visits
  const firstRow = highest - ROW_MARGIN - 1;
  const height = lowest - highest + 2 * ROW_MARGIN + 4;
  const active = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    const surface = surfaceAt(seed, firstColumn + x);
    for (let y = 0; y < height; y++) active[x * height + y] = firstRow + y > surface ? 1 : 0;
  }
  return {
    firstColumn,
    firstRow,
    width,
    height,
    active,
    slope: new Uint8Array(width * height),
    half: new Uint8Array(width * height),
  };
}

/** WorldGen.genRand: a 32-bit xorshift from `state`, returning `Next(maximum)`. */
export function xorshift(state: number): (maximum: number) => number {
  return (maximum: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % maximum;
  };
}

function smoothChunk(seed: number, chunk: number): Smoothed {
  const grid = unsmoothedGrid(seed, chunk);
  smoothFirstLoop(grid, cellGenerator(seed, 1));
  smoothSecondLoop(grid, cellGenerator(seed, 2));
  return shapesOf(seed, chunk, grid);
}

/**
 * The pass's random draws in the world: the `n`th draw at a cell in one of its two loops is a hash of the seed, the
 * loop, the draw and the cell.
 */
export function cellGenerator(seed: number, loop: number): Generator {
  let lastColumn = Number.NaN;
  let lastRow = Number.NaN;
  let draws = 0;
  return (maximum, column, row) => {
    if (column !== lastColumn || row !== lastRow) {
      lastColumn = column;
      lastRow = row;
      draws = 0;
    }
    const salt = Math.imul(loop * 16 + draws, 0x9e3779b9);
    draws++;
    return Math.floor(tileRand((seed ^ salt) >>> 0, column, row) * maximum);
  };
}

/** One seed's chain: every chunk from 0 smoothed so far, and the next chunk part way. */
interface Chain {
  readonly smoothed: Smoothed[];
  /** The last smoothed chunk's grid, whose final right column is the next chunk's left seam. */
  last: SmoothGrid | undefined;
  /** The next chunk, after the pass's first loop. */
  pending: SmoothGrid | undefined;
}

const CHAINED_SEEDS = 4;
const chains = new Map<number, Chain>();

/**
 * Chunk `chunk` (≥ 0) as one continuous pass from column 0 would leave it. The pass reads one column either side:
 * in its first loop the column to the left after that loop and the one to the right untouched, in its second the
 * left after both loops and the right after the first. So each chunk runs its first loop from its left
 * neighbour's first-loop result, and its second once the right neighbour has run its first.
 */
function chainedChunk(seed: number, chunk: number): Smoothed {
  let chain = chains.get(seed);
  if (!chain) {
    chain = { smoothed: [], last: undefined, pending: undefined };
    chains.set(seed, chain);
    if (chains.size > CHAINED_SEEDS) chains.delete(chains.keys().next().value as number);
  }
  while (chain.smoothed.length <= chunk) {
    const index = chain.smoothed.length;
    const current = chain.pending ?? firstLoop(seed, index, undefined);
    const right = firstLoop(seed, index + 1, current);
    copyColumn(right, 1, current, current.width - 1);
    if (chain.last) copyColumn(chain.last, chain.last.width - 2, current, 0);
    smoothSecondLoop(current, cellGenerator(seed, 2));
    chain.smoothed.push(shapesOf(seed, index, current));
    chain.last = current;
    chain.pending = right;
  }
  return chain.smoothed[chunk];
}

/** A chunk's grid after the pass's first loop, its left seam taken from `left` after that loop. */
function firstLoop(seed: number, chunk: number, left: SmoothGrid | undefined): SmoothGrid {
  const grid = unsmoothedGrid(seed, chunk);
  if (left) copyColumn(left, left.width - 2, grid, 0);
  smoothFirstLoop(grid, cellGenerator(seed, 1));
  return grid;
}

/** Copy column `fromX` of one grid over column `toX` of another, row for row; rows `from` lacks are the untouched world. */
function copyColumn(from: SmoothGrid, fromX: number, to: SmoothGrid, toX: number): void {
  for (let y = 0; y < to.height; y++) {
    const row = to.firstRow + y;
    const source = row - from.firstRow;
    const index = toX * to.height + y;
    if (source >= 0 && source < from.height) {
      const origin = fromX * from.height + source;
      to.active[index] = from.active[origin];
      to.slope[index] = from.slope[origin];
      to.half[index] = from.half[origin];
    } else {
      to.active[index] = source >= from.height ? 1 : 0;
      to.slope[index] = 0;
      to.half[index] = 0;
    }
  }
}

function shapesOf(seed: number, chunk: number, grid: SmoothGrid): Smoothed {
  const { height } = grid;
  const shapes = new Int8Array(SMOOTH_CHUNK * height);
  for (let x = 0; x < SMOOTH_CHUNK; x++) {
    for (let y = 0; y < height; y++) {
      const index = (x + 1) * height + y;
      // half bricks become full cells: DELVE has none
      shapes[x * height + y] = !grid.active[index]
        ? OPEN
        : grid.half[index]
          ? FULL
          : grid.slope[index];
    }
  }
  return { seed, chunk, firstRow: grid.firstRow, height, shapes };
}

/** WorldGen.genRand's Next(maximum), asked for a draw by the pass while it visits the cell (column, row). */
export type Generator = (maximum: number, column: number, row: number) => number;

/**
 * The Smooth World pass over a grid's inner columns and rows (every column but the first and last, every row
 * but the top one and bottom two): WorldGen.cs:7564-7690, for a world of one rock type.
 */

export function smoothWorld(grid: SmoothGrid, next: Generator): void {
  smoothFirstLoop(grid, next);
  smoothSecondLoop(grid, next);
}

/** Terraria's tile operations during generation, on a grid. */
function tiles(grid: SmoothGrid) {
  const { height, active: activeBits, slope: slopeBits, half: halfBits } = grid;
  const at = (x: number, y: number): number => x * height + y;
  const active = (x: number, y: number): boolean => activeBits[at(x, y)] === 1;
  const halfBrick = (x: number, y: number): boolean => halfBits[at(x, y)] === 1;
  const slopeOf = (x: number, y: number): number => slopeBits[at(x, y)];
  /** WorldGen.SolidTile: an active full block (not half, not sloped). */
  const solidTile = (x: number, y: number): boolean =>
    active(x, y) && !halfBrick(x, y) && slopeOf(x, y) === 0;
  /** WorldGen.SlopeTile during generation. */
  const slopeTile = (x: number, y: number, slope: number): void => {
    halfBits[at(x, y)] = 0;
    slopeBits[at(x, y)] = slope;
  };
  /** WorldGen.PoundTile during generation: toggles the half brick. */
  const poundTile = (x: number, y: number): void => {
    halfBits[at(x, y)] = halfBrick(x, y) ? 0 : 1;
  };
  /** WorldGen.KillTile during generation (it leaves the slope bits). */
  const killTile = (x: number, y: number): void => {
    activeBits[at(x, y)] = 0;
    halfBits[at(x, y)] = 0;
  };
  /** WorldGen.PlaceTile of rock into an empty cell. */
  const placeTile = (x: number, y: number): void => {
    activeBits[at(x, y)] = 1;
  };
  return { active, halfBrick, slopeOf, solidTile, slopeTile, poundTile, killTile, placeTile };
}

/** The pass's first loop: steps become slopes or half bricks, bumps go, corners fill, ceilings slope. */
export function smoothFirstLoop(grid: SmoothGrid, next: Generator): void {
  const { width, height } = grid;
  const { active, halfBrick, slopeOf, solidTile, slopeTile, poundTile, killTile, placeTile } = tiles(grid);
  for (let i = 1; i < width - 1; i++) {
    for (let j = 1; j < height - 2; j++) {
      const roll = (maximum: number): number => next(maximum, grid.firstColumn + i, grid.firstRow + j);
      if (!active(i, j - 1)) {
        if (solidTile(i, j)) {
          if (
            !halfBrick(i - 1, j) &&
            !halfBrick(i + 1, j) &&
            slopeOf(i - 1, j) === 0 &&
            slopeOf(i + 1, j) === 0
          ) {
            if (solidTile(i, j + 1)) {
              if (
                !solidTile(i - 1, j) &&
                !halfBrick(i - 1, j + 1) &&
                solidTile(i - 1, j + 1) &&
                solidTile(i + 1, j) &&
                !active(i + 1, j - 1)
              ) {
                if (roll(2) === 0) slopeTile(i, j, 2);
                else poundTile(i, j);
              } else if (
                !solidTile(i + 1, j) &&
                !halfBrick(i + 1, j + 1) &&
                solidTile(i + 1, j + 1) &&
                solidTile(i - 1, j) &&
                !active(i - 1, j - 1)
              ) {
                if (roll(2) === 0) slopeTile(i, j, 1);
                else poundTile(i, j);
              } else if (
                solidTile(i + 1, j + 1) &&
                solidTile(i - 1, j + 1) &&
                !active(i + 1, j) &&
                !active(i - 1, j)
              ) {
                poundTile(i, j);
              }
              if (solidTile(i, j)) {
                if (
                  solidTile(i - 1, j) &&
                  solidTile(i + 1, j + 2) &&
                  !active(i + 1, j) &&
                  !active(i + 1, j + 1) &&
                  !active(i - 1, j - 1)
                ) {
                  killTile(i, j);
                } else if (
                  solidTile(i + 1, j) &&
                  solidTile(i - 1, j + 2) &&
                  !active(i - 1, j) &&
                  !active(i - 1, j + 1) &&
                  !active(i + 1, j - 1)
                ) {
                  killTile(i, j);
                } else if (
                  !active(i - 1, j + 1) &&
                  !active(i - 1, j) &&
                  solidTile(i + 1, j) &&
                  solidTile(i, j + 2)
                ) {
                  if (roll(5) === 0) killTile(i, j);
                  else if (roll(5) === 0) poundTile(i, j);
                  else slopeTile(i, j, 2);
                } else if (
                  !active(i + 1, j + 1) &&
                  !active(i + 1, j) &&
                  solidTile(i - 1, j) &&
                  solidTile(i, j + 2)
                ) {
                  if (roll(5) === 0) killTile(i, j);
                  else if (roll(5) === 0) poundTile(i, j);
                  else slopeTile(i, j, 1);
                }
              }
            }
            if (solidTile(i, j) && !active(i - 1, j) && !active(i + 1, j)) killTile(i, j);
          }
        } else if (!active(i, j)) {
          if (
            solidTile(i - 1, j + 1) &&
            solidTile(i + 1, j) &&
            !active(i - 1, j) &&
            !active(i + 1, j - 1)
          ) {
            placeTile(i, j);
            if (roll(2) === 0) slopeTile(i, j, 2);
            else poundTile(i, j);
          }
          if (
            solidTile(i + 1, j + 1) &&
            solidTile(i - 1, j) &&
            !active(i + 1, j) &&
            !active(i - 1, j - 1)
          ) {
            placeTile(i, j);
            if (roll(2) === 0) slopeTile(i, j, 1);
            else poundTile(i, j);
          }
        }
      } else if (
        !active(i, j + 1) &&
        roll(2) === 0 &&
        solidTile(i, j) &&
        !halfBrick(i - 1, j) &&
        !halfBrick(i + 1, j) &&
        slopeOf(i - 1, j) === 0 &&
        slopeOf(i + 1, j) === 0 &&
        solidTile(i, j - 1)
      ) {
        if (solidTile(i - 1, j) && !solidTile(i + 1, j) && solidTile(i - 1, j - 1))
          slopeTile(i, j, 3);
        else if (solidTile(i + 1, j) && !solidTile(i - 1, j) && solidTile(i + 1, j - 1))
          slopeTile(i, j, 4);
      }
    }
  }
}

/** The pass's second loop: more floor slopes, and a floor slope with nothing beside its solid side is undone. */
export function smoothSecondLoop(grid: SmoothGrid, next: Generator): void {
  const { width, height } = grid;
  const { active, slopeOf, solidTile, slopeTile, poundTile } = tiles(grid);
  for (let i = 1; i < width - 1; i++) {
    for (let j = 1; j < height - 2; j++) {
      const roll = (maximum: number): number => next(maximum, grid.firstColumn + i, grid.firstRow + j);
      if (roll(2) === 0 && !active(i, j - 1) && solidTile(i, j)) {
        if (solidTile(i, j + 1) && solidTile(i + 1, j) && !active(i - 1, j)) slopeTile(i, j, 2);
        if (solidTile(i, j + 1) && solidTile(i - 1, j) && !active(i + 1, j)) slopeTile(i, j, 1);
      }
      if (slopeOf(i, j) === 1 && !solidTile(i - 1, j)) {
        slopeTile(i, j, 0);
        poundTile(i, j);
      }
      if (slopeOf(i, j) === 2 && !solidTile(i + 1, j)) {
        slopeTile(i, j, 0);
        poundTile(i, j);
      }
    }
  }
}

// ---- geometry --------------------------------------------------------------------------------------------------

export type Side = 'up' | 'down' | 'left' | 'right';

/** Whether a cell of this shape is solid along the whole of that side (Tile.topSlope/bottomSlope/leftSlope/rightSlope). */
export function covers(shape: number, side: Side): boolean {
  if (shape === FULL) return true;
  if (shape === OPEN) return false;
  switch (side) {
    case 'up':
      return shape === SLOPE_UP_RIGHT || shape === SLOPE_UP_LEFT;
    case 'down':
      return shape === SLOPE_DOWN_RIGHT || shape === SLOPE_DOWN_LEFT;
    case 'left':
      return shape === SLOPE_DOWN_RIGHT || shape === SLOPE_UP_RIGHT;
    case 'right':
      return shape === SLOPE_DOWN_LEFT || shape === SLOPE_UP_LEFT;
  }
}

/** Whether pixel (x, y) of a `size`-pixel cell of this shape is solid: a slope's diagonal belongs to its solid half. */
export function insideShape(shape: number, x: number, y: number, size: number): boolean {
  switch (shape) {
    case OPEN:
      return false;
    case SLOPE_DOWN_RIGHT:
      return y >= x;
    case SLOPE_DOWN_LEFT:
      return y >= size - 1 - x;
    case SLOPE_UP_RIGHT:
      return y <= size - 1 - x;
    case SLOPE_UP_LEFT:
      return y <= x;
    default:
      return true;
  }
}

/**
 * How far pixel (x, y)'s centre lies inside a slope's diagonal edge, in pixels, measured like a straight edge's
 * (the pixel on the diagonal is half a pixel in). Infinity for a full cell, which has no diagonal.
 */
export function diagonalDistance(shape: number, x: number, y: number, size: number): number {
  switch (shape) {
    case SLOPE_DOWN_RIGHT:
      return (y - x) / Math.SQRT2 + 0.5;
    case SLOPE_DOWN_LEFT:
      return (y - (size - 1 - x)) / Math.SQRT2 + 0.5;
    case SLOPE_UP_RIGHT:
      return (size - 1 - x - y) / Math.SQRT2 + 0.5;
    case SLOPE_UP_LEFT:
      return (x - y) / Math.SQRT2 + 0.5;
    default:
      return Infinity;
  }
}

/**
 * The lowest row that shows sky in a column: the row above its first full cell. World smoothing moves the surface
 * by a cell either way, and a slope on it shows sky in its open corner, so the sky reaches down past both.
 */
export function skyRowAt(seed: number, column: number): number {
  let row = surfaceAt(seed, column) - 2;
  while (shapeAt(seed, column, row + 1) !== FULL) row++;
  return row;
}
