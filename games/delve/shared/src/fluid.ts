// fluid.ts — simulated water and lava (#30): a Terraria-style cellular automaton on the collision
// grid. Pure and DOM-free like the rest of the ruleset, and deliberately world-agnostic — it asks a
// `solid(column, row)` predicate rather than reading a WorldState, so the lab can drive it over a
// hand-built box and the game can later drive it over the real terrain. The model, its trade-offs and
// what is still open: docs/FLUIDS.md.

export type FluidKind = 'water' | 'lava';

/** A full cell. Integer levels, so mass is conserved exactly and the step is identical on every machine. */
export const MAX_LEVEL = 255;

/** Lava steps once every this many ticks — slow and heavy next to water. */
export const LAVA_TICK_INTERVAL = 4;

/**
 * The smallest level difference each kind spreads sideways across.
 *
 * Water's is 1: it levels out until neighbours differ by at most one unit. Lava's is large, which
 * leaves a thick, lumpy front instead of a film.
 */
const MIN_SPREAD: Readonly<Record<FluidKind, number>> = { water: 1, lava: 24 };

export type SolidQuery = (column: number, row: number) => boolean;

/** Whether a cell is inside the region being simulated this tick — the active region near players. */
export type RegionQuery = (column: number, row: number) => boolean;

/**
 * The fluid in a world. Sparse: a cell with no fluid has no entry.
 *
 * `cells` maps a packed cell key (`fluidKey`) to a packed value — the level in the low byte, the kind
 * above it — so a field is one flat Map of numbers, cheap to diff and to put on the wire.
 */
export interface FluidField {
  cells: Map<number, number>;
  /** Cells that might change next tick. A settled body leaves it, and costs nothing. */
  active: Set<number>;
  tick: number;
}

export interface FluidStepResult {
  /** Cells actually stepped this tick — the CPU cost. */
  stepped: number;
  /** Cells whose level or kind changed this tick — what replication would have to send. */
  changed: ReadonlySet<number>;
}

// ---- packing ------------------------------------------------------------------------------------

const COORD_OFFSET = 32768; // columns and rows are signed; this shifts them into 16 unsigned bits
const COORD_RANGE = 65536;

/** A cell's key. Covers columns and rows in `[-32768, 32767]`, far beyond the largest world. */
export const fluidKey = (column: number, row: number): number =>
  (row + COORD_OFFSET) * COORD_RANGE + (column + COORD_OFFSET);

/** The column and row a `fluidKey` was packed from. */
export const columnOfKey = (key: number): number => (key % COORD_RANGE) - COORD_OFFSET;
export const rowOfKey = (key: number): number => Math.floor(key / COORD_RANGE) - COORD_OFFSET;

const KIND_CODES: readonly FluidKind[] = ['water', 'lava'];
const LEVEL_BITS = 8;
const LEVEL_MASK = 0xff;

const pack = (kind: FluidKind, level: number): number =>
  ((KIND_CODES.indexOf(kind) + 1) << LEVEL_BITS) | level;
const levelOf = (value: number | undefined): number =>
  value === undefined ? 0 : value & LEVEL_MASK;
const kindOf = (value: number): FluidKind => KIND_CODES[(value >> LEVEL_BITS) - 1];

// ---- public API ---------------------------------------------------------------------------------

export function newFluidField(): FluidField {
  return { cells: new Map(), active: new Set(), tick: 0 };
}

/** The fluid in a cell, or null for none. */
export function fluidAt(
  field: FluidField,
  column: number,
  row: number,
): { kind: FluidKind; level: number } | null {
  const value = field.cells.get(fluidKey(column, row));
  if (value === undefined) return null;
  return { kind: kindOf(value), level: levelOf(value) };
}

/** The total of one kind in the field. Conserved by `stepFluid`, exactly. */
export function fluidMass(field: FluidField, kind: FluidKind): number {
  let total = 0;
  for (const value of field.cells.values()) {
    if (kindOf(value) === kind) total += levelOf(value);
  }
  return total;
}

/**
 * Add up to `amount` of `kind` to one cell, and return how much it accepted.
 *
 * Refused outright by rock and by a cell holding the other kind — kinds don't mix (FLUIDS.md).
 */
export function pourFluid(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  amount: number,
  solid: SolidQuery,
): number {
  if (amount <= 0 || solid(column, row)) return 0;
  const key = fluidKey(column, row);
  const value = field.cells.get(key);
  if (value !== undefined && kindOf(value) !== kind) return 0;
  const accepted = Math.min(Math.floor(amount), MAX_LEVEL - levelOf(value));
  if (accepted === 0) return 0;
  field.cells.set(key, pack(kind, levelOf(value) + accepted));
  wakeAround(field, column, row);
  return accepted;
}

/**
 * Wake the fluid around a cell whose terrain changed.
 *
 * The step only visits active cells, so a settled lake sleeps through its own breach unless whatever
 * dug the wall reports it here.
 */
