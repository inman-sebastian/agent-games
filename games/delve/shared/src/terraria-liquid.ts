// terraria-liquid.ts — Terraria's liquid simulation, ported (#90). A translation of Terraria 1.4.0.5's
// Liquid.cs (decompiled): Liquid.Update, UpdateLiquid, AddWater and DelWater, statement by statement, on
// DELVE's dig cells. Every tile holds a liquid level 0–255; liquid moves only through an active list of
// tiles, in the order they were added; a tile that hasn't changed for 8 updates leaves the list.
//
// What's left out is what DELVE doesn't have: slopes, half bricks, platforms, honey, water-lava reactions
// (one liquid per simulation for now), the underworld's evaporation, multiplayer sync, and the panic mode that
// settles a whole world when the list overflows for a minute. Terraria's own quirks are kept — rounded
// averages, deleted films and the odd unit of liquid created — because matching it is the point. See
// docs/FLUIDS.md, "Terraria's liquid".
import { UNIT, type Liquid } from './liquid';

export const LIQUID_WATER = 0;
export const LIQUID_LAVA = 1;

/** Terraria updates liquid every second world update (WorldGen.UpdateWorld): 30 times a second. */
export const TERRARIA_LIQUID_UPDATES_PER_SECOND = 30;

// Liquid.maxLiquid, the buffer's size, and Main.cs's cycles at full graphics quality (17 − 10 · gfxQuality)
const MAX_LIQUID = 25000;
const MAX_LIQUID_BUFFER = 50000;
const CYCLES = 7;
/** A list entry this many updates unchanged is removed (UpdateLiquid's num1, single player). */
const KILL_AFTER = 8;
/** Lava waits this many visits between moves (Liquid.Update's delay for lava). */
const LAVA_DELAY = 5;
export interface TerrariaLiquid extends Liquid {
  /** Liquid per tile, 0–255: Tile.liquid. */
  readonly level: Uint8Array;
  readonly kind: number;
  readonly updatesPerSecond: number;
  /** Entries in the active list (Liquid.numLiquid): 0 once everything has settled. */
  activeCount(): number;
  /** Liquid.AddWater: put a tile's liquid on the active list. */
  addWater(index: number): void;
  /** Pour liquid into a tile as a bucket does: add to its level, then frame the 3×3 around it. */
  pour(index: number, level: number): void;
}

