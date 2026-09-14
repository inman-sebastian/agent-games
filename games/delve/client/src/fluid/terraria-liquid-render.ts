// terraria-liquid-render.ts — Terraria's liquid renderer, ported (#90), in DELVE's look. The draw cache is a
// translation of Terraria 1.4.0.5's LiquidRenderer.InternalPrepareDraw (decompiled), pass by pass, on DELVE's
// 8 art px cells, checked exactly against Terraria's own code (tools/terraria-oracle). What it draws is DELVE's:
// a texture on Terraria's layout with a top-lit rim, whole Resurrect 64 colours, water you see the cave
// through, lava that's opaque and lights the dark, and no fading trail. See docs/FLUIDS.md, "The look".
import { LIQUID_LAVA, vnoise, type TerrariaLiquid } from '@delve/shared';
import { paint, type LiquidStyle, type Rgb, WATER_STYLE } from './liquid-render';
import { hexRgb, moltenSurface } from '../render/palette';

// LiquidRenderer.WATERFALL_LENGTH, water then lava
const WATERFALL_LENGTH = [10, 3];
/** LiquidRenderer.MIN_LIQUID_SIZE: a drawn tile is never smaller than this much of a tile. */
const MIN_LIQUID_SIZE = 0.25;
/** Terraria's tile size: every wall and frame offset is in these units. */
const TILE = 16;

export interface TerrariaLiquidFrame {
  readonly liquid: TerrariaLiquid;
  /** Art px per cell. */
  readonly cell: number;
  /** Per art pixel: 1 where the rock mask is open. */
  readonly open: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly time: number;
}

/** LiquidRenderer.LiquidCache, as arrays over the cells. */
class Cache {
  readonly level: Float32Array;
  readonly visibleLevel: Float32Array;
  readonly opacity: Float32Array;
  readonly isSolid: Uint8Array;
  readonly hasLiquid: Uint8Array;
  readonly hasVisibleLiquid: Uint8Array;
  readonly frameX: Int32Array;
  readonly frameY: Int32Array;
  readonly hasLeftEdge: Uint8Array;
  readonly hasRightEdge: Uint8Array;
  readonly hasTopEdge: Uint8Array;
  readonly hasBottomEdge: Uint8Array;
  readonly leftWall: Float32Array;
  readonly rightWall: Float32Array;
  readonly topWall: Float32Array;
  readonly bottomWall: Float32Array;
  readonly visibleLeftWall: Float32Array;
  readonly visibleRightWall: Float32Array;
  readonly visibleTopWall: Float32Array;
  readonly visibleBottomWall: Float32Array;

  constructor(count: number) {
    this.level = new Float32Array(count);
    this.visibleLevel = new Float32Array(count);
    this.opacity = new Float32Array(count);
    this.isSolid = new Uint8Array(count);
    this.hasLiquid = new Uint8Array(count);
    this.hasVisibleLiquid = new Uint8Array(count);
    this.frameX = new Int32Array(count);
    this.frameY = new Int32Array(count);
    this.hasLeftEdge = new Uint8Array(count);
    this.hasRightEdge = new Uint8Array(count);
    this.hasTopEdge = new Uint8Array(count);
    this.hasBottomEdge = new Uint8Array(count);
    this.leftWall = new Float32Array(count);
    this.rightWall = new Float32Array(count);
    this.topWall = new Float32Array(count);
    this.bottomWall = new Float32Array(count);
    this.visibleLeftWall = new Float32Array(count);
    this.visibleRightWall = new Float32Array(count);
    this.visibleTopWall = new Float32Array(count);
    this.visibleBottomWall = new Float32Array(count);
  }
}

/**
 * Each liquid's cache, kept frame to frame as LiquidRenderer keeps _cache: a pass only writes what Terraria's
 * writes, so a hidden tile keeps the walls it last had, and the corner fix reads them.
 */
const caches = new WeakMap<TerrariaLiquid, Cache>();

