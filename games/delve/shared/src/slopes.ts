// slopes.ts — sloped cells (#92): the static world's shape, from Terraria 1.4.0.5's "Smooth World" pass
// (WorldGen.cs:7564-7690), statement by statement. DELVE's world is unbounded and computed per cell, so the pass —
// sequential over a finite world, one random generator, reading tiles it changed a moment earlier — is replayed
// over fixed chunks of columns, each starting from the unsmoothed heightmap, with a xorshift seeded per chunk in
// place of WorldGen.genRand. Checked exactly against Terraria's code on the same chunks (tools/terraria-oracle).
// Half bricks (DELVE has none: its cell already is one) are tracked while the pass runs, because its rules read
// them, and become full cells after. See docs/SLOPES.md.
import { surfaceAt } from './blocks';

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

/** Columns replayed together. A chunk's seams read the unsmoothed world beyond them. */
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
  const slot = chunk & (CACHE_SIZE - 1);
  let smoothed = cache[slot];
  if (!smoothed || smoothed.seed !== seed || smoothed.chunk !== chunk) {
    smoothed = smoothChunk(seed, chunk);
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

/** The seed of a chunk's WorldGen.genRand: its xorshift's starting state. */
export function chunkSeed(seed: number, chunk: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(chunk, 0xc2b2ae35)) >>> 0 || 1;
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
  smoothWorld(grid, xorshift(chunkSeed(seed, chunk)));
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

/**
 * The Smooth World pass over a grid's inner columns and rows (every column but the first and last, every row
 * but the top one and bottom two): WorldGen.cs:7564-7690, for a world of one rock type.
 */
export function smoothWorld(grid: SmoothGrid, next: (maximum: number) => number): void {
  const { width, height, active: activeBits, slope: slopeBits, half: halfBits } = grid;
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

  for (let i = 1; i < width - 1; i++) {
    for (let j = 1; j < height - 2; j++) {
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
                if (next(2) === 0) slopeTile(i, j, 2);
                else poundTile(i, j);
              } else if (
                !solidTile(i + 1, j) &&
                !halfBrick(i + 1, j + 1) &&
                solidTile(i + 1, j + 1) &&
                solidTile(i - 1, j) &&
                !active(i - 1, j - 1)
              ) {
                if (next(2) === 0) slopeTile(i, j, 1);
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
                  if (next(5) === 0) killTile(i, j);
                  else if (next(5) === 0) poundTile(i, j);
                  else slopeTile(i, j, 2);
                } else if (
                  !active(i + 1, j + 1) &&
                  !active(i + 1, j) &&
                  solidTile(i - 1, j) &&
                  solidTile(i, j + 2)
                ) {
                  if (next(5) === 0) killTile(i, j);
                  else if (next(5) === 0) poundTile(i, j);
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
            if (next(2) === 0) slopeTile(i, j, 2);
            else poundTile(i, j);
          }
          if (
            solidTile(i + 1, j + 1) &&
            solidTile(i - 1, j) &&
            !active(i + 1, j) &&
            !active(i - 1, j - 1)
          ) {
            placeTile(i, j);
            if (next(2) === 0) slopeTile(i, j, 1);
            else poundTile(i, j);
          }
        }
      } else if (
        !active(i, j + 1) &&
        next(2) === 0 &&
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
  for (let i = 1; i < width - 1; i++) {
    for (let j = 1; j < height - 2; j++) {
      if (next(2) === 0 && !active(i, j - 1) && solidTile(i, j)) {
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
