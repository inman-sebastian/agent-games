// liquid-render.ts — draws the cell-pipe liquid (#90) at art resolution, over rock that's already been drawn.
// The sim is coarse (8 px cells); everything that makes it read as water is here: surfaces from each column's
// volume joined between cell centres, eroded rock wetted, falls drawn as streaked columns with a mouth and a
// splash. Every pixel lands on the art grid, like the rock. See docs/FLUIDS.md, "Rendering".
//
// Pure TypeScript over an RGBA buffer: the reference the GPU port will be gated against.
import { waterRuns, UNIT, type Liquid, type WaterRun } from '@delve/shared';

export type Rgb = readonly [number, number, number];

export interface LiquidStyle {
  readonly deep: Rgb;
  readonly body: Rgb;
  readonly mid: Rgb;
  readonly light: Rgb;
  readonly surface: Rgb;
  readonly foam: Rgb;
  readonly specular: Rgb;
  /** How much of the body tint covers what's behind it, 0–1. */
  readonly opacity: number;
  /** How much a fall's core covers what's behind it. */
  readonly fallOpacity: number;
  /** Art px of depth over which the body darkens toward `deep`. */
  readonly depthRange: number;
  /** Art px/s the streaks in a fall scroll down. */
  readonly fallSpeed: number;
}

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/** Resurrect 64 blues (docs/FLUIDS.md, "Palette"). */
export const WATER_STYLE: LiquidStyle = {
  deep: hex('#323353'),
  body: hex('#484a77'),
  mid: hex('#4d65b4'),
  light: hex('#4d9be6'),
  surface: hex('#8fd3ff'),
  foam: hex('#c7dcd0'),
  specular: hex('#ffffff'),
  opacity: 0.45,
  fallOpacity: 0.85,
  depthRange: 40,
  fallSpeed: 90,
};

/** The teal alternative, for strata whose rock already uses the blue ramp. */
export const TEAL_WATER_STYLE: LiquidStyle = {
  ...WATER_STYLE,
  deep: hex('#0b5e65'),
  body: hex('#0b8a8f'),
  mid: hex('#0b8a8f'),
  light: hex('#0eaf9b'),
  surface: hex('#8ff8e2'),
  foam: hex('#c7dcd0'),
};

/** Water in a cell less than this is a film: not drawn as resting water. */
const DRAWN_MINIMUM = UNIT / 50;
/** A falling cell holds at least this much to be drawn. */
const FALL_MINIMUM = UNIT / 40;
/** A fall column is never narrower than this, art px: light edge, core, light edge. */
const FALL_MIN_WIDTH = 3;
/** Eroded rock this close to water's cell, art px, is wet. The rock mask never erodes deeper. */
const WET_EROSION_REACH = 3;
/** 4×4 Bayer thresholds, world-anchored, for darkening with depth. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Glints live in the top of the body, between these depths, art px. */
const GLINT_TOP = 2;
const GLINT_BOTTOM = 7;
/** One glint slot per this many art px of surface, and how long a glint lives, s. */
const GLINT_SPACING = 14;
/** Only one glint slot in this many lights up: more read as specks of noise. */
const GLINT_RARITY = 6;
const GLINT_PERIOD = 1.4;
/** Streaks in a fall: each lane's streak length, art px. */
const STREAK_LENGTH = 11;
/** Rows of a fall that read as its mouth, where water turns over the lip. */
const MOUTH_ROWS = 2;
/** Foam at a fall's landing spreads this far past the fall on each side, art px. */
const FOAM_SPREAD = 3;
/** The splash crown re-rolls this many times a second: chaotic effects may flip-book. */
const CROWN_RATE = 15;

export interface LiquidFrame {
  readonly liquid: Liquid;
  /** Art px per cell. */
  readonly cell: number;
  /** Per art pixel: 1 where the rock mask is open. */
  readonly open: Uint8Array;
  /** Art px. */
  readonly width: number;
  readonly height: number;
  /** World art px of the frame's top-left, so dithering and noise stay anchored to the world. */
  readonly originX: number;
  readonly originY: number;
  readonly time: number;
}

