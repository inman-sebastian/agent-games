// blocks.js — the world DEFINITION: bounds, block types (strata + ore), procedural
// generation, and the one canonical query for "what is at (seed, c, r)". Standalone and
// script-agnostic: depends on nothing, attaches to `self` (browser/worker) AND
// module.exports (Node), so the engine, renderer, chunk Worker and dev tools all read
// the SAME source of truth.
//
// The world is INFINITE and never stored: every cell's *static* contents are a pure
// function of (seed, c, r). blockAt() returns that. DYNAMIC state — whether a cell has
// been dug, and in-progress damage — is NOT here; it lives in the save and is layered
// over these coords by the sim.
(function (root) {
  'use strict';

  // Entity definitions (strata + ores) come from the resource REGISTRY — one
  // self-registering file per entity under resources/*.js. blocks.js owns only the
  // world-generation logic; the data lives with the resources. (Node: requiring the
  // registry auto-loads every resource file; browser: it's loaded before this script.)
  const DelveResources = (typeof module !== 'undefined' && module.exports) ? require('./resources') : root.DelveResources;

  // The world is UNBOUNDED horizontally (see blockAt/solidAt) — there are no side walls.
  // WIDTH is retained only as a convenient default view span for the dev tools; it does
  // NOT bound the world.
  const WIDTH = 82;
  const SURFACE = 0;        // row 0 is the open surface yard; r>SURFACE is solid rock

  // --- deterministic noise/hash (world-gen owns these; pure) ---
  // per-cell white noise (0..1) — independent per cell
  function tileRand(seed, c, r) {
    let h = (seed ^ (c * 73856093) ^ (r * 19349663)) >>> 0;
    h += 0x6D2B79F5; h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  }
  // spatially-coherent value noise (bilinear lattice) — thresholding it yields
  // CONTIGUOUS blobs, the basis for ore nodes/clusters
  function vnoise(x, y, sd) {
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + sd * 362437) >>> 0; n = Math.imul(n ^ n >>> 13, 1274126177) >>> 0; return ((n ^ n >>> 16) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t), au = sm(tx), av = sm(ty);
    const a = h(fx, fy), b = h(fx + 1, fy), c = h(fx, fy + 1), d = h(fx + 1, fy + 1);
    return (a * (1 - au) + b * au) * (1 - av) + (c * (1 - au) + d * au) * av;
  }

  // --- STRATA blocks (the diggable rock) --------------------------------------------
  // Depth bands are defined in resources/*.js (type 'strata'): each has a row `top` and a
  // 6-stop Resurrect-64 ramp. Here we just read them, sorted shallow→deep by the registry.
  const STRATA = DelveResources.all('strata');
  function strataIndexAt(r) { let i = 0; while (i < STRATA.length - 1 && r >= STRATA[i + 1].top) i++; return i; }

  // --- ORE blocks (nodes) -----------------------------------------------------------
  // Ore item definitions live in resources/*.js (type 'ore'): id / name / band / weight /
  // value / hp / color / desc / art, ordered surface→deep so the array index is the
  // rarity/tier (see rarityOf). blocks.js owns only the placement logic below.
  const ORES = DelveResources.all('ore');
  const ORE_BY_ID = Object.fromEntries(ORES.map(o => [o.id, o]));
  const rarityOf = (id) => ORES.findIndex(o => o.id === id);

  // Ore forms contiguous NODES (clusters): a low-frequency value-noise field is
  // thresholded into blobby pockets, and a coarse region grid assigns each pocket a
  // single ore type (weighted by depth band). Pure f(seed,c,r). Density kept near the
  // old value for now — a rarer/richer-cluster economy retune is a later pass.
  const CLUSTER_FREQ = 0.30, REGION = 6;
  function oreAt(seed, c, r) {
    if (r <= SURFACE) return 0;
    const elig = ORES.filter(o => r >= o.band[0] && r <= o.band[1]);
    if (!elig.length) return 0;
    const n = vnoise(c * CLUSTER_FREQ, r * CLUSTER_FREQ, (seed ^ 0x5EED) >>> 0);
    const cover = 0.20 + Math.min(0.14, r * 0.0003);
    if (n < 1 - cover) return 0;
    const rx = Math.floor(c / REGION), ry = Math.floor(r / REGION);
    const total = elig.reduce((s, o) => s + o.weight, 0);
    let roll = tileRand((seed ^ 0xA5A5) >>> 0, rx, ry) * total;
    for (const o of elig) { if ((roll -= o.weight) < 0) return o.id; }
    return elig[elig.length - 1].id;
  }

  // Base rock hp from depth. Grows so deep rock needs upgraded picks.
  function rockHp(r) { return 2 + Math.floor(r * 0.31); }

  // Interned descriptor for open sky (no per-call allocation).
  const OPEN = Object.freeze({ solid: false, kind: 'open', ore: 0, strata: -1, hp: 0, value: 0, dim: false });

  // THE canonical world query — the full STATIC descriptor of a cell, pure f(seed,c,r).
  // The world is unbounded: any column below the surface is solid rock (no side walls).
  // (Dynamic dug/damage state is layered on by the sim; it can't come from seed+coords.)
  function blockAt(seed, c, r) {
    if (r <= SURFACE) return OPEN;
    const ore = oreAt(seed, c, r), od = ore ? ORE_BY_ID[ore] : null;
    return { solid: true, kind: ore ? 'ore' : 'rock', ore, strata: strataIndexAt(r),
      hp: rockHp(r) + (od ? od.hp : 0), value: od ? od.value : 0, dim: od ? !!od.dim : false };
  }
  // Cheap boolean solidity for the per-pixel rock field (no allocation). Static only —
  // callers AND the dug overlay: `solidAt(...) && !isDug(...)`.
  function solidAt(seed, c, r) { return r > SURFACE; }

  const Blocks = {
    WIDTH, SURFACE, STRATA, ORES, ORE_BY_ID, rarityOf, CLUSTER_FREQ, REGION,
    tileRand, vnoise, strataIndexAt, oreAt, rockHp, blockAt, solidAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Blocks;
  else root.Blocks = Blocks;
})(typeof self !== 'undefined' ? self : this);