/** InternalPrepareDraw's passes. Outside the grid reads as solid rock with no liquid. */
function prepare(liquid: TerrariaLiquid, firstWorldRow: number): Cache {
  const { width, height } = liquid;
  let cache = caches.get(liquid);
  if (!cache || cache.level.length !== width * height) {
    cache = new Cache(width * height);
    caches.set(liquid, cache);
  }
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
  const solidAt = (index: number): boolean => index < 0 || cache.isSolid[index] === 1;
  const visibleAt = (index: number): boolean => index >= 0 && cache.hasVisibleLiquid[index] === 1;
  const levelAt = (index: number): number => (index < 0 ? 1 : cache.visibleLevel[index]); // solid: 1
  const liquidAt = (index: number): boolean => index >= 0 && cache.hasLiquid[index] === 1;

  for (let index = 0; index < width * height; index++) {
    cache.level[index] = liquid.level[index] / 255;
    cache.isSolid[index] = liquid.isSolid(index) ? 1 : 0;
    cache.hasLiquid[index] = liquid.level[index] > 0 ? 1 : 0;
  }
  // gap fill: a tile without liquid between two with it, above and below or either side, shows their mean
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let visible: number;
      if (!cache.hasLiquid[index]) {
        const above = at(x, y - 1);
        const below = at(x, y + 1);
        const left = at(x - 1, y);
        const right = at(x + 1, y);
        let sum = 0;
        if (liquidAt(above) && liquidAt(below) && !solidAt(above) && !solidAt(below))
          sum = cache.level[above] + cache.level[below];
        if (liquidAt(left) && liquidAt(right) && !solidAt(left) && !solidAt(right))
          sum = Math.max(sum, cache.level[left] + cache.level[right]);
        visible = sum * 0.5;
      } else {
        visible = cache.level[index];
      }
      cache.visibleLevel[index] = visible;
      cache.hasVisibleLiquid[index] = visible !== 0 ? 1 : 0;
    }
  }
  // the waterfall trail: under liquid, a few tiles of fading liquid, down to rock
  const length = WATERFALL_LENGTH[liquid.kind];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (cache.hasVisibleLiquid[index] && !cache.isSolid[index]) {
        cache.opacity[index] = 1;
        const step = 1 / (length + 1);
        let fade = 1;
        for (let k = 1; k <= length; k++) {
          fade -= step;
          const below = at(x, y + k);
          if (below < 0 || cache.isSolid[below]) break;
          cache.visibleLevel[below] = Math.max(
            cache.visibleLevel[below],
            cache.visibleLevel[index] * fade,
          );
          cache.opacity[below] = fade;
        }
      }
      if (cache.isSolid[index]) {
        cache.visibleLevel[index] = 1;
        cache.hasVisibleLiquid[index] = 0;
      } else {
        cache.hasVisibleLiquid[index] = cache.visibleLevel[index] !== 0 ? 1 : 0;
      }
    }
  }
  // walls, edges and the frame they pick
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!cache.hasVisibleLiquid[index]) {
        cache.hasLeftEdge[index] = 0;
        cache.hasTopEdge[index] = 0;
        cache.hasRightEdge[index] = 0;
        cache.hasBottomEdge[index] = 0;
        continue;
      }
      const above = at(x, y - 1);
      const below = at(x, y + 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const visible = cache.visibleLevel[index];
      let leftWall = 0;
      let rightWall = 1;
      let topWall = 0;
      let bottomWall = 1;
      if (!visibleAt(above)) topWall += levelAt(below) * (1 - visible);
      if (!visibleAt(below) && !solidAt(below)) bottomWall -= levelAt(above) * (1 - visible);
      if (!visibleAt(left) && !solidAt(left)) leftWall += levelAt(right) * (1 - visible);
      if (!visibleAt(right) && !solidAt(right)) rightWall -= levelAt(left) * (1 - visible);
      cache.leftWall[index] = leftWall;
      cache.rightWall[index] = rightWall;
      cache.bottomWall[index] = bottomWall;
      cache.topWall[index] = topWall;
      const hasTop = (!visibleAt(above) && !solidAt(above)) || topWall !== 0;
      const hasBottom = (!visibleAt(below) && !solidAt(below)) || bottomWall !== 1;
      const hasLeft = (!visibleAt(left) && !solidAt(left)) || leftWall !== 0;
      const hasRight = (!visibleAt(right) && !solidAt(right)) || rightWall !== 1;
      cache.hasTopEdge[index] = hasTop ? 1 : 0;
      cache.hasBottomEdge[index] = hasBottom ? 1 : 0;
      cache.hasLeftEdge[index] = hasLeft ? 1 : 0;
      cache.hasRightEdge[index] = hasRight ? 1 : 0;
      let frameX = 0;
      let frameY = 0;
      if (!hasLeft) frameX += hasRight ? 32 : 16;
      if (hasLeft && hasRight) {
        frameX = 16;
        frameY += 32;
        if (hasTop) frameY = 16;
      } else if (!hasTop) {
        frameY += !hasLeft && !hasRight ? 48 : 16;
      }
      if (frameY === 16 && hasLeft !== hasRight && (y + firstWorldRow) % 2 === 0) frameY += 16;
      cache.frameX[index] = frameX;
      cache.frameY[index] = frameY;
    }
  }
  // smoothing: an edge's wall is averaged with its neighbours' along that edge
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!cache.hasVisibleLiquid[index]) continue;
      const above = at(x, y - 1);
      const below = at(x, y + 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const wall = (array: Float32Array, neighbour: number): number =>
        neighbour < 0 ? 0 : array[neighbour];
      cache.visibleLeftWall[index] = cache.leftWall[index];
      cache.visibleRightWall[index] = cache.rightWall[index];
      cache.visibleTopWall[index] = cache.topWall[index];
      cache.visibleBottomWall[index] = cache.bottomWall[index];
      if (visibleAt(above) && visibleAt(below)) {
        if (cache.hasLeftEdge[index])
          cache.visibleLeftWall[index] =
            (cache.leftWall[index] * 2 +
              wall(cache.leftWall, above) +
              wall(cache.leftWall, below)) *
            0.25;
        if (cache.hasRightEdge[index])
          cache.visibleRightWall[index] =
            (cache.rightWall[index] * 2 +
              wall(cache.rightWall, above) +
              wall(cache.rightWall, below)) *
            0.25;
      }
      if (visibleAt(left) && visibleAt(right)) {
        if (cache.hasTopEdge[index])
          cache.visibleTopWall[index] =
            (cache.topWall[index] * 2 + wall(cache.topWall, left) + wall(cache.topWall, right)) *
            0.25;
        if (cache.hasBottomEdge[index])
          cache.visibleBottomWall[index] =
            (cache.bottomWall[index] * 2 +
              wall(cache.bottomWall, left) +
              wall(cache.bottomWall, right)) *
            0.25;
      }
    }
  }
  // corner fix: a tile with a top edge and one side edge takes its walls from its neighbours
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!cache.hasLiquid[index]) continue;
      const below = at(x, y + 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const hasLeft = cache.hasLeftEdge[index] === 1;
      const hasRight = cache.hasRightEdge[index] === 1;
      if (cache.hasTopEdge[index] && !cache.hasBottomEdge[index] && hasLeft !== hasRight) {
        if (hasRight) {
          if (below >= 0) cache.visibleRightWall[index] = cache.visibleRightWall[below];
          if (left >= 0) cache.visibleTopWall[index] = cache.visibleTopWall[left];
        } else {
          if (below >= 0) cache.visibleLeftWall[index] = cache.visibleLeftWall[below];
          if (right >= 0) cache.visibleTopWall[index] = cache.visibleTopWall[right];
        }
      } else if (below >= 0 && cache.frameX[below] === 16 && cache.frameY[below] === 32) {
        if (cache.visibleLeftWall[index] > 0.5) {
          cache.visibleLeftWall[index] = 0;
          cache.frameX[index] = 0;
          cache.frameY[index] = 0;
        } else if (cache.visibleRightWall[index] < 0.5) {
          cache.visibleRightWall[index] = 1;
          cache.frameX[index] = 32;
          cache.frameY[index] = 0;
        }
      }
    }
  }
  // inner corners: a tile with no edges under a neighbour's top edge takes an inner-corner frame
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!cache.hasLiquid[index]) continue;
      if (
        cache.hasBottomEdge[index] ||
        cache.hasLeftEdge[index] ||
        cache.hasTopEdge[index] ||
        cache.hasRightEdge[index]
      )
        continue;
      const above = at(x, y - 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      if (above < 0) continue;
      const truncate = (value: number): number => Math.trunc(value);
      if (left >= 0 && cache.hasTopEdge[left] && cache.hasLeftEdge[above]) {
        cache.frameX[index] = Math.max(4, truncate(TILE - cache.visibleLeftWall[above] * TILE)) - 4;
        cache.frameY[index] =
          48 + Math.max(4, truncate(TILE - cache.visibleTopWall[left] * TILE)) - 4;
      } else if (right >= 0 && cache.hasTopEdge[right] && cache.hasRightEdge[above]) {
        cache.frameX[index] =
          32 - Math.min(TILE, truncate(cache.visibleRightWall[above] * TILE) - 4);
        cache.frameY[index] =
          48 + Math.max(4, truncate(TILE - cache.visibleTopWall[right] * TILE)) - 4;
      } else {
        continue;
      }
      cache.visibleLeftWall[index] = 0;
      cache.visibleTopWall[index] = 0;
      cache.visibleRightWall[index] = 1;
      cache.visibleBottomWall[index] = 1;
    }
  }
  return cache;
}

