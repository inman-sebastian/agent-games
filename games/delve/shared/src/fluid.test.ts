// fluid.test.ts — the whole-cell fluid automaton (#30) under fuzzing. Random terrain and random pours,
// asserting what must hold in every case: cells are conserved exactly, fluid never sits in rock, the
// step is deterministic, resting fluid is always supported, a closed basin settles flat, and fluid
// outside the active region freezes. See docs/FLUIDS.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newFluidField,
  pourFluid,
  stepFluid,
  wakeAround,
  fluidAt,
  fluidCount,
  fluidKey,
  columnOfKey,
  rowOfKey,
  type FluidField,
  type FluidKind,
  type SolidQuery,
} from './fluid';

const W = 16;
const H = 12;
const SETTLE_TICK_CAP = 5000;

/** A closed box: walls on every side, plus whatever interior rock the test adds. */
function boxSolid(rock: ReadonlySet<number>, width = W, height = H): SolidQuery {
  return (column, row) =>
    column < 0 || column >= width || row < 0 || row >= height || rock.has(fluidKey(column, row));
}

const cellArb = fc.record({
  c: fc.integer({ min: 0, max: W - 1 }),
  r: fc.integer({ min: 0, max: H - 1 }),
});

const rockArb = fc
  .array(cellArb, { maxLength: 40 })
  .map((cells) => new Set(cells.map(({ c, r }) => fluidKey(c, r))));

const pourArb = fc.array(
  fc.record({
    c: fc.integer({ min: 0, max: W - 1 }),
    r: fc.integer({ min: 0, max: H - 1 }),
    kind: fc.constantFrom<FluidKind>('water', 'lava'),
    atTick: fc.integer({ min: 0, max: 60 }),
  }),
  { minLength: 1, maxLength: 40 },
);

type Pour = { c: number; r: number; kind: FluidKind; atTick: number };

/** Run a scenario, handing each tick to `check`. Returns the field and how many cells of each kind went in. */
function run(
  rock: ReadonlySet<number>,
  pours: Pour[],
  ticks: number,
  check: (field: FluidField, poured: Record<FluidKind, number>) => void = () => {},
): { field: FluidField; poured: Record<FluidKind, number> } {
  const solid = boxSolid(rock);
  const field = newFluidField();
  const poured: Record<FluidKind, number> = { water: 0, lava: 0 };
  for (let tick = 0; tick < ticks; tick++) {
    for (const pour of pours) {
      if (pour.atTick !== tick) continue;
      if (pourFluid(field, pour.c, pour.r, pour.kind, solid)) poured[pour.kind]++;
    }
    stepFluid(field, solid);
    check(field, poured);
  }
  return { field, poured };
}

function settle(field: FluidField, solid: SolidQuery): number {
  let ticks = 0;
  while (field.active.size > 0 && ticks < SETTLE_TICK_CAP) {
    stepFluid(field, solid);
    ticks++;
  }
  return ticks;
}

const WIDE = 48;
const SHALLOW = 8;

/**
 * Pour `cells` of `kind` as a stream into one column of an empty box, settle, and require a flat pool:
 * every row under the top one full, the top row holding exactly the remainder, nothing above it.
 */
function expectSettlesFlat(
  kind: FluidKind,
  width: number,
  height: number,
  column: number,
  cells: number,
): void {
  const solid = boxSolid(new Set(), width, height);
  const field = newFluidField();
  let poured = 0;
  for (let tick = 0; poured < cells && tick < SETTLE_TICK_CAP * 4; tick++) {
    if (pourFluid(field, column, 0, kind, solid)) poured++;
    stepFluid(field, solid);
  }
  expect(poured).toBe(cells);
  const ticks = settle(field, solid);
  expect(field.active.size, `still moving after ${ticks} ticks`).toBe(0);

  const fullRows = Math.floor(cells / width);
  for (let row = height - 1; row >= height - fullRows; row--) {
    for (let c = 0; c < width; c++) {
      expect(fluidAt(field, c, row), `hole in full row ${row} at ${c}`).toBe(kind);
    }
  }
  const topRow = height - fullRows - 1;
  let inTopRow = 0;
  for (let c = 0; c < width; c++) if (fluidAt(field, c, topRow)) inTopRow++;
  expect(inTopRow, `top row ${topRow}`).toBe(cells % width);
  for (let row = 0; row < topRow; row++) {
    for (let c = 0; c < width; c++)
      expect(fluidAt(field, c, row), `above the pool at ${c},${row}`).toBeNull();
  }
}

