// liquid-render.ts — draws the cell-pipe liquid (#90) at art resolution, over rock that's already been drawn.
//
// One shape for all of it. Every cell gets a visual fill; the fill is interpolated between cell centres at
// every art pixel, and a pixel is wet where it crosses one half — a density field and a threshold, the way
// PixelJunk Shooter and metaball water draw fluid. Pools, pours, surges and streams come out as one smooth
// silhouette that joins where they meet. What differs inside it (still water or falling water) is shading,
// blended per pixel, never a separate drawing: separate cases for pools, masses and streams each drew their
// own way, flickered between each other and left spikes where they met. See docs/FLUIDS.md, "Rendering".
//
// Pure TypeScript over an RGBA buffer: the reference the GPU port will be gated against.
import { waterRuns, UNIT, type Liquid } from '@delve/shared';

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
  /** How much falling water covers what's behind it. */
  readonly fallOpacity: number;
  /** Art px of depth over which the body darkens toward `deep`. */
  readonly depthRange: number;
  /** Art px/s the streaks in falling water scroll down. */
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
  fallOpacity: 0.45, // the same as the body, so a fall and the pool it joins are one tint
  depthRange: 40,
  fallSpeed: 90,
};

/** Lava: opaque, hot at the surface and edges, dark at depth (docs/FLUIDS.md, "Palette"). */
export const LAVA_STYLE: LiquidStyle = {
  deep: hex('#6e2727'),
  body: hex('#ae2334'),
  mid: hex('#e83b3b'),
  light: hex('#fb6b1d'),
  surface: hex('#f9c22b'),
  foam: hex('#fbff86'),
  specular: hex('#ffffff'),
  opacity: 0.95,
  fallOpacity: 1,
  depthRange: 48,
  fallSpeed: 30,
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

/** A pixel is wet where the interpolated fill reaches this. */
const WET_THRESHOLD = 0.5;
/** Moving water in a cell less than this is left out: a trickle falling fast holds very little per cell. */
const MOVING_MINIMUM = UNIT / 500;
/** Resting water in a cell less than this is left out of the field. */
const DRAWN_MINIMUM = UNIT / 50;
/** A film on rock shallower than this, art px, isn't drawn: a drained pool left hairlines along its floor. */
const MINIMUM_POOL_PX = 1.5;
/**
 * Moving water is drawn by how much flows, not only how much a cell holds: a thin fast stream holds little
 * but carries a lot, and drawn by its fill it vanished, so water seemed to teleport from basin to basin.
 * A cell carrying this many cells of water a second is drawn as a thin stream…
 */
const VISIBLE_FLOW = 0.05;
/** …its visual fill starting here (a stream about 2 px wide)… */
const THIN_STREAM_FILL = 0.53;
/** …and growing this much per cell/s more, up to full. */
const FILL_PER_FLOW = 0.04;
/** Falling water shows from this interpolated fill, and is fully dense this much above it. */
const FALL_VISIBLE_FROM = 0.2;
const FALL_DENSITY_RANGE = 0.45;
/** Falling droplets are this many art px long as they slide down. */
const DROPLET_LENGTH = 2;
/** Water moving faster than this, cells/s, and not resting in a pool, is shaded as falling. */
const FALLING_SPEED = 6;
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
/** Streaks in falling water: each lane's streak length, art px, and one lane in this many carries one. */
const STREAK_LENGTH = 7;
const STREAK_RARITY = 3;
/** Idle surface motion: art px/s, the two wavelengths, and a half-amplitude that rounds to at most 1 px. */
const IDLE_SPEED = 10;
const IDLE_WAVELENGTH_SHORT = 60;
const IDLE_WAVELENGTH_LONG = 140;
const IDLE_AMPLITUDE = 0.34;
/** Foam where falling water meets the air at a pool: flickers this many times a second. */
const FOAM_RATE = 12;

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
  /** Idle surface motion speed, 1 for water; lava moves slower. */
  readonly idle?: number;
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

/**
 * Still water is never frozen: two slow sines travelling in opposite directions, summed and rounded, move a
 * 1 px kink along the surface (Celeste's idle surface). The kinks travel; flat stretches never bob.
 */
function idleOffset(worldX: number, time: number, speedScale: number): number {
  const travel = time * IDLE_SPEED * speedScale;
  const first = Math.sin(((worldX - travel) / IDLE_WAVELENGTH_SHORT) * Math.PI * 2);
  const second = Math.sin(((worldX + travel * 0.8) / IDLE_WAVELENGTH_LONG) * Math.PI * 2);
  return Math.round(IDLE_AMPLITUDE * (first + second));
}

/** The cell grid the picture is drawn from: a visual fill and a falling amount per cell. */
interface Field {
  readonly fill: Float32Array;
  readonly falling: Float32Array;
}

/**
 * Visual fill per cell.
 * - Resting water (a column's run standing on rock) is laid out from the run's volume: full cells under a
 *   top cell holding the remainder. Water compressed at the bottom of a deep pool doesn't sink the surface.
 * - Moving water is at least as full as its flow makes it (see VISIBLE_FLOW).
 * - A film lying on rock is left out.
 */
function buildField(frame: LiquidFrame): Field {
  const { liquid, cell } = frame;
  const { width, height, volume, downVelocity } = liquid;
  const fill = new Float32Array(width * height);
  const falling = new Float32Array(width * height);
  const resting = new Uint8Array(width * height);
  for (let column = 0; column < width; column++) {
    for (const run of waterRuns(liquid, column, DRAWN_MINIMUM)) {
      let remaining = 0;
      for (let row = run.topRow; row <= run.bottomRow; row++) {
        remaining += volume[row * width + column] / UNIT;
        resting[row * width + column] = 1;
      }
      const depthPx = remaining * cell;
      if (run.topRow === run.bottomRow && depthPx < MINIMUM_POOL_PX) continue;
      for (let row = run.bottomRow; row >= run.topRow; row--) {
        const amount = Math.min(1, remaining);
        fill[row * width + column] = amount;
        remaining -= amount;
      }
      // compressed volume past the top cell shows in the cell above, if it's open
      const above = (run.topRow - 1) * width + column;
      if (remaining > 0 && run.topRow > 0 && !liquid.isSolid(above)) {
        fill[above] = Math.max(fill[above], Math.min(1, remaining));
      }
    }
  }
  for (let index = 0; index < width * height; index++) {
    if (resting[index] || liquid.isSolid(index) || volume[index] < MOVING_MINIMUM) continue;
    const row = Math.floor(index / width);
    const held = Math.min(1, volume[index] / UNIT);
    const onRock = row + 1 >= height || liquid.isSolid(index + width);
    if (onRock && held * cell < MINIMUM_POOL_PX) continue;
    // how fast it's falling: only a fall is boosted. Boosting water flowing across a surface raised pointed
    // peaks above it at every lip.
    // (a face out of an empty cell carries a speed but no water: counted, it boosted surface cells into peaks)
    const aboveHolds = row > 0 && volume[index - width] >= MOVING_MINIMUM;
    const downIn = aboveHolds ? downVelocity[index - width] : 0;
    const speed = Math.max(0, downIn, downVelocity[index]);
    const flow = held * speed;
    let shown = held;
    if (flow >= VISIBLE_FLOW)
      shown = Math.max(shown, Math.min(1, THIN_STREAM_FILL + flow * FILL_PER_FLOW));
    fill[index] = Math.max(fill[index], shown);
    // shaded as falling only where it falls with something other than water beside it: water moving down
    // inside a surge is part of the body, or its pockets hung under the surface as arrows
    const waterLeft =
      index % width > 0 && !liquid.isSolid(index - 1) && volume[index - 1] >= UNIT / 2;
    const waterRight =
      index % width < width - 1 && !liquid.isSolid(index + 1) && volume[index + 1] >= UNIT / 2;
    const inBody = waterLeft && waterRight;
    // and only where water comes down from above: a lone drop settling back onto a pool fuzzed its surface
    const fedFromAbove =
      row > 0 && !liquid.isSolid(index - width) && volume[index - width] >= MOVING_MINIMUM;
    if (Math.max(downIn, downVelocity[index]) > FALLING_SPEED && !inBody && fedFromAbove)
      falling[index] = 1;
  }
  // a trickle falls as packets with a dry cell between them: drawn wet, or the stream breaks into dashes
  for (let index = width; index < width * (height - 1); index++) {
    if (fill[index] > 0 || resting[index] || liquid.isSolid(index)) continue;
    const above = fill[index - width];
    const below = fill[index + width];
    if (above <= 0 || below <= 0 || falling[index - width] === 0) continue;
    fill[index] = Math.min(above, below);
    falling[index] = 1;
  }
  return { fill, falling };
}

/**
 * The field at an art-pixel position, interpolated between the centres of the four nearest cells. A rock
 * corner takes the value of the water beside it in the same sample (across first, then above or below), so
 * water meets rock flush — never rounding away from a wall or floor — and never leaks through one.
 */
function sample(
  frame: LiquidFrame,
  solid: Uint8Array,
  values: Float32Array,
  x: number,
  y: number,
): number {
  const { liquid, cell } = frame;
  const columns = liquid.width;
  const u = x / cell - 0.5;
  const v = y / cell - 0.5;
  const leftColumn = Math.floor(u);
  const topRow = Math.floor(v);
  const fx = u - leftColumn;
  const fy = v - topRow;
  const c0 = Math.max(0, Math.min(columns - 1, leftColumn));
  const c1 = Math.max(0, Math.min(columns - 1, leftColumn + 1));
  const r0 = Math.max(0, Math.min(liquid.height - 1, topRow));
  const r1 = Math.max(0, Math.min(liquid.height - 1, topRow + 1));
  const topLeft = r0 * columns + c0;
  const topRight = r0 * columns + c1;
  const bottomLeft = r1 * columns + c0;
  const bottomRight = r1 * columns + c1;
  // stand-ins for rock corners: across the row, then up or down the column, then the diagonal
  const pick = (
    corner: number,
    acrossCorner: number,
    verticalCorner: number,
    diagonalCorner: number,
  ): number => {
    if (!solid[corner]) return values[corner];
    if (!solid[acrossCorner]) return values[acrossCorner];
    if (!solid[verticalCorner]) return values[verticalCorner];
    if (!solid[diagonalCorner]) return values[diagonalCorner];
    return 0;
  };
  const a = pick(topLeft, topRight, bottomLeft, bottomRight);
  const b = pick(topRight, topLeft, bottomRight, bottomLeft);
  const c = pick(bottomLeft, bottomRight, topLeft, topRight);
  const d = pick(bottomRight, bottomLeft, topRight, topLeft);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Draw the liquid into `pixels` (RGBA, rock already drawn). */
export function drawLiquid(
  frame: LiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { width, height, open, originX, originY, time, liquid, cell } = frame;
  const field = buildField(frame);
  const idle = frame.idle ?? 1;
  const solid = new Uint8Array(liquid.width * liquid.height);
  for (let index = 0; index < solid.length; index++) solid[index] = liquid.isSolid(index) ? 1 : 0;
  // cells with any water within one cell: only their pixels can be wet, so the rest are skipped
  const near = new Uint8Array(liquid.width * liquid.height);
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      if (field.fill[row * liquid.width + column] <= 0) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr;
          const c = column + dc;
          if (r >= 0 && c >= 0 && r < liquid.height && c < liquid.width)
            near[r * liquid.width + c] = 1;
        }
      }
    }
  }
  // which pixels are standing water (wet), and how dense the falling water is at the rest
  const wet = new Uint8Array(width * height);
  const falling = new Float32Array(width * height);
  const fallDensity = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!open[index]) continue;
      if (
        !near[
          Math.min(liquid.height - 1, Math.floor(y / cell)) * liquid.width +
            Math.min(liquid.width - 1, Math.floor(x / cell))
        ]
      )
        continue;
      const centreX = x + 0.5;
      const centreY = y + 0.5 - idleOffset(originX + x, time, idle);
      const value = sample(frame, solid, field.fill, centreX, centreY);
      if (value < FALL_VISIBLE_FROM) continue;
      const fall = sample(frame, solid, field.falling, centreX, centreY);
      if (fall >= 0.5) {
        // falling water has no edge of its own: its density fades out through the threshold
        fallDensity[index] = Math.min(1, (value - FALL_VISIBLE_FROM) / FALL_DENSITY_RANGE);
        continue;
      }
      if (value < WET_THRESHOLD) continue;
      wet[index] = 1;
      falling[index] = fall;
    }
  }
  const airAt = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    open[y * width + x] === 1 &&
    wet[y * width + x] === 0 &&
    // falling water isn't air: the pool's outline stops where a fall joins it instead of wrapping it
    fallDensity[y * width + x] === 0;
  // depth below the air over each column of wet pixels; water under rock (a flooded passage) starts deep
  const depth = new Int16Array(width * height).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (!wet[index]) continue;
      if (y > 0 && depth[index - width] >= 0) depth[index] = depth[index - width] + 1;
      else {
        // under rock (a flooded passage) or under a fall pouring into it, there's no surface here
        const underCover = y > 0 && (open[index - width] === 0 || fallDensity[index - width] > 0);
        depth[index] = underCover ? GLINT_BOTTOM : 0;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const worldX = originX + x;
      const worldY = originY + y;
      if (fallDensity[index] > 0) {
        drawFalling(pixels, index * 4, worldX, worldY, fallDensity[index], time, style);
        continue;
      }
      if (!wet[index]) continue;
      const offset = index * 4;
      const fall = falling[index];
      const onEdge = airAt(x, y - 1) || airAt(x - 1, y) || airAt(x + 1, y);
      if (onEdge) {
        // foam where falling water churns into the surface of a pool; the plain outline everywhere else
        const fallingInto =
          (y > 0 && fallDensity[index - width] > 0) ||
          (y > 1 && fallDensity[index - 2 * width] > 0);
        const churning = fallingInto || (fall > 0.2 && airAt(x, y - 1));
        const flicker = hash(worldX, Math.floor(time * FOAM_RATE)) % 3 !== 0;
        paint(pixels, offset, churning && flicker ? style.foam : style.surface);
        continue;
      }
      const below = depth[index];
      if (below === 1) {
        paint(pixels, offset, style.light);
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

/**
 * Falling water: the pool's own tint, with no outline, thinned by density. Where a fall is thick every pixel
 * is drawn; where it thins, only some are, picked by noise that slides down at the fall's speed, so a
 * trickle reads as droplets falling rather than a line. A few light streaks ride down the thick part.
 * Outlined like a pool, falls read as separate ribbons and trickles as cartoon lines.
 */
function drawFalling(
  pixels: Uint8ClampedArray,
  offset: number,
  worldX: number,
  worldY: number,
  density: number,
  time: number,
  style: LiquidStyle,
): void {
  const scrolled = Math.floor((worldY - time * style.fallSpeed) / DROPLET_LENGTH);
  const chance = (hash(worldX, scrolled) % 1000) / 1000;
  if (chance >= density) return;
  blend(pixels, offset, style.mid, style.fallOpacity);
  const lane = hash(worldX, 7);
  if (lane % STREAK_RARITY !== 0 || density < 1) return;
  const streakSegment = Math.floor((worldY - time * style.fallSpeed + (lane % 97)) / STREAK_LENGTH);
  if (hash(worldX, streakSegment) % 2 === 0) blend(pixels, offset, style.light, 0.6);
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
  const slot = Math.floor((worldX + drift) / GLINT_SPACING);
  const seed = hash(slot, below * 131 + Math.floor(surfaceWorldY / 8));
  if (seed % GLINT_RARITY !== 0) return;
  const phase = (time / GLINT_PERIOD + (seed % 1000) / 1000) % 1;
  const halfLength = Math.round(Math.sin(phase * Math.PI) * 2); // 0 → 2 → 0
  if (halfLength <= 0) return;
  const centre = slot * GLINT_SPACING + (seed % GLINT_SPACING) - drift;
  if (Math.abs(worldX - centre) > halfLength - 1) return;
  paint(pixels, offset, style.foam);
}