export const enum Texel {
  Clear = 0,
  Body = 1,
  /** The outer pixel of a top edge: the surface line. */
  TopOuter = 2,
  TopInner = 3,
  /** The outer pixel of a side edge. */
  SideOuter = 4,
  SideInner = 5,
  /** The drifting sparkle just under a top edge. */
  Shimmer = 6,
}

/** Frames of the texture's animation (LiquidRenderer.ANIMATION_FRAME_COUNT), and how fast they turn without wind. */
const ANIMATION_FRAMES = 16;
const ANIMATION_FRAMES_PER_SECOND = 6;
/** The texture's surface frame sits under the animation: IsSurfaceLiquid tiles draw from here, unanimated. */
const SURFACE_FRAME_Y = 1280;
/** Terraria's liquid texture is pixel art drawn at 2×: one of its pixels is two units, one DELVE art pixel. */
const UNITS_PER_PIXEL = 2;

const hashPixel = (x: number, y: number): number => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return Math.imul(h, 1103515245) >>> 0;
};

/** An edge pixel `distance` in from the edge (0 outer, 1 inner, 2 the shimmer's row), on a top or a side edge. */
function edge(distance: number, top: boolean): Texel {
  if (distance <= 0) return top ? Texel.TopOuter : Texel.SideOuter;
  if (distance === 1) return top ? Texel.TopInner : Texel.SideInner;
  return Texel.Body;
}