function hash(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

function blend(pixels: Uint8ClampedArray, offset: number, colour: Rgb, amount: number): void {
  pixels[offset] += (colour[0] - pixels[offset]) * amount;
  pixels[offset + 1] += (colour[1] - pixels[offset + 1]) * amount;
  pixels[offset + 2] += (colour[2] - pixels[offset + 2]) * amount;
}

function paint(pixels: Uint8ClampedArray, offset: number, colour: Rgb): void {
  pixels[offset] = colour[0];
  pixels[offset + 1] = colour[1];
  pixels[offset + 2] = colour[2];
}

/** A column's resting water, in art px: the rows it occupies and its surface. */
interface Pool {
  readonly run: WaterRun;
  /** Art px row of the surface (fractional). */
  readonly surface: number;
  /** Art px row just below the run's lowest cell. */
  readonly floor: number;
  /** Whether rock caps the run: a flooded passage has no free surface to draw. */
  readonly capped: boolean;
}

function poolsOf(frame: LiquidFrame): Pool[][] {
  const { liquid, cell } = frame;
  const pools: Pool[][] = [];
  for (let column = 0; column < liquid.width; column++) {
    const list: Pool[] = [];
    for (const run of waterRuns(liquid, column, DRAWN_MINIMUM)) {
      const aboveRow = run.topRow - 1;
      const capped = aboveRow < 0 || liquid.isSolid(aboveRow * liquid.width + column);
      // compression hidden in a deep column can put the surface a little above its top wet cell
      let surface = Math.max(run.surface, run.topRow - 1) * cell;
      // moving water right on top: drawn full to the top of its cell, or a pocket of air shows between them
      const wetAbove = !capped && liquid.volume[aboveRow * liquid.width + column] >= DRAWN_MINIMUM;
      if (wetAbove) surface = Math.min(surface, run.topRow * cell);
      list.push({
        run,
        surface: capped ? run.topRow * cell : surface,
        floor: (run.bottomRow + 1) * cell,
        capped,
      });
    }
    pools.push(list);
  }
  return pools;
}

/** The pool in a neighbouring column that the same water continues into at this pool's surface, if any. */
function continuation(
  frame: LiquidFrame,
  pools: Pool[][],
  column: number,
  pool: Pool,
): Pool | null {
  if (column < 0 || column >= frame.liquid.width) return null;
  const surfaceRow = Math.min(
    pool.run.bottomRow,
    Math.max(pool.run.topRow, Math.floor(pool.surface / frame.cell)),
  );
  for (const other of pools[column]) {
    if (surfaceRow < other.run.topRow || surfaceRow > other.run.bottomRow) continue;
    return other;
  }
  return null;
}

/** Surface row (whole art px) at each art column across a pool's cell column, joined to its neighbours. */
function surfaceRows(frame: LiquidFrame, pools: Pool[][], column: number, pool: Pool): Int32Array {
  const { cell } = frame;
  const rows = new Int32Array(cell);
  const left = continuation(frame, pools, column - 1, pool);
  const right = continuation(frame, pools, column + 1, pool);
  const centre = (cell - 1) / 2;
  for (let local = 0; local < cell; local++) {
    let height = pool.surface;
    const offset = (local - centre) / cell; // −0.5 … 0.5 across the cell
    const neighbour = offset < 0 ? left : right;
    if (neighbour && !neighbour.capped && !pool.capped) {
      height += (neighbour.surface - pool.surface) * Math.abs(offset);
    }
    rows[local] = Math.round(height);
  }
  return rows;
}

/** Depth below the surface of every wet art pixel, or −1. */
function wetDepths(frame: LiquidFrame, pools: Pool[][]): { depth: Int16Array; top: Int32Array } {
  const { width, height, cell, open, liquid } = frame;
  const depth = new Int16Array(width * height).fill(-1);
  // per art pixel, the surface row of the water above it (for surface lines and glints)
  const top = new Int32Array(width * height).fill(-1);
  const markWet = (x: number, y: number, surfaceRow: number, capped: boolean): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (!open[index] || depth[index] >= 0) return;
    depth[index] = capped ? Math.max(GLINT_BOTTOM, y - surfaceRow) : y - surfaceRow;
    top[index] = surfaceRow;
  };
  for (let column = 0; column < liquid.width; column++) {
    for (const pool of pools[column]) {
      const rows = surfaceRows(frame, pools, column, pool);
      const leftOpen =
        column > 0 && !liquid.isSolid(pool.run.bottomRow * liquid.width + column - 1);
      const rightOpen =
        column + 1 < liquid.width &&
        !liquid.isSolid(pool.run.bottomRow * liquid.width + column + 1);
      for (let local = 0; local < cell; local++) {
        const x = column * cell + local;
        const surfaceRow = rows[local];
        for (let y = Math.max(0, surfaceRow); y < pool.floor; y++)
          markWet(x, y, surfaceRow, pool.capped);
        // eroded floor under the pool
        for (let y = pool.floor; y < pool.floor + WET_EROSION_REACH; y++)
          markWet(x, y, surfaceRow, pool.capped);
      }
      // eroded walls either side, below the surface
      const edgeRows = [rows[0], rows[cell - 1]];
      for (let reach = 1; reach <= WET_EROSION_REACH; reach++) {
        for (let y = Math.max(0, edgeRows[0]); y < pool.floor; y++) {
          if (!leftOpen) markWet(column * cell - reach, y, edgeRows[0], pool.capped);
        }
        for (let y = Math.max(0, edgeRows[1]); y < pool.floor; y++) {
          if (!rightOpen) markWet((column + 1) * cell - 1 + reach, y, edgeRows[1], pool.capped);
        }
      }
      // a flooded passage wets the eroded ceiling
      if (pool.capped) {
        for (let local = 0; local < cell; local++) {
          for (let reach = 1; reach <= WET_EROSION_REACH; reach++) {
            markWet(
              column * cell + local,
              pool.run.topRow * cell - reach,
              pool.run.topRow * cell,
              true,
            );
          }
        }
      }
    }
  }
  return { depth, top };
}

