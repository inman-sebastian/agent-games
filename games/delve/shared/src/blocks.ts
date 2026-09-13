// blocks.ts — the world DEFINITION: bounds, block types (strata + ore), procedural
// generation, and the one canonical query for "what is at (seed, column, row)". The world is
// INFINITE in every direction and never stored — every cell's static contents are a pure
// function of (seed, column, row). Dynamic state (dug cells, in-progress damage) is NOT here;
// it lives in the save and is layered over these coordinates by the sim.
import './resources/index'; // side-effect: registers every strata + ore before we read them
import { all } from './registry';
import { tileRand, vnoise } from './rng';
import type { Block, OreResource, StrataResource } from './types';

// The world is UNBOUNDED horizontally (see blockAt/solidAt) — there are no side walls. WIDTH
// is retained only as a convenient default view span for the dev tools; it does NOT bound the
// world.
/**
 * Cells per BLOCK edge — the 2x2 split (#44).
 *
 * THE WORLD IS GENERATED ON A BLOCK GRID AND COLLIDED ON A CELL GRID, and keeping those two things
 * separate is what makes this a small change instead of a world-gen rewrite. A block is what the
 * generator decides — its stratum, its ore, its toughness. A cell is what the player collides with,
 * mines, and walks up.
 *
 * So every generator below takes CELL coordinates and shifts them down to the block that owns them.
 * Strata tops, ore bands, cluster frequency and the heightmap's octaves are all still expressed in
 * BLOCKS and none of them changed — a 2x2 group of cells shares one block's material, so an ore vein
 * is exactly as chunky as it was. What changed is that you can now mine a quarter of a block, which
 * is what gives natural staircases: a one-cell rise is half a block, and the step-up assist walks it.
 */
export const SUB = 2;

/** A cell coordinate down to the block that owns it. */
export const blockOf = (cell: number): number => Math.floor(cell / SUB);

/** World width in CELLS. The generator still thinks in 82 blocks. */
export const WIDTH = 82 * SUB;

/**
 * The MEAN surface row. The actual surface undulates around it per column — see `surfaceAt`.
 *
 * Kept as the reference for everything measured in absolute depth: strata tops, ore bands and rock
 * HP are all rows counted from here, and they stay horizontal while the ground above them rolls.
 * That is deliberate and it is how real geology reads — a hill has more topsoil above the same clay,
 * it does not carry the clay up with it.
 */
export const SURFACE_BASE = 0;

// ---- the surface heightmap ---------------------------------------------------------------------
//
// `SURFACE` used to be a constant, which made the whole world a flat plane with open sky above one
// row. The design ruled that the surface is real content and not a barren plane (#44), so it is a
// function of column now.
//
// Two octaves, and the amplitudes are picked against a HARD CONSTRAINT rather than by eye: the
// player must be able to walk up the terrain. Smoothstep-interpolated value noise has a maximum
// slope of 1.5 * amplitude * frequency per octave, so the sum of those products has to stay under
// one tile per column — otherwise a hillside is a wall, and with no step-up assist the player would
// simply be stopped by open ground. A test measures the real worst case rather than trusting the
// arithmetic.
const SURFACE_OCTAVES: readonly { readonly amplitude: number; readonly frequency: number }[] = [
  { amplitude: 7, frequency: 0.05 }, // broad hills, ~20 tiles across
  { amplitude: 2, frequency: 0.13 }, // finer undulation so the hills are not featureless curves
];
const SURFACE_SALT = 0x5a17; // decorrelates the heightmap from the ore and damage fields

/**
 * The surface row at `column`: rows AT OR ABOVE it are open sky, rows below it are solid rock.
 *
 * Pure `f(seed, column)` like everything else in this file — nothing is stored, and two clients
 * given the same seed agree without exchanging a heightmap.
 */
/**
 * A direct-mapped cache for `surfaceAt`, which is the hottest function in the world model.
 *
 * It is a pure `f(seed, column)`, so caching it cannot change an answer — and it is recomputed
 * relentlessly: once per `solidAt`, again inside `oreAt`, and again inside `blockAt`, for every cell
 * of every column of every frame. After the 2x2 split that is four times as many calls as before,
 * and two value-noise octaves each. Measured at 4.5ms for one viewport's worth before this.
 *
 * Direct-mapped on the column's low bits rather than a `Map`, so a hit is two array reads and no
 * allocation. A different seed resets it: correct either way, and a session only ever has one seed —
 * if two interleaved, it would degrade to no cache rather than to a wrong answer.
 */