/** A rounded-cornered edge: `sideX` in from the side, `topY` down from the top; the corner is cut at 2. */
function roundedEdge(x: number, y: number, sideX: number, topY: number, frame: number): Texel {
  if (sideX + topY < 2) return Texel.Clear;
  const distance = Math.min(sideX, topY, sideX + topY - 2);
  const top = topY <= sideX;
  // the shimmer: now and then a pixel just under a top edge, drifting a pixel a frame
  if (distance === 2 && top && hashPixel((x + frame) % 24, y) % 7 === 0) return Texel.Shimmer;
  return edge(distance, top);
}

/**
 * DELVE's liquid texture, on Terraria's layout (x, y in its pixels: 24 × 40 a frame, 8 a tile). Rows 0–2: an
 * edge block with rounded top corners, open at the bottom, with a narrow two-sided column (tiles (1,1)–(1,2))
 * cut into it. Row 3: the column's sides flaring into a surface line, for inner corners. Row 4: body. An edge is
 * two pixels, on a top edge or a side edge. The animation is a shimmer under the top edges.
 */
export function texel(x: number, y: number, frame: number): Texel {
  if (y >= SURFACE_FRAME_Y / UNITS_PER_PIXEL) {
    const row = y - SURFACE_FRAME_Y / UNITS_PER_PIXEL;
    if (x < 8 || x > 15 || row > 7) return Texel.Clear;
    return edge(row, true);
  }
  const localY = y % 40;
  if (localY < 24) {
    if (x >= 8 && x <= 15 && localY >= 8) {
      return roundedEdge(x, localY, Math.min(x - 8, 15 - x), localY - 8, frame); // the narrow column
    }
    return roundedEdge(x, localY, x < 8 ? x : x > 15 ? 23 - x : 8, localY, frame);
  }
  if (localY < 32) {
    // inner corners: the column's sides, flaring into a surface line at row 30
    const row = localY - 24;
    const sideX = Math.min(x - 6, 17 - x);
    if (row < 6) return sideX < 0 ? Texel.Clear : edge(sideX, false);
    if (row === 6) return sideX < 0 ? Texel.TopOuter : sideX < 2 ? Texel.TopInner : Texel.Body;
    return sideX < 0 ? Texel.TopInner : Texel.Body;
  }
  return Texel.Body;
}

