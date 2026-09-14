// bodies.test.ts — surface water's bodies (#89, step 2): flat levels from volume, spills, drains, merges.
// Volume is a whole number of pixels, so every check of conservation is exact.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createWaterSim, WATER } from './bodies';

/** A grid from rows of text: '#' rock, anything else open. Returns open = 1. */
function grid(rows: string[]): { width: number; height: number; open: Uint8Array } {
  const height = rows.length;
  const width = rows[0].length;
  const open = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((c, x) => (open[y * width + x] = c === '#' ? 0 : 1)));
  return { width, height, open };
}

const run = (sim: ReturnType<typeof createWaterSim>, seconds: number, check?: () => void): void => {
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    sim.step(1 / 60);
    check?.();
  }
};

describe('surface water bodies', () => {
  it('fills a basin flat from the bottom: the level is where the volume reaches', () => {
    const { width, height, open } = grid([
      '#............#',
      '#............#',
      '#............#',
      '#............#',
      '##############',
    ]);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 6, 0, 30); // 12 wide: two full rows and six in the third
    expect(sim.bodies).toHaveLength(1);
    const body = sim.bodies[0];
    expect(sim.levelOf(body)).toBe(1);
    let covered = 0;
    for (let i = 0; i < width * height; i++) if (sim.bodyAt(i)) covered++;
    expect(covered).toBe(30);
    // every pixel in the bottom two rows is liquid
    for (let x = 1; x < 13; x++) {
      expect(sim.bodyAt(3 * width + x)).not.toBeNull();
      expect(sim.bodyAt(2 * width + x)).not.toBeNull();
    }
  });

  it('overflows its rim as a stream into the next basin, conserving every pixel', () => {
    // basins deeper than PIT_DEPTH, so the right one is a way down, not a pit in the left one's floor
    const { width, height, open } = grid([
      '#...............#',
      '#......#........#',
      '#......#........#',
      '#......#........#',
      '#......#........#',
      '#......#........#',
      '#......#........#',
      '#################',
    ]);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 3, 0, 36 + 20); // the left basin holds 6 × 6 = 36 below its rim
    const total = sim.total(WATER);
    let sawStream = false;
    run(sim, 2, () => {
      expect(sim.total(WATER)).toBe(total);
      if (sim.streams.length > 0) sawStream = true;
    });
    expect(sawStream).toBe(true);
    const left = sim.bodyAt(6 * width + 3)!;
    const right = sim.bodyAt(6 * width + 12)!;
    expect(left).not.toBe(right);
    expect(left.volume).toBe(36);
    expect(right.volume).toBe(20);
  });

  it('drains a pool through a hole dug in its floor into the cave below', () => {
    const rows = [
      '#........#',
      '#........#',
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '##########',
    ];
    const { width, height, open } = grid(rows);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 4, 0, 16); // fills the upper pool
    expect(sim.bodies).toHaveLength(1);
    // dig through the floor
    const dug = open.slice();
    dug[2 * width + 4] = 1;
    sim.setOpen(dug);
    run(sim, 2, () => expect(sim.total(WATER)).toBe(16));
    // all but what sits below the hole's rim has run down: the lower cave holds it, flat
    const lower = sim.bodyAt(5 * width + 4)!;
    expect(lower).not.toBeNull();
    expect(lower.volume).toBeGreaterThanOrEqual(15);
    expect(sim.levelOf(lower)).toBe(4);
  });

  it('merges two pools into one level when a dig joins them below their surfaces', () => {
    const { width, height, open } = grid([
      '#.....#.....#',
      '#.....#.....#',
      '#.....#.....#',
      '#.....#.....#',
      '#############',
    ]);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 3, 0, 15); // left: three rows
    sim.add(WATER, 9, 0, 5); // right: one row
    expect(sim.bodies).toHaveLength(2);
    const dug = open.slice();
    dug[3 * width + 6] = 1; // a hole through the wall at the bottom
    sim.setOpen(dug);
    run(sim, 2, () => expect(sim.total(WATER)).toBe(20));
    expect(sim.bodies).toHaveLength(1);
    // one level across both: 20 pixels over 11 columns = one full row, nine of the next
    const body = sim.bodies[0];
    expect(sim.levelOf(body)).toBe(2);
  });

  it('settles into one flat pool over a bumpy floor, instead of dips spilling into each other forever', () => {
    const { width, height, open } = grid([
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#.#..#.##.#..#.#',
      '################',
    ]);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 3, 0, 40);
    run(sim, 2, () => expect(sim.total(WATER)).toBe(40));
    expect(sim.bodies).toHaveLength(1);
    expect(sim.streams).toHaveLength(0);
    // 8 dip pixels in the bumpy row, then 14 per row above: 40 = 8 + 14 + 14 + 4
    expect(sim.levelOf(sim.bodies[0])).toBe(1);
  });

  it('joins two full basins into one pool once the water stands above the rim between them', () => {
    const { width, height, open } = grid([
      '#.............#',
      '#.............#',
      '#.............#',
      '#......#......#',
      '#......#......#',
      '#......#......#',
      '#......#......#',
      '#......#......#',
      '#......#......#',
      '###############',
    ]);
    const sim = createWaterSim(width, height, open);
    // each basin holds 6 × 6 = 36 below the rim; 80 fills both and 8 more above it, across all 13 columns
    sim.add(WATER, 3, 0, 80);
    run(sim, 3, () => expect(sim.total(WATER)).toBe(80));
    expect(sim.bodies).toHaveLength(1);
    expect(sim.streams).toHaveLength(0);
    expect(sim.levelOf(sim.bodies[0])).toBe(2);
  });

  it('pours past the little ledges on a wall face instead of pooling on each one', () => {
    // a basin that overflows its right rim down a shaft whose left wall has one-pixel bumps
    const width = 24;
    const height = 40;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const basin = y < 10 && x >= 1 && x < 10;
        const rim = y < 4 && x >= 10 && x < 13;
        const shaft = y < 32 && x >= 13 && x < 18;
        const bump = x === 13 && y > 6 && y % 6 === 0; // ledges sticking out of the wall face
        const floor = y >= 32 && y < 39 && x >= 1 && x < 23;
        row += (basin || rim || shaft || floor) && !bump ? '.' : '#';
      }
      rows.push(row);
    }
    const { open } = grid(rows);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 5, 0, 200);
    let streamed = false;
    run(sim, 3, () => {
      expect(sim.total(WATER)).toBe(200);
      if (sim.streams.length > 0) streamed = true;
      // IN MOTION: no pool ever sits on a ledge in the shaft (x 13–17, above the floor at row 32)
      for (const body of sim.bodies) {
        for (const seed of body.seeds) {
          const x = seed % width;
          const y = Math.floor(seed / width);
          expect(x >= 13 && x < 18 && y < 32, `a pool on a ledge at ${x},${y}`).toBe(false);
        }
      }
    });
    expect(streamed).toBe(true);
  });

  it('never has two bodies stacked in one column: a pool draining into the shaft below it joins what rises to meet it', () => {
    // a pool 40 wide over a 1-wide, 20-deep shaft into a cave that can't hold all of it, so the water rises
    // back up the shaft into the pool — large enough that the stream rate spans many steps
    const width = 44;
    const height = 44;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const pool = y < 12 && x >= 2 && x < 42;
        const shaft = y >= 12 && y < 32 && x === 21;
        const cave = y >= 32 && y < 42 && x >= 12 && x < 32;
        row += pool || shaft || cave ? '.' : '#';
      }
      rows.push(row);
    }
    const { open } = grid(rows);
    const sealed = open.slice();
    for (let y = 12; y < 32; y++) sealed[y * width + 21] = 0; // the shaft starts sealed
    const sim = createWaterSim(width, height, sealed);
    sim.add(WATER, 20, 0, 400); // the pool: ten rows of forty
    sim.setOpen(open); // dig the shaft
    run(sim, 6, () => {
      expect(sim.total(WATER)).toBe(400);
      // IN MOTION: one body's water never sits directly on another's in the same column
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
          const above = sim.bodyAt(y * width + x);
          const below = sim.bodyAt((y + 1) * width + x);
          if (above && below) expect(above.id, `bodies stacked at ${x},${y}`).toBe(below.id);
        }
      }
    });
    expect(sim.bodies).toHaveLength(1);
    expect(sim.streams).toHaveLength(0);
  });

  it('draws a pool that is pouring away through a hole in its floor until it has drained, instead of vanishing', () => {
    const width = 30;
    const height = 30;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const pool = y < 10 && x >= 1 && x < 29;
        const shaft = y >= 10 && y < 18 && x === 15;
        const cave = y >= 18 && y < 29 && x >= 1 && x < 29;
        row += pool || shaft || cave ? '.' : '#';
      }
      rows.push(row);
    }
    const { open } = grid(rows);
    const sealed = open.slice();
    for (let y = 10; y < 18; y++) sealed[y * width + 15] = 0;
    const sim = createWaterSim(width, height, sealed);
    sim.add(WATER, 10, 0, 140); // the pool: five rows of twenty-eight
    sim.setOpen(open); // the floor is breached: the pool's basin can hold nothing now
    sim.step(1 / 60);
    // the pool's water is still drawn in the pool, near its old surface, while it drains
    expect(sim.bodyAt(6 * width + 5)).not.toBeNull();
    run(sim, 4, () => expect(sim.total(WATER)).toBe(140));
    // and once it has drained, it's gone from the pool and in the cave
    expect(sim.bodyAt(9 * width + 5)).toBeNull();
    expect(sim.bodyAt(28 * width + 5)).not.toBeNull();
  });

  it('never draws water standing on air: a pool pouring over a breached wall shows none past the rim', () => {
    // a full reservoir behind a wall, then the top half of the wall dug away: water pours over the stub, whose
    // top corner is chipped (as the rock mask rounds them) so the spill search meets a notch beside the lip
    const width = 40;
    const height = 30;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const edge = x === 0 || x === width - 1 || y === height - 1;
        const chipped = y === 15 && x >= 17;
        const wall = x >= 16 && x <= 18 && y >= 15 && !chipped;
        const bump = x === 19 && y === 20; // a knob on the wall's face, in the fall
        row += edge || wall || bump ? '#' : '.';
      }
      rows.push(row);
    }
    const { open } = grid(rows);
    const sealed = open.slice();
    for (let y = 2; y < 16; y++) for (let x = 16; x <= 18; x++) sealed[y * width + x] = 0;
    const sim = createWaterSim(width, height, sealed);
    sim.add(WATER, 5, 3, 15 * 26); // the reservoir, full to row 3
    sim.add(WATER, 30, 3, 20); // a puddle on the far floor, whose basin takes in the knob
    sim.setOpen(open);
    let streamed = false;
    sim.step(1 / 60);
    // the first pour runs off the knob and on down to the puddle (row 28), not stopping on the dry knob
    expect(Math.max(...sim.streams.map((stream) => stream.bottom))).toBe(28);
    run(sim, 2, () => {
      // the stream falls from the lip to the floor, never a zero-length stream on the notch
      for (const stream of sim.streams) {
        expect(stream.bottom, `a stream stuck at ${stream.x},${stream.top}`).toBeGreaterThan(
          stream.top,
        );
        streamed = true;
      }
      for (let i = 0; i < width * (height - 1); i++) {
        const body = sim.bodyAt(i);
        if (!body) continue;
        // held up by rock or by its own water below
        const below = i + width;
        expect(open[below] === 0 || sim.bodyAt(below) === body).toBe(true);
      }
    });
    expect(streamed).toBe(true);
    expect(sim.total(WATER)).toBe(15 * 26 + 20);
  });

  it('never counts a pixel twice in a basin, over any rough floor', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 20, maxLength: 20 }),
        (floor) => {
          const width = 22;
          const height = 16;
          const open = new Uint8Array(width * height);
          for (let x = 1; x < width - 1; x++)
            for (let y = 0; y < height - 1 - floor[x - 1]; y++) open[y * width + x] = 1;
          const sim = createWaterSim(width, height, open);
          sim.add(WATER, 10, 0, 60);
          for (const body of sim.bodies) {
            expect(new Set(body.fill).size).toBe(body.fill.length);
            expect(new Set(body.view).size).toBe(body.view.length);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is deterministic', () => {
    const make = () => {
      const { width, height, open } = grid([
        '#..........#',
        '#...#......#',
        '#...#......#',
        '############',
      ]);
      const sim = createWaterSim(width, height, open);
      sim.add(WATER, 2, 0, 20);
      run(sim, 1);
      return sim.bodies.map((body) => [body.volume, body.seeds, body.spill]);
    };
    expect(make()).toEqual(make());
  });
});
