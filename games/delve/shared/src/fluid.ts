// fluid.ts — simulated water and lava (#30): a whole-cell automaton on the collision grid. A cell is
// either full of one fluid or empty — no partial levels — so fluid only ever fills empty space and
// can only make the shapes the terrain makes. Pure and DOM-free like the rest of the ruleset, and
// world-agnostic: it asks a `solid(column, row)` predicate rather than reading a WorldState, so the lab
// drives it over a hand-built box and the game can later drive it over the real terrain.
// The model, the prior art it follows, and what is still open: docs/FLUIDS.md.

export type FluidKind = 'water' | 'lava';

/** Lava steps once every this many ticks — slow next to water. */
export const LAVA_TICK_INTERVAL = 4;

/**
 * How far along its row a cell looks for somewhere lower to go, in cells.
 *
 * Minecraft's "seek the nearest drop", widened. Water's reach is what flattens a pool; lava's is short,
 * so it can't find a drop across a wide floor and heaps into stepped mounds instead.
 */
export const FLUID_REACH: Readonly<Record<FluidKind, number>> = { water: 16, lava: 2 };

const MAX_REACH = Math.max(...Object.values(FLUID_REACH));

export type SolidQuery = (column: number, row: number) => boolean;

/** Whether a cell is inside the region being simulated this tick — the active region near players. */
export type RegionQuery = (column: number, row: number) => boolean;

/**
 * The fluid in a world. Sparse: a cell with no fluid has no entry, and a cell with fluid maps its
 * packed key (`fluidKey`) to its kind. That is the whole state — a cell count per kind is the mass.
 */
export interface FluidField {
  cells: Map<number, FluidKind>;
  /** Cells that might move next tick. A settled body leaves it, and costs nothing. */
  active: Set<number>;
  tick: number;
}

export interface FluidStepResult {
  /** Cells actually stepped this tick — the CPU cost. */
  stepped: number;
  /** Cells that gained or lost fluid this tick — what replication would have to send. */
  changed: ReadonlySet<number>;
  /**
   * Every move as `[from, to]` keys. Always to a lower row. A sideways move can cross several cells in
   * one tick, so this is what a renderer animates along, the sim having already decided where it ends.
   */
  moves: readonly (readonly [number, number])[];
}

// ---- keys ---------------------------------------------------------------------------------------

const COORD_OFFSET = 32768; // columns and rows are signed; this shifts them into 16 unsigned bits
const COORD_RANGE = 65536;

/** A cell's key. Covers columns and rows in `[-32768, 32767]`, far beyond the largest world. */
export const fluidKey = (column: number, row: number): number =>
  (row + COORD_OFFSET) * COORD_RANGE + (column + COORD_OFFSET);

/** The column and row a `fluidKey` was packed from. */
export const columnOfKey = (key: number): number => (key % COORD_RANGE) - COORD_OFFSET;
export const rowOfKey = (key: number): number => Math.floor(key / COORD_RANGE) - COORD_OFFSET;

// ---- public API ---------------------------------------------------------------------------------

export function newFluidField(): FluidField {
  return { cells: new Map(), active: new Set(), tick: 0 };
}

/** The kind of fluid in a cell, or null for none. */
export function fluidAt(field: FluidField, column: number, row: number): FluidKind | null {
  return field.cells.get(fluidKey(column, row)) ?? null;
}

/** How many cells hold `kind`. Conserved by `stepFluid`, exactly. */
export function fluidCount(field: FluidField, kind: FluidKind): number {
  let count = 0;
  for (const cellKind of field.cells.values()) {
    if (cellKind === kind) count++;
  }
  return count;
}

/** Fill one empty cell with `kind`. Returns false for rock or a cell that already holds fluid. */
export function pourFluid(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  solid: SolidQuery,
): boolean {
  const key = fluidKey(column, row);
  if (solid(column, row) || field.cells.has(key)) return false;
  field.cells.set(key, kind);
  wakeAround(field, column, row);
  return true;
}

/**
 * Wake the fluid that could move because the cell at `(column, row)` changed — terrain dug or built,
 * or fluid arriving or leaving.
 *
 * Wider than the neighbours: a cell looks for somewhere to go along its whole reach, in its own row,
 * and a change also alters what the row above can see. So everything within reach in this row and the
 * one above wakes. The step only visits active cells, so a settled lake sleeps through its own breach
 * unless whatever dug the wall reports it here.
 */
export function wakeAround(field: FluidField, column: number, row: number): void {
  for (let wakeRow = row - 1; wakeRow <= row; wakeRow++) {
    for (let wakeColumn = column - MAX_REACH; wakeColumn <= column + MAX_REACH; wakeColumn++) {
      const key = fluidKey(wakeColumn, wakeRow);
      if (field.cells.has(key)) field.active.add(key);
    }
  }
}

