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

  const WIDTH = 82;         // columns (0..WIDTH-1); a bounded shaft, infinite downward
  const SURFACE = 0;        // row 0 is the open surface yard

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
  // Each depth band starts at row `top` and carries a 6-stop Resurrect-64 palette ramp.
  // Appearance lives here so a block is defined once; renderers read STRATA for colour.
  const STRATA = [
    { id: 'topsoil',   top: 2,   ramp: ['#2e222f', '#45293f', '#7a3045', '#9e4539', '#cd683d', '#e6904e'] }, // red-brown
    { id: 'clay',      top: 24,  ramp: ['#2a2018', '#48371f', '#6d5230', '#8f6b3c', '#b28a4e', '#d0aa66'] }, // ochre
    { id: 'stone',     top: 84,  ramp: ['#2e222f', '#3e3546', '#625565', '#7f708a', '#9babb2', '#c7dcd0'] }, // gray
    { id: 'deepstone', top: 190, ramp: ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff'] }, // blue
    { id: 'basalt',    top: 370, ramp: ['#2e222f', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded'] }, // violet
  ];
  function strataIndexAt(r) { let i = 0; while (i < STRATA.length - 1 && r >= STRATA[i + 1].top) i++; return i; }

  // --- ORE blocks (nodes) -----------------------------------------------------------
  // band=[minRow,maxRow] where it can appear; weight = spawn share within its band;
  // value = coins per block; hp = toughness on top of the rock hp. Ordered surface→deep.
  const ORES = [
    { id: 1, name: 'Dirt',    band: [2, 8],        weight: 60, value: 1,    hp: 0,  color: '#a06a3c', dim: true }, // plain clod
    { id: 2, name: 'Copper',  band: [4, 24],       weight: 26, value: 5,    hp: 1,  color: '#d67b40' },
    { id: 3, name: 'Iron',    band: [16, 52],      weight: 22, value: 12,   hp: 2,  color: '#c2ccd8' },
    { id: 4, name: 'Silver',  band: [40, 92],      weight: 15, value: 34,   hp: 3,  color: '#f0f4fa' },
    { id: 5, name: 'Gold',    band: [76, 156],     weight: 11, value: 95,   hp: 4,  color: '#f5c84e' },
    { id: 6, name: 'Emerald', band: [132, 240],    weight: 7,  value: 260,  hp: 6,  color: '#41cf76' },
    { id: 7, name: 'Ruby',    band: [216, 370],    weight: 5,  value: 720,  hp: 8,  color: '#ee4f66' },
    { id: 8, name: 'Diamond', band: [330, 530],    weight: 3,  value: 2100, hp: 11, color: '#66e0ee' },
    { id: 9, name: 'Mythril', band: [480, 99999],  weight: 2,  value: 6200, hp: 15, color: '#bd77f5' },
  ];
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

  // Interned descriptors for non-generated cells (no per-call allocation).
  const WALL = Object.freeze({ solid: true, kind: 'wall', ore: 0, strata: -1, hp: Infinity, value: 0, dim: false });
  const OPEN = Object.freeze({ solid: false, kind: 'open', ore: 0, strata: -1, hp: 0, value: 0, dim: false });

  // THE canonical world query — the full STATIC descriptor of a cell, pure f(seed,c,r).
  // (Dynamic dug/damage state is layered on by the sim; it can't come from seed+coords.)
  function blockAt(seed, c, r) {
    if (c < 0 || c >= WIDTH) return WALL;
    if (r <= SURFACE) return OPEN;
    const ore = oreAt(seed, c, r), od = ore ? ORE_BY_ID[ore] : null;
    return { solid: true, kind: ore ? 'ore' : 'rock', ore, strata: strataIndexAt(r),
      hp: rockHp(r) + (od ? od.hp : 0), value: od ? od.value : 0, dim: od ? !!od.dim : false };
  }
  // Cheap boolean solidity for the per-pixel rock field (no allocation). Static only —
  // callers AND the dug overlay: `solidAt(...) && !isDug(...)`.
  function solidAt(seed, c, r) { return (c < 0 || c >= WIDTH) ? true : r > SURFACE; }

  const Blocks = {
    WIDTH, SURFACE, STRATA, ORES, ORE_BY_ID, rarityOf, CLUSTER_FREQ, REGION,
    tileRand, vnoise, strataIndexAt, oreAt, rockHp, blockAt, solidAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Blocks;
  else root.Blocks = Blocks;
})(typeof self !== 'undefined' ? self : this);
