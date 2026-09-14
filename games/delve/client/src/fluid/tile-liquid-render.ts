// tile-liquid-render.ts — draws the tile liquid (#90) on the art grid. Pools are flat: a cell under liquid is
// full, a surface cell draws its row's shared level as one straight line. Falling liquid is a stream as wide as
// its level, reaching down to the surface it lands on. See docs/FLUIDS.md, "Tile liquid".
import type { TileLiquid } from '@delve/shared';
import { BAYER, blend, type LiquidStyle, WATER_STYLE } from './liquid-render';

const FULL = 255;
/** Body opacity, water then lava. */
const OPACITY = [0.6, 0.95];
/** A stream is never thinner than this, in art px. */
const MIN_STREAM = 2;

export interface TileLiquidFrame {
  readonly liquid: TileLiquid;
  /** Art px per cell. */
  readonly cell: number;
  /** Per art pixel: 1 where the rock mask is open. */
  readonly open: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

const enum Shown {
  Nothing = 0,
  Body = 1,
  Surface = 2,
  Stream = 3,
  StreamSide = 4,
}

export function drawTileLiquid(
  frame: TileLiquidFrame,
  pixels: Uint8ClampedArray,
  style: LiquidStyle = WATER_STYLE,
): void {
  const { liquid, cell, open, width, height, originX, originY } = frame;
  const { level, resting } = liquid;
  const columns = liquid.width;
  const rows = liquid.height;
  const wet = (column: number, row: number): boolean =>
    column >= 0 && row >= 0 && column < columns && row < rows && level[row * columns + column] > 0;
  const restingWet = (column: number, row: number): boolean =>
    wet(column, row) && resting[row * columns + column] === 1;
  /** Part of a pool: resting, or a hole between resting liquid. */
  const pooled = (column: number, row: number): boolean =>
    restingWet(column, row) ||
    (wet(column, row) && restingWet(column - 1, row) && restingWet(column + 1, row));
  const streamWidth = (index: number): number =>
    Math.max(MIN_STREAM, Math.min(cell, Math.round((level[index] * cell) / FULL)));

  const shown = new Uint8Array(width * height);
  const put = (x: number, y: number, kind: Shown): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (open[pixel]) shown[pixel] = kind;
  };
  /** Each column's stream width in the row above, 0 where there was none: a stream only widens as it falls. */
  const carried = new Int32Array(columns);
  const drawStream = (
    column: number,
    row: number,
    streamPixels: number,
    top: number,
    bottom: number,
  ): void => {
    const left = column * cell + ((cell - streamPixels) >> 1);
    for (let py = top; py < bottom; py++) {
      for (let px = 0; px < streamPixels; px++) {
        const side = streamPixels > MIN_STREAM && (px === 0 || px === streamPixels - 1);
        put(left + px, row * cell + py, side ? Shown.StreamSide : Shown.Stream);
      }
    }
  };

  for (let row = 0; row < rows; row++) {
    let column = 0;
    while (column < columns) {
      const index = row * columns + column;
      if (!wet(column, row)) {
        carried[column] = 0;
        column++;
        continue;
      }
      if (!pooled(column, row)) {
        carried[column] = Math.max(carried[column], streamWidth(index));
        drawStream(column, row, carried[column], 0, cell);
        column++;
        continue;
      }
      if (pooled(column, row - 1)) {
        for (let py = 0; py < cell; py++)
          for (let px = 0; px < cell; px++) put(column * cell + px, row * cell + py, Shown.Body);
        carried[column] = 0;
        column++;
        continue;
      }
      // a run of surface cells: one level, one straight line
      const start = column;
      let sum = 0;
      while (column < columns && pooled(column, row) && !pooled(column, row - 1)) {
        sum += level[row * columns + column];
        column++;
      }
      const mean = sum / (column - start);
      const surfaceHeight = Math.max(1, Math.min(cell, Math.round((mean * cell) / FULL)));
      for (let c = start; c < column; c++) {
        for (let py = cell - surfaceHeight; py < cell; py++) {
          for (let px = 0; px < cell; px++) {
            put(
              c * cell + px,
              row * cell + py,
              py === cell - surfaceHeight ? Shown.Surface : Shown.Body,
            );
          }
        }
        if (carried[c] > 0) drawStream(c, row, carried[c], 0, cell - surfaceHeight);
        carried[c] = 0;
      }
    }
  }

  // paint, darkening the pool body by dither with depth below its surface
  const opacity = OPACITY[liquid.kind] ?? OPACITY[0];
  for (let x = 0; x < width; x++) {
    let depth = 0;
    for (let y = 0; y < height; y++) {
      const pixel = y * width + x;
      const kind = shown[pixel];
      const offset = pixel * 4;
      if (kind !== Shown.Body) depth = 0;
      if (kind === Shown.Nothing) continue;
      if (kind === Shown.Surface) {
        blend(pixels, offset, style.surface, 1);
      } else if (kind === Shown.StreamSide) {
        blend(pixels, offset, style.light, 0.8);
      } else {
        blend(pixels, offset, style.mid, opacity);
        if (kind === Shown.Body) {
          depth++;
          const darkness = Math.min(1, depth / style.depthRange);
          const threshold = (BAYER[((originY + y) & 3) * 4 + ((originX + x) & 3)] + 0.5) / 16;
          if (darkness > threshold) blend(pixels, offset, style.deep, 0.5);
        }
      }
    }
  }
}
