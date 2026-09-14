// tile-liquid.ts — DELVE's liquid (#90): Terraria's fall, with flat pools. Each dig cell holds a level 0–255.
// An update goes up the rows from the bottom: the row above falls into each row, the row's resting liquid is
// levelled flat, and the row above tops it up again. Integer levels, only ever moved: volume is exact. See docs/FLUIDS.md, "Tile liquid".
import { UNIT, type Liquid } from './liquid';

export const LIQUID_WATER = 0;
export const LIQUID_LAVA = 1;

/** Terraria's 30 updates a second on 16 px tiles, at DELVE's 8 px cells. */
export const WATER_UPDATES_PER_SECOND = 60;
/** Terraria moves lava on every fifth visit. */
export const LAVA_UPDATES_PER_SECOND = 12;

const FULL = 255;
/** A spread never gets thinner than this: one art pixel of an 8 px cell. */
export const MIN_FILM = 32;
/**
 * Across dry rock a spread reaches one cell further every this many updates: 20 cells a second for water,
 * about 10 Terraria tiles.
 */
const SPREAD_EVERY = 3;
/** The most a run pours over an edge into its spill each update: an eighth of a cell, a curtain. */
const SPILL_PER_UPDATE = 32;

export interface TileLiquid extends Liquid {
  /** Liquid per cell, 0–255. */
  readonly level: Uint8Array;
  /** 1 where a cell rests: rock below, or a full resting cell a stream isn't landing on. Updated by each step. */
  readonly resting: Uint8Array;
  readonly kind: number;
  readonly updatesPerSecond: number;
}