function drawBody(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  depth: Int16Array,
  falling: Uint8Array,
  style: LiquidStyle,
): void {
  const { width, height, originX, originY, time, open } = frame;
  /** Open air (not rock, not water) at a pixel: where the water's silhouette is. */
  const airAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = y * width + x;
    return open[index] === 1 && depth[index] < 0;
  };
  // Depth is measured down from the air over each column of wet pixels, whatever drew them: pools, masses
  // and the cells between them share one body. Water under rock (a flooded passage) starts deep.
  const fromAir = new Int16Array(width * height).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (depth[index] < 0) continue;
      const aboveWet = y > 0 && fromAir[index - width] >= 0;
      if (aboveWet) fromAir[index] = fromAir[index - width] + 1;
      else fromAir[index] = y > 0 && open[index - width] === 0 ? GLINT_BOTTOM : 0;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const below = fromAir[index];
      if (below < 0) continue;
      const offset = index * 4;
      // the outline: any wet pixel touching open air above or beside it, so a steep surface stays one line
      const onEdge = airAt(x, y - 1) || airAt(x - 1, y) || airAt(x + 1, y);
      if (onEdge) {
        paint(pixels, offset, style.surface);
        continue;
      }
      if (below === 1) {
        paint(pixels, offset, style.light);
        continue;
      }
      const worldX = originX + x;
      const worldY = originY + y;
      if (
        falling[Math.floor(y / frame.cell) * frame.liquid.width + Math.floor(x / frame.cell)] === 1
      ) {
        drawFallingPixel(pixels, offset, worldX, worldY, time, style);
        continue;
      }
      blend(pixels, offset, style.mid, style.opacity);
      // darker with depth, dithered on the world grid
      const darkness = Math.min(1, below / style.depthRange);
      const threshold = (BAYER[(worldY & 3) * 4 + (worldX & 3)] + 0.5) / 16;
      if (darkness > threshold) blend(pixels, offset, style.deep, 0.5);
      if (below >= GLINT_TOP && below < GLINT_BOTTOM)
        drawGlint(pixels, offset, worldX, worldY - below, below, time, style);
    }
  }
}

