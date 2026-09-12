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
export const WIDTH = 82;

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
export function surfaceAt(seed: number, column: number): number {
  let height = 0;
  for (const [i, octave] of SURFACE_OCTAVES.entries()) {
    // Centred on zero, so the octaves cancel rather than all pushing the terrain one way.
    const n = vnoise(column * octave.frequency, i * 31.7, (seed ^ SURFACE_SALT) >>> 0) - 0.5;
    height += n * octave.amplitude;
  }
  return SURFACE_BASE + Math.round(height);
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
  let index = 0;
  while (index < STRATA.length - 1 && row >= STRATA[index + 1].top) index++;
  return index;
}

// Ore forms contiguous NODES (clusters): a low-frequency value-noise field is thresholded into
// blobby pockets, and a coarse region grid assigns each pocket a single ore type (weighted by
// depth band). Pure f(seed, column, row).
const CLUSTER_FREQUENCY = 0.3; // noise frequency for ore pockets — lower = larger, blobbier clusters
const REGION_SIZE = 6; // tiles per ore-type region; a whole pocket shares one weighted roll
const ORE_NOISE_SALT = 0x5eed; // decorrelates the ore cluster-noise field from other noise
const ORE_TYPE_SALT = 0xa5a5; // decorrelates the per-region ore-type roll from the cluster field
const BASE_ORE_COVERAGE = 0.2; // fraction of in-band rock that is ore near the surface
const DEEP_COVERAGE_BONUS = 0.14; // extra coverage added by depth (capped) — deeper = a bit denser
const COVERAGE_PER_ROW = 0.0003; // how fast the depth coverage bonus grows per row

export function oreAt(seed: number, column: number, row: number): number {
  if (row <= surfaceAt(seed, column)) return 0;

  const eligible = ORES.filter((ore) => row >= ore.band[0] && row <= ore.band[1]);
  if (eligible.length === 0) return 0;

  const noise = vnoise(
    column * CLUSTER_FREQUENCY,
    row * CLUSTER_FREQUENCY,
    (seed ^ ORE_NOISE_SALT) >>> 0,
  );
  const coverage = BASE_ORE_COVERAGE + Math.min(DEEP_COVERAGE_BONUS, row * COVERAGE_PER_ROW);
  if (noise < 1 - coverage) return 0; // outside a pocket → plain rock

  // Pick this pocket's ore type: one weighted roll per coarse region, so a whole cluster
  // shares a type.
  const regionX = Math.floor(column / REGION_SIZE);
  const regionY = Math.floor(row / REGION_SIZE);
  const totalWeight = eligible.reduce((sum, ore) => sum + ore.weight, 0);
  let roll = tileRand((seed ^ ORE_TYPE_SALT) >>> 0, regionX, regionY) * totalWeight;
  for (const ore of eligible) {
    roll -= ore.weight;
    if (roll < 0) return ore.id;
  }
  return eligible[eligible.length - 1].id;
}

// Base rock hp from depth — grows so deep rock needs an upgraded pick.
const BASE_ROCK_HP = 2; // hp of rock at the surface
const ROCK_HP_PER_ROW = 0.31; // hp added per row of depth

export function rockHp(row: number): number {
  return BASE_ROCK_HP + Math.floor(row * ROCK_HP_PER_ROW);
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
    hp: rockHp(row) + (oreDef ? oreDef.hp : 0),
    dim: oreDef ? !!oreDef.dim : false,
  };
}

/** Cheap boolean solidity for the per-pixel rock field. Static only — callers combine it with
 * the dug overlay: `solidAt(...) && !isDug(...)`. */
export function solidAt(seed: number, column: number, row: number): boolean {
  return row > surfaceAt(seed, column);
}
