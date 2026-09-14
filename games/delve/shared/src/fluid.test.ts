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
function boxSolid(rock: ReadonlySet<number>): SolidQuery {
  return (column, row) =>
    column < 0 || column >= W || row < 0 || row >= H || rock.has(fluidKey(column, row));
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
          for (const [from, to] of moves) expect(rowOfKey(to)).toBeGreaterThan(rowOfKey(from));
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
          for (const [from, to] of moves) {
            expect(arrived.has(from), 'moved twice in one tick').toBe(false);
            arrived.add(to);
          }
        }
      }),
    );
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
        (column, cells) => {
          const solid = boxSolid(new Set());
          const field = newFluidField();
          // Poured as a stream into one column, the way a breached pocket arrives.
          let poured = 0;
          for (let tick = 0; poured < cells && tick < SETTLE_TICK_CAP; tick++) {
            if (pourFluid(field, column, 0, 'water', solid)) poured++;
            stepFluid(field, solid);
          }
          expect(poured).toBe(cells);
          const ticks = settle(field, solid);
          expect(field.active.size, `still moving after ${ticks} ticks`).toBe(0);

          const fullRows = Math.floor(cells / W);
          for (let row = H - 1; row >= H - fullRows; row--) {
            for (let c = 0; c < W; c++) {
              expect(fluidAt(field, c, row), `hole in full row ${row} at ${c}`).toBe('water');
            }
          }
          const topRow = H - fullRows - 1;
          let inTopRow = 0;
          for (let c = 0; c < W; c++) if (fluidAt(field, c, topRow)) inTopRow++;
          expect(inTopRow).toBe(cells % W);
          for (let row = 0; row < topRow; row++) {
            for (let c = 0; c < W; c++) expect(fluidAt(field, c, row)).toBeNull();
          }
        },
      ),
    );
  });

  it('lava is slower than water', () => {
    const solid = boxSolid(new Set());
    const furthest = (kind: FluidKind): number => {
      const field = newFluidField();
      for (let row = H - 4; row < H; row++) pourFluid(field, 0, row, kind, solid);
      for (let tick = 0; tick < 12; tick++) stepFluid(field, solid);
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