/** Water falling fast, inside a body's outline: opaque, with light streaks scrolling down. Never a slab. */
function drawFallingPixel(
  pixels: Uint8ClampedArray,
  offset: number,
  worldX: number,
  worldY: number,
  time: number,
  style: LiquidStyle,
): void {
  blend(pixels, offset, style.mid, style.fallOpacity);
  const scrolled = worldY - time * style.fallSpeed;
  const streakSeed = hash(worldX, Math.floor(scrolled / STREAK_LENGTH));
  if (streakSeed % 4 === 0) paint(pixels, offset, style.light);
  else if (streakSeed % 29 === 0) paint(pixels, offset, style.surface);
}

/** Cells whose water is moving down faster than this, cells/s, are drawn as falling water. */
const FALLING_SPEED = 6;

/**
 * Which cells hold water falling fast enough to draw as a fall, not as still water. Water inside a resting
 * pool isn't a fall however it moves: drawn as one, a pool's churn showed as blocks of streaks.
 */
function fallingCells(frame: LiquidFrame, pools: Pool[][]): Uint8Array {
  const { liquid } = frame;
  const falling = new Uint8Array(liquid.width * liquid.height);
  const resting = new Uint8Array(liquid.width * liquid.height);
  for (let column = 0; column < liquid.width; column++) {
    for (const pool of pools[column]) {
      for (let row = pool.run.topRow; row <= pool.run.bottomRow; row++)
        resting[row * liquid.width + column] = 1;
    }
  }
  for (let index = 0; index < falling.length; index++) {
    if (resting[index] || liquid.isSolid(index) || liquid.volume[index] < DRAWN_MINIMUM) continue;
    const intoIt = index >= liquid.width ? liquid.downVelocity[index - liquid.width] : 0;
    const outOf = liquid.downVelocity[index];
    if (Math.max(intoIt, outOf) > FALLING_SPEED) falling[index] = 1;
  }
  return falling;
}

/** Short horizontal dashes under the surface that grow and shrink in place and drift slowly. */
function drawGlint(
  pixels: Uint8ClampedArray,
  offset: number,
  worldX: number,
  surfaceWorldY: number,
  below: number,
  time: number,
  style: LiquidStyle,
): void {
  const drift = Math.floor(time * 3);
  const lane = below;
  const slot = Math.floor((worldX + drift) / GLINT_SPACING);
  const seed = hash(slot, lane * 131 + Math.floor(surfaceWorldY / 8));
  if (seed % GLINT_RARITY !== 0) return;
  const phase = (time / GLINT_PERIOD + (seed % 1000) / 1000) % 1;
  const halfLength = Math.round(Math.sin(phase * Math.PI) * 2); // 0 → 2 → 0
  if (halfLength <= 0) return;
  const centre = slot * GLINT_SPACING + (seed % GLINT_SPACING) - drift;
  if (Math.abs(worldX - centre) > halfLength - 1) return;
  paint(pixels, offset, style.foam);
}

interface Fall {
  readonly column: number;
  readonly row: number;
  readonly fill: number;
}

/** Cells whose water isn't resting: falling through air, or pouring over a lip. */
function fallsOf(frame: LiquidFrame, pools: Pool[][]): Fall[] {
  const { liquid } = frame;
  const resting = new Uint8Array(liquid.width * liquid.height);
  for (let column = 0; column < liquid.width; column++) {
    for (const pool of pools[column]) {
      for (let row = pool.run.topRow; row <= pool.run.bottomRow; row++)
        resting[row * liquid.width + column] = 1;
    }
  }
  const falls: Fall[] = [];
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      const index = row * liquid.width + column;
      if (resting[index] || liquid.isSolid(index)) continue;
      const units = liquid.volume[index];
      const above = row > 0 ? liquid.volume[index - liquid.width] : 0;
      const below = row + 1 < liquid.height ? liquid.volume[index + liquid.width] : 0;
      // a dry cell between two falling ones is drawn wet: the sim's stream has gaps a cell long
      const gap =
        units < FALL_MINIMUM &&
        above >= FALL_MINIMUM &&
        below >= FALL_MINIMUM &&
        !resting[index + liquid.width];
      if (units < FALL_MINIMUM && !gap) continue;
      falls.push({ column, row, fill: gap ? (above + below) / 2 / UNIT : units / UNIT });
    }
  }
  return falls;
}

