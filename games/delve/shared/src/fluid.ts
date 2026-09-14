// fluid.ts — simulated water and lava (#30): a whole-cell automaton on the collision grid. A cell is
// either full of one fluid or empty — no partial levels — so fluid only ever fills empty space and
// can only make the shapes the terrain makes. Pure and DOM-free like the rest of the ruleset, and
// world-agnostic: it asks a `solid(column, row)` predicate rather than reading a WorldState, so the lab
// drives it over a hand-built box and the game can later drive it over the real terrain.
// The model — gravity first, then resting bodies level — and why it's this one: docs/FLUIDS.md.

export type FluidKind = 'water' | 'lava';

/** Lava takes both of its phases once every this many ticks — slow next to water, same rules. */
export const LAVA_TICK_INTERVAL = 4;

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
 * How a cell moved, which is how a renderer shows it: a `fall` slides down one cell; a `merge` is a
 * resting body moving a cell from its surface to an opening, and since a body's cells are
 * indistinguishable it isn't drawn travelling at all.
 */
export type FluidMoveType = 'fall' | 'merge';

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
 * Wake the fluid next to a cell that changed — terrain dug or built, or fluid arriving or leaving.
 *
 * Only the eight neighbours and the cell itself: one awake cell makes its whole body level, so a change
 * anywhere in a pool reaches all of it. The step only visits active cells, so a settled lake sleeps
 * through its own breach unless whatever dug the wall reports it here.
 */
export function wakeAround(field: FluidField, column: number, row: number): void {
  for (let wakeRow = row - 1; wakeRow <= row + 1; wakeRow++) {
    for (let wakeColumn = column - 1; wakeColumn <= column + 1; wakeColumn++) {
      const key = fluidKey(wakeColumn, wakeRow);
      if (field.cells.has(key)) field.active.add(key);
    }
  }
}

/**
 * Advance the fluid one tick, in two phases. A cell takes part in at most one move.
 *
 * 1. **Gravity.** Every active cell with an empty cell below falls one cell, bottom row first. That is
 *    all a falling cell does, and falling fluid is never part of a body.
 * 2. **Resting bodies level.** A body is the fluid of one kind connected (left, right, up, down) through
 *    cells with rock or fluid under them. Its highest surface cells move to its lowest openings — an
 *    empty cell beside the body with something under it, or, over a drop, the cell below — one cell per
 *    opening, while the opening is strictly lower than the source.
 *
 * Every move lands strictly lower than where it started, which is the whole termination argument: total
 * height only ever falls, so every body settles and nothing jitters. An opening is never above the body
 * alone, so a body never grows upward — there is no pressure (a decided design — FLUIDS.md).
 *
 * Cells outside `inRegion` are neither moved nor moved into, but stay active: fluid far from every player
 * freezes mid-flow rather than being forgotten.
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

  const isEmpty = (column: number, row: number): boolean =>
    !solid(column, row) && !field.cells.has(fluidKey(column, row));
  const inReach = (key: number): boolean => !inRegion || inRegion(columnOfKey(key), rowOfKey(key));
  const kindSteps = (kind: FluidKind): boolean => kind !== 'lava' || lavaSteps;
  const move = (from: number, to: number, type: FluidMoveType): void => {
    const kind = field.cells.get(from)!;
    field.cells.delete(from);
    field.cells.set(to, kind);
    arrived.add(to);
    moves.push({ from, to, type });
  };

  // ponytail: sorts the whole active set every tick, O(A log A). Fine at lab scale; bucket by row if
  // a real flood shows up in a profile.
  const order = [...field.active].sort((a, b) => byRowThenSweep(a, b, true, sweepRight));

  // ---- 1. gravity ----
  let stepped = 0;
  const resting: number[] = [];
  for (const key of order) {
    const kind = field.cells.get(key);
    if (kind === undefined) continue;
    if (!inReach(key) || !kindSteps(kind)) {
      waiting.add(key);
      continue;
    }
    stepped++;
    const below = fluidKey(columnOfKey(key), rowOfKey(key) + 1);
    const belowInReach = inReach(below);
    if (isEmpty(columnOfKey(key), rowOfKey(key) + 1) && belowInReach) move(key, below, 'fall');
    else if (isEmpty(columnOfKey(key), rowOfKey(key) + 1)) waiting.add(key);
    else resting.push(key);
  }

  // ---- 2. resting bodies level ----
  const levelled = new Set<number>();
  for (const seed of resting) {
    const kind = field.cells.get(seed);
    if (kind === undefined || levelled.has(seed)) continue;
    const body = collectBody(field, seed, kind, isEmpty);
    for (const key of body) levelled.add(key);

    const sources = body.filter(
      (key) =>
        field.cells.get(fluidKey(columnOfKey(key), rowOfKey(key) - 1)) !== kind &&
        !arrived.has(key) &&
        inReach(key),
    );
    const openings = [...openingsOf(body, isEmpty, solid)].filter(inReach);
    sources.sort((a, b) => byRowThenSweep(a, b, false, sweepRight));
    openings.sort((a, b) => byRowThenSweep(a, b, true, sweepRight));

    for (const opening of openings) {
      const source = takeFarthestHighest(sources, opening);
      if (source === undefined) break;
      if (rowOfKey(opening) <= rowOfKey(source)) break; // the highest source left isn't above it
      move(source, opening, 'merge');
    }
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

// ---- bodies -------------------------------------------------------------------------------------

/**
 * Remove and return, from `sources` (sorted highest row first), the highest source FARTHEST from
 * `opening` along the row.
 *
 * Farthest, not nearest: a body drains from its far end toward its outlet. Taking the nearest cell of a
 * one-cell-thick sheet took the very cell that touched the ledge, which cut the rest of the sheet off
 * from its only drop and stranded it.
 *
 * ponytail: a linear scan of the top row per opening, O(openings × top row). Fine for a lab's bodies;
 * keep the top row in a structure ordered by column if a wide lake drains slowly in a profile.
 */