export function createTileLiquid(
  width: number,
  height: number,
  solid: Uint8Array,
  kind: number = LIQUID_WATER,
): TileLiquid {
  const count = width * height;
  const rock = solid.slice();
  const level = new Uint8Array(count);
  const resting = new Uint8Array(count);
  const fed = new Uint8Array(count);
  /** A levelled run's top level on each of its cells, so a whole run holds or doesn't, remainder or not. */
  const runTop = new Uint8Array(count);
  const volume = new Int32Array(count);
  const rightVelocity = new Float64Array(count);
  const downVelocity = new Float64Array(count);
  let updates = 0;
  /** 1 on the updates a spread may reach one cell further across dry rock. */
  let spreading = 0;

  /** Outside the grid counts as rock. */
  const rockAt = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= width || y >= height || rock[y * width + x] === 1;

  /**
   * Row `y − 1` falls into row `y`: every cell moves as much as fits into the open cell below. A cell fed by a
   * stream — a falling cell with no liquid either side — is marked: a stream landing on it doesn't make it hold,
   * so the stream never stands up as a column.
   */
  function fallInto(y: number): void {
    if (y === 0) return;
    for (let x = 0; x < width; x++) {
      const below = y * width + x;
      const here = below - width;
      if (level[here] === 0 || rock[below] === 1) continue;
      const moved = Math.min(level[here], FULL - level[below]);
      if (moved === 0) continue;
      level[here] -= moved;
      level[below] += moved;
      const alone =
        (x === 0 || level[here - 1] === 0) && (x === width - 1 || level[here + 1] === 0);
      if (alone) fed[below] = 1;
    }
  }

  /** Whether the cell rests, from the row below's resting (already worked out for this update). */
  function restsAt(x: number, y: number): boolean {
    if (rockAt(x, y + 1)) return true;
    const below = (y + 1) * width + x;
    const full = Math.max(level[below], runTop[below]);
    return full === FULL && resting[below] === 1 && fed[below] === 0;
  }

  /**
   * Level one run, cells `start..end` of row `y`. `drain` is a cell inside the run that doesn't rest (a hole
   * below), or −1. Spills are the non-resting cells just outside the run, or −1.
   */
  function levelRun(y: number, start: number, end: number, drain: number): void {
    const row = y * width;
    let wetFirst = -1;
    let wetLast = -1;
    let total = 0;
    let weighted = 0;
    let overLiquid = false;
    for (let x = start; x <= end; x++) {
      if (resting[row + x] && !rockAt(x, y + 1)) overLiquid = true;
      if (level[row + x] === 0) continue;
      if (wetFirst < 0) wetFirst = x;
      wetLast = x;
      total += level[row + x];
      weighted += x * level[row + x];
    }
    if (total === 0) return;
    // over resting liquid the spread is instant; across dry rock it reaches one cell further now and then
    let first = wetFirst;
    let budget = spreading;
    while (first > start && (!rockAt(first - 1, y + 1) || budget-- > 0)) first--;
    let last = wetLast;
    budget = spreading;
    while (last < end && (!rockAt(last + 1, y + 1) || budget-- > 0)) last++;
    const leftSpill = start > 0 && !rockAt(start - 1, y) && !restsAt(start - 1, y) ? start - 1 : -1;
    const rightSpill = !rockAt(end + 1, y) && !restsAt(end + 1, y) ? end + 1 : -1;
    // on rock, never thinner than a film: shrink toward the drain, or the spill, or the middle of the liquid
    const widest = Math.max(1, Math.floor(total / MIN_FILM));
    if (!overLiquid && last - first + 1 > widest) {
      // only toward an outlet the spread already reaches, so a puddle never jumps to one
      let anchor = Math.floor(weighted / total);
      if (drain >= first && drain <= last) anchor = drain;
      else if (leftSpill >= 0 && first === start && !(rightSpill >= 0 && last === end))
        anchor = start;
      else if (rightSpill >= 0 && last === end && !(leftSpill >= 0 && first === start))
        anchor = end;
      first = Math.max(start, Math.min(anchor - (widest >> 1), end - widest + 1));
      last = first + widest - 1;
    }
    for (let x = start; x <= end; x++) {
      if (x < first || x > last) level[row + x] = 0;
    }
    const cells = last - first + 1;
    // a spill takes a little each update, up to the run's level, and never gives back
    for (const spill of [first === start ? leftSpill : -1, last === end ? rightSpill : -1]) {
      if (spill < 0) continue;
      const index = row + spill;
      const intake = Math.min(SPILL_PER_UPDATE, Math.floor(total / cells) - level[index]);
      if (intake <= 0) continue;
      level[index] += intake;
      total -= intake;
    }
    const share = Math.floor(total / cells);
    let remainder = total - share * cells;
    const top = share + (remainder > 0 ? 1 : 0);
    for (let x = first; x <= last; x++) {
      level[row + x] = share + (remainder > 0 ? 1 : 0);
      runTop[row + x] = top;
      if (remainder > 0) remainder--;
    }
  }

  function levelRows(): void {
    for (let y = height - 1; y >= 0; y--) {
      const row = y * width;
      fed.fill(0, row, row + width);
      runTop.fill(0, row, row + width);
      fallInto(y);
      for (let x = 0; x < width; x++) {
        resting[row + x] = rock[row + x] === 0 && restsAt(x, y) ? 1 : 0;
      }
      let x = 0;
      while (x < width) {
        if (!resting[row + x]) {
          x++;
          continue;
        }
        // a run: resting cells, bridging single non-resting cells between them
        const start = x;
        let drain = -1;
        while (x + 1 < width) {
          if (resting[row + x + 1]) x++;
          else if (x + 2 < width && rock[row + x + 1] === 0 && resting[row + x + 2]) {
            if (drain < 0) drain = x + 1;
            x += 2;
          } else break;
        }
        levelRun(y, start, x, drain);
        x++;
      }
      // what spread out of the row is replaced from above at once, so the liquid above it still rests
      fallInto(y);
    }
  }

  function step(): void {
    spreading = updates % SPREAD_EVERY === 0 ? 1 : 0;
    updates++;
    levelRows();
    for (let index = 0; index < count; index++) {
      volume[index] = Math.floor((level[index] * UNIT) / FULL);
    }
  }

  return {
    width,
    height,
    level,
    resting,
    kind,
    volume,
    rightVelocity,
    downVelocity,
    updatesPerSecond: kind === LIQUID_LAVA ? LAVA_UPDATES_PER_SECOND : WATER_UPDATES_PER_SECOND,
    isSolid: (index) => rock[index] === 1,
    setSolid: (index, solidNow) => {
      rock[index] = solidNow ? 1 : 0;
    },
    add: (index, units) => {
      if (rock[index] === 1) return;
      level[index] = Math.min(FULL, level[index] + Math.round((units * FULL) / UNIT));
      volume[index] = Math.floor((level[index] * UNIT) / FULL);
    },
    step,
    total: () => {
      let sum = 0;
      for (let index = 0; index < count; index++) sum += level[index];
      return Math.floor((sum * UNIT) / FULL);
    },
  };
}