/**
 * Moving water that has wet cells beside it is a mass (a surge, water spilling across a floor), drawn filled
 * like a pool so it has one outline; only water falling with nothing beside it is a stream, drawn as a
 * column. Drawn as columns, a surge front of partly full cells read as a row of spikes.
 */
function splitMoving(
  frame: LiquidFrame,
  moving: Fall[],
  pools: Pool[][],
): { streams: Fall[]; masses: Fall[] } {
  const { liquid } = frame;
  const wet = new Uint8Array(liquid.width * liquid.height);
  for (const cell of moving) wet[cell.row * liquid.width + cell.column] = 1;
  for (let column = 0; column < liquid.width; column++) {
    for (const pool of pools[column]) {
      for (let row = pool.run.topRow; row <= pool.run.bottomRow; row++)
        wet[row * liquid.width + column] = 1;
    }
  }
  const streams: Fall[] = [];
  const masses: Fall[] = [];
  for (const cell of moving) {
    const index = cell.row * liquid.width + cell.column;
    const wetLeft = cell.column > 0 && wet[index - 1] === 1;
    const wetRight = cell.column + 1 < liquid.width && wet[index + 1] === 1;
    if (wetLeft || wetRight) masses.push(cell);
    else streams.push(cell);
  }
  return { streams, masses };
}

/**
 * A mass fills its cell from below (or from above, if it's hanging from water over air), at least 2 px. With
 * wet water above it, it's drawn full: stacked partly full cells each drawn to their own height read as
 * stripes through a surge (Terraria draws its tiles fuller than they hold for the same reason).
 */
function markMass(frame: LiquidFrame, depth: Int16Array, top: Int32Array, mass: Fall): void {
  const { liquid, cell, width, height, open } = frame;
  const index = mass.row * liquid.width + mass.column;
  const aboveIndex = index - liquid.width;
  const wetAbove =
    mass.row > 0 && !liquid.isSolid(aboveIndex) && liquid.volume[aboveIndex] >= DRAWN_MINIMUM;
  const rows = wetAbove ? cell : Math.max(2, Math.min(cell, Math.round(mass.fill * cell)));
  const belowIndex = index + liquid.width;
  const heldUp =
    mass.row + 1 >= liquid.height ||
    liquid.isSolid(belowIndex) ||
    liquid.volume[belowIndex] >= DRAWN_MINIMUM;
  const cellTop = mass.row * cell;
  const massTop = heldUp ? cellTop + cell - rows : cellTop;
  for (let y = massTop; y < massTop + rows && y < height; y++) {
    for (let x = mass.column * cell; x < (mass.column + 1) * cell && x < width; x++) {
      const pixel = y * width + x;
      if (!open[pixel] || depth[pixel] >= 0) continue;
      depth[pixel] = y - massTop;
      top[pixel] = massTop;
    }
  }
}

