// liquid.ts — simulated water and lava on the dig grid (#90). Cell pipes: every cell holds an integer volume,
// and every open face between two cells carries a velocity that the difference in hydraulic head speeds up
// or slows down (virtual pipes, after O'Brien & Hodgins 1995 and Mei, Decaudin & Hu 2007, on a vertical
// grid). Full cells are very slightly compressible, which is how the weight of water above becomes pressure
// that pushes water sideways out of an opening, or up the far leg of a U-bend.
//
// Pure and deterministic: integer volumes; every transfer computed from the start-of-step state and moved
// as a whole number of units, so update order doesn't matter and the total never changes. Only arithmetic,
// floor, min, max and abs, which are bit-identical across JavaScript engines. See docs/FLUIDS.md, "The model".
//
// Rows grow downward. A cell is one dig cell (8 art px).

/** Volume units in one full cell. Fine enough that a slow trickle still moves whole units every substep. */
export const UNIT = 1 << 16;

export interface LiquidParams {
  /** Cells per second². */
  readonly gravity: number;
  /** Substeps per second. */
  readonly substepsPerSecond: number;
  /**
   * How much more than a full cell a cell holds per cell of head above it. Small enough that a deep pool
   * hides little volume in compression; large enough to stay stable at this substep rate
   * (Δt·√(gravity/compressibility) ≤ 0.6).
   */
  readonly compressibility: number;
  /** Fraction of a face's velocity kept each substep: how fast sloshing dies away. A baked constant. */
  readonly velocityKept: number;
  /** A cell less full than this doesn't spread sideways: a film stays put instead of creeping forever. */
  readonly film: number;
  /**
   * Velocity kept each substep across a floor between two full cells: there, water only moves to compress
   * or relax, and with the free surface's gentle damping that compression rang for seconds in a pool at
   * rest. Damped hard, it stops. Side faces keep the gentle damping even when full, or a breach's bulk flow
   * (which runs through full cells) turns to syrup, and so do falls and surges.
   */
  readonly pressureVelocityKept: number;
}

/** Twenty percent of a face's velocity survives a second: a breach surges and settles within seconds. */
const WATER_VELOCITY_KEPT_PER_SUBSTEP = 0.9933161993; // 0.2^(1/240), baked: Math.pow isn't bit-portable

export const WATER_PARAMS: LiquidParams = {
  gravity: 92, // the player's 736 art px/s² in 8 px cells
  substepsPerSecond: 240,
  compressibility: 0.01,
  velocityKept: WATER_VELOCITY_KEPT_PER_SUBSTEP,
  film: 0.02,
  pressureVelocityKept: 0.9,
};

/** Faces move at most this much of a cell per substep: the explicit step's stability limit. */
const MAX_CELLS_PER_SUBSTEP = 0.5;
/**
 * Water counts as held up from below once the cell under it is this full; between that and full, its
 * sideways push ramps in. Water on air falls instead of spreading from mid-air.
 */
const SUPPORT_FROM = 0.9;

export interface Liquid {
  readonly width: number;
  readonly height: number;
  /** Units per cell. Read-only to callers: change it through `add`. */
  readonly volume: Int32Array;
  /** Velocity across each cell's right face, cells/s (positive rightward). */
  readonly rightVelocity: Float64Array;
  /** Velocity across each cell's bottom face, cells/s (positive downward). */
  readonly downVelocity: Float64Array;
  isSolid(index: number): boolean;
  /** The rock changed at a cell (a dig or a build). Liquid in a cell that becomes rock moves up out of it. */
  setSolid(index: number, solid: boolean): void;
  /** Pour `units` of liquid into a cell. */
  add(index: number, units: number): void;
  /** Advance one substep. */
  step(): void;
  /** Total units, for conservation checks. */
  total(): number;
}