function expectEachCellMovesOnce(width: number, height: number, pours: Pour[]): void {
  const solid = boxSolid(new Set(), width, height);
  const field = newFluidField();
  for (let tick = 0; tick < 160; tick++) {
    for (const pour of pours) {
      if (pour.atTick === tick) pourFluid(field, pour.c, pour.r, pour.kind, solid);
    }
    const { moves } = stepFluid(field, solid);
    const arrived = new Set<number>();
    for (const { from, to } of moves) {
      expect(arrived.has(from), `moved twice in one tick at tick ${tick}`).toBe(false);
      arrived.add(to);
    }
  }
}

describe('fluid invariants', () => {
  it('conserves cells exactly, every tick, for both kinds', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        run(rock, pours, 150, (field, poured) => {
          expect(fluidCount(field, 'water')).toBe(poured.water);
          expect(fluidCount(field, 'lava')).toBe(poured.lava);
        });
      }),
    );
  });

  it('never puts fluid in a solid cell', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        run(rock, pours, 150, (field) => {
          for (const key of field.cells.keys()) {
            const column = columnOfKey(key);
            const row = rowOfKey(key);
            expect(solid(column, row), `fluid in rock at ${column},${row}`).toBe(false);
          }
        });
      }),
    );
  });

  it('every move goes strictly down: total height never rises between pours', () => {
    // The termination argument (FLUIDS.md). A sideways move that isn't also a fall could let two
    // cells trade places forever; this is the property that rules it out.
    const heightOf = (field: FluidField): number => {
      let total = 0;
      for (const key of field.cells.keys()) total += rowOfKey(key);
      return total;
    };
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        const field = newFluidField();
        for (let tick = 0; tick < 150; tick++) {
          for (const pour of pours) {
            if (pour.atTick === tick) pourFluid(field, pour.c, pour.r, pour.kind, solid);
          }
          const before = heightOf(field);
          const { moves } = stepFluid(field, solid);
          // Rows grow downward, so the sum of rows grows by exactly one per row fallen.
          expect(heightOf(field)).toBeGreaterThanOrEqual(before);
          for (const { from, to } of moves) expect(rowOfKey(to)).toBeGreaterThan(rowOfKey(from));
        }
      }),
    );
  });

  it('a cell moves at most once per tick: nothing teleports by chaining moves', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        const field = newFluidField();
        for (let tick = 0; tick < 150; tick++) {
          for (const pour of pours) {
            if (pour.atTick === tick) pourFluid(field, pour.c, pour.r, pour.kind, solid);
          }
          const { moves } = stepFluid(field, solid);
          // In order: a move may start where an earlier move this tick LEFT (another cell arriving
          // there is fine), but never from a cell an earlier move this tick delivered.
          const arrived = new Set<number>();
          for (const { from, to } of moves) {
            expect(arrived.has(from), 'moved twice in one tick').toBe(false);
            arrived.add(to);
          }
        }
      }),
    );
  });

  it('nothing spreads into mid-air: a merge lands on support, or just past an edge it spills over', () => {
    // The fault behind the hanging wedge and the V under the shelf (docs/FLUIDS.md history, model 3).
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        const field = newFluidField();
        for (let tick = 0; tick < 150; tick++) {
          for (const pour of pours) {
            if (pour.atTick === tick) pourFluid(field, pour.c, pour.r, pour.kind, solid);
          }
          const before = new Map(field.cells);
          const { moves } = stepFluid(field, solid);
          for (const move of moves) {
            if (move.type !== 'merge') continue;
            const kind = field.cells.get(move.to);
            const column = columnOfKey(move.to);
            const row = rowOfKey(move.to);
            const supported = solid(column, row + 1) || field.cells.has(fluidKey(column, row + 1));
            const overhang = fluidKey(column, row - 1);
            const spill =
              !solid(column, row - 1) &&
              !before.has(overhang) &&
              (before.get(fluidKey(column - 1, row - 1)) === kind ||
                before.get(fluidKey(column + 1, row - 1)) === kind);
            expect(supported || spill, `merge into mid-air at ${column},${row}`).toBe(true);
          }
        }
      }),
    );
  });

  it('regression: a merge that lands above the processing row is not moved again that tick', () => {
    // Shrunk by fast-check from a dense fuzz with the arrival guards removed: a stream into one corner
    // of a 20x14 box. A merge can land ABOVE the row being processed, on a cell still waiting its turn,
    // and without the guard that cell moved twice in one tick.
    const width = 20;
    const height = 14;
    expectEachCellMovesOnce(width, height, [
      { c: 0, r: 0, kind: 'water', atTick: 0 },
      { c: 0, r: 1, kind: 'water', atTick: 0 },
      { c: 2, r: 0, kind: 'water', atTick: 1 },
      { c: 0, r: 0, kind: 'water', atTick: 2 },
      { c: 0, r: 0, kind: 'water', atTick: 3 },
      { c: 1, r: 3, kind: 'water', atTick: 5 },
    ]);
  });

  it('regression: a column top that arrived this tick is not lifted by a merge the same tick', () => {
    // The second shrunk case: streams into two corners. The merging cell had not moved, but the top of
    // its column had just been delivered by an earlier merge.
    expectEachCellMovesOnce(20, 14, [
      { c: 16, r: 0, kind: 'water', atTick: 0 },
      { c: 0, r: 0, kind: 'water', atTick: 0 },
      { c: 17, r: 0, kind: 'water', atTick: 0 },
      { c: 16, r: 0, kind: 'water', atTick: 1 },
      { c: 16, r: 1, kind: 'water', atTick: 3 },
    ]);
  });

  it('is deterministic: the same scenario gives the same field', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const a = run(rock, pours, 120).field;
        const b = run(rock, pours, 120).field;
        expect([...a.cells]).toEqual([...b.cells]);
        expect([...a.active].sort()).toEqual([...b.active].sort());
      }),
    );
  });
});

