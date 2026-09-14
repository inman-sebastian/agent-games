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
 * How far along its row a LONE cell (not in a pool) looks for a drop, in cells — Minecraft's "seek the
 * nearest way down", widened. Pools don't use it: they search through themselves with no limit.
 */
export const DROP_REACH = 16;

/**
 * The most pool cells one merge search visits.
 *
 * ponytail: a pool larger than this can't find an empty cell on its far side in one search, and settles
 * a little slower (the move comes from a cell nearer the gap instead). Raise it, or cache each pool's
 * lowest empty cell per tick, if a big lake ever settles visibly slowly or shows up in a profile.
 */
const MERGE_SEARCH_LIMIT = 4096;

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

/**
 * How a cell moved, which is how a renderer shows it: a `fall` or a `drop` slides along its path; a
 * `merge` joins a pool, whose cells are indistinguishable, so it isn't drawn travelling at all.
 */
export type FluidMoveType = 'fall' | 'drop' | 'merge';

export interface FluidMove {
  readonly from: number;
  readonly to: number;
  readonly type: FluidMoveType;
}

export interface FluidStepResult {
  /** Cells actually stepped this tick — the CPU cost. */
  stepped: number;
  /** Cells that gained or lost fluid this tick — what replication would have to send. */
  changed: ReadonlySet<number>;
  /** Every move this tick, in the order made. Always to a lower row. */
  moves: readonly FluidMove[];
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
 * Wider than the neighbours: a lone cell looks for a drop along its whole reach, in its own row, and a
 * change also alters what the row above can see. So everything within reach in this row and the one
 * above wakes. A pool needs no more than that — any awake cell in it moves its column's top, so a change
 * anywhere in a pool spreads through the cells beside it. The step only visits active cells, so a settled lake sleeps through its own breach
 * unless whatever dug the wall reports it here.
 */
export function wakeAround(field: FluidField, column: number, row: number): void {
  for (let wakeRow = row - 1; wakeRow <= row; wakeRow++) {
    for (let wakeColumn = column - DROP_REACH; wakeColumn <= column + DROP_REACH; wakeColumn++) {
      const key = fluidKey(wakeColumn, wakeRow);
      if (field.cells.has(key)) field.active.add(key);
    }
  }
}

/**
 * Advance the fluid one tick. Each active cell, bottom row first, makes at most one move:
 *
 * 1. **Fall** into an empty cell below.
 * 2. **Merge**, if the cell is in a pool (its kind above or below it): search from the TOP of its column
 *    through the pool, only down or sideways, for the nearest empty cell lower than that top, and move
 *    the top there. No distance limit, so every pool settles flat; never upward, so there's no pressure.
 * 3. **Seek a drop**, if the cell is alone: the nearest empty cell with nothing under it, along its row,
 *    through empty cells, within `DROP_REACH`. Move to the bottom of it.
 * 4. Otherwise **rest**.
 *
 * Every move lands strictly lower than the cell that makes it, which is the whole termination argument:
 * total height only ever falls, so every closed body settles and nothing jitters.
 *
 * A merge can land ABOVE the row being processed, on a cell whose turn is still to come, so no move
 * starts from a cell that arrived this tick; it waits for the next.
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
  const arrived = new Set<number>();
  const moves: FluidMove[] = [];

  // ponytail: sorts the whole active set every tick, O(A log A). Fine at lab scale; bucket by row if
  // a real flood shows up in a profile.
  const order = [...field.active].sort((a, b) => {
    const rowDifference = rowOfKey(b) - rowOfKey(a);
    if (rowDifference !== 0) return rowDifference;
    return sweepRight ? columnOfKey(a) - columnOfKey(b) : columnOfKey(b) - columnOfKey(a);
  });

  const isEmpty = (column: number, row: number): boolean =>
    !solid(column, row) && !field.cells.has(fluidKey(column, row));
  const dryRuns: DryRuns = new Map();

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

    const move = chooseMove(field, column, row, kind, sweepRight, isEmpty, dryRuns);
    if (!move) continue;
    // The one guard against moving a cell twice in a tick. A merge can land ABOVE the row being
    // processed, so either this cell or the top of its column may have arrived earlier this tick. Both
    // cases have a regression test; it covers both because a cell's own move starts from itself.
    if (arrived.has(move.from)) {
      waiting.add(key);
      continue;
    }
    field.cells.delete(move.from);
    field.cells.set(move.to, kind);
    dryRuns.clear(); // a move opens and fills cells, so what failed before might not now
    arrived.add(move.to);
    moves.push(move);
  }

  const changed = new Set<number>();
  for (const { from, to } of moves) {
    changed.add(from);
    changed.add(to);
  }
  field.active = waiting;
  for (const key of changed) wakeAround(field, columnOfKey(key), rowOfKey(key));
  return { stepped, changed, moves };
}

// ---- choosing a move ----------------------------------------------------------------------------

/**
 * Merge searches that found nothing this tick: pool cell key → the highest top row a failed search
 * reached it from.
 *
 * A failed search proves there is no empty cell lower than its top reachable from any cell it visited.
 * A later search starting from — or passing through — one of those cells, from a top at that row or
 * below, can only reach less and needs to go lower, so it fails too and can stop there. Without this,
 * every awake cell at the top of a settling lake searched the whole lake every tick: the lab measured
 * 56 ms/s of stepping for 15 cells a tick. Cleared by every move, since a move changes what's empty.
 */
type DryRuns = Map<number, number>;

/** The one move this cell makes, or null to rest. */
function chooseMove(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  sweepRight: boolean,
  isEmpty: (column: number, row: number) => boolean,
  dryRuns: DryRuns,
): FluidMove | null {
  const here = fluidKey(column, row);
  if (isEmpty(column, row + 1)) return { from: here, to: fluidKey(column, row + 1), type: 'fall' };
  const inPool =
    field.cells.get(fluidKey(column, row + 1)) === kind ||
    field.cells.get(fluidKey(column, row - 1)) === kind;
  if (inPool) return mergeMove(field, column, row, kind, sweepRight, isEmpty, dryRuns);
  return dropMove(column, row, sweepRight, isEmpty);
}

/**
 * A pool cell's move: the top of its column goes to the nearest empty cell lower than that top, found by
 * a breadth-first search through the pool that only ever steps down or sideways.
 *
 * Down is tried before sideways, so a pool fills from the bottom. Never stepping up is what keeps this
 * from being pressure: the far arm of a U-bend is only reachable by climbing, so it stays dry.
 */
function mergeMove(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  sweepRight: boolean,
  isEmpty: (column: number, row: number) => boolean,
  dryRuns: DryRuns,
): FluidMove | null {
  const top = topOfColumn(field, column, row, kind);
  const topRow = rowOfKey(top);
  const knownDry = (key: number): boolean => (dryRuns.get(key) ?? Infinity) <= topRow;
  if (knownDry(top)) return null;
  const sides = sweepRight ? [1, -1] : [-1, 1];
  const queue = [top];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length && index < MERGE_SEARCH_LIMIT; index++) {
    const cellColumn = columnOfKey(queue[index]);
    const cellRow = rowOfKey(queue[index]);
    const next: readonly (readonly [number, number])[] = [
      [cellColumn, cellRow + 1],
      [cellColumn + sides[0], cellRow],
      [cellColumn + sides[1], cellRow],
    ];
    for (const [nextColumn, nextRow] of next) {
      if (isEmpty(nextColumn, nextRow)) {
        if (nextRow > topRow)
          return { from: top, to: fluidKey(nextColumn, nextRow), type: 'merge' };
        continue;
      }
      const nextKey = fluidKey(nextColumn, nextRow);
      if (seen.has(nextKey) || field.cells.get(nextKey) !== kind || knownDry(nextKey)) continue;
      seen.add(nextKey);
      queue.push(nextKey);
    }
  }
  // Only a search that ran to completion proves anything; one cut off by the limit might have found a
  // cell just past it.
  if (queue.length < MERGE_SEARCH_LIMIT) {
    for (const key of seen) dryRuns.set(key, Math.min(dryRuns.get(key) ?? Infinity, topRow));
  }
  return null;
}

