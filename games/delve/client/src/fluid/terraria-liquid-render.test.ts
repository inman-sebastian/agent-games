// terraria-liquid-render.test.ts — how often the liquid picture changes (#90). Terraria renders its water into
// a render target on one frame in four (Main.renderCount, advanced by the lighting pass), at 60 frames a second
// with liquid every second frame: the picture refreshes every second liquid update, always at the same point of
// the update cycle. A stream over a lip alternates between two states update to update; shown every update, it
// flickers where it leaves one pool and enters the next.
import { describe, it, expect } from 'vitest';
import { createTerrariaLiquid } from '@delve/shared';
import { drawTerrariaLiquid } from './terraria-liquid-render';

const CELL = 8;

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
});