/** Lava's light, the Light role of its ramp (#fb6b1d), as a lighting colour. */
export const LAVA_LIGHT: [number, number, number] = [251 / 255, 107 / 255, 29 / 255];

/**
 * The tiles a liquid lights the cave from: lava tiles open to the air above or beside them. Water casts none.
 * Each is a lamp-field emitter in LAVA_LIGHT (docs/FLUIDS.md, "The look"; docs/LIGHTING.md, "World lights").
 */
export function liquidLights(liquid: TerrariaLiquid): { column: number; row: number }[] {
  if (liquid.kind !== LIQUID_LAVA) return [];
  const { width, height, level } = liquid;
  const air = (column: number, row: number): boolean =>
    column >= 0 &&
    row >= 0 &&
    column < width &&
    row < height &&
    level[row * width + column] === 0 &&
    !liquid.isSolid(row * width + column);
  const lights: { column: number; row: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (level[row * width + column] === 0) continue;
      if (air(column, row - 1) || air(column - 1, row) || air(column + 1, row)) {
        lights.push({ column, row });
      }
    }
  }
  return lights;
}

/** LiquidRenderer's draw cache, per cell (row by row): what InternalPrepareDraw hands InternalDraw. */
export interface LiquidDraw {
  readonly visible: Uint8Array;
  /** The source rectangle in the 48×80 liquid frame, in Terraria's 16-per-tile units. */
  readonly sourceX: Int32Array;
  readonly sourceY: Int32Array;
  readonly sourceWidth: Int32Array;
  readonly sourceHeight: Int32Array;
  /** Where the rectangle is drawn inside the tile, in the same units. */
  readonly offsetX: Int32Array;
  readonly offsetY: Int32Array;
  /** The waterfall trail's fade: 1 for liquid, less below it. */
  readonly opacity: Float32Array;
  /** IsSurfaceLiquid: a plain top edge, drawn from the texture's surface frame instead of the animation. */
  readonly surface: Uint8Array;
}

