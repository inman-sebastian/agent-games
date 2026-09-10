// engine.js — pure mining sim: deterministic world, dig/move resolution,
// economy, upgrades. Runs identically in Node (verify.js) and the browser
// (index.html) so the balance checker and the game share ONE ruleset.
//
// The world is INFINITE and never stored tile-by-tile: every underground tile's
// contents are a pure function of (seed, col, row). A save only records which
// tiles have been dug out, in-progress damage, and the player's economy.
//
// Ore sells the instant it's mined (coins credited in place) — no hauling back
// to the surface. Going up is optional; you just keep digging.
(function (root) {
  'use strict';

  const WIDTH = 82;         // columns; a wide field (0..WIDTH-1) that fills the viewport.
                            // Bounded horizontally, infinite downward. The grid is a
                            // fine 16px-cell world (Terraria-ish): ~2× the columns of the
                            // old coarse grid, and every row-based constant below is scaled
                            // to match, so the PHYSICAL world is unchanged — just finer.
  const SURFACE = 0;        // row 0 is the open surface yard

  // Ore table. band=[minDepth,maxDepth] rows where it can appear; weight is its
  // relative spawn share within its band; value is coins per unit; hp is extra
  // toughness on top of depth-based rock hp. Ordered surface→deep (= discovery
  // order / rarity index).
  const ORES = [
    { id: 1, name: 'Dirt',    band: [2, 8],        weight: 60, value: 1,    hp: 0, color: '#a06a3c' },
    { id: 2, name: 'Copper',  band: [4, 24],       weight: 26, value: 5,    hp: 1, color: '#d67b40' },
    { id: 3, name: 'Iron',    band: [16, 52],      weight: 22, value: 12,   hp: 2, color: '#c2ccd8' },
    { id: 4, name: 'Silver',  band: [40, 92],      weight: 15, value: 34,   hp: 3, color: '#f0f4fa' },
    { id: 5, name: 'Gold',    band: [76, 156],     weight: 11, value: 95,   hp: 4, color: '#f5c84e' },
    { id: 6, name: 'Emerald', band: [132, 240],    weight: 7,  value: 260,  hp: 6, color: '#41cf76' },
    { id: 7, name: 'Ruby',    band: [216, 370],    weight: 5,  value: 720,  hp: 8, color: '#ee4f66' },
    { id: 8, name: 'Diamond', band: [330, 530],    weight: 3,  value: 2100, hp: 11, color: '#66e0ee' },
    { id: 9, name: 'Mythril', band: [480, 99999],  weight: 2,  value: 6200, hp: 15, color: '#bd77f5' },
  ];
  const ORE_BY_ID = Object.fromEntries(ORES.map(o => [o.id, o]));
  const rarityOf = (id) => ORES.findIndex(o => o.id === id);

  // Upgrade tracks: leveled, geometric cost. `apply` maps level→effect.
  const UPGRADES = {
    pick:   { name: 'Pickaxe',  base: 25,  mult: 1.6,  max: 40, desc: 'Damage per hit' },
    speed:  { name: 'Agility',  base: 40,  mult: 1.7,  max: 18, desc: 'Move / dig speed' },
    refine: { name: 'Refinery', base: 90,  mult: 1.7,  max: 24, desc: 'Ore is worth more' },
    fortune:{ name: 'Fortune',  base: 70,  mult: 1.8,  max: 15, desc: 'Chance of a rich vein (3× value)' },
  };
  // One-time tech unlocks that change the sim.
  const TECH = {
    scanner: { name: 'Ore Scanner', cost: 200,  desc: 'See ore through rock' },
    lantern: { name: 'Deep Lantern', cost: 850, desc: 'Widen your vision underground' },
  };

  // --- deterministic per-tile RNG (mulberry32 seeded by a spatial hash) ---
  function tileRand(seed, c, r) {
    let h = (seed ^ (c * 73856093) ^ (r * 19349663)) >>> 0;
    h += 0x6D2B79F5; h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  }

  // --- deterministic smooth value noise (bilinear-interpolated lattice) ---
  // Unlike tileRand (white noise, per-cell independent), this is spatially coherent, so
  // thresholding it yields CONTIGUOUS blobs — the basis for ore nodes/clusters.
  function vnoise(x, y, sd) {
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + sd * 362437) >>> 0; n = Math.imul(n ^ n >>> 13, 1274126177) >>> 0; return ((n ^ n >>> 16) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t), au = sm(tx), av = sm(ty);
    const a = h(fx, fy), b = h(fx + 1, fy), c = h(fx, fy + 1), d = h(fx + 1, fy + 1);
    return (a * (1 - au) + b * au) * (1 - av) + (c * (1 - au) + d * au) * av;
  }

  // Base rock hp from depth (row). Grows so deep rock needs upgraded picks. Slope is
  // halved vs the old coarse grid because rows are now 2× denser — hp per *physical*
  // depth is unchanged (and each of the 2× cells is quicker to break, so total effort
  // to descend a given distance stays the same). (ponytail: economy retune is a later pass.)
  function rockHp(r) { return 2 + Math.floor(r * 0.31); }

  // Ore forms contiguous NODES (clusters), not per-cell confetti. Pure f(seed,c,r):
  //  1. a low-frequency value-noise field carves blobby pockets — cells where the field
  //     exceeds a depth-scaled threshold are inside a node (else plain rock);
  //  2. a coarse REGION grid assigns each pocket a SINGLE ore type (weighted by the depth
  //     band), so a node reads as one ore's cluster rather than a mix.
  // Node coverage is kept near the old per-cell ore density, so the economy/verifier are
  // stable for now — a full economy retune (rarer, richer clusters) is a later pass.
  const CLUSTER_FREQ = 0.30;    // node blob scale (lower = bigger pockets)
  const REGION = 6;             // cells across a region that shares one ore type
  function oreAt(seed, c, r) {
    if (r <= SURFACE) return 0;
    const elig = ORES.filter(o => r >= o.band[0] && r <= o.band[1]);
    if (!elig.length) return 0;
    const n = vnoise(c * CLUSTER_FREQ, r * CLUSTER_FREQ, (seed ^ 0x5EED) >>> 0);
    const cover = 0.20 + Math.min(0.14, r * 0.0003);   // node coverage rises with depth
    if (n < 1 - cover) return 0;                        // outside any node → plain rock
    const rx = Math.floor(c / REGION), ry = Math.floor(r / REGION);
    const total = elig.reduce((s, o) => s + o.weight, 0);
    let roll = tileRand((seed ^ 0xA5A5) >>> 0, rx, ry) * total;
    for (const o of elig) { if ((roll -= o.weight) < 0) return o.id; }
    return elig[elig.length - 1].id;
  }

  // Whether a mined tile hit a rich vein (3× value). Deterministic per tile so
  // the balance gate sees the same luck the player does.
  function isRich(seed, c, r, fortune) { return tileRand(seed ^ 0x9E3779B9, c, r) < fortune; }

  // Full static description of a tile (ignores dug/damage state).
  function tileInfo(seed, c, r) {
    if (c < 0 || c >= WIDTH) return { wall: true };          // side bedrock
    if (r <= SURFACE) return { empty: true, ore: 0, maxHp: 0 };
    const ore = oreAt(seed, c, r);
    const maxHp = rockHp(r) + (ore ? ORE_BY_ID[ore].hp : 0);
    return { ore, maxHp };
  }

  // --- state ---
  function newGame(seed) {
    return {
      seed: (seed >>> 0) || 1,
      c: (WIDTH - 1) >> 1, r: SURFACE,   // start centered on the surface
      facing: 'down',
      dug: {},           // "c,r" -> true  (excavated tiles)
      dmg: {},           // "c,r" -> hp already dealt to a not-yet-broken tile
      coins: 0,
      earned: 0,         // lifetime coins (for progression display)
      depth: 0,          // deepest row reached
      best: 0,           // deepest ore rarity index discovered
      up: { pick: 0, speed: 0, refine: 0, fortune: 0 },
      tech: { scanner: false, lantern: false },
    };
  }

  const key = (c, r) => c + ',' + r;
  const isDug = (s, c, r) => r <= SURFACE || !!s.dug[key(c, r)];

  // Derived stats from upgrade levels.
  function stats(s) {
    return {
      power: 1 + s.up.pick,                       // damage per hit
      interval: 200 * Math.pow(0.9, s.up.speed),  // ms between actions
      valueMult: 1 + 0.4 * s.up.refine,
      fortune: Math.min(0.6, 0.045 * s.up.fortune),
      vision: 3.4 + (s.tech.lantern ? 3 : 0),
    };
  }

  function upgradeCost(kind, level) {
    const u = UPGRADES[kind];
    return Math.floor(u.base * Math.pow(u.mult, level));
  }

  function buyUpgrade(s, kind) {
    const u = UPGRADES[kind];
    if (!u || s.up[kind] >= u.max) return false;
    const cost = upgradeCost(kind, s.up[kind]);
    if (s.coins < cost) return false;
    s.coins -= cost; s.up[kind]++;
    return true;
  }
  function buyTech(s, kind) {
    const t = TECH[kind];
    if (!t || s.tech[kind] || s.coins < t.cost) return false;
    s.coins -= t.cost; s.tech[kind] = true;
    return true;
  }

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  // The single action that drives everything. Attempt to move/dig one step in
  // `dir`. Mutates and returns an event describing what happened:
  //   {type:'move'} | {type:'blocked'} | {type:'dig', broke, ore, coin, rich}
  // The browser calls this on a speed-gated timer; verify.js calls it directly.
  function attemptStep(s, dir) {
    const [dc, dr] = DIRS[dir];
    s.facing = dir;
    const nc = s.c + dc, nr = s.r + dr;
    if (nc < 0 || nc >= WIDTH || nr < SURFACE) return { type: 'blocked' };

    if (isDug(s, nc, nr)) {                 // open space → walk into it
      s.c = nc; s.r = nr;
      if (nr > s.depth) s.depth = nr;
      return { type: 'move', c: nc, r: nr };
    }

    const info = tileInfo(s.seed, nc, nr);
    const k = key(nc, nr);
    const dealt = (s.dmg[k] || 0) + stats(s).power;
    if (dealt < info.maxHp) {               // chipped, not broken
      s.dmg[k] = dealt;
      return { type: 'dig', broke: false, c: nc, r: nr, ore: info.ore,
               hp: info.maxHp - dealt, maxHp: info.maxHp };
    }

    // broke through → sell ore instantly in place
    delete s.dmg[k];
    s.dug[k] = true;
    let coin = 0, rich = false;
    if (info.ore) {
      const st = stats(s);
      rich = isRich(s.seed, nc, nr, st.fortune);
      coin = Math.max(1, Math.floor(ORE_BY_ID[info.ore].value * st.valueMult * (rich ? 3 : 1)));
      s.coins += coin; s.earned += coin;
      const rar = rarityOf(info.ore);
      if (rar > s.best) s.best = rar;
    }
    return { type: 'dig', broke: true, c: nc, r: nr, ore: info.ore, coin, rich, maxHp: info.maxHp };
  }

  const atSurface = (s) => s.r <= SURFACE;

  const Delve = {
    WIDTH, SURFACE, ORES, ORE_BY_ID, UPGRADES, TECH, DIRS, rarityOf,
    tileRand, rockHp, oreAt, isRich, tileInfo, newGame, stats, upgradeCost,
    buyUpgrade, buyTech, attemptStep, atSurface, isDug, key,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Delve;
  else root.Delve = Delve;
})(typeof self !== 'undefined' ? self : this);
