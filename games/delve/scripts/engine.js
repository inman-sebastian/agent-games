// engine.js — the mining SIM: player state, dig/move resolution, economy, upgrades.
// Runs identically in Node (the tools/ — verify.js, sim.js) and the browser (index.html).
//
// The WORLD (bounds, block types, generation, the pure `blockAt(seed,c,r)` query) lives
// in blocks.js — this file layers the DYNAMIC state on top: which cells are dug, damage
// in progress, coins, upgrades. Ore sells the instant it's mined (no hauling).
(function (root) {
  'use strict';

  const Blocks = (typeof module !== 'undefined' && module.exports) ? require('./blocks') : root.Blocks;
  const { WIDTH, SURFACE, ORES, ORE_BY_ID, rarityOf, blockAt, solidAt, oreAt, rockHp, tileRand } = Blocks;

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

  // Whether a mined cell hit a rich vein (3× value). Deterministic per cell so the
  // balance gate sees the same luck the player does.
  function isRich(seed, c, r, fortune) { return tileRand(seed ^ 0x9E3779B9, c, r) < fortune; }

  // Back-compat static-tile view ({ore, maxHp} / {wall} / {empty}) over blockAt, for
  // callers not yet migrated to the richer descriptor.
  function tileInfo(seed, c, r) {
    const b = blockAt(seed, c, r);
    if (b.kind === 'wall') return { wall: true };
    if (b.kind === 'open') return { empty: true, ore: 0, maxHp: 0 };
    return { ore: b.ore, maxHp: b.hp };
  }

  // --- state ---
  function newGame(seed) {
    return {
      seed: (seed >>> 0) || 1,
      c: (WIDTH - 1) >> 1, r: SURFACE,   // start centered on the surface
      facing: 'down',
      dug: {},           // "c,r" -> true  (excavated cells)
      dmg: {},           // "c,r" -> hp already dealt to a not-yet-broken cell
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

  // The single action that drives everything. Attempt to move/dig one step in `dir`.
  // Mutates and returns an event:
  //   {type:'move'} | {type:'blocked'} | {type:'dig', broke, ore, coin, rich}
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

    const b = blockAt(s.seed, nc, nr);      // static block being dug
    const k = key(nc, nr);
    const dealt = (s.dmg[k] || 0) + stats(s).power;
    if (dealt < b.hp) {                      // chipped, not broken
      s.dmg[k] = dealt;
      return { type: 'dig', broke: false, c: nc, r: nr, ore: b.ore, hp: b.hp - dealt, maxHp: b.hp };
    }

    // broke through → sell ore instantly in place
    delete s.dmg[k];
    s.dug[k] = true;
    let coin = 0, rich = false;
    if (b.ore) {
      const st = stats(s);
      rich = isRich(s.seed, nc, nr, st.fortune);
      coin = Math.max(1, Math.floor(b.value * st.valueMult * (rich ? 3 : 1)));
      s.coins += coin; s.earned += coin;
      const rar = rarityOf(b.ore);
      if (rar > s.best) s.best = rar;
    }
    return { type: 'dig', broke: true, c: nc, r: nr, ore: b.ore, coin, rich, maxHp: b.hp };
  }

  const atSurface = (s) => s.r <= SURFACE;

  const Delve = {
    // world (re-exported from blocks.js for convenience)
    WIDTH, SURFACE, ORES, ORE_BY_ID, rarityOf, blockAt, solidAt, oreAt, rockHp, tileInfo,
    // sim
    UPGRADES, TECH, DIRS, isRich, newGame, stats, upgradeCost, buyUpgrade, buyTech,
    attemptStep, atSurface, isDug, key,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Delve;
  else root.Delve = Delve;
})(typeof self !== 'undefined' ? self : this);