/** InternalPrepareDraw's final pass: each visible tile's source and destination rectangles. */
export function prepareLiquidDraw(liquid: TerrariaLiquid, firstWorldRow = 0): LiquidDraw {
  const cache = prepare(liquid, firstWorldRow);
  const count = liquid.width * liquid.height;
  const draw: LiquidDraw = {
    visible: new Uint8Array(count),
    sourceX: new Int32Array(count),
    sourceY: new Int32Array(count),
    sourceWidth: new Int32Array(count),
    sourceHeight: new Int32Array(count),
    offsetX: new Int32Array(count),
    offsetY: new Int32Array(count),
    opacity: new Float32Array(count),
    surface: new Uint8Array(count),
  };
  for (let index = 0; index < count; index++) {
    if (!cache.hasVisibleLiquid[index]) continue;
    const left = Math.min(0.75, cache.visibleLeftWall[index]);
    const right = Math.max(MIN_LIQUID_SIZE, cache.visibleRightWall[index]);
    const top = Math.min(0.75, cache.visibleTopWall[index]);
    const bottom = Math.max(MIN_LIQUID_SIZE, cache.visibleBottomWall[index]);
    draw.visible[index] = 1;
    draw.sourceX[index] = Math.trunc(TILE - right * TILE) + cache.frameX[index];
    draw.sourceY[index] = Math.trunc(TILE - bottom * TILE) + cache.frameY[index];
    draw.sourceWidth[index] = Math.ceil((right - left) * TILE);
    draw.sourceHeight[index] = Math.ceil((bottom - top) * TILE);
    draw.offsetX[index] = Math.floor(left * TILE);
    draw.offsetY[index] = Math.floor(top * TILE);
    draw.opacity[index] = cache.opacity[index];
    // underground (DELVE is all below Terraria's worldSurface − 40), a top-middle frame is surface liquid
    draw.surface[index] = cache.frameX[index] === 16 && cache.frameY[index] === 0 ? 1 : 0;
  }
  return draw;
}

/**
 * Main.waterTarget: Terraria renders its liquid into a render target on one frame in four (Main.renderCount,
 * advanced each frame by the lighting pass) and draws that target every frame. At 60 frames a second with
 * liquid every second frame, the picture refreshes every second liquid update, always at the same point of the
 * cycle — which hides a stream's update-to-update alternation where it pours over a lip and lands.
 */
interface WaterTarget {
  shown: Uint8Array;
  /** Per cell: 1 where liquid was drawn (liquid, or a gap the trail bridges). */
  cells: Uint8Array;
  /** Half the liquid update count it was rendered at. */
  renderedHalf: number;
}

/** Each liquid picture refreshes once per this many liquid updates. */
const UPDATES_PER_RENDER = 2;

const waterTargets = new WeakMap<TerrariaLiquid, WaterTarget>();

/**
 * Brightness (0–255) of what's behind a water pixel, below which it shows the ramp's Deep, then Body, then Mid.
 * Tuned to the Stone background, whose wall has two tones (brightness 48 and 59); other strata will want theirs.
 */
const SEE_THROUGH_DEEP = 54;
const SEE_THROUGH_BODY = 100;
/** Art px under its surface over which lava cools from its hottest to its dark centre. */
const LAVA_COOLING_DEPTH = 56;
/** Lava's molten ramp, dark → hot (Resurrect 64). */
export const LAVA_BANDS = ['#6e2727', '#ae2334', '#e83b3b', '#fb6b1d', '#f79617', '#f9c22b'].map(
  hexRgb,
);

/**
 * Draw the liquid into `pixels` (RGBA), in whole palette colours (docs/FLUIDS.md, "The look"). Water is drawn
 * over the scene it sits in, reading what's behind it; lava is opaque and can be drawn into its own layer, to
 * go over the lighting.
 */
