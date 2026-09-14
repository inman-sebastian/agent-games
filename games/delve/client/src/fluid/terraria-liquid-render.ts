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
import { BAYER, blend, type LiquidStyle, WATER_STYLE } from './liquid-render';

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

/** InternalPrepareDraw's passes. Outside the grid reads as solid rock with no liquid. */
function prepare(liquid: TerrariaLiquid): Cache {
  const { width, height } = liquid;
  const cache = new Cache(width * height);
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
      if (frameY === 16 && hasLeft !== hasRight && y % 2 === 0) frameY += 16;
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

const enum Texel {
  Body = 0,
  /** An edge along the top of the liquid: the surface. */
  Top = 1,
  /** An edge along a side. */
  Side = 2,
}

/**
 * DELVE's liquid texture, laid out like Terraria's 48×80 frame (u, v in its 16 px tile units): a block of
 * edge tiles three wide and three tall with a narrow two-sided column in its middle, and under it the
 * inner-corner tiles and plain body. An edge is a line one texel wide where Terraria's frame has one.
 */
function texel(u: number, v: number): Texel {
  const column = Math.floor(u / TILE);
  const row = Math.floor(v / TILE);
  const localU = u - column * TILE;
  const localV = v - row * TILE;
  const edgeWidth = 2; // one DELVE art px, in Terraria's 16 px units
  if (row <= 2) {
    const narrow = column === 1 && row >= 1;
    if (narrow) {
      if (row === 1 && localV < edgeWidth) return Texel.Top;
      if (localU < edgeWidth || localU >= TILE - edgeWidth) return Texel.Side;
      return Texel.Body;
    }
    if (row === 0 && localV < edgeWidth) return Texel.Top;
    if (column === 0 && localU < edgeWidth) return Texel.Side;
    if (column === 2 && localU >= TILE - edgeWidth) return Texel.Side;
    return Texel.Body;
  }
  if (row === 3) {
    // inner corners: the side of the column above meeting the top of the body beside it
    if (column === 0 && localU >= TILE - edgeWidth) return Texel.Side;
    if (column === 2 && localU < edgeWidth) return Texel.Side;
    if (column !== 1 && localV >= TILE - edgeWidth) return Texel.Top;
  }
  return Texel.Body;
}

/** Draw the liquid into `pixels` (RGBA, rock already drawn), as Terraria's LiquidRenderer draws it. */
export function drawTerrariaLiquid(
  frame: TerrariaLiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { liquid, cell, open, width, height, originX, originY } = frame;
  const cache = prepare(liquid);
  const scale = TILE / cell; // Terraria units per art px
  const baseOpacity = DEFAULT_OPACITY[liquid.kind];
  // what each art pixel shows: its texel, and the opacity of the tile it belongs to
  const shown = new Int8Array(width * height).fill(-1);
  const pixelOpacity = new Float32Array(width * height);
  const put = (x: number, y: number, kind: Texel, opacity: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (!open[pixel] || shown[pixel] >= 0) return;
    shown[pixel] = kind;
    pixelOpacity[pixel] = opacity;
  };
  for (let row = 0; row < liquid.height; row++) {
    for (let column = 0; column < liquid.width; column++) {
      const index = row * liquid.width + column;
      if (!cache.hasVisibleLiquid[index]) continue;
      const left = Math.min(0.75, cache.visibleLeftWall[index]);
      const right = Math.max(MIN_LIQUID_SIZE, cache.visibleRightWall[index]);
      const top = Math.min(0.75, cache.visibleTopWall[index]);
      const bottom = Math.max(MIN_LIQUID_SIZE, cache.visibleBottomWall[index]);
      const sourceX = Math.trunc(TILE - right * TILE) + cache.frameX[index];
      const sourceY = Math.trunc(TILE - bottom * TILE) + cache.frameY[index];
      const drawWidth = Math.ceil((right - left) * TILE);
      const drawHeight = Math.ceil((bottom - top) * TILE);
      const offsetX = Math.floor(left * TILE);
      const offsetY = Math.floor(top * TILE);
      const opacity = cache.opacity[index] * baseOpacity;
      for (let py = 0; py < cell; py++) {
        const centreY = (py + 0.5) * scale - offsetY;
        if (centreY < 0 || centreY >= drawHeight) continue;
        for (let px = 0; px < cell; px++) {
          const centreX = (px + 0.5) * scale - offsetX;
          if (centreX < 0 || centreX >= drawWidth) continue;
          const kind = texel(sourceX + Math.floor(centreX), sourceY + Math.floor(centreY));
          put(column * cell + px, row * cell + py, kind, opacity);
        }
      }
    }
  }
  // paint, darkening the body with depth below the top of each column of liquid
  for (let x = 0; x < width; x++) {
    let depth = 0;
    for (let y = 0; y < height; y++) {
      const pixel = y * width + x;
      const kind = shown[pixel];
      if (kind < 0) {
        depth = 0;
        continue;
      }
      depth++;
      const offset = pixel * 4;
      const opacity = pixelOpacity[pixel];
      if (kind === Texel.Top) {
        blend(pixels, offset, style.surface, Math.min(1, opacity / baseOpacity));
        continue;
      }
      if (kind === Texel.Side) {
        blend(pixels, offset, style.light, Math.min(1, (opacity / baseOpacity) * 0.8));
        continue;
      }
      blend(pixels, offset, style.mid, opacity);
      const worldX = originX + x;
      const worldY = originY + y;
      const darkness = Math.min(1, depth / style.depthRange);
      const threshold = (BAYER[(worldY & 3) * 4 + (worldX & 3)] + 0.5) / 16;
      if (darkness > threshold) blend(pixels, offset, style.deep, 0.5 * (opacity / baseOpacity));
    }
  }
}
