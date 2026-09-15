// terraria-liquid-render.test.ts — how often the liquid picture changes (#90). Terraria renders its water into
// a render target on one frame in four (Main.renderCount, advanced by the lighting pass), at 60 frames a second
// with liquid every second frame: the picture refreshes every second liquid update, always at the same point of
// the update cycle. A stream over a lip alternates between two states update to update; shown every update, it
// flickers where it leaves one pool and enters the next.
import { describe, it, expect } from 'vitest';
import {
  createTerrariaLiquid,
  FULL,
  insideShape,
  OPEN,
  LIQUID_LAVA,
  LIQUID_WATER,
  type TerrariaLiquid,
} from '@delve/shared';
import {
  drawTerrariaLiquid,
  LAVA_BANDS,
  liquidLights,
  surfaceDistance,
  texel,
  Texel,
} from './terraria-liquid-render';
import { LAVA_STYLE, WATER_STYLE, type LiquidStyle } from './liquid-render';

const CELL = 8;

/** A cell's shape in a scene: '1'–'4' a slope, '#' full rock, anything else open. */
function shapeIn(rows: string[], column: number, row: number): number {
  const c = rows[row]?.[column] ?? '#';
  return c === '#' ? FULL : c >= '1' && c <= '4' ? Number(c) : OPEN;
}