export function drawTerrariaLiquid(
  frame: TerrariaLiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { liquid, open, width, height, originX, originY, time, cell } = frame;
  const half = Math.floor(liquid.updateCount() / UPDATES_PER_RENDER);
  let target = waterTargets.get(liquid);
  if (!target || target.shown.length !== width * height || target.renderedHalf !== half) {
    target = renderWater(frame, target);
    target.renderedHalf = half;
    waterTargets.set(liquid, target);
  }
  const lava = liquid.kind === LIQUID_LAVA;
  // art px under the nearest surface above, per column, and that spread sideways: lava's heat
  const depth = new Int32Array(width);
  const distance = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      // the surface is open air, judged by cell: not rock (its eroded edge pixels included), and no liquid
      // drawn there — so a cell the sim briefly empties inside moving lava, which the draw fills, doesn't count
      const cellIndex = Math.floor(y / cell) * liquid.width + Math.floor(x / cell);
      const surface = target.cells[cellIndex] === 0 && !liquid.isSolid(cellIndex);
      depth[x] = surface ? 0 : depth[x] + 1;
    }
    if (lava) surfaceDistance(depth, distance);
    for (let x = 0; x < width; x++) {
      const pixel = row + x;
      let kind = target.shown[pixel];
      if (!open[pixel]) continue; // rock stays in front
      const column = Math.floor(x / cell);
      const cellIndex = Math.floor(y / cell) * liquid.width + column;
      // open air beside a cell: not rock, nothing drawn (Terraria's undrawn trail counts as air)
      const airAt = (neighbour: number, inRow: boolean): boolean =>
        inRow && target.cells[neighbour] === 0 && !liquid.isSolid(neighbour);
      const airLeft = airAt(cellIndex - 1, column > 0);
      const airRight = airAt(cellIndex + 1, column < liquid.width - 1);
      if (kind === Texel.Clear) {
        // a gap a partly filled tile leaves inside the body — a drawn cell under a drawn cell, closed in by liquid
        // or rock either side — is body, not a hole; a crop toward open air is an edge and stays
        const above = cellIndex - liquid.width;
        if (!target.cells[cellIndex] || above < 0 || !target.cells[above]) continue;
        if (airLeft || airRight) continue;
        kind = Texel.Body;
      }
      if ((kind === Texel.Body || kind === Texel.Shimmer) && target.cells[cellIndex]) {
        // a face toward open air gets its side edge, even where Terraria's trail beside it kept one from showing
        const localX = x - column * cell;
        if (airLeft && localX < 2) kind = localX === 0 ? Texel.SideOuter : Texel.SideInner;
        else if (airRight && localX >= cell - 2)
          kind = localX === cell - 1 ? Texel.SideOuter : Texel.SideInner;
      }
      const offset = pixel * 4;
      let colour: Rgb;
      if (lava) {
        // the molten surface, lit from within: its rim hottest, cooling with distance from the surface
        const worldX = originX + x;
        const worldY = originY + y;
        // the cooling depth wanders, so hot and cool lava meet along an organic line, not a straight band
        const cooling = LAVA_COOLING_DEPTH * (0.7 + vnoise(worldX * 0.05, worldY * 0.03, 7) * 0.6);
        const heat = Math.max(0, 1 - distance[x] / cooling);
        // the brightest rim only on the real surface, not on the inner edges between partly filled tiles
        colour =
          kind === Texel.TopOuter && distance[x] <= 2
            ? LAVA_BANDS[LAVA_BANDS.length - 1]
            : moltenSurface(worldX, worldY, worldX, worldY, heat, time, LAVA_BANDS);
      } else {
        switch (kind) {
          case Texel.TopOuter:
            colour = style.surface;
            break;
          case Texel.TopInner:
          case Texel.SideOuter:
          case Texel.Shimmer:
            colour = style.light;
            break;
          case Texel.SideInner:
            colour = style.mid;
            break;
          default:
            colour = seeThrough(pixels, offset, style);
        }
      }
      paint(pixels, offset, colour);
      pixels[offset + 3] = 255;
    }
  }
}