describe('settling', () => {
  it('fluid always comes to rest, and nothing rests in mid-air', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        const { field } = run(rock, pours, 61);
        const ticks = settle(field, solid);
        expect(field.active.size, `still moving after ${ticks} ticks`).toBe(0);
        for (let column = 0; column < W; column++) {
          for (let row = 0; row < H; row++) {
            if (!fluidAt(field, column, row)) continue;
            const supported = solid(column, row + 1) || fluidAt(field, column, row + 1) !== null;
            expect(supported, `fluid hanging at ${column},${row}`).toBe(true);
          }
        }
      }),
    );
  });

  it('a closed basin of water settles flat: every row under the top one is full', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: W - 1 }),
        fc.integer({ min: 1, max: W * (H - 2) }),
        (column, cells) => expectSettlesFlat('water', W, H, column, cells),
      ),
    );
  });

  it('a basin far wider than any search distance still settles flat — no steps', () => {
    // The reach-limited version settled a wide pool into 16-cell-wide steps (docs/FLUIDS.md history).
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: WIDE - 1 }),
        fc.integer({ min: WIDE, max: WIDE * 4 }),
        (column, cells) => expectSettlesFlat('water', WIDE, SHALLOW, column, cells),
      ),
      { numRuns: 40 },
    );
  });

  it('lava settles into flat pools too, never mounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: WIDE - 1 }),
        fc.integer({ min: WIDE, max: WIDE * 3 }),
        (column, cells) => expectSettlesFlat('lava', WIDE, SHALLOW, column, cells),
      ),
      { numRuns: 20 },
    );
  });

  it('no pressure: a U-bend fills only to the height of its connection', () => {
    // Left arm, a divider with a two-row channel under it, right arm. Pour the left arm full: water
    // runs through the channel, but never climbs the right arm.
    const width = 9;
    const height = 14;
    const rock = new Set<number>();
    for (let row = 0; row < height - 2; row++) {
      for (let column = 3; column <= 5; column++) rock.add(fluidKey(column, row));
    }
    const solid = boxSolid(rock, width, height);
    const field = newFluidField();
    for (let row = 0; row < height - 2; row++) {
      for (let column = 0; column < 3; column++) pourFluid(field, column, row, 'water', solid);
    }
    settle(field, solid);
    expect(field.active.size).toBe(0);
    for (let row = 0; row < height - 2; row++) {
      for (let column = 6; column < width; column++) {
        expect(fluidAt(field, column, row), `climbed the right arm at ${column},${row}`).toBeNull();
      }
    }
  });

  it('lava is slower than water', () => {
    const solid = boxSolid(new Set());
    const furthest = (kind: FluidKind): number => {
      const field = newFluidField();
      for (let row = H - 4; row < H; row++) pourFluid(field, 0, row, kind, solid);
      // Short enough that lava, stepping every LAVA_TICK_INTERVAL ticks, is still on its way.
      for (let tick = 0; tick < 6; tick++) stepFluid(field, solid);
      let reached = 0;
      for (let c = 0; c < W; c++) if (fluidAt(field, c, H - 1)) reached = c;
      return reached;
    };
    expect(furthest('lava')).toBeLessThan(furthest('water'));
  });

  it("kinds don't mix: water rests on lava instead of displacing it", () => {
    const solid = boxSolid(new Set());
    const field = newFluidField();
    pourFluid(field, 5, H - 1, 'lava', solid);
    pourFluid(field, 5, H - 2, 'water', solid);
    settle(field, solid);
    expect(fluidAt(field, 5, H - 1)).toBe('lava');
    expect(fluidCount(field, 'water')).toBe(1);
    expect(fluidCount(field, 'lava')).toBe(1);
  });
});

