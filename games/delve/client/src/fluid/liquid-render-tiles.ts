// liquid-render-tiles.ts — the cell-pipe liquid (#90) drawn on the dig grid, the way Terraria draws its
// liquids: every cell a partial block of its own 8 art px, so water shares the grid and the silhouette
// language of the blocks around it. The alternative to liquid-render.ts's smooth density field, toggled in
// the lab so the two can be compared by eye (docs/FLUIDS.md, "Rendering").
//
// After Terraria's LiquidRenderer (read in its decompiled source): gap fill, a fading trail under water
// pouring over air, blocks anchored toward the water that holds them, and a minimum thickness. The surface is
// a line only where water meets air above it; blocks have no outlined sides.
import { waterRuns, UNIT } from '@delve/shared';
import {
  BAYER,
  blend,
  drawGlint,
  hash,
  paint,
  WATER_STYLE,
  type LiquidFrame,
  type LiquidStyle,
} from './liquid-render';

/** Resting water in a cell less than this is left out. */
const DRAWN_MINIMUM = UNIT / 50;
/** Moving water in a cell less than this is left out: a trickle falling fast holds very little per cell. */
const MOVING_MINIMUM = UNIT / 500;
/** A film on rock shallower than this, art px, isn't drawn. */
const MINIMUM_POOL_PX = 1.5;
/** A drawn block is never thinner than this, art px (Terraria's quarter tile, on an 8 px cell). */
const MINIMUM_BLOCK_PX = 2;
/** Water moving down faster than this, cells/s, is falling. */
const FALLING_SPEED = 6;
/** A cell carrying this many cells of water a second down is drawn at least this full, and fuller as more flows. */
const VISIBLE_FLOW = 0.05;
const STREAM_LEVEL = 0.375;
const LEVEL_PER_FLOW = 0.04;
/** The trail under water hanging over air: this many cells, each drawn fainter. */
const TRAIL_CELLS = 3;
/** A cell below this full counts as air for holding up the water above it. */
const HOLDS_UP = 0.9;
/** Eroded rock this close to a wet cell, art px, is wet. The rock mask never erodes deeper. */
const WET_EROSION_REACH = 3;
/** Streaks in falling water: length, and one lane in this many carries them. */
const STREAK_LENGTH = 6;
const STREAK_RARITY = 3;
/** Glints live in this band under the surface, art px. */
const GLINT_TOP = 2;
const GLINT_BOTTOM = 7;
/** Foam on a surface under falling water flickers this many times a second. */
const FOAM_RATE = 12;

const enum Anchor {
  None = 0,
  /** Held up from below: the block sits on the cell's floor. */
  Bottom = 1,
  /** Hanging from water above, over air: the block hangs from the cell's ceiling. */
  Top = 2,
}

interface Tiles {
  /** How full each cell is drawn, 0–1. */
  readonly level: Float32Array;
  readonly anchor: Uint8Array;
  /** 1 where the cell's water is falling. */
  readonly falling: Uint8Array;
  /** How opaque each cell is drawn, 0–1: a trail fades. */
  readonly opacity: Float32Array;
}

