// bodies.test.ts — surface water's bodies (#89, step 2): flat levels from volume, spills, drains, merges.
// Volume is a whole number of pixels, so every check of conservation is exact.
import { describe, it, expect } from 'vitest';
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
    sim.snap();
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

  it('shows a pool drain into a basin it was just joined to, instead of teleporting to the new level', () => {
    const { width, height, open } = grid([
      '#.....................#',
      '#..........#..........#',
      '#..........#..........#',
      '#..........#..........#',
      '#..........#..........#',
      '#..........#..........#',
      '#..........#..........#',
      '#######################',
    ]);
    const sim = createWaterSim(width, height, open);
    sim.add(WATER, 5, 0, 60); // the left basin, 10 wide: six rows
    sim.snap();
    const dug = open.slice();
    for (let y = 4; y < 7; y++) dug[y * width + 11] = 1; // a breach at the bottom of the wall
    sim.setOpen(dug);
    const shownRight = (): number => {
      let count = 0;
      for (let y = 0; y < height; y++)
        for (let x = 12; x < 22; x++) if (sim.bodyAt(y * width + x)) count++;
      return count;
    };
    // the true state has already levelled; what's shown hasn't — it moves at the stream rate
    sim.step(1 / 60);
    expect(shownRight()).toBeLessThanOrEqual(Math.ceil(900 / 60));
    run(sim, 3, () => expect(sim.total(WATER)).toBe(60));
    // and it gets there: about half of the water on the right
    expect(shownRight()).toBeGreaterThan(20);
  });

  it('never shows two surfaces stacked in one column: a pool draining into the shaft below it joins what rises to meet it', () => {
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
    sim.snap();
    sim.setOpen(open); // dig the shaft
    run(sim, 6, () => {
      expect(sim.total(WATER)).toBe(400);
      // IN MOTION: shown water of one body never sits directly on another's in the same column
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