/** '#' rock, '1'–'4' a slope, '~' full, '.' open: a liquid with every wet tile on the list, as a scene starts. */
function scene(rows: string[], kind = LIQUID_WATER): TerrariaLiquid {
  const width = rows[0].length;
  const height = rows.length;
  const solid = new Uint8Array(width * height);
  rows.forEach((line, y) =>
    [...line].forEach((_, x) => (solid[y * width + x] = shapeIn(rows, x, y) === OPEN ? 0 : 1)),
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
function drawOverWall(
  liquid: TerrariaLiquid,
  style: LiquidStyle,
  time = 0,
  rows?: string[],
): Uint8ClampedArray {
  const width = liquid.width * CELL;
  const height = liquid.height * CELL;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const dark = ((pixel % width) >> 3) % 3 === 0;
    pixels.set(dark ? [38, 34, 46, 255] : [70, 64, 82, 255], pixel * 4);
  }
  // the rock mask: open everywhere but the solid cells (a slope's solid half), as the lab's is
  const shapeAt = rows ? (column: number, row: number) => shapeIn(rows, column, row) : undefined;
  const open = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const column = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    const shape = shapeAt
      ? shapeAt(column, row)
      : liquid.isSolid(row * liquid.width + column)
        ? FULL
        : OPEN;
    open[pixel] = insideShape(shape, x - column * CELL, y - row * CELL, CELL) ? 0 : 1;
  }
  drawTerrariaLiquid(
    { liquid, cell: CELL, open, width, height, originX: 0, originY: 0, time, shapeAt },
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
          ...(kind === LIQUID_LAVA
            ? LAVA_BANDS
            : [style.deep, style.body, style.mid, style.light, style.surface]),
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

  it('draws lava as a molten surface: a calm dark body in its depths, and a hot top that moves', () => {
    const rows = ['##########', '#........#'];
    for (let row = 0; row < 18; row++) rows.push('#~~~~~~~~#');
    rows.push('##########');
    const liquid = scene(rows, LIQUID_LAVA);
    const width = liquid.width * CELL;
    const colourAt = (pixels: Uint8ClampedArray, x: number, y: number): string => {
      const index = (y * width + x) * 4;
      return `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
    };
    const early = drawOverWall(liquid, LAVA_STYLE, 0);
    // the depths: one colour almost everywhere — no dither checker, no busy grit
    const counts = new Map<string, number>();
    let total = 0;
    for (let y = 16 * CELL; y < 19 * CELL; y++) {
      for (let x = CELL; x < width - CELL; x++) {
        const colour = colourAt(early, x, y);
        counts.set(colour, (counts.get(colour) ?? 0) + 1);
        total++;
      }
    }
    expect(Math.max(...counts.values()) / total).toBeGreaterThan(0.85);
    // the hot top churns: a couple of seconds on, it has changed
    const later = drawOverWall(liquid, LAVA_STYLE, 2);
    let changed = 0;
    for (let y = 2 * CELL; y < 4 * CELL; y++) {
      for (let x = CELL; x < width - CELL; x++) {
        if (colourAt(early, x, y) !== colourAt(later, x, y)) changed++;
      }
    }
    expect(changed).toBeGreaterThan(20);
  });

  it("measures lava's heat from where the lava actually starts, not from the top of a partly filled tile", () => {
    const liquid = scene(
      ['##########', '#........#', '#~~~~~~~~#', '#~~~~~~~~#', '#~~~~~~~~#', '##########'],
      LIQUID_LAVA,
    );
    // the top row partly filled, to different heights
    [40, 90, 140, 200, 255, 120, 60, 180].forEach(
      (level, k) => (liquid.level[2 * liquid.width + 1 + k] = level),
    );
    const pixels = drawOverWall(liquid, LAVA_STYLE);
    const width = liquid.width * CELL;
    const hottest = LAVA_BANDS[LAVA_BANDS.length - 1].join(',');
    // the first lava pixel down each column is the hot rim, however full its tile
    for (let x = CELL; x < width - CELL; x++) {
      let y = 0;
      while (y < liquid.height * CELL) {
        const index = (y * width + x) * 4;
        if (
          LAVA_BANDS.some(
            (c) =>
              c[0] === pixels[index] && c[1] === pixels[index + 1] && c[2] === pixels[index + 2],
          )
        )
          break;
        y++;
      }
      const index = (y * width + x) * 4;
      expect(
        `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`,
        `column ${x}, row ${y}`,
      ).toBe(hottest);
    }
  });

  it("measures lava's heat as a distance to open air in 2D: smooth round corners, and never through rock", () => {
    // 0 air, 1 lava, 2 rock: a stepped surface over lava, and a rock wall with air only on its far side
    const map = [
      '000000000000',
      '111110000000',
      '111110000000',
      '111111110000',
      '111111112000',
      '111111112000',
      '111111112000',
    ];
    const width = map[0].length;
    const height = map.length;
    const air = new Uint8Array(width * height);
    const rock = new Uint8Array(width * height);
    map.forEach((line, y) =>
      [...line].forEach((c, x) => {
        air[y * width + x] = c === '0' ? 1 : 0;
        rock[y * width + x] = c === '2' ? 1 : 0;
      }),
    );
    const distance = surfaceDistance(air, rock, width, height, new Int32Array(width * height));
    const at = (x: number, y: number): number => distance[y * width + x];
    // no step of more than one between neighbours that aren't rock: no hard line anywhere
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rock[y * width + x]) continue;
        if (x + 1 < width && !rock[y * width + x + 1])
          expect(Math.abs(at(x, y) - at(x + 1, y))).toBeLessThanOrEqual(1);
        if (y + 1 < height && !rock[(y + 1) * width + x])
          expect(Math.abs(at(x, y) - at(x, y + 1))).toBeLessThanOrEqual(1);
      }
    }
    // right beside the rock wall, the lava is as far from air as its depth and the step allow — the air
    // on the wall's far side doesn't reach through
    expect(at(7, 6)).toBeGreaterThan(2);
  });

  it('measures heat along any path round rock: up over a wall and down behind it', () => {
    // 'a' air, '#' rock, '.' lava: the pocket right of the wall is reached only by going up, over and down
    const rows = [
      '............',
      '............',
      '...#........',
      '...#........',
      '...#........',
      '...#........',
      '...#........',
      'a..#........',
    ];
    const width = rows[0].length;
    const height = rows.length;
    const air = new Uint8Array(width * height);
    const rock = new Uint8Array(width * height);
    rows.forEach((line, y) =>
      [...line].forEach((c, x) => {
        air[y * width + x] = c === 'a' ? 1 : 0;
        rock[y * width + x] = c === '#' ? 1 : 0;
      }),
    );
    const distance = surfaceDistance(air, rock, width, height, new Int32Array(width * height));
    // up 6 to row 1, right 5, down 6
    expect(distance[7 * width + 5]).toBe(6 + 5 + 6);
  });

  it('edges a face toward open air even where Terraria left none for its trail', () => {
    // after one update the water has spread into a sheet (rows 1–2) over a gap-filled tile (3,3); the sheet's trail
    // falls either side of that tile, so Terraria gives it no side edges — and the trail isn't drawn
    const liquid = scene([
      '#######',
      '#..~..#',
      '#..~..#',
      '#..~..#',
      '#.....#',
      '#.....#',
      '#######',
    ]);
    liquid.step();
    const pixels = drawOverWall(liquid, WATER_STYLE);
    const width = liquid.width * CELL;
    const light = WATER_STYLE.light.join(',');
    const at = (x: number, y: number): string => {
      const index = (y * width + x) * 4;
      return `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
    };
    const y = 3 * CELL + 4;
    expect(at(3 * CELL, y), 'left face').toBe(light);
    expect(at(4 * CELL - 1, y), 'right face').toBe(light);
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

  describe('behind a slope (#95)', () => {
    /** Which of a cell's pixels the liquid painted over the wall. */
    const painted = (rows: string[], column: number, row: number): boolean[] => {
      const liquid = scene(rows);
      const before = drawOverWall(
        scene(rows.map((line) => line.replace(/~/g, '.'))),
        WATER_STYLE,
        0,
        rows,
      );
      const after = drawOverWall(liquid, WATER_STYLE, 0, rows);
      const width = liquid.width * CELL;
      const out: boolean[] = [];
      for (let py = 0; py < CELL; py++) {
        for (let px = 0; px < CELL; px++) {
          const index = ((row * CELL + py) * width + column * CELL + px) * 4;
          out.push(before[index] !== after[index] || before[index + 2] !== after[index + 2]);
        }
      }
      return out;
    };

    it("shows the pool through a slope's open half, and never in its solid half", () => {
      const rows = ['######', '#~~2.#', '#~~###', '######'];
      painted(rows, 3, 1).forEach((wet, i) => {
        const inSolid = insideShape(2, i % CELL, Math.floor(i / CELL), CELL);
        expect(wet, `pixel ${i % CELL},${Math.floor(i / CELL)}`).toBe(!inSolid);
      });
    });

    it('heats lava behind a slope like the lava beside it, not like rock', () => {
      const rows = ['#######', '#.....#', '#~~2..#', '#~~####', '#######'];
      const liquid = scene(rows, LIQUID_LAVA);
      const pixels = drawOverWall(liquid, LAVA_STYLE, 0, rows);
      const width = liquid.width * CELL;
      const hot = LAVA_BANDS.slice(-3).map((band) => band.join(','));
      // just under the surface, in the slope's open corner
      const index = ((2 * CELL + 3) * width + 3 * CELL + 1) * 4;
      expect(hot).toContain(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    });

    it('hides it in a ceiling slope with a dry open side, as Terraria does', () => {
      expect(painted(['######', '#~~4.#', '#~~###', '######'], 3, 1).some(Boolean)).toBe(false);
      expect(painted(['######', '#~~4##', '#~~###', '######'], 3, 1).some(Boolean)).toBe(true);
    });
  });
});