function buildTiles(frame: LiquidFrame): Tiles {
  const { liquid, cell } = frame;
  const { width, height, volume, downVelocity } = liquid;
  const count = width * height;
  const level = new Float32Array(count);
  const anchor = new Uint8Array(count);
  const falling = new Uint8Array(count);
  const opacity = new Float32Array(count).fill(1);
  const resting = new Uint8Array(count);
  // resting water, laid out from each column's volume: full cells under a top cell holding the remainder
  for (let column = 0; column < width; column++) {
    for (const run of waterRuns(liquid, column, DRAWN_MINIMUM)) {
      let remaining = 0;
      for (let row = run.topRow; row <= run.bottomRow; row++) {
        remaining += volume[row * width + column] / UNIT;
        resting[row * width + column] = 1;
      }
      if (run.topRow === run.bottomRow && remaining * cell < MINIMUM_POOL_PX) continue;
      for (let row = run.bottomRow; row >= run.topRow; row--) {
        const amount = Math.min(1, remaining);
        level[row * width + column] = amount;
        anchor[row * width + column] = Anchor.Bottom;
        remaining -= amount;
      }
    }
  }
  // Terraria's edge smoothing: a pool's top cell is drawn at (2·self + left + right)/4 of its neighbours at
  // the same row, so a surface steps by less than a pixel from cell to cell instead of one or two
  const smoothed = level.slice();
  for (let index = 1; index < count - 1; index++) {
    if (!resting[index] || level[index] >= 1) continue;
    const column = index % width;
    if (column === 0 || column === width - 1) continue;
    const topOfColumn = index < width || !resting[index - width] || level[index - width] <= 0;
    if (!topOfColumn) continue;
    const left =
      resting[index - 1] && level[index - 1] > 0 && level[index - 1] < 1
        ? level[index - 1]
        : level[index];
    const right =
      resting[index + 1] && level[index + 1] > 0 && level[index + 1] < 1
        ? level[index + 1]
        : level[index];
    smoothed[index] = (2 * level[index] + left + right) / 4;
  }
  level.set(smoothed);
  // moving water
  for (let index = 0; index < count; index++) {
    if (resting[index] || liquid.isSolid(index) || volume[index] < MOVING_MINIMUM) continue;
    const row = Math.floor(index / width);
    const held = Math.min(1, volume[index] / UNIT);
    const onRock = row + 1 >= height || liquid.isSolid(index + width);
    if (onRock && held * cell < MINIMUM_POOL_PX) continue;
    const aboveHolds = row > 0 && volume[index - width] >= MOVING_MINIMUM;
    const downIn = aboveHolds ? downVelocity[index - width] : 0;
    const speed = Math.max(0, downIn, downVelocity[index]);
    const flow = held * speed;
    let shown = held;
    if (flow >= VISIBLE_FLOW)
      shown = Math.max(shown, Math.min(1, STREAM_LEVEL + flow * LEVEL_PER_FLOW));
    level[index] = shown;
    if (speed > FALLING_SPEED && aboveHolds) falling[index] = 1;
  }
  // anchors: held up from below sits on the floor; water under water over air hangs from the ceiling
  for (let index = 0; index < count; index++) {
    if (level[index] <= 0 || anchor[index] !== Anchor.None) continue;
    const row = Math.floor(index / width);
    const below = index + width;
    // falling water holds nothing up: its level is drawn fuller than it holds
    const heldUp =
      row + 1 >= height || liquid.isSolid(below) || (level[below] >= HOLDS_UP && !falling[below]);
    const wetAbove = row > 0 && level[index - width] > 0;
    anchor[index] = !heldUp && wetAbove ? Anchor.Top : Anchor.Bottom;
  }
  // gap fill: a dry cell between two wet ones is drawn at their mean (sideways between resting water, or
  // down a stream between two falling cells)
  for (let index = width; index < count - width; index++) {
    if (level[index] > 0 || liquid.isSolid(index)) continue;
    const column = index % width;
    if (column > 0 && column < width - 1 && resting[index - 1] && resting[index + 1]) {
      level[index] = (level[index - 1] + level[index + 1]) / 2;
      anchor[index] = Anchor.Bottom;
      continue;
    }
    if (falling[index - width] && level[index + width] > 0) {
      level[index] = (level[index - width] + level[index + width]) / 2;
      anchor[index] = Anchor.Top;
      falling[index] = 1;
    }
  }
  // the trail: under water hanging over air, a few cells of fainter water, so a pour reads as falling
  for (let index = 0; index < count - width; index++) {
    if (level[index] <= 0 || anchor[index] !== Anchor.Top || !falling[index]) continue;
    for (let step = 1; step <= TRAIL_CELLS; step++) {
      const below = index + step * width;
      if (below >= count || liquid.isSolid(below) || level[below] > 0) break;
      const fade = 1 - step / (TRAIL_CELLS + 1);
      level[below] = level[index] * fade;
      anchor[below] = Anchor.Top;
      falling[below] = 1;
      opacity[below] = fade;
    }
  }
  return { level, anchor, falling, opacity };
}