export function wakeAround(field: FluidField, column: number, row: number): void {
  for (const [dc, dr] of NEIGHBOURHOOD) {
    const key = fluidKey(column + dc, row + dr);
    if (field.cells.has(key)) field.active.add(key);
  }
}

/**
 * Advance the fluid one tick.
 *
 * Each active cell falls as far as the cell below allows, then shares what is left with its LOWER
 * left/right neighbours as an integer average, the remainder dealt out a unit at a time — so no unit
 * is created or destroyed, and both moves strictly lower the fluid's energy, which is why every closed body settles.
 * Bottom row first, so fluid falls one cell per tick; the sideways sweep alternates direction each
 * tick so neither side is favoured.
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
  const nextActive = new Set<number>();
  const changed = new Set<number>();

  // ponytail: sorts the whole active set every tick, O(A log A). Fine at lab scale; bucket by row if
  // a real flood shows up in a profile.
  const order = [...field.active].sort((a, b) => {
    const rowDifference = rowOfKey(b) - rowOfKey(a);
    if (rowDifference !== 0) return rowDifference;
    return sweepRight ? columnOfKey(a) - columnOfKey(b) : columnOfKey(b) - columnOfKey(a);
  });

  const setLevel = (key: number, kind: FluidKind, level: number): void => {
    if (level === 0) field.cells.delete(key);
    else field.cells.set(key, pack(kind, level));
    changed.add(key);
  };

  let stepped = 0;
  for (const key of order) {
    const value = field.cells.get(key);
    if (value === undefined) continue; // drained earlier this tick
    const column = columnOfKey(key);
    const row = rowOfKey(key);
    const kind = kindOf(value);
    const waiting = (inRegion && !inRegion(column, row)) || (kind === 'lava' && !lavaSteps);
    if (waiting) {
      nextActive.add(key);
      continue;
    }
    stepped++;
    let level = levelOf(value);

    level = fall(field, column, row, kind, level, solid, setLevel);
    if (level > 0) level = spread(field, column, row, kind, level, sweepRight, solid, setLevel);
    if (level !== levelOf(value)) setLevel(key, kind, level);
  }

  // Everything that changed, and everything that could now flow because of it, is awake next tick.
  for (const key of changed) {
    const column = columnOfKey(key);
    const row = rowOfKey(key);
    for (const [dc, dr] of NEIGHBOURHOOD) {
      const neighbour = fluidKey(column + dc, row + dr);
      if (field.cells.has(neighbour)) nextActive.add(neighbour);
    }
  }
  field.active = nextActive;
  return { stepped, changed };
}

// ---- the two moves ------------------------------------------------------------------------------

/** Self, and the four cells that can flow into or out of it: above falls in, the sides spread in. */
const NEIGHBOURHOOD: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

type SetLevel = (key: number, kind: FluidKind, level: number) => void;

/** Move as much as fits into the cell below. Returns what is left in this cell. */
function fall(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  level: number,
  solid: SolidQuery,
  setLevel: SetLevel,
): number {
  if (solid(column, row + 1)) return level;
  const belowKey = fluidKey(column, row + 1);
  const below = field.cells.get(belowKey);
  if (below !== undefined && kindOf(below) !== kind) return level;
  const moved = Math.min(level, MAX_LEVEL - levelOf(below));
  if (moved === 0) return level;
  setLevel(belowKey, kind, levelOf(below) + moved);
  return level - moved;
}

/**
 * Average this cell with its lower open neighbours. Returns what is left in this cell.
 *
 * Only LOWER neighbours take part, and this cell gets the first unit of any remainder — which is what
 * makes a one-unit difference stable instead of a unit that flip-flops between two cells forever.
 */
function spread(
  field: FluidField,
  column: number,
  row: number,
  kind: FluidKind,
  level: number,
  sweepRight: boolean,
  solid: SolidQuery,
  setLevel: SetLevel,
): number {
  const sides = sweepRight ? [column + 1, column - 1] : [column - 1, column + 1];
  const minSpread = MIN_SPREAD[kind];
  const takers: { key: number; level: number }[] = [];
  let total = level;
  for (const side of sides) {
    if (solid(side, row)) continue;
    const key = fluidKey(side, row);
    const value = field.cells.get(key);
    if (value !== undefined && kindOf(value) !== kind) continue;
    const sideLevel = levelOf(value);
    if (level - sideLevel < minSpread) continue;
    takers.push({ key, level: sideLevel });
    total += sideLevel;
  }
  if (takers.length === 0) return level;

  // The remainder is dealt out one unit each — this cell first, then the takers in sweep order — so
  // everyone ends within one unit of each other. Keeping all of it here left a stable spike: 0, 2, 0
  // averages to a share of 0 with 2 left over, and never moved again. The property test found it.
  const share = Math.floor(total / (takers.length + 1));
  let remainder = total - share * (takers.length + 1);
  const kept = share + (remainder > 0 ? 1 : 0);
  if (remainder > 0) remainder--;
  for (const taker of takers) {
    const next = share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    if (taker.level !== next) setLevel(taker.key, kind, next);
  }
  return kept;
}
