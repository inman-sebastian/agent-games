// terraria-liquid-render.test.ts — how often the liquid picture changes (#90). Terraria renders its water into
// a render target on one frame in four (Main.renderCount, advanced by the lighting pass), at 60 frames a second
// with liquid every second frame: the picture refreshes every second liquid update, always at the same point of
// the update cycle. A stream over a lip alternates between two states update to update; shown every update, it
// flickers where it leaves one pool and enters the next.
import { describe, it, expect } from 'vitest';
import {
  createTerrariaLiquid,
  LIQUID_LAVA,
  LIQUID_WATER,
  type TerrariaLiquid,
} from '@delve/shared';
import { drawTerrariaLiquid, liquidLights, texel, Texel } from './terraria-liquid-render';
import { LAVA_STYLE, WATER_STYLE, type LiquidStyle } from './liquid-render';

const CELL = 8;

/** '#' rock, '~' full, '.' open: a liquid with every wet tile on the list, as a scene starts. */
function scene(rows: string[], kind = LIQUID_WATER): TerrariaLiquid {
  const width = rows[0].length;
  const height = rows.length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, y) =>
    [...line].forEach((c, x) => (solid[y * width + x] = c === '#' ? 1 : 0)),
  );
  const liquid = createTerrariaLiquid(width, height, solid, kind);
  rows.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (c === '~') liquid.level[y * width + x] = 255;
    }),
  );
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++)
      if (liquid.level[y * width + x]) liquid.addWater(y * width + x);
  }
  return liquid;
}

/** Draw over a cave wall of two tones (dark blotches on a lighter wall), as the lab's background has. */
function drawOverWall(liquid: TerrariaLiquid, style: LiquidStyle): Uint8ClampedArray {
  const width = liquid.width * CELL;
  const height = liquid.height * CELL;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const dark = ((pixel % width) >> 3) % 3 === 0;
    pixels.set(dark ? [38, 34, 46, 255] : [70, 64, 82, 255], pixel * 4);
  }
  const open = new Uint8Array(width * height).fill(1);
  drawTerrariaLiquid(
    { liquid, cell: CELL, open, width, height, originX: 0, originY: 0, time: 0 },
    pixels,
    style,
  );
  return pixels;
}