/** Draw the liquid into `pixels` (RGBA, rock already drawn) as blocks on the dig grid. */
export function drawLiquidTiles(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { width, height, open, originX, originY, time, liquid, cell } = frame;
  const tiles = buildTiles(frame);
  // which art pixels are wet, and the cell each belongs to
  const owner = new Int32Array(width * height).fill(-1);
  const mark = (x: number, y: number, index: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (open[pixel] && owner[pixel] < 0) owner[pixel] = index;
  };
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      const index = row * liquid.width + column;
      const level = tiles.level[index];
      if (level <= 0) continue;
      const blockPx = Math.max(MINIMUM_BLOCK_PX, Math.min(cell, Math.round(level * cell)));
      const cellTop = row * cell;
      const belowWet = row + 1 < liquid.height && tiles.level[index + liquid.width] > 0;
      const pouring =
        tiles.anchor[index] === Anchor.Top && (tiles.falling[index] === 1 || belowWet);
      // falling water fills its cell top to bottom and shows how much falls by its width, hugging the wall
      // it pours down: drawn as blocks hanging from each cell's ceiling, a stream was a dashed ladder
      const top =
        pouring || tiles.anchor[index] === Anchor.Top ? cellTop : cellTop + cell - blockPx;
      const bottom = pouring ? cellTop + cell : top + blockPx;
      let left = column * cell;
      let right = left + cell;
      if (pouring) {
        const rockLeft = column === 0 || liquid.isSolid(index - 1);
        const rockRight = column === liquid.width - 1 || liquid.isSolid(index + 1);
        if (rockLeft && !rockRight) right = left + blockPx;
        else if (rockRight && !rockLeft) left = right - blockPx;
        else {
          left += (cell - blockPx) >> 1;
          right = left + blockPx;
        }
      }
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) mark(x, y, index);
        // eroded rock beside it
        const rowOfPixel = Math.floor(y / cell);
        for (let reach = 1; reach <= WET_EROSION_REACH; reach++) {
          if (column === 0 || liquid.isSolid(rowOfPixel * liquid.width + column - 1))
            mark(column * cell - reach, y, index);
          if (column === liquid.width - 1 || liquid.isSolid(rowOfPixel * liquid.width + column + 1))
            mark((column + 1) * cell - 1 + reach, y, index);
        }
      }
      // eroded rock under a block on the floor, and over a full block under rock
      const belowSolid = row + 1 >= liquid.height || liquid.isSolid(index + liquid.width);
      const aboveSolid = row === 0 || liquid.isSolid(index - liquid.width);
      for (let reach = 0; reach < WET_EROSION_REACH; reach++) {
        for (let x = left; x < right; x++) {
          if (belowSolid && bottom === cellTop + cell) mark(x, bottom + reach, index);
          if (aboveSolid && top === cellTop) mark(x, top - 1 - reach, index);
        }
      }
    }
  }
  const airAt = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    open[y * width + x] === 1 &&
    owner[y * width + x] < 0;
  for (let x = 0; x < width; x++) {
    let depth = -1;
    for (let y = 0; y < height; y++) {
      const pixel = y * width + x;
      const index = owner[pixel];
      if (index < 0) {
        depth = -1;
        continue;
      }
      if (depth < 0)
        depth = airAt(x, y - 1) || y === 0 ? 0 : GLINT_BOTTOM; // under rock, no surface
      else depth++;
      const offset = pixel * 4;
      const worldX = originX + x;
      const worldY = originY + y;
      if (tiles.falling[index]) {
        drawFalling(pixels, offset, worldX, worldY, tiles.opacity[index], time, style);
        continue;
      }
      if (depth === 0) {
        const above = index - liquid.width;
        const fallingInto = above >= 0 && tiles.falling[above] === 1;
        const flicker = hash(worldX, Math.floor(time * FOAM_RATE)) % 3 !== 0;
        paint(pixels, offset, fallingInto && flicker ? style.foam : style.surface);
        continue;
      }
      if (depth === 1) {
        paint(pixels, offset, style.light);
        continue;
      }
      blend(pixels, offset, style.mid, style.opacity);
      const darkness = Math.min(1, depth / style.depthRange);
      const threshold = (BAYER[(worldY & 3) * 4 + (worldX & 3)] + 0.5) / 16;
      if (darkness > threshold) blend(pixels, offset, style.deep, 0.5);
      if (depth >= GLINT_TOP && depth < GLINT_BOTTOM)
        drawGlint(pixels, offset, worldX, worldY - depth, depth, time, style);
    }
  }
}

/** Falling water: the body tint, fainter down a trail, with light streaks scrolling down. No outline. */
function drawFalling(
  pixels: Uint8ClampedArray,
  offset: number,
  worldX: number,
  worldY: number,
  opacity: number,
  time: number,
  style: LiquidStyle,
): void {
  blend(pixels, offset, style.mid, style.fallOpacity * opacity);
  const lane = hash(worldX, 7);
  if (lane % STREAK_RARITY !== 0) return;
  const segment = Math.floor((worldY - time * style.fallSpeed + (lane % 97)) / STREAK_LENGTH);
  if (hash(worldX, segment) % 2 === 0) blend(pixels, offset, style.light, 0.6 * opacity);
}
