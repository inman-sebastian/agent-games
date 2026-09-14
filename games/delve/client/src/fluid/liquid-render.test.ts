// liquid-render.test.ts — invariants of the liquid renderer (#90): it never paints rock, it draws a pool's
// outline where the water meets air, and a stream from a hole stays connected down to where it lands.
import { describe, it, expect } from 'vitest';
import { createLiquid, UNIT, WATER_PARAMS, type Liquid } from '@delve/shared';
import { drawLiquid, WATER_STYLE, type LiquidFrame } from './liquid-render';
import { drawLiquidTiles } from './liquid-render-tiles';

const CELL = 8;

/** A cell scene with a matching art-pixel mask (rock cells fully solid, no erosion). */
function scene(rows: string[]): { liquid: Liquid; frame: (time: number) => LiquidFrame } {
  const height = rows.length;
  const width = rows[0].length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => (solid[row * width + column] = c === '#' ? 1 : 0)),
  );
  const liquid = createLiquid(width, height, solid);
  rows.forEach((line, row) =>
    [...line].forEach((c, column) => {
      if (c === '~') liquid.add(row * width + column, UNIT);
    }),
  );
  const artWidth = width * CELL;
  const artHeight = height * CELL;
  const open = new Uint8Array(artWidth * artHeight);
  for (let y = 0; y < artHeight; y++)
    for (let x = 0; x < artWidth; x++)
      open[y * artWidth + x] = solid[Math.floor(y / CELL) * width + Math.floor(x / CELL)] ? 0 : 1;
  return {
    liquid,
    frame: (time) => ({
      liquid,
      cell: CELL,
      open,
      width: artWidth,
      height: artHeight,
      originX: 0,
      originY: 0,
      time,
    }),
  };
}

/** Rock grey everywhere, so any change is the renderer's. */
const ROCK: [number, number, number] = [98, 85, 101];
function blank(frame: LiquidFrame): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...ROCK, 255], i);
  return pixels;
}
const changed = (pixels: Uint8ClampedArray, index: number): boolean =>
  pixels[index * 4] !== ROCK[0] ||
  pixels[index * 4 + 1] !== ROCK[1] ||
  pixels[index * 4 + 2] !== ROCK[2];

function box(
  width: number,
  height: number,
  cell: (column: number, row: number) => string,
): string[] {
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) =>
      column === 0 || column === width - 1 || row === height - 1 ? '#' : cell(column, row),
    ).join(''),
  );
}

function run(liquid: Liquid, seconds: number): void {
  for (let k = 0; k < Math.round(seconds * WATER_PARAMS.substepsPerSecond); k++) liquid.step();
}

const RENDERERS = [
  ['smooth', drawLiquid],
  ['grid', drawLiquidTiles],
] as const;

describe.each(RENDERERS)('the %s liquid renderer', (_, drawLiquid) => {
  it('never paints rock, however the water moves', () => {
    const { liquid, frame } = scene(
      box(24, 16, (column, row) => (column === 10 ? '#' : column < 10 && row >= 3 ? '~' : '.')),
    );
    liquid.setSolid(8 * 24 + 10, false); // a gap in the wall
    for (let second = 0; second < 3; second++) {
      run(liquid, 0.5);
      const view = frame(second);
      const pixels = blank(view);
      drawLiquid(view, pixels, WATER_STYLE);
      for (let index = 0; index < view.width * view.height; index++) {
        if (view.open[index] === 0)
          expect(changed(pixels, index), `rock painted at ${index}`).toBe(false);
      }
    }
  });

  it("draws a still pool's surface as one opaque line of the surface colour", () => {
    const { liquid, frame } = scene(box(12, 8, (_, row) => (row >= 4 ? '~' : '.')));
    run(liquid, 2);
    const view = frame(0);
    const pixels = blank(view);
    drawLiquid(view, pixels, WATER_STYLE);
    // every open column has exactly one surface-coloured pixel at the top of its water
    for (let x = CELL; x < view.width - CELL; x++) {
      let surfaceRows = 0;
      for (let y = 0; y < view.height; y++) {
        const o = (y * view.width + x) * 4;
        const isSurface =
          pixels[o] === WATER_STYLE.surface[0] &&
          pixels[o + 1] === WATER_STYLE.surface[1] &&
          pixels[o + 2] === WATER_STYLE.surface[2];
        if (isSurface) surfaceRows++;
      }
      expect(surfaceRows, `column ${x}`).toBe(1);
    }
  });

  it('draws a stream from a hole connected all the way down to where it lands', () => {
    // a pool on a shelf with a hole in its floor over a tall empty shaft into a basin
    const { liquid, frame } = scene(
      box(15, 30, (column, row) => {
        if (row === 8) return column === 7 ? '.' : '#';
        if (row > 8 && row < 24 && column !== 7) return '#';
        return row >= 3 && row < 8 ? '~' : '.';
      }),
    );
    run(liquid, 0.8);
    const view = frame(0.8);
    const pixels = blank(view);
    drawLiquid(view, pixels, WATER_STYLE);
    // down the shaft (cell column 7), from the hole to the basin below, no art row without water drawn
    let firstWet = -1;
    let lastWet = -1;
    let dryRows = 0;
    for (let y = 9 * CELL; y < 24 * CELL; y++) {
      let wet = false;
      for (let x = 7 * CELL; x < 8 * CELL; x++) if (changed(pixels, y * view.width + x)) wet = true;
      if (wet) {
        if (firstWet < 0) firstWet = y;
        else if (lastWet >= 0 && y - lastWet > 1) dryRows += y - lastWet - 1;
        lastWet = y;
      }
    }
    expect(firstWet).toBeGreaterThanOrEqual(0);
    expect(dryRows).toBe(0);
    expect(lastWet - firstWet).toBeGreaterThan(10 * CELL);
  });
});