function drawFalls(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  falls: Fall[],
  depth: Int16Array,
  style: LiquidStyle,
): void {
  const { width, height, cell, open, liquid, originX, originY, time } = frame;
  const fallingAt = new Set(falls.map((fall) => fall.row * liquid.width + fall.column));
  for (const fall of falls) {
    const fallWidth = Math.max(FALL_MIN_WIDTH, Math.min(cell, Math.ceil(fall.fill * cell) + 2));
    // hug the side the water came from: the wall beside a pour, or the middle of a shaft
    const index = fall.row * liquid.width + fall.column;
    const rockLeft = fall.column === 0 || liquid.isSolid(index - 1);
    const rockRight = fall.column + 1 >= liquid.width || liquid.isSolid(index + 1);
    let left = fall.column * cell + Math.floor((cell - fallWidth) / 2);
    if (rockLeft && !rockRight) left = fall.column * cell;
    else if (rockRight && !rockLeft) left = (fall.column + 1) * cell - fallWidth;
    const isMouth = !fallingAt.has(index - liquid.width);
    const y0 = fall.row * cell;
    let y1 = y0 + cell;
    for (let y = y0; y < y1 && y < height; y++) {
      // edge wobble: ±1 px in 3 px rows, travelling down
      const wobble = Math.round(Math.sin((originY + y) / 6 - time * 8 + fall.column) * 1);
      for (let x = left; x < left + fallWidth; x++) {
        const px = x + (Math.floor((originY + y) / 3) % 2 === 0 ? 0 : wobble);
        if (px < 0 || px >= width) continue;
        const pixelIndex = y * width + px;
        if (!open[pixelIndex]) continue;
        if (depth[pixelIndex] > 1) continue; // it's entered water
        const offset = pixelIndex * 4;
        const edge = x === left || x === left + fallWidth - 1;
        if (isMouth && y - y0 < MOUTH_ROWS) {
          const sparkle = hash(originX + px, Math.floor(time * CROWN_RATE)) % 7 === 0;
          paint(pixels, offset, sparkle ? style.specular : style.surface);
          continue;
        }
        if (edge) {
          paint(pixels, offset, style.light);
          continue;
        }
        blend(pixels, offset, style.mid, style.fallOpacity);
        // streaks: per art-px lane, a streak of light scrolled down at the fall's speed
        const lane = originX + px;
        const scrolled = originY + y - time * style.fallSpeed;
        const segment = Math.floor(scrolled / STREAK_LENGTH);
        const streakSeed = hash(lane, segment);
        if (streakSeed % 4 === 0) paint(pixels, offset, style.light);
        else if (streakSeed % 29 === 0) paint(pixels, offset, style.surface);
      }
    }
    // a splash where it lands on water
    const landingIndex = (fall.row + 1) * liquid.width + fall.column;
    if (fall.row + 1 < liquid.height && !fallingAt.has(landingIndex)) {
      drawSplash(frame, pixels, left, fallWidth, y1, depth, style);
    }
  }
}

function drawSplash(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  left: number,
  fallWidth: number,
  landingY: number,
  depth: Int16Array,
  style: LiquidStyle,
): void {
  const { width, height, open, originX, time } = frame;
  // find the surface under the fall's middle
  const middle = left + (fallWidth >> 1);
  let surfaceY = -1;
  for (let y = landingY - frame.cell; y < Math.min(height, landingY + frame.cell * 2); y++) {
    if (middle >= 0 && middle < width && depth[y * width + middle] === 0) {
      surfaceY = y;
      break;
    }
  }
  if (surfaceY < 0) return;
  const tick = Math.floor(time * CROWN_RATE);
  for (let x = left - FOAM_SPREAD; x < left + fallWidth + FOAM_SPREAD; x++) {
    if (x < 0 || x >= width) continue;
    // foam on the surface row and the row under it, lingering pixels
    for (let dy = 0; dy < 2; dy++) {
      const y = surfaceY + dy;
      if (y >= height || depth[y * width + x] < 0) continue;
      if (hash(originX + x, Math.floor(time * 3) + dy * 7) % 3 !== 0)
        paint(pixels, (y * width + x) * 4, style.foam);
    }
    // crown: light spikes above the surface, re-rolled at the flip-book rate
    if (x >= left - 1 && x <= left + fallWidth) {
      const spike = hash(originX + x, tick) % 5;
      for (let dy = 1; dy <= spike; dy++) {
        const y = surfaceY - dy;
        if (y < 0 || !open[y * width + x]) break;
        paint(pixels, (y * width + x) * 4, dy === spike ? style.foam : style.light);
      }
    }
  }
}

/** Draw the liquid into `pixels` (RGBA, rock already drawn). */
export function drawLiquid(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const pools = poolsOf(frame);
  const { depth, top } = wetDepths(frame, pools);
  const { streams, masses } = splitMoving(frame, fallsOf(frame, pools), pools);
  for (const mass of masses) markMass(frame, depth, top, mass);
  drawBody(frame, pixels, depth, fallingCells(frame, pools), style);
  drawFalls(frame, pixels, streams, depth, style);
}