function takeFarthestHighest(sources: number[], opening: number): number | undefined {
  if (sources.length === 0) return undefined;
  const topRow = rowOfKey(sources[0]);
  const openingColumn = columnOfKey(opening);
  let bestIndex = 0;
  let bestDistance = -1;
  for (let index = 0; index < sources.length && rowOfKey(sources[index]) === topRow; index++) {
    const distance = Math.abs(columnOfKey(sources[index]) - openingColumn);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return sources.splice(bestIndex, 1)[0];
}

/**
 * Bottom row first (`lowestFirst`) or top row first, and within a row in this tick's sweep direction,
 * so the order is deterministic and neither side is favoured.
 */
function byRowThenSweep(a: number, b: number, lowestFirst: boolean, sweepRight: boolean): number {
  const rowDifference = lowestFirst ? rowOfKey(b) - rowOfKey(a) : rowOfKey(a) - rowOfKey(b);
  if (rowDifference !== 0) return rowDifference;
  return sweepRight ? columnOfKey(a) - columnOfKey(b) : columnOfKey(b) - columnOfKey(a);
}

/**
 * Every cell of `kind` connected to `seed` through cells that rest: something directly under them.
 *
 * "Directly under", not "supported all the way down". A stream that has joined a body counts as part of
 * it, which is harmless because only a cell standing on rock may spill (`openingsOf`), so the stream has
 * no openings of its own. A recursive all-the-way-down test was tried and removed once that rule made it
 * redundant: every test passed without it.
 *
 * ponytail: walks the whole body every tick it has an awake cell, so a huge lake fed by one stream pays
 * for the lake. Keep bodies between ticks and update them incrementally if that ever profiles.
 */
function collectBody(
  field: FluidField,
  seed: number,
  kind: FluidKind,
  isEmpty: (column: number, row: number) => boolean,
): number[] {
  const body = [seed];
  const seen = new Set(body);
  for (let index = 0; index < body.length; index++) {
    const column = columnOfKey(body[index]);
    const row = rowOfKey(body[index]);
    for (const [nextColumn, nextRow] of [
      [column - 1, row],
      [column + 1, row],
      [column, row - 1],
      [column, row + 1],
    ]) {
      const key = fluidKey(nextColumn, nextRow);
      if (seen.has(key) || field.cells.get(key) !== kind || isEmpty(nextColumn, nextRow + 1))
        continue;
      seen.add(key);
      body.push(key);
    }
  }
  return body;
}

/**
 * Where a body can put a cell. Beside each of its cells:
 *
 * - the empty cell there, if it has something under it — the body widens onto a floor or a pool;
 * - or, if that cell is over a drop AND the body cell stands on rock, the cell under it — the body
 *   spills over the edge of the floor it stands on.
 *
 * Only ever BESIDE a body cell: an empty cell with the body only underneath it is never an opening, and
 * that omission is what keeps a body from growing upward — no pressure.
 *
 * Only a cell ON ROCK spills. A stream that has reached the pool below is a column of fluid resting on
 * fluid; if its cells could spill, it poured out sideways at every height into a V under the ceiling it
 * came through — the lab's third fault. A pool still overflows its rim: the rim's top is rock, so the
 * cell beside it is a floor opening first, and spills from there.
 */
function openingsOf(
  body: readonly number[],
  isEmpty: (column: number, row: number) => boolean,
  solid: SolidQuery,
): Set<number> {
  const openings = new Set<number>();
  for (const key of body) {
    const row = rowOfKey(key);
    const onRock = solid(columnOfKey(key), row + 1);
    for (const column of [columnOfKey(key) - 1, columnOfKey(key) + 1]) {
      if (!isEmpty(column, row)) continue;
      if (!isEmpty(column, row + 1)) openings.add(fluidKey(column, row));
      else if (onRock) openings.add(fluidKey(column, row + 1));
    }
  }
  return openings;
}
