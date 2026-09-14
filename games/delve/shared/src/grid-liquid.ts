// grid-liquid.ts — liquid the way Terraria moves it (#90): no momentum, no pressure solve. Every tick, cell by
// cell from the bottom row up, water falls into the cell below as far as it fits, then evens out with the
// open cells beside it in its row. Simple, deterministic, and it looks like the blocks it sits among. The
// alternative to the cell pipes (liquid.ts), behind the same interface so either can be drawn and compared.
//
// After Terraria's Liquid.cs (read in its decompiled source), with one change: volume is exact. Terraria
// writes rounded averages and deletes thin films, and players duplicate water with it; here an average's
// remainder is handed out unit by unit, and nothing is deleted. See docs/FLUIDS.md, "The grid liquid".
import { UNIT, type Liquid } from './liquid';

export interface GridLiquidParams {
  /** Ticks per second. */
  readonly ticksPerSecond: number;
  /** How far along its row a cell evens out with wet neighbours, cells (Terraria: 3). */
  readonly reach: number;
  /** A cell holding less than this doesn't spread sideways: a film stays put instead of creeping forever. */
  readonly film: number;
}

export const GRID_WATER_PARAMS: GridLiquidParams = {
  ticksPerSecond: 30, // Terraria updates its liquid every second world update, 30 times a second
  reach: 3,
  film: UNIT / 64,
};

/** Lava: the same rules, a fifth as often (Terraria moves lava on every sixth visit, honey every eleventh). */
export const GRID_LAVA_PARAMS: GridLiquidParams = {
  ...GRID_WATER_PARAMS,
  ticksPerSecond: 6,
};

/** A row whose cells differ by no more than this is even: left alone, so still water sleeps. */
const EVEN = 2;

export function createGridLiquid(
  width: number,
  height: number,
  solid: Uint8Array,
  params: GridLiquidParams = GRID_WATER_PARAMS,
): Liquid & { readonly substepsPerSecond: number } {
  const count = width * height;
  const rock = solid.slice();
  const volume = new Int32Array(count);
  // what moved last tick, as speeds, so renderers can tell falling water from resting water
  const rightVelocity = new Float64Array(count);
  const downVelocity = new Float64Array(count);
  let tick = 0;

  const open = (index: number): boolean => rock[index] === 0;

  /** Drop everything that fits into the cell below. Returns whether anything moved. */
  function fall(index: number, row: number): boolean {
    if (row + 1 >= height) return false;
    const below = index + width;
    if (!open(below)) return false;
    const room = UNIT - volume[below];
    if (room <= 0) return false;
    const moved = Math.min(room, volume[index]);
    volume[index] -= moved;
    volume[below] += moved;
    // it moved a whole cell this tick, however little of it: that's its speed (a thin stream is fast, not slow)
    downVelocity[index] = moved > 0 ? params.ticksPerSecond : 0;
    return moved > 0;
  }

  /** Even out a cell with the open cells beside it: the next ones always, farther ones only if already wet. */
  function spread(index: number, column: number, leftFirst: boolean): void {
    if (volume[index] < params.film) return;
    const members = [index];
    for (const direction of leftFirst ? [-1, 1] : [1, -1]) {
      for (let step = 1; step <= params.reach; step++) {
        const neighbourColumn = column + direction * step;
        if (neighbourColumn < 0 || neighbourColumn >= width) break;
        const neighbour = index + direction * step;
        if (!open(neighbour)) break;
        if (step > 1 && volume[neighbour] === 0) break; // past the next cell, only into water (Terraria)
        members.push(neighbour);
      }
    }
    if (members.length < 2) return;
    let sum = 0;
    let least = Infinity;
    let most = -Infinity;
    for (const member of members) {
      sum += volume[member];
      least = Math.min(least, volume[member]);
      most = Math.max(most, volume[member]);
    }
    if (most - least <= EVEN) return;
    const share = Math.floor(sum / members.length);
    let remainder = sum - share * members.length;
    // the remainder goes to the cells nearest the one spreading, in the tick's direction: exact, and it
    // doesn't drift the row one way over time
    for (const member of members) {
      const before = volume[member];
      let after = share;
      if (remainder > 0) {
        after++;
        remainder--;
      }
      volume[member] = after;
      const difference = after - before;
      if (member !== index && difference !== 0) {
        const face = member < index ? member : index;
        rightVelocity[face] +=
          ((member > index ? difference : -difference) / UNIT) * params.ticksPerSecond;
      }
    }
  }

  /**
   * Water spreads sideways only when something holds it up: rock, or full water below that isn't itself
   * falling this tick (the rows below are done already). The one rule not in Terraria: spreading from falling
   * water sprayed a stream sideways into the air beside it, and Terraria's own guard (a cell that fell this
   * tick doesn't spread) stalled flood fronts here, where every cell updates every tick.
   */
  function heldUp(index: number, row: number): boolean {
    if (row + 1 >= height) return true;
    const below = index + width;
    if (!open(below)) return true;
    return volume[below] >= UNIT && downVelocity[below] === 0;
  }

  function step(): void {
    rightVelocity.fill(0);
    downVelocity.fill(0);
    const leftFirst = tick % 2 === 0;
    for (let row = height - 1; row >= 0; row--) {
      for (let offset = 0; offset < width; offset++) {
        const column = leftFirst ? offset : width - 1 - offset;
        const index = row * width + column;
        if (!open(index) || volume[index] === 0) continue;
        fall(index, row);
        if (volume[index] > 0 && heldUp(index, row)) spread(index, column, leftFirst);
      }
    }
    tick++;
  }

  function setSolid(index: number, solidNow: boolean): void {
    rock[index] = solidNow ? 1 : 0;
    if (!solidNow || volume[index] === 0) return;
    // displaced liquid moves up to the nearest open cell above
    let above = index - width;
    while (above >= 0 && rock[above] === 1) above -= width;
    if (above < 0) {
      rock[index] = 0; // nowhere to go: keep it, so the total stays exact
      return;
    }
    volume[above] += volume[index];
    volume[index] = 0;
  }

  return {
    width,
    height,
    volume,
    rightVelocity,
    downVelocity,
    substepsPerSecond: params.ticksPerSecond,
    isSolid: (index) => rock[index] === 1,
    setSolid,
    add: (index, units) => {
      if (rock[index] === 0) volume[index] += units;
    },
    step,
    total: () => {
      let sum = 0;
      for (let index = 0; index < count; index++) sum += volume[index];
      return sum;
    },
  };
}