describe('fluid in motion — checked every tick, not just once settled', () => {
  it('a dam breach pours down the far face and spreads along the floor, never hanging in the air', () => {
    // The review's first screenshot: water through a breach grew a wedge in mid-air.
    const width = 60;
    const height = 40;
    const DAM = 20; // two cells thick
    const BREACH_TOP = 14;
    const rock = new Set<number>();
    for (let row = 8; row < height; row++) {
      rock.add(fluidKey(DAM, row));
      rock.add(fluidKey(DAM + 1, row));
    }
    const solid = boxSolid(rock, width, height);
    const field = newFluidField();
    for (let row = 12; row < height; row++) {
      for (let column = 0; column < DAM; column++) pourFluid(field, column, row, 'water', solid);
    }
    settle(field, solid);
    for (let row = BREACH_TOP; row < BREACH_TOP + 3; row++) {
      for (const column of [DAM, DAM + 1]) {
        rock.delete(fluidKey(column, row));
        wakeAround(field, column, row);
      }
    }
    const breached = boxSolid(rock, width, height);
    for (let tick = 0; tick < 400; tick++) {
      stepFluid(field, breached);
      // Past the waterfall column, every fluid cell stands on an unbroken column down to the floor.
      for (const key of field.cells.keys()) {
        const column = columnOfKey(key);
        if (column <= DAM + 2) continue;
        for (let row = rowOfKey(key) + 1; row < height; row++) {
          expect(
            field.cells.has(fluidKey(column, row)),
            `tick ${tick}: air under ${column},${rowOfKey(key)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('a pool draining through a hole in its floor stays flat the whole way down', () => {
    // The review's second screenshot: lava draining through a shelf went ragged, and spread into a V
    // under the ceiling below.
    const width = 80;
    const height = 50;
    const SHELF = 20;
    const HOLE = 40;
    const rock = new Set<number>();
    for (let column = 0; column < width; column++)
      if (column !== HOLE) rock.add(fluidKey(column, SHELF));
    const solid = boxSolid(rock, width, height);
    const field = newFluidField();
    for (let row = 12; row < SHELF; row++) {
      for (let column = 0; column < width; column++) pourFluid(field, column, row, 'lava', solid);
    }
    for (let tick = 0; tick < 4000 && fluidCount(field, 'lava') > 0; tick++) {
      stepFluid(field, solid);
      const heights: number[] = [];
      for (let column = 0; column < width; column++) {
        if (Math.abs(column - HOLE) <= 1) continue; // the cells feeding the hole
        let depth = 0;
        for (let row = 0; row < SHELF; row++) if (field.cells.has(fluidKey(column, row))) depth++;
        heights.push(depth);
      }
      expect(
        Math.max(...heights) - Math.min(...heights),
        `tick ${tick}: ${heights.join('')}`,
      ).toBeLessThanOrEqual(1);
      // Below the shelf, nothing clings to its underside: the stream falls to the floor first.
      for (const key of field.cells.keys()) {
        if (rowOfKey(key) !== SHELF + 1 || columnOfKey(key) === HOLE) continue;
        expect(false, `tick ${tick}: lava spread under the shelf at ${columnOfKey(key)}`).toBe(
          true,
        );
      }
    }
  });
});

describe('bodies at their edges', () => {
  it('a one-cell-thick sheet that reaches a ledge drains off it completely, however long it is', () => {
    // A sheet is just a thin body: its edge cell stands on rock beside a drop, so the body spills there
    // until it's gone. (A sheet that doesn't reach any drop is a flat puddle and stays one.)
    const width = 70;
    const height = 20;
    const SHELF = 8;
    const rock = new Set<number>();
    for (let column = 0; column < width - 6; column++) rock.add(fluidKey(column, SHELF));
    const solid = boxSolid(rock, width, height);
    const field = newFluidField();
    for (let column = 0; column < width - 6; column++)
      pourFluid(field, column, SHELF - 1, 'water', solid);
    settle(field, solid);
    for (let column = 0; column < width; column++) {
      expect(fluidAt(field, column, SHELF - 1), `stranded on the shelf at ${column}`).toBeNull();
    }
    expect(fluidCount(field, 'water')).toBe(width - 6);
  });

  it('a pool overflows a wall lower than its surface, and fills the far side', () => {
    const width = 20;
    const height = 12;
    const WALL = 10;
    const rock = new Set<number>();
    for (let row = height - 3; row < height; row++) rock.add(fluidKey(WALL, row));
    const solid = boxSolid(rock, width, height);
    const field = newFluidField();
    for (let row = height - 6; row < height; row++) {
      for (let column = 0; column < WALL; column++) pourFluid(field, column, row, 'water', solid);
    }
    settle(field, solid);
    let farSide = 0;
    for (const key of field.cells.keys()) if (columnOfKey(key) > WALL) farSide++;
    expect(farSide).toBeGreaterThan(0);
    for (let column = 0; column < width; column++) {
      if (column === WALL) continue;
      expect(fluidAt(field, column, height - 1), `dry floor at ${column}`).toBe('water');
    }
  });
});

describe('sleeping and waking', () => {
  it('a settled lake sleeps through a breach until the terrain change is reported', () => {
    // A lake on the left of a one-cell-thick dam; the right side is dry.
    const rock = new Set<number>();
    const DAM = 6;
    for (let row = 0; row < H; row++) rock.add(fluidKey(DAM, row));
    const solidWithDam = boxSolid(rock);
    const field = newFluidField();
    for (let row = H - 1; row >= H - 4; row--) {
      for (let c = 0; c < DAM; c++) pourFluid(field, c, row, 'water', solidWithDam);
    }
    settle(field, solidWithDam);
    expect(field.active.size).toBe(0);

    rock.delete(fluidKey(DAM, H - 1)); // dig the dam's bottom cell
    const breached = boxSolid(rock);
    stepFluid(field, breached);
    expect(fluidAt(field, DAM, H - 1), 'nothing moves without a wake').toBeNull();

    wakeAround(field, DAM, H - 1);
    for (let tick = 0; tick < 20; tick++) stepFluid(field, breached);
    expect(fluidAt(field, DAM + 1, H - 1)).toBe('water');
  });

  it('fluid resting on fluid follows it down when the cell below leaves', () => {
    // A settled two-cell stack in a one-wide slot (so it can't level out sideways). Digging the slot's
    // floor wakes the bottom cell, which falls; the cell above it was asleep and must be woken by that
    // move, or it hangs in the air.
    const rock = new Set([
      fluidKey(4, 8),
      fluidKey(3, 7),
      fluidKey(5, 7),
      fluidKey(3, 6),
      fluidKey(5, 6),
    ]);
    const solid = boxSolid(rock);
    const field = newFluidField();
    pourFluid(field, 4, 7, 'water', solid);
    pourFluid(field, 4, 6, 'water', solid);
    settle(field, solid);
    expect(fluidAt(field, 4, 6)).toBe('water');

    rock.delete(fluidKey(4, 8));
    wakeAround(field, 4, 8);
    settle(field, solid);
    for (const key of field.cells.keys()) {
      const column = columnOfKey(key);
      const row = rowOfKey(key);
      const supported = solid(column, row + 1) || fluidAt(field, column, row + 1) !== null;
      expect(supported, `left hanging at ${column},${row}`).toBe(true);
    }
  });

  it('fluid outside the active region freezes, stays awake, and loses nothing', () => {
    const solid = boxSolid(new Set());
    const field = newFluidField();
    pourFluid(field, 2, 0, 'water', solid);
    const before = [...field.cells];
    const onlyRightHalf = (column: number): boolean => column >= W / 2;
    for (let tick = 0; tick < 50; tick++) stepFluid(field, solid, onlyRightHalf);
    expect([...field.cells]).toEqual(before);
    expect(field.active.has(fluidKey(2, 0))).toBe(true);

    for (let tick = 0; tick < 50; tick++) stepFluid(field, solid);
    expect(fluidAt(field, 2, 0)).toBeNull(); // released, it fell
    expect(fluidCount(field, 'water')).toBe(1);
  });

  it('pouring fills only an empty cell', () => {
    const rock = new Set([fluidKey(3, 3)]);
    const solid = boxSolid(rock);
    const field = newFluidField();
    expect(pourFluid(field, 3, 3, 'water', solid)).toBe(false);
    expect(pourFluid(field, 4, 4, 'water', solid)).toBe(true);
    expect(pourFluid(field, 4, 4, 'water', solid)).toBe(false);
    expect(pourFluid(field, 4, 4, 'lava', solid)).toBe(false);
  });
});
