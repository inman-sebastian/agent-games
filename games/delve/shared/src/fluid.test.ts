// fluid.test.ts — the cellular-automaton fluid (#30) under fuzzing. Random terrain and random pours,
// asserting what must hold in every case: mass is conserved exactly, fluid never sits in rock, the
// step is deterministic, a closed basin settles flat, and fluid outside the active region freezes.
// See docs/FLUIDS.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newFluidField,
  pourFluid,
  stepFluid,
  wakeAround,
  fluidAt,
  fluidMass,
  fluidKey,
  MAX_LEVEL,
  type FluidField,
  type FluidKind,
} from './fluid';

const W = 16;
const H = 12;

/** A closed box: walls on every side, plus whatever interior rock the test adds. */
function boxSolid(rock: ReadonlySet<number>): (column: number, row: number) => boolean {
  return (column, row) =>
    column < 0 || column >= W || row < 0 || row >= H || rock.has(fluidKey(column, row));
}

const rockArb = fc
  .array(
    fc.record({ c: fc.integer({ min: 0, max: W - 1 }), r: fc.integer({ min: 0, max: H - 1 }) }),
    {
      maxLength: 40,
    },
  )
  .map((cells) => new Set(cells.map(({ c, r }) => fluidKey(c, r))));

const pourArb = fc.array(
  fc.record({
    c: fc.integer({ min: 0, max: W - 1 }),
    r: fc.integer({ min: 0, max: H - 1 }),
    kind: fc.constantFrom<FluidKind>('water', 'lava'),
    amount: fc.integer({ min: 1, max: MAX_LEVEL * 3 }),
    atTick: fc.integer({ min: 0, max: 60 }),
  }),
  { minLength: 1, maxLength: 12 },
);

/** Run a scenario, handing each tick to `check`. Returns the field and how much of each kind went in. */
function run(
  rock: ReadonlySet<number>,
  pours: { c: number; r: number; kind: FluidKind; amount: number; atTick: number }[],
  ticks: number,
  check: (field: FluidField, poured: Record<FluidKind, number>) => void = () => {},
): { field: FluidField; poured: Record<FluidKind, number> } {
  const solid = boxSolid(rock);
  const field = newFluidField();
  const poured: Record<FluidKind, number> = { water: 0, lava: 0 };
  for (let tick = 0; tick < ticks; tick++) {
    for (const pour of pours) {
      if (pour.atTick !== tick) continue;
      poured[pour.kind] += pourFluid(field, pour.c, pour.r, pour.kind, pour.amount, solid);
    }
    stepFluid(field, solid);
    check(field, poured);
  }
  return { field, poured };
}