/** A lone cell's move: to the bottom of the nearest drop along its row, through empty cells. */
function dropMove(
  column: number,
  row: number,
  sweepRight: boolean,
  isEmpty: (column: number, row: number) => boolean,
): FluidMove | null {
  const here = fluidKey(column, row);
  let best: { column: number; distance: number } | null = null;
  for (const direction of sweepRight ? [1, -1] : [-1, 1]) {
    for (let distance = 1; distance <= DROP_REACH; distance++) {
      const probe = column + direction * distance;
      if (!isEmpty(probe, row)) break;
      if (!isEmpty(probe, row + 1)) continue; // an empty cell on a floor: look past it
      if (!best || distance < best.distance) best = { column: probe, distance };
      break;
    }
  }
  if (!best) return null;
  return { from: here, to: fluidKey(best.column, row + 1), type: 'drop' };
}

/**
 * The topmost cell of the unbroken column of `kind` standing on `(column, row)`.
 *
 * ponytail: walks up one cell at a time, so a very deep column costs its height per merge. Cache column
 * tops per tick if deep lakes draining ever profile.
 */
function topOfColumn(field: FluidField, column: number, row: number, kind: FluidKind): number {
  let top = row;
  while (field.cells.get(fluidKey(column, top - 1)) === kind) top--;
  return fluidKey(column, top);
}