export function createLiquid(
  width: number,
  height: number,
  solid: Uint8Array,
  params: LiquidParams = WATER_PARAMS,
): Liquid {
  const cellCount = width * height;
  const rock = solid.slice();
  const volume = new Int32Array(cellCount);
  const rightVelocity = new Float64Array(cellCount);
  const downVelocity = new Float64Array(cellCount);
  // scratch, reused every substep
  const rightTransfer = new Float64Array(cellCount);
  const downTransfer = new Float64Array(cellCount);
  const outflow = new Float64Array(cellCount);
  const change = new Int32Array(cellCount);

  const substep = 1 / params.substepsPerSecond;
  const speedLimit = MAX_CELLS_PER_SUBSTEP / substep;

  const fill = (index: number): number => volume[index] / UNIT;

  /** Head of a cell for flow through its floor or ceiling. Up is positive: the cell's floor is at −row. */
  function verticalHead(index: number, row: number): number {
    const fullness = fill(index);
    if (fullness > 1) return -row + 1 + (fullness - 1) / params.compressibility;
    return -row + fullness;
  }

  /** Head for flow through a side: water only pushes sideways as much as it's held up from below. */
  function sideHead(index: number, row: number): number {
    const fullness = fill(index);
    if (fullness > 1) return -row + 1 + (fullness - 1) / params.compressibility;
    const onFloor = row + 1 >= height || rock[index + width] === 1;
    let support = 1;
    if (!onFloor) {
      const belowFullness = fill(index + width);
      support = Math.min(1, Math.max(0, (belowFullness - SUPPORT_FROM) / (1 - SUPPORT_FROM)));
    }
    return -row + fullness * support;
  }

  function accelerate(velocity: number, headDifference: number, kept: number): number {
    const sped = (velocity + substep * params.gravity * headDifference) * kept;
    return Math.max(-speedLimit, Math.min(speedLimit, sped));
  }

  /** Velocity kept across the floor between two cells. */
  function keptBetween(first: number, second: number): number {
    const bothFull = volume[first] >= UNIT && volume[second] >= UNIT;
    return bothFull ? params.pressureVelocityKept : params.velocityKept;
  }

  function planFlows(): void {
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        rightTransfer[index] = 0;
        downTransfer[index] = 0;
        if (rock[index] === 1) {
          rightVelocity[index] = 0;
          downVelocity[index] = 0;
          continue;
        }
        const right = index + 1;
        if (column + 1 < width && rock[right] === 0) {
          const kept = params.velocityKept;
          let velocity = accelerate(
            rightVelocity[index],
            sideHead(index, row) - sideHead(right, row),
            kept,
          );
          const upwind = velocity > 0 ? index : right;
          // a shallow cell pours through a shallow window
          const window = Math.min(1, fill(upwind));
          if (window < params.film) velocity = 0;
          rightVelocity[index] = velocity;
          rightTransfer[index] = velocity * window * substep;
        } else {
          rightVelocity[index] = 0;
        }
        const below = index + width;
        if (row + 1 < height && rock[below] === 0) {
          const kept = keptBetween(index, below);
          const velocity = accelerate(
            downVelocity[index],
            verticalHead(index, row) - verticalHead(below, row + 1),
            kept,
          );
          downVelocity[index] = velocity;
          downTransfer[index] = velocity * substep;
        } else {
          downVelocity[index] = 0;
        }
      }
    }
  }

  /** How much each cell would send in total, so no cell can send more than it holds. */
  function sumOutflows(): void {
    outflow.fill(0);
    for (let index = 0; index < cellCount; index++) {
      const across = rightTransfer[index];
      if (across > 0) outflow[index] += across;
      else if (across < 0) outflow[index + 1] -= across;
      const down = downTransfer[index];
      if (down > 0) outflow[index] += down;
      else if (down < 0) outflow[index + width] -= down;
    }
  }

  /** The fraction of its planned outflow a cell can actually send. */
  function limiter(source: number): number {
    if (outflow[source] <= 0) return 1;
    return Math.min(1, fill(source) / outflow[source]);
  }

  function moveVolume(): void {
    change.fill(0);
    for (let index = 0; index < cellCount; index++) {
      const across = rightTransfer[index];
      if (across !== 0) {
        const neighbour = index + 1;
        const source = across > 0 ? index : neighbour;
        const limit = limiter(source);
        if (limit < 1) rightVelocity[index] *= limit;
        const units = Math.floor(Math.abs(across) * limit * UNIT);
        change[source] -= units;
        change[source === index ? neighbour : index] += units;
      }
      const down = downTransfer[index];
      if (down !== 0) {
        const neighbour = index + width;
        const source = down > 0 ? index : neighbour;
        const limit = limiter(source);
        if (limit < 1) downVelocity[index] *= limit;
        const units = Math.floor(Math.abs(down) * limit * UNIT);
        change[source] -= units;
        change[source === index ? neighbour : index] += units;
      }
    }
    for (let index = 0; index < cellCount; index++) volume[index] += change[index];
  }

  function step(): void {
    planFlows();
    sumOutflows();
    moveVolume();
  }

  function stopFacesAround(index: number): void {
    rightVelocity[index] = 0;
    downVelocity[index] = 0;
    if (index % width > 0) rightVelocity[index - 1] = 0;
    if (index >= width) downVelocity[index - width] = 0;
  }

  function setSolid(index: number, solid: boolean): void {
    rock[index] = solid ? 1 : 0;
    stopFacesAround(index);
    if (!solid || volume[index] === 0) return;
    // displaced liquid moves up to the nearest open cell above, where pressure spreads it
    let above = index - width;
    while (above >= 0 && rock[above] === 1) above -= width;
    if (above >= 0) volume[above] += volume[index];
    else {
      // nowhere to go: keep it in the cell so the total stays exact (a build into a sealed column)
      rock[index] = 0;
      return;
    }
    volume[index] = 0;
  }

  return {
    width,
    height,
    volume,
    rightVelocity,
    downVelocity,
    isSolid: (index) => rock[index] === 1,
    setSolid,
    add: (index, units) => {
      if (rock[index] === 0) volume[index] += units;
    },
    step,
    total: () => {
      let sum = 0;
      for (let index = 0; index < cellCount; index++) sum += volume[index];
      return sum;
    },
  };
}

export interface WaterRun {
  /** The lowest cell's row: the run rests on rock below it. */
  readonly bottomRow: number;
  /** The highest cell's row that holds any of it. */
  readonly topRow: number;
  /**
   * The surface, in rows (fractional, down is positive): the floor under the run minus its total volume in
   * cells. Drawn from volume, not cells, so water compressed at the bottom of a deep pool doesn't sink the
   * surface.
   */
  readonly surface: number;
}

/**
 * The resting water in one column: runs of wet cells standing on rock, from the bottom up. Water falling
 * through air isn't part of a run.
 */
export function waterRuns(liquid: Liquid, column: number, minimumUnits = 1): WaterRun[] {
  const runs: WaterRun[] = [];
  for (let row = liquid.height - 1; row >= 0; row--) {
    const index = row * liquid.width + column;
    if (liquid.isSolid(index) || liquid.volume[index] < minimumUnits) continue;
    const restsOnRock = row + 1 >= liquid.height || liquid.isSolid(index + liquid.width);
    if (!restsOnRock) continue;
    let units = 0;
    let top = row;
    while (top >= 0) {
      const cell = top * liquid.width + column;
      if (liquid.isSolid(cell) || liquid.volume[cell] < minimumUnits) break;
      units += liquid.volume[cell];
      top--;
    }
    const topRow = top + 1;
    runs.push({ bottomRow: row, topRow, surface: row + 1 - units / UNIT });
    row = topRow;
  }
  return runs;
}