describe('fluid invariants', () => {
  it('conserves mass exactly, every tick, for both kinds', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        run(rock, pours, 150, (field, poured) => {
          expect(fluidMass(field, 'water')).toBe(poured.water);
          expect(fluidMass(field, 'lava')).toBe(poured.lava);
        });
      }),
    );
  });

  it('never puts fluid in a solid cell, and never over-fills one', () => {
    fc.assert(
      fc.property(rockArb, pourArb, (rock, pours) => {
        const solid = boxSolid(rock);
        run(rock, pours, 150, (field) => {
          for (let column = -1; column <= W; column++) {
            for (let row = -1; row <= H; row++) {
              const cell = fluidAt(field, column, row);
              if (!cell) continue;
              expect(solid(column, row), `fluid in rock at ${column},${row}`).toBe(false);
              expect(cell.level).toBeGreaterThan(0);
              expect(cell.level).toBeLessThanOrEqual(MAX_LEVEL);
            }
          }
        });
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
  it('a closed basin of water comes to rest: the active set empties and the surface is flat', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: W - 1 }),
        fc.integer({ min: 1, max: MAX_LEVEL * W * 3 }),
        (column, amount) => {
          const solid = boxSolid(new Set());
          const field = newFluidField();
          // Poured in a column of cells from the top, the way a breached pocket arrives.
          let left = amount;
          for (let row = 0; row < H && left > 0; row++) {
            left -= pourFluid(field, column, row, 'water', left, solid);
          }
          let ticks = 0;
          while (field.active.size > 0 && ticks < 20_000) {
            stepFluid(field, solid);
            ticks++;
          }
          expect(field.active.size, `still moving after ${ticks} ticks`).toBe(0);

          // Every row below the top partial one is full, and the partial row is flat to within one
          // unit between neighbours — the integer average's residue, invisible at 255 units a cell.
          const levelAt = (c: number, r: number): number => fluidAt(field, c, r)?.level ?? 0;
          for (let row = 0; row < H; row++) {
            const levels = Array.from({ length: W }, (_, c) => levelAt(c, row));
            const below =
              row + 1 < H ? Array.from({ length: W }, (_, c) => levelAt(c, row + 1)) : null;
            if (levels.some((level) => level > 0) && below) {
              expect(
                below.every((level) => level === MAX_LEVEL),
                `row ${row + 1} under water is full`,
              ).toBe(true);
            }
            for (let c = 1; c < W; c++) {
              expect(
                Math.abs(levels[c] - levels[c - 1]),
                `step at ${c},${row}`,
              ).toBeLessThanOrEqual(1);
            }
          }
        },
      ),
    );
  });

  it('lava is slower than water', () => {
    const solid = boxSolid(new Set());
    const reach = (kind: FluidKind): number => {
      const field = newFluidField();
      pourFluid(field, 0, H - 1, kind, MAX_LEVEL, solid);
      for (let tick = 0; tick < 40; tick++) stepFluid(field, solid);
      let furthest = 0;
      for (let c = 0; c < W; c++) if (fluidAt(field, c, H - 1)) furthest = c;
      return furthest;
    };
    expect(reach('lava')).toBeLessThan(reach('water'));
  });

  it("kinds don't mix: water treats lava as a wall", () => {
    const solid = boxSolid(new Set());
    const field = newFluidField();
    pourFluid(field, 5, H - 1, 'lava', MAX_LEVEL, solid);
    pourFluid(field, 5, H - 2, 'water', MAX_LEVEL, solid);
    for (let tick = 0; tick < 200; tick++) stepFluid(field, solid);
    // The water came to rest on the lava rather than displacing it: the lava's cell is still lava.
    expect(fluidAt(field, 5, H - 1)?.kind).toBe('lava');
    expect(fluidMass(field, 'water')).toBe(MAX_LEVEL);
    expect(fluidMass(field, 'lava')).toBe(MAX_LEVEL);
  });
});

describe('sleeping and waking', () => {
  it('a settled lake sleeps through a breach until the terrain change is reported', () => {
    // A lake on the left of a one-cell dam; the right side is dry.
    const rock = new Set<number>();
    const DAM = 6;
    for (let row = 0; row < H; row++) rock.add(fluidKey(DAM, row));
    const solidWithDam = boxSolid(rock);
    const field = newFluidField();
    for (let row = H - 1; row >= H - 4; row--) {
      for (let c = 0; c < DAM; c++) pourFluid(field, c, row, 'water', MAX_LEVEL, solidWithDam);
    }
    for (let tick = 0; tick < 500 && field.active.size > 0; tick++) stepFluid(field, solidWithDam);
    expect(field.active.size).toBe(0);

    rock.delete(fluidKey(DAM, H - 1)); // dig the dam's bottom cell
    const breached = boxSolid(rock);
    stepFluid(field, breached);
    expect(fluidAt(field, DAM, H - 1), 'nothing moves without a wake').toBeNull();

    wakeAround(field, DAM, H - 1);
    for (let tick = 0; tick < 20; tick++) stepFluid(field, breached);
    expect(fluidAt(field, DAM + 1, H - 1)?.kind).toBe('water');
  });

  it('fluid outside the active region freezes, stays awake, and loses nothing', () => {
    const solid = boxSolid(new Set());
    const field = newFluidField();
    pourFluid(field, 2, 0, 'water', MAX_LEVEL, solid);
    const before = [...field.cells];
    const onlyRightHalf = (column: number): boolean => column >= W / 2;
    for (let tick = 0; tick < 50; tick++) stepFluid(field, solid, onlyRightHalf);
    expect([...field.cells]).toEqual(before);
    expect(field.active.has(fluidKey(2, 0))).toBe(true);

    for (let tick = 0; tick < 50; tick++) stepFluid(field, solid);
    expect(fluidAt(field, 2, 0)).toBeNull(); // released, it fell
    expect(fluidMass(field, 'water')).toBe(MAX_LEVEL);
  });

  it('pouring into rock or into the other kind is refused, and reports what was accepted', () => {
    const rock = new Set([fluidKey(3, 3)]);
    const solid = boxSolid(rock);
    const field = newFluidField();
    expect(pourFluid(field, 3, 3, 'water', 10, solid)).toBe(0);
    expect(pourFluid(field, 4, 4, 'water', MAX_LEVEL + 50, solid)).toBe(MAX_LEVEL);
    expect(pourFluid(field, 4, 4, 'lava', 10, solid)).toBe(0);
  });
});