const SURFACE_CACHE_SIZE = 1 << 12;
const SURFACE_CACHE_MASK = SURFACE_CACHE_SIZE - 1;
const NO_COLUMN = 0x7fffffff;
const surfaceColumns = new Int32Array(SURFACE_CACHE_SIZE).fill(NO_COLUMN);
const surfaceRows = new Int32Array(SURFACE_CACHE_SIZE);
let surfaceCacheSeed = -1;

export function surfaceAt(seed: number, column: number): number {
  if (seed !== surfaceCacheSeed) {
    surfaceCacheSeed = seed;
    surfaceColumns.fill(NO_COLUMN);
  }
  const slot = column & SURFACE_CACHE_MASK;
  if (surfaceColumns[slot] === column) return surfaceRows[slot];
  const row = computeSurfaceAt(seed, column);
  surfaceColumns[slot] = column;
  surfaceRows[slot] = row;
  return row;
}

function computeSurfaceAt(seed: number, column: number): number {
  // Sampled at CELL resolution, with the frequency divided and the amplitude multiplied by SUB — so
  // the hill keeps exactly the wavelength and height it had in blocks, but is quantised to cells.
  //
  // THIS IS NOT OPTIONAL. Sampling per block and multiplying the result instead gives terrain that is
  // flat across each block and then steps a WHOLE BLOCK at every block boundary — which the one-cell
  // step-up assist cannot climb, so hills become walls. Sampling per cell halves the riser: the
  // per-column slope bound is unchanged in absolute terms, so it is now one CELL per column instead
  // of one block. Natural hills get the same staircase the split gives mined ones.
  let height = 0;
  for (const [i, octave] of SURFACE_OCTAVES.entries()) {
    // Centred on zero, so the octaves cancel rather than all pushing the terrain one way.
    const n =
      vnoise(column * (octave.frequency / SUB), i * 31.7, (seed ^ SURFACE_SALT) >>> 0) - 0.5;
    height += n * (octave.amplitude * SUB);
  }
  return SURFACE_BASE * SUB + Math.round(height);
}

// Entity definitions come from the resource registry (resources/*.ts). This file owns only
// the world-generation logic; the data lives with the resources, sorted for us by the registry.
export const STRATA: readonly StrataResource[] = all('strata');
export const ORES: readonly OreResource[] = all('ore');
export const ORE_BY_ID: Record<number, OreResource> = Object.fromEntries(
  ORES.map((ore) => [ore.id, ore]),
);

/** Rarity/tier of an ore = its index in the surface→deep ordering. */
/** The top of the rarity scale, so the client can normalise without knowing how many ores exist. */
export const RARITY_MAX = 6;

/**
 * How special a find this ore is, `0`..`RARITY_MAX`, as authored on the resource.
 *
 * This was `ORES.findIndex(...)` — the ore's position in the registry — which meant adding an ore
 * file silently re-tiered every ore after it. Four appended files had already made quartz
 * out-reward mythril and stone bricks the loudest event in the game (#46).
 */
export const rarityOf = (oreId: number): number => ORE_BY_ID[oreId]?.rarity ?? 0;

export function strataIndexAt(row: number): number {
  const block = blockOf(row);
  let index = 0;
  while (index < STRATA.length - 1 && block >= STRATA[index + 1].top) index++;
  return index;
}

// Ore forms contiguous NODES (clusters): a low-frequency value-noise field is thresholded into
// blobby pockets, and a coarse region grid assigns each pocket a single ore type (weighted by
// depth band). Pure f(seed, column, row).
const CLUSTER_FREQUENCY = 0.3; // noise frequency for ore pockets — lower = larger, blobbier clusters
const REGION_SIZE = 6; // BLOCKS per ore-type region; a whole pocket shares one weighted roll
const ORE_NOISE_SALT = 0x5eed; // decorrelates the ore cluster-noise field from other noise
const ORE_TYPE_SALT = 0xa5a5; // decorrelates the per-region ore-type roll from the cluster field
const BASE_ORE_COVERAGE = 0.2; // fraction of in-band rock that is ore near the surface
const DEEP_COVERAGE_BONUS = 0.14; // extra coverage added by depth (capped) — deeper = a bit denser
const COVERAGE_PER_ROW = 0.0003; // how fast the depth coverage bonus grows per row