/**
 * Advance the fluid one tick. Each active cell, bottom row first, makes at most one move:
 *
 * 1. **Fall** into an empty cell below.
 * 2. **Seek a drop**: along its row, through empty cells, the nearest empty cell with nothing under
 *    it. The cell moves straight to the bottom of that drop.
 * 3. **Level**: if the cell has fluid of its kind above it — so it's in a column, not on a surface — it
 *    may also look through fluid of its kind for the nearest empty cell resting on something. The TOP
 *    of its column moves there. That is how a lake runs out along a flat tunnel floor.
 * 4. Otherwise **rest**.
 *
 * There is no "already moved" guard. Falls and drops land in a row already processed, which leaves
 * only a levelling move landing later in its own row's sweep as a way to move a cell twice. Two guards
 * against that were deleted after dense fuzzing (4,000 runs on a 24×16 box) never exercised either;
 * the property test "a cell moves at most once per tick" is what would catch it.
 *
 * Every move lands strictly lower than the cell that makes it, which is the whole termination
 * argument: total height only ever falls, so every closed body settles and nothing jitters. A surface
 * cell never moves sideways to a spot as high as itself, and none of this lets water climb, so there
 * is no pressure (a decided design — FLUIDS.md).
 *
 * Cells outside `inRegion` are skipped but stay active: fluid far from every player freezes mid-flow
 * rather than being forgotten.
 */
export function stepFluid(
  field: FluidField,
  solid: SolidQuery,
  inRegion?: RegionQuery,
): FluidStepResult {
  field.tick++;
  const sweepRight = field.tick % 2 === 0;
  const lavaSteps = field.tick % LAVA_TICK_INTERVAL === 0;
  const waiting = new Set<number>();
  const moves: [number, number][] = [];

  // ponytail: sorts the whole active set every tick, O(A log A). Fine at lab scale; bucket by row if
  // a real flood shows up in a profile.
  const order = [...field.active].sort((a, b) => {
    const rowDifference = rowOfKey(b) - rowOfKey(a);
    if (rowDifference !== 0) return rowDifference;
    return sweepRight ? columnOfKey(a) - columnOfKey(b) : columnOfKey(b) - columnOfKey(a);
  });

  const isEmpty = (column: number, row: number): boolean =>
    !solid(column, row) && !field.cells.has(fluidKey(column, row));

  let stepped = 0;
  for (const key of order) {
    const kind = field.cells.get(key);
    if (kind === undefined) continue; // left this cell earlier in the tick
    const column = columnOfKey(key);
    const row = rowOfKey(key);
    if ((inRegion && !inRegion(column, row)) || (kind === 'lava' && !lavaSteps)) {
      waiting.add(key);
      continue;
    }
    stepped++;

    const move = chooseMove(field, column, row, kind, sweepRight, isEmpty);
    if (!move) continue;
    const [from, to] = move;
    field.cells.delete(from);
    field.cells.set(to, kind);
    moves.push(move);
  }

  const changed = new Set<number>();
  for (const [from, to] of moves) {
    changed.add(from);
    changed.add(to);
  }
  field.active = waiting;
  for (const key of changed) wakeAround(field, columnOfKey(key), rowOfKey(key));
  return { stepped, changed, moves };
}

// ---- choosing a move ----------------------------------------------------------------------------

/** The one move this cell makes, as `[from, to]` keys, or null to rest. */
function chooseMove(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  sweepRight: boolean,
  isEmpty: (column: number, row: number) => boolean,
): [number, number] | null {
  const here = fluidKey(column, row);
  if (isEmpty(column, row + 1)) return [here, fluidKey(column, row + 1)];

  const inColumn = field.cells.get(fluidKey(column, row - 1)) === kind;
  const directions = sweepRight ? [1, -1] : [-1, 1];
  let bestDrop: { column: number; distance: number } | null = null;
  let bestLevel: { column: number; distance: number } | null = null;

  for (const direction of directions) {
    for (let distance = 1; distance <= FLUID_REACH[kind]; distance++) {
      const probe = column + direction * distance;
      if (isEmpty(probe, row)) {
        if (isEmpty(probe, row + 1)) {
          if (!bestDrop || distance < bestDrop.distance) bestDrop = { column: probe, distance };
          break;
        }
        if (inColumn && (!bestLevel || distance < bestLevel.distance)) {
          bestLevel = { column: probe, distance };
        }
        continue; // an empty cell on a floor: keep looking past it for a drop
      }
      // Fluid of this kind can be looked through only by a cell in a column — it is the column's
      // weight that runs out along the row. Rock, the other kind, or a surface cell's view ends here.
      if (inColumn && field.cells.get(fluidKey(probe, row)) === kind) continue;
      break;
    }
  }

  if (bestDrop) return [here, fluidKey(bestDrop.column, row + 1)];
  if (bestLevel) return [topOfColumn(field, column, row, kind), fluidKey(bestLevel.column, row)];
  return null;
}

/**
 * The topmost cell of the unbroken column of `kind` standing on `(column, row)`.
 *
 * ponytail: walks up one cell at a time, so a very deep column costs its height per levelling move.
 * Cache column tops per tick if deep lakes draining ever profile.
 */
function topOfColumn(field: FluidField, column: number, row: number, kind: FluidKind): number {
  let top = row;
  while (field.cells.get(fluidKey(column, top - 1)) === kind) top--;
  return fluidKey(column, top);
}