export function createTerrariaLiquid(
  width: number,
  height: number,
  solid: Uint8Array,
  kind: number = LIQUID_WATER,
  seed = 1,
): TerrariaLiquid {
  const count = width * height;
  const rock = solid.slice();
  const level = new Uint8Array(count);
  const checking = new Uint8Array(count); // Tile.checkingLiquid
  const skip = new Uint8Array(count); // Tile.skipLiquid
  const volume = new Int32Array(count);
  const rightVelocity = new Float64Array(count);
  const downVelocity = new Float64Array(count);

  // Main.liquid[] and LiquidBuffer
  const listX = new Int32Array(MAX_LIQUID);
  const listY = new Int32Array(MAX_LIQUID);
  const listKill = new Int32Array(MAX_LIQUID);
  const listDelay = new Int32Array(MAX_LIQUID);
  let numLiquid = 0;
  const bufferX = new Int32Array(MAX_LIQUID_BUFFER);
  const bufferY = new Int32Array(MAX_LIQUID_BUFFER);
  let bufferLength = 0;
  let wetCounter = 0;
  let stuckCount = 0;
  let stuckAmount = 0;
  let stuck = false;

  // WorldGen.genRand, deterministic
  let random = seed >>> 0 || 1;
  const next = (maximum: number): number => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return (random >>> 0) % maximum;
  };

  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  /** Tile.nactive() && Main.tileSolid: outside the world counts as solid. */
  const isSolid = (x: number, y: number): boolean => !inside(x, y) || rock[y * width + x] === 1;
  const get = (x: number, y: number): number => (inside(x, y) ? level[y * width + x] : 0);
  const set = (x: number, y: number, value: number): void => {
    if (inside(x, y)) level[y * width + x] = value & 0xff;
  };
  /** .NET's Math.Round: halves go to the even neighbour. */
  const round = (value: number): number => {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction > 0.5) return floor + 1;
    if (fraction < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
  };

  function addWater(x: number, y: number): void {
    if (!inside(x, y)) return;
    const index = y * width + x;
    if (checking[index] || level[index] === 0 || rock[index] === 1) return;
    if (numLiquid >= MAX_LIQUID - 1) {
      // LiquidBuffer.AddBuffer
      if (bufferLength >= MAX_LIQUID_BUFFER - 2) return;
      checking[index] = 1;
      bufferX[bufferLength] = x;
      bufferY[bufferLength] = y;
      bufferLength++;
      return;
    }
    checking[index] = 1;
    skip[index] = 0;
    listKill[numLiquid] = 0;
    listX[numLiquid] = x;
    listY[numLiquid] = y;
    listDelay[numLiquid] = 0;
    numLiquid++;
  }

  /** Liquid.Update for one list entry. */
  function update(entry: number): void {
    const x = listX[entry];
    const y = listY[entry];
    if (isSolid(x, y)) {
      listKill[entry] = 999;
      return;
    }
    const original = get(x, y);
    if (original === 0) {
      listKill[entry] = 999;
      return;
    }
    if (kind === LIQUID_LAVA) {
      if (listDelay[entry] < LAVA_DELAY) {
        listDelay[entry]++;
        return;
      }
      listDelay[entry] = 0;
    }
    // fall
    if (!isSolid(x, y + 1) && get(x, y + 1) < 255) {
      let flag = false;
      let amount = 255 - get(x, y + 1);
      if (amount > get(x, y)) amount = get(x, y);
      if (amount === 1 && get(x, y) === 255) flag = true;
      if (!flag) set(x, y, get(x, y) - amount);
      set(x, y + 1, get(x, y + 1) + amount);
      addWater(x, y + 1);
      if (inside(x, y + 1)) skip[(y + 1) * width + x] = 1;
      skip[y * width + x] = 1;
      if (!flag) {
        addWater(x - 1, y);
        addWater(x + 1, y);
      }
    }
    // spread along the row
    if (get(x, y) > 0) {
      let flag1 = true;
      let flag2 = true;
      let flag3 = true;
      let flag4 = true;
      if (isSolid(x - 1, y)) flag1 = false;
      else if (isSolid(x - 2, y)) flag3 = false;
      else if (get(x - 2, y) === 0) flag3 = false;
      if (isSolid(x + 1, y)) flag2 = false;
      else if (isSolid(x + 2, y)) flag4 = false;
      else if (get(x + 2, y) === 0) flag4 = false;
      let filmAdjust = 0;
      if (get(x, y) < 3) filmAdjust = -1;
      if (get(x, y) > 250) {
        flag3 = false;
        flag4 = false;
      }
      if (flag1 && flag2) {
        if (flag3 && flag4) {
          let flag5 = true;
          let flag6 = true;
          if (isSolid(x - 3, y)) flag5 = false;
          else if (get(x - 3, y) === 0) flag5 = false;
          if (isSolid(x + 3, y)) flag6 = false;
          else if (get(x + 3, y) === 0) flag6 = false;
          if (flag5 && flag6) {
            spreadOver(x, y, [-1, 1, -2, 2, -3, 3], filmAdjust, 7);
          } else {
            spreadOver(x, y, [-1, 1, -2, 2], filmAdjust, 5);
          }
        } else if (flag3) {
          spreadFour(x, y, -2, filmAdjust);
        } else if (flag4) {
          spreadFour(x, y, 2, filmAdjust);
        } else {
          let average = round((get(x - 1, y) + get(x + 1, y) + get(x, y) + filmAdjust) / 3);
          if (average === 254 && next(30) === 0) average = 255;
          if (get(x - 1, y) !== average) {
            set(x - 1, y, average);
            addWater(x - 1, y);
          }
          if (get(x + 1, y) !== average) {
            set(x + 1, y, average);
            addWater(x + 1, y);
          }
          set(x, y, average);
        }
      } else if (flag1) {
        const average = round((get(x - 1, y) + get(x, y) + filmAdjust) / 2);
        if (get(x - 1, y) !== average) set(x - 1, y, average);
        if (get(x, y) !== average || get(x - 1, y) !== average) addWater(x - 1, y);
        set(x, y, average);
      } else if (flag2) {
        const average = round((get(x + 1, y) + get(x, y) + filmAdjust) / 2);
        if (get(x + 1, y) !== average) set(x + 1, y, average);
        if (get(x, y) !== average || get(x + 1, y) !== average) addWater(x + 1, y);
        set(x, y, average);
      }
    }
    // stay awake while changing
    if (get(x, y) !== original) {
      if (get(x, y) === 254 && original === 255) {
        listKill[entry]++;
      } else {
        addWater(x, y - 1);
        listKill[entry] = 0;
      }
    } else {
      listKill[entry]++;
    }
  }

  /** The 7- and 5-tile averages: every tile in reach set to the rounded mean, woken if it changed. */
  function spreadOver(
    x: number,
    y: number,
    offsets: number[],
    filmAdjust: number,
    divisor: number,
  ): void {
    let sum = get(x, y) + filmAdjust;
    for (const offset of offsets) sum += get(x + offset, y);
    const average = round(sum / divisor);
    let unchanged = 0;
    for (const offset of offsets) {
      if (get(x + offset, y) !== average) {
        set(x + offset, y, average);
        addWater(x + offset, y);
      } else {
        unchanged++;
      }
    }
    for (const offset of offsets) {
      if (get(x + offset, y) !== average || get(x, y) !== average) addWater(x + offset, y);
    }
    if (unchanged !== offsets.length || get(x, y - 1) <= 0) set(x, y, average);
  }

  /** The 4-tile average, reaching two tiles to one side (`far` is −2 or 2). */
  function spreadFour(x: number, y: number, far: number, filmAdjust: number): void {
    const average = round(
      (get(x - 1, y) + get(x + 1, y) + get(x + far, y) + get(x, y) + filmAdjust) / 4,
    );
    for (const offset of [-1, 1, far]) {
      if (get(x + offset, y) !== average || get(x, y) !== average) {
        set(x + offset, y, average);
        addWater(x + offset, y);
      }
    }
    set(x, y, average);
  }

  /** Liquid.DelWater: an entry leaves the list, deleting a film and waking what might still move. */
  function delWater(entry: number): void {
    const x = listX[entry];
    const y = listY[entry];
    const here = y * width + x;
    const minimum = 2;
    if (get(x, y) < minimum) {
      set(x, y, 0);
      if (get(x - 1, y) < minimum) set(x - 1, y, 0);
      else addWater(x - 1, y);
      if (get(x + 1, y) < minimum) set(x + 1, y, 0);
      else addWater(x + 1, y);
    } else if (get(x, y) < 20) {
      const leftLower = get(x - 1, y) < get(x, y) && !isSolid(x - 1, y);
      const rightLower = get(x + 1, y) < get(x, y) && !isSolid(x + 1, y);
      const belowNotFull = get(x, y + 1) < 255 && !isSolid(x, y + 1);
      if (leftLower || rightLower || belowNotFull) set(x, y, 0);
    } else if (get(x, y + 1) < 255 && !isSolid(x, y + 1) && !stuck && !isSolid(x, y)) {
      listKill[entry] = 0;
      return;
    }
    if (get(x, y) < 250 && get(x, y - 1) > 0) addWater(x, y - 1);
    if (get(x, y) !== 0) {
      if (
        get(x + 1, y) > 0 &&
        get(x + 1, y) < 250 &&
        !isSolid(x + 1, y) &&
        get(x, y) !== get(x + 1, y)
      )
        addWater(x + 1, y);
      if (
        get(x - 1, y) > 0 &&
        get(x - 1, y) < 250 &&
        !isSolid(x - 1, y) &&
        get(x, y) !== get(x - 1, y)
      )
        addWater(x - 1, y);
    }
    numLiquid--;
    checking[here] = 0;
    listX[entry] = listX[numLiquid];
    listY[entry] = listY[numLiquid];
    listKill[entry] = listKill[numLiquid];
  }

  /** Liquid.UpdateLiquid: one slice of the list, and at the end of a cycle, the sweep of sleeping entries. */
  function updateLiquid(): void {
    wetCounter++;
    const slice = Math.floor(MAX_LIQUID / CYCLES);
    const from = slice * (wetCounter - 1);
    let to = slice * wetCounter;
    if (wetCounter === CYCLES) to = numLiquid;
    if (to > numLiquid) {
      to = numLiquid;
      wetCounter = CYCLES;
    }
    for (let entry = from; entry < to; entry++) {
      const index = listY[entry] * width + listX[entry];
      if (!skip[index]) update(entry);
      else skip[index] = 0;
    }
    if (wetCounter >= CYCLES) {
      wetCounter = 0;
      for (let entry = numLiquid - 1; entry >= 0; entry--) {
        if (listKill[entry] >= KILL_AFTER) {
          const index = listY[entry] * width + listX[entry];
          if (level[index] === 254) level[index] = 255;
          delWater(entry);
        }
      }
      const refill = Math.min(numLiquid, bufferLength);
      for (let k = 0; k < refill; k++) {
        const x = bufferX[0];
        const y = bufferY[0];
        checking[y * width + x] = 0;
        addWater(x, y);
        // LiquidBuffer.DelBuffer(0): the last entry moves into the first
        bufferLength--;
        bufferX[0] = bufferX[bufferLength];
        bufferY[0] = bufferY[bufferLength];
      }
      if (numLiquid > 0 && numLiquid > stuckAmount - 50 && numLiquid < stuckAmount + 50) {
        stuckCount++;
        if (stuckCount >= 10000) {
          stuck = true;
          for (let entry = numLiquid - 1; entry >= 0; entry--) delWater(entry);
          stuck = false;
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
        stuckAmount = numLiquid;
      }
    }
    for (let index = 0; index < count; index++)
      volume[index] = Math.floor((level[index] * UNIT) / 255);
  }

  /**
   * WorldGen.SquareTileFrame's liquid check: TileFrame on the 3×3 around a changed tile, column by column, and
   * each wakes the liquid there. The order matters: it's the order the tiles join the active list.
   */
  function wakeAround(x: number, y: number): void {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) addWater(x + dx, y + dy);
  }

  return {
    width,
    height,
    level,
    kind,
    volume,
    rightVelocity,
    downVelocity,
    updatesPerSecond: TERRARIA_LIQUID_UPDATES_PER_SECOND,
    activeCount: () => numLiquid,
    addWater: (index) => {
      const x = index % width;
      addWater(x, (index - x) / width);
    },
    pour: (index, amount) => {
      if (rock[index] === 1) return;
      level[index] = Math.min(255, level[index] + amount);
      const x = index % width;
      wakeAround(x, (index - x) / width);
    },
    isSolid: (index) => rock[index] === 1,
    setSolid: (index, solidNow) => {
      rock[index] = solidNow ? 1 : 0;
      const x = index % width;
      wakeAround(x, (index - x) / width);
    },
    add: (index, units) => {
      if (rock[index] === 1) return;
      level[index] = Math.min(255, level[index] + Math.round((units * 255) / UNIT));
      volume[index] = Math.floor((level[index] * UNIT) / 255);
      const x = index % width;
      wakeAround(x, (index - x) / width);
    },
    step: updateLiquid,
    total: () => {
      let sum = 0;
      for (let index = 0; index < count; index++) sum += level[index];
      return Math.floor((sum * UNIT) / 255);
    },
  };
}
