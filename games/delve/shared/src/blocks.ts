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
export const SURFACE = 0; // row 0 is the open surface yard; row > SURFACE is solid rock

// Entity definitions come from the resource registry (resources/*.ts). This file owns only
// the world-generation logic; the data lives with the resources, sorted for us by the registry.
export const STRATA: readonly StrataResource[] = all('strata');
export const ORES: readonly OreResource[] = all('ore');
export const ORE_BY_ID: Record<number, OreResource> = Object.fromEntries(
  ORES.map((ore) => [ore.id, ore]),
);

/** Rarity/tier of an ore = its index in the surface→deep ordering. */
export const rarityOf = (oreId: number): number => ORES.findIndex((ore) => ore.id === oreId);

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
  if (row <= SURFACE) return 0;

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
  value: 0,
  dim: false,
});

/**
 * THE canonical world query — the full static descriptor of a cell. Any column below the
 * surface is solid rock (no side walls). Dynamic dug/damage state is layered on by the sim.
 */
export function blockAt(seed: number, column: number, row: number): Block {
  if (row <= SURFACE) return OPEN;
  const ore = oreAt(seed, column, row);
  const oreDef = ore ? ORE_BY_ID[ore] : null;
  return {
    solid: true,
    kind: ore ? 'ore' : 'rock',
    ore,
    strata: strataIndexAt(row),
    hp: rockHp(row) + (oreDef ? oreDef.hp : 0),
    value: oreDef ? oreDef.value : 0,
    dim: oreDef ? !!oreDef.dim : false,
  };
}

/** Cheap boolean solidity for the per-pixel rock field. Static only — callers combine it with
 * the dug overlay: `solidAt(...) && !isDug(...)`. */
export function solidAt(_seed: number, _column: number, row: number): boolean {
  return row > SURFACE;
}