/**
 * Each column's depth under its own surface, spread sideways one pixel per pixel (a 1D distance transform), into
 * `out`: the distance to the nearest surface along the row or straight up. Lava's heat is measured from it, so
 * where the surface steps, hot and cool lava blend across instead of meeting in a vertical seam.
 */
export function surfaceDistance(depth: Int32Array, out: Int32Array): Int32Array {
  const width = depth.length;
  let carried = Infinity;
  for (let x = 0; x < width; x++) {
    carried = Math.min(depth[x], carried + 1);
    out[x] = carried;
  }
  carried = Infinity;
  for (let x = width - 1; x >= 0; x--) {
    carried = Math.min(out[x], carried + 1);
    out[x] = carried;
  }
  return out;
}

/** A water body pixel: the water ramp colour matching the brightness of what's behind it. */
function seeThrough(pixels: Uint8ClampedArray, offset: number, style: LiquidStyle): Rgb {
  const brightness =
    0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
  if (brightness < SEE_THROUGH_DEEP) return style.deep;
  if (brightness < SEE_THROUGH_BODY) return style.body;
  return style.mid;
}

/** Main.RenderWater: prepare the draw and lay every tile's source rectangle into the target. */
function renderWater(frame: TerrariaLiquidFrame, reuse: WaterTarget | undefined): WaterTarget {
  const { liquid, cell, width, height, originY } = frame;
  const draw = prepareLiquidDraw(liquid, Math.floor(originY / cell));
  const scale = TILE / cell; // Terraria units per art px
  const frameNumber = Math.floor(frame.time * ANIMATION_FRAMES_PER_SECOND) % ANIMATION_FRAMES;
  const target: WaterTarget =
    reuse && reuse.shown.length === width * height
      ? reuse
      : {
          shown: new Uint8Array(width * height),
          cells: new Uint8Array(liquid.width * liquid.height),
          renderedHalf: -1,
        };
  if (target.cells.length !== liquid.width * liquid.height) {
    target.cells = new Uint8Array(liquid.width * liquid.height);
  }
  target.shown.fill(Texel.Clear);
  // hard edges: the waterfall trail's faded tiles are drawn only where they bridge a gap to liquid further down
  // the stream; a trail that only fades into the air (a tail) isn't drawn
  const drawn = target.cells;
  drawn.fill(0);
  for (let column = 0; column < liquid.width; column++) {
    let liquidBelow = false;
    for (let row = liquid.height - 1; row >= 0; row--) {
      const index = row * liquid.width + column;
      if (!draw.visible[index]) {
        liquidBelow = false;
        continue;
      }
      if (draw.opacity[index] >= 1) liquidBelow = true;
      if (liquidBelow) drawn[index] = 1;
    }
  }
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      const index = row * liquid.width + column;
      if (!drawn[index]) continue;
      const sourceX = draw.sourceX[index];
      // InternalDraw: surface liquid draws from the surface frame, everything else from this animation frame
      const sourceY = draw.surface[index]
        ? SURFACE_FRAME_Y
        : draw.sourceY[index] + frameNumber * 80;
      for (let py = 0; py < cell; py++) {
        const unitY = py * scale - draw.offsetY[index];
        if (unitY < 0 || unitY >= draw.sourceHeight[index]) continue;
        for (let px = 0; px < cell; px++) {
          const unitX = px * scale - draw.offsetX[index];
          if (unitX < 0 || unitX >= draw.sourceWidth[index]) continue;
          const kind = texel(
            Math.floor((sourceX + unitX) / UNITS_PER_PIXEL),
            Math.floor((sourceY + unitY) / UNITS_PER_PIXEL),
            frameNumber,
          );
          if (kind === Texel.Clear) continue;
          const x = column * cell + px;
          const y = row * cell + py;
          if (x >= width || y >= height) continue;
          target.shown[y * width + x] = kind;
        }
      }
    }
  }
  return target;
}
