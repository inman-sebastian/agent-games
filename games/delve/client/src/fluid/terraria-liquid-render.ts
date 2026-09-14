// terraria-liquid-render.ts — Terraria's liquid renderer, ported (#90). A translation of Terraria 1.4.0.5's
// LiquidRenderer.InternalPrepareDraw and InternalDraw (decompiled), pass by pass, on DELVE's 8 art px cells:
// gap fill, the waterfall trail, walls cropped toward neighbouring liquid, edge smoothing, the corner fixes,
// and a source rectangle into a liquid texture that sets where its edges show.
//
// Terraria's liquid texture is a 48×80 frame of 16 px tiles; DELVE draws its own at half the size, on the
// Resurrect 64 palette: the same regions and edges, a surface line on top edges, a light line on side edges, a
// tinted body darkened with depth. Liquid is drawn only inside its own cells, as Terraria draws it.
// See docs/FLUIDS.md, "Terraria's liquid".
import type { TerrariaLiquid } from '@delve/shared';
import { blend, type LiquidStyle, WATER_STYLE } from './liquid-render';

// LiquidRenderer.WATERFALL_LENGTH and DEFAULT_OPACITY, water then lava
const WATERFALL_LENGTH = [10, 3];
const DEFAULT_OPACITY = [0.6, 0.95];
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
  /** The inner of an edge's two pixels. */
  Light = 2,
  /** The outer pixel of an edge. */
  Surface = 3,
}

/** Frames of the texture's animation (LiquidRenderer.ANIMATION_FRAME_COUNT), and how fast they turn without wind. */
const ANIMATION_FRAMES = 16;
const ANIMATION_FRAMES_PER_SECOND = 6;
/** The texture's surface frame sits under the animation: IsSurfaceLiquid tiles draw from here, unanimated. */
const SURFACE_FRAME_Y = 1280;
/** Terraria's liquid texture is pixel art drawn at 2×: one of its pixels is two units, one DELVE art pixel. */
const UNITS_PER_PIXEL = 2;

/** Farther from any edge than the shimmer reaches. */
const DEEP = 99;

const hashPixel = (x: number, y: number): number => {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return Math.imul(h, 1103515245) >>> 0;
};

/**
 * DELVE's liquid texture, on Terraria's layout (x, y in its pixels: 24 × 40 a frame, 8 a tile). Rows 0–2: an
 * edge block with rounded top corners, open at the bottom, with a narrow two-sided column (tiles (1,1)–(1,2))
 * cut into it. Row 3: the column's sides flaring into a surface line, for inner corners. Row 4: body. An edge is
 * two pixels: surface outside, light inside. The animation is a shimmer along the inside of each edge.
 */
export function texel(x: number, y: number, frame: number): Texel {
  if (y >= SURFACE_FRAME_Y / UNITS_PER_PIXEL) {
    const row = y - SURFACE_FRAME_Y / UNITS_PER_PIXEL;
    if (x < 8 || x > 15 || row > 7) return Texel.Clear;
    return row === 0 ? Texel.Surface : row === 1 ? Texel.Light : Texel.Body;
  }
  const localY = y % 40;
  let kind: Texel;
  let edgeDistance: number; // pixels in from the nearest edge
  if (localY < 24) {
    if (x >= 8 && x <= 15 && localY >= 8) {
      // the narrow column
      const sideX = Math.min(x - 8, 15 - x);
      const topY = localY - 8;
      if (sideX + topY < 2) return Texel.Clear;
      edgeDistance = Math.min(sideX, topY, sideX + topY - 2);
    } else {
      const sideX = x < 8 ? x : x > 15 ? 23 - x : 8;
      if (sideX + localY < 2) return Texel.Clear;
      edgeDistance = Math.min(sideX, localY, sideX + localY - 2);
    }
  } else if (localY < 32) {
    // inner corners: the column's sides, flaring into a surface line at row 30
    const row = localY - 24;
    const sideX = Math.min(x - 6, 17 - x);
    if (row < 6) {
      if (sideX < 0) return Texel.Clear;
      edgeDistance = sideX;
    } else if (row === 6) {
      edgeDistance = sideX >= 0 ? Math.max(1, sideX) : 0;
    } else {
      edgeDistance = sideX >= 0 ? DEEP : 1;
    }
  } else {
    edgeDistance = DEEP;
  }
  if (edgeDistance <= 0) kind = Texel.Surface;
  else if (edgeDistance === 1) kind = Texel.Light;
  else kind = Texel.Body;
  // the shimmer, in the edge block: now and then a light pixel just inside an edge, drifting a pixel a frame
  if (
    localY < 24 &&
    kind === Texel.Body &&
    edgeDistance === 2 &&
    hashPixel((x + frame) % 24, localY) % 7 === 0
  ) {
    kind = Texel.Light;
  }
  return kind;
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

/** Draw the liquid into `pixels` (RGBA, rock already drawn), as Terraria's LiquidRenderer draws it. */
export function drawTerrariaLiquid(
  frame: TerrariaLiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { liquid, cell, open, width, height, originY } = frame;
  const draw = prepareLiquidDraw(liquid, Math.floor(originY / cell));
  const scale = TILE / cell; // Terraria units per art px
  const baseOpacity = DEFAULT_OPACITY[liquid.kind];
  const frameNumber = Math.floor(frame.time * ANIMATION_FRAMES_PER_SECOND) % ANIMATION_FRAMES;
  // what each art pixel shows: its texel, and the opacity it's drawn at
  const shown = new Uint8Array(width * height);
  const pixelOpacity = new Float32Array(width * height);
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      const index = row * liquid.width + column;
      if (!draw.visible[index]) continue;
      const sourceX = draw.sourceX[index];
      // InternalDraw: surface liquid draws from the surface frame, everything else from this animation frame
      const sourceY = draw.surface[index]
        ? SURFACE_FRAME_Y
        : draw.sourceY[index] + frameNumber * 80;
      const opacity = Math.min(1, draw.opacity[index] * baseOpacity);
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
          if (x >= width || y >= height || !open[y * width + x]) continue;
          shown[y * width + x] = kind;
          pixelOpacity[y * width + x] = opacity;
        }
      }
    }
  }
  // paint: the whole sprite at one opacity, as a tinted, faded sprite batch draws it
  for (let pixel = 0; pixel < width * height; pixel++) {
    const kind = shown[pixel];
    if (kind === Texel.Clear) continue;
    const colour =
      kind === Texel.Surface ? style.surface : kind === Texel.Light ? style.light : style.mid;
    blend(pixels, pixel * 4, colour, pixelOpacity[pixel]);
  }
}