describe('the liquid picture', () => {
  it('refreshes every second liquid update, so a stream over a lip never flickers', () => {
    // a reservoir whose wall's top half is gone: it pours over what's left into the right-hand side
    const rows = [
      '########################',
      '#........#.............#',
      '#~~~~~~~~..............#',
      '#~~~~~~~~..............#',
      '#~~~~~~~~..............#',
      '#~~~~~~~~#.............#',
      '#~~~~~~~~#.............#',
      '#~~~~~~~~#.............#',
      '#~~~~~~~~#.............#',
      '#~~~~~~~~#.............#',
      '########################',
    ];
    const width = rows[0].length;
    const height = rows.length;
    const solid = new Uint8Array(width * height);
    rows.forEach((line, y) =>
      [...line].forEach((c, x) => (solid[y * width + x] = c === '#' ? 1 : 0)),
    );
    const liquid = createTerrariaLiquid(width, height, solid);
    rows.forEach((line, y) =>
      [...line].forEach((c, x) => {
        if (c === '~') liquid.level[y * width + x] = 255;
      }),
    );
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++)
        if (liquid.level[y * width + x]) liquid.addWater(y * width + x);
    }
    const open = new Uint8Array(width * CELL * height * CELL).fill(1);
    const picture = (): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(width * CELL * height * CELL * 4);
      drawTerrariaLiquid(
        {
          liquid,
          cell: CELL,
          open,
          width: width * CELL,
          height: height * CELL,
          originX: 0,
          originY: 0,
          time: 0,
        },
        pixels,
      );
      return pixels;
    };
    let previous = picture();
    let refreshed = 0;
    for (let update = 1; update <= 120; update++) {
      liquid.step();
      // two frames drawn per update, as at 60 frames a second
      picture();
      const now = picture();
      const same = now.every((value, index) => value === previous[index]);
      if (update % 2 === 1) expect(same, `picture changed after update ${update}`).toBe(true);
      else if (!same) refreshed++;
      previous = now;
    }
    // and it does move: the flow is drawn, every second update
    expect(refreshed).toBeGreaterThan(20);
  });

  it('draws liquid only where there is liquid: no fading trail into the air below a fall', () => {
    const liquid = scene([
      '##########',
      '#...~~...#',
      '#...~~...#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '#........#',
      '##########',
    ]);
    liquid.step();
    liquid.step();
    const pixels = drawOverWall(liquid, WATER_STYLE);
    const background = (index: number): boolean =>
      [
        [38, 34, 46],
        [70, 64, 82],
      ].some(
        (c) => c[0] === pixels[index] && c[1] === pixels[index + 1] && c[2] === pixels[index + 2],
      );
    const width = liquid.width * CELL;
    for (let row = 0; row < liquid.height; row++) {
      const wet = Array.from(
        { length: liquid.width },
        (_, x) => liquid.level[row * liquid.width + x],
      ).some((level) => level > 0);
      if (wet) continue;
      // a dry row (the trail's) is untouched: every pixel still the wall
      for (let y = row * CELL; y < (row + 1) * CELL; y++) {
        for (let x = 0; x < width; x++)
          expect(background((y * width + x) * 4), `${x},${y}`).toBe(true);
      }
    }
  });

  it('fills a gap inside a falling stream, where the trail bridges liquid above and below', () => {
    const liquid = scene(['#####', '##~##', '##.##', '##.##', '##~##', '##.##', '##.##', '#####']);
    const pixels = drawOverWall(liquid, WATER_STYLE);
    const width = liquid.width * CELL;
    const painted = (x: number, y: number): boolean => {
      const index = (y * width + x) * 4;
      const wall = [
        [38, 34, 46],
        [70, 64, 82],
      ];
      return !wall.some(
        (c) => c[0] === pixels[index] && c[1] === pixels[index + 1] && c[2] === pixels[index + 2],
      );
    };
    // the two-tile gap (rows 2–3) is drawn through the middle of the column; the tail below (rows 5–6) isn't
    const middle = 2 * CELL + (CELL >> 1);
    expect(painted(middle, 2 * CELL + 4)).toBe(true);
    expect(painted(middle, 3 * CELL + 4)).toBe(true);
    expect(painted(middle, 5 * CELL + 4)).toBe(false);
    expect(painted(middle, 6 * CELL + 4)).toBe(false);
  });

  it('paints only whole palette colours, water and lava alike', () => {
    for (const [kind, style] of [
      [LIQUID_WATER, WATER_STYLE],
      [LIQUID_LAVA, LAVA_STYLE],
    ] as const) {
      const liquid = scene(
        [
          '############',
          '#~~~~#.....#',
          '#~~~~#.....#',
          '#~~~~......#',
          '#~~~~......#',
          '############',
        ],
        kind,
      );
      for (let k = 0; k < 20; k++) liquid.step();
      const pixels = drawOverWall(liquid, style);
      const allowed = new Set(
        [
          style.deep,
          style.body,
          style.mid,
          style.light,
          style.surface,
          [38, 34, 46],
          [70, 64, 82],
        ].map((c) => c.join(',')),
      );
      for (let index = 0; index < pixels.length; index += 4) {
        const colour = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
        expect(allowed.has(colour), `${colour} at pixel ${index / 4}`).toBe(true);
      }
    }
  });

  it('tells a top edge from a side edge, so the rim can be top-lit', () => {
    expect(texel(12, 0, 0)).toBe(Texel.TopOuter);
    expect(texel(12, 1, 0)).toBe(Texel.TopInner);
    expect(texel(0, 12, 0)).toBe(Texel.SideOuter);
    expect(texel(1, 12, 0)).toBe(Texel.SideInner);
    expect(texel(23, 12, 0)).toBe(Texel.SideOuter);
    // the surface frame is a top edge
    expect(texel(12, 640, 0)).toBe(Texel.TopOuter);
  });

  it('lights lava where it meets the air, not inside the pool', () => {
    const liquid = scene(
      ['#########', '#.......#', '#~~~~~~~#', '#~~~~~~~#', '#~~~~~~~#', '#########'],
      LIQUID_LAVA,
    );
    const lights = liquidLights(liquid);
    const rows = new Set(lights.map((light) => light.row));
    expect([...rows]).toEqual([2]);
    expect(lights.length).toBe(7);
    // water casts none
    expect(liquidLights(scene(['###', '#.#', '#~#', '###']))).toEqual([]);
  });
});