export function oreAt(seed: number, column: number, row: number): number {
  if (row <= surfaceAt(seed, column)) return 0;

  // Everything from here is on the BLOCK grid, so the four cells of a block share one ore and the
  // pockets keep their size. Sampling the noise per cell instead would quarter every vein.
  const bc = blockOf(column);
  const br = blockOf(row);
  // Two allocation-free passes over ORES instead of `filter` + `reduce`. This is called for every
  // cell of every frame, so the array it used to build was six thousand short-lived allocations a
  // frame — pure garbage-collector pressure for a list that never escapes the function.
  let totalWeight = 0;
  for (const ore of ORES) {
    if (br >= ore.band[0] && br <= ore.band[1]) totalWeight += ore.weight;
  }
  if (totalWeight === 0) return 0;

  const noise = vnoise(
    bc * CLUSTER_FREQUENCY,
    br * CLUSTER_FREQUENCY,
    (seed ^ ORE_NOISE_SALT) >>> 0,
  );
  const coverage = BASE_ORE_COVERAGE + Math.min(DEEP_COVERAGE_BONUS, br * COVERAGE_PER_ROW);
  if (noise < 1 - coverage) return 0; // outside a pocket → plain rock

  // Pick this pocket's ore type: one weighted roll per coarse region, so a whole cluster
  // shares a type.
  const regionX = Math.floor(bc / REGION_SIZE);
  const regionY = Math.floor(br / REGION_SIZE);
  let roll = tileRand((seed ^ ORE_TYPE_SALT) >>> 0, regionX, regionY) * totalWeight;
  let last = 0;
  for (const ore of ORES) {
    if (br < ore.band[0] || br > ore.band[1]) continue;
    last = ore.id;
    roll -= ore.weight;
    if (roll < 0) return ore.id;
  }
  return last; // float rounding only; the weights are exhausted above
}

// Base rock hp from depth — grows so deep rock needs an upgraded pick.
const BASE_ROCK_HP = 2; // hp of rock at the surface
const ROCK_HP_PER_ROW = 0.31; // hp added per row of depth

/**
 * A CELL's toughness.
 *
 * Divided by the number of cells in a block, because a block is now four digs rather than one and
 * excavating a given volume of rock should take the same time it always did. Without this the split
 * would quadruple every tunnel's cost, which is a mining nerf disguised as a rendering change.
 */
export const CELLS_PER_BLOCK = SUB * SUB;

export function rockHp(row: number): number {
  return (BASE_ROCK_HP + Math.floor(blockOf(row) * ROCK_HP_PER_ROW)) / CELLS_PER_BLOCK;
}

// Interned descriptor for open sky (no per-call allocation).
const OPEN: Block = Object.freeze({
  solid: false,
  kind: 'open',
  ore: 0,
  strata: -1,
  hp: 0,
  dim: false,
});

/**
 * THE canonical world query — the full static descriptor of a cell. Any column below the
 * surface is solid rock (no side walls). Dynamic dug/damage state is layered on by the sim.
 */
export function blockAt(seed: number, column: number, row: number): Block {
  if (row <= surfaceAt(seed, column)) return OPEN;
  const ore = oreAt(seed, column, row);
  const oreDef = ore ? ORE_BY_ID[ore] : null;
  return {
    solid: true,
    kind: ore ? 'ore' : 'rock',
    ore,
    strata: strataIndexAt(row),
    // The ore's toughness bonus is per BLOCK too, so it divides like the rock's does.
    hp: rockHp(row) + (oreDef ? oreDef.hp / CELLS_PER_BLOCK : 0),
    dim: oreDef ? !!oreDef.dim : false,
  };
}

/** Cheap boolean solidity for the per-pixel rock field. Static only — callers combine it with
 * the dug overlay: `solidAt(...) && !isDug(...)`. */
export function solidAt(seed: number, column: number, row: number): boolean {
  return row > surfaceAt(seed, column);
}
