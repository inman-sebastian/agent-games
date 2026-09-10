// engine.js — the mining SIM: player state, PLATFORMER physics (gravity / run / jump),
// dig resolution, economy, upgrades. Runs identically in Node (tools/, verify.js) and the
// browser (index.html).
//
// The WORLD (bounds, block types, generation, the pure `blockAt(seed,c,r)` query) lives in
// blocks.js — this file layers the DYNAMIC state on top: the player's CONTINUOUS position
// and velocity, which cells are dug, in-progress damage, coins, upgrades.
//
// Movement is smooth, sub-tile, physics-driven: horizontal run + gravity + jumping, with
// axis-separated AABB tile collision (the standard 2D-platformer technique). Mining is
// still COUPLED to movement — you dig the rock you push into (walk into a wall to tunnel
// sideways, hold Down to tunnel below, Up/jump to hop). Decoupling mining into its own
// aim/target action is a separate pass (#3). Ore sells the instant it's broken (no hauling).
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

  // --- platformer physics constants (tile units; time in seconds) --------------------
  // The player is a small AABB centred at (x, y). Half-extents are < 0.5 so it fits and
  // moves cleanly through a 1×1 dug cell / corridor. Tuned by feel — see PHYS export.
  const HW = 0.36, HH = 0.46;            // player half-width / half-height
  const GRAVITY = 46, MAX_FALL = 30;     // downward accel and terminal speed
  const RUN_SPEED = 6;                    // max horizontal speed
  const RUN_ACCEL = 85, AIR_ACCEL = 46;  // ground vs air responsiveness
  const FRICTION = 60;                    // ground deceleration when no input
  const JUMP_VEL = 10.7;                  // initial jump speed (~1.25 tiles high: v²/2g, g=46)
  const REACH = 1;                         // base mining reach in tiles (Chebyshev): adjacent only. Upgradable later.
  const COYOTE = 0.08, JUMP_BUF = 0.10;   // forgiveness: jump just after leaving / just before landing
  const MAX_DT = 1 / 30;                  // clamp per-step dt so fast motion can't tunnel a tile
  const EPS = 1e-4;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

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
    const startC = (WIDTH - 1) >> 1;
    return {
      seed: (seed >>> 0) || 1,
      x: startC + 0.5, y: SURFACE + 0.5,   // player CENTRE (tile units); starts on the surface
      vx: 0, vy: 0,
      grounded: false, facing: 'right',
      digKey: null, digTime: 0,          // current mining target + sub-hit time accumulator
      jumpBuf: 0, coyote: 0, jumpLatch: false,
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
  // A cell blocks the player when it's static-solid and not yet dug.
  const solidCell = (s, c, r) => solidAt(s.seed, c, r) && !isDug(s, c, r);

  // Derived stats from upgrade levels.
  function stats(s) {
    return {
      power: 1 + s.up.pick,                       // damage per hit
      interval: 200 * Math.pow(0.9, s.up.speed),  // ms between dig hits
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

  // Chip/break one target cell over `dt` while the player pushes into it. Damage is dealt
  // in discrete hits paced by dig speed (stats.interval), so it reads as chipping and the
  // sound/juice stay punchy. Pushes 'chip'/'break' events; returns true if the cell broke.
  function mineTile(s, c, r, dt, events) {
    if (r <= SURFACE) return false;
    const b = blockAt(s.seed, c, r);
    const k = key(c, r);
    if (s.digKey !== k) { s.digKey = k; s.digTime = 0; }   // switched target → restart the hit timer
    s.digTime += dt;
    const st = stats(s), hit = st.interval / 1000;
    let broke = false;
    while (s.digTime >= hit) {
      s.digTime -= hit;
      const dealt = (s.dmg[k] || 0) + st.power;
      if (dealt < b.hp) { s.dmg[k] = dealt; events.push({ type: 'chip', c, r, ore: b.ore, hp: b.hp - dealt, maxHp: b.hp }); }
      else {
        delete s.dmg[k]; s.dug[k] = true;
        let coin = 0, rich = false;
        if (b.ore) {                                       // ore sells instantly, in place
          rich = isRich(s.seed, c, r, st.fortune);
          coin = Math.max(1, Math.floor(b.value * st.valueMult * (rich ? 3 : 1)));
          s.coins += coin; s.earned += coin;
          const rar = rarityOf(b.ore); if (rar > s.best) s.best = rar;
        }
        events.push({ type: 'break', c, r, ore: b.ore, coin, rich, maxHp: b.hp });
        s.digKey = null; s.digTime = 0; broke = true; break;
      }
    }
    return broke;
  }

  // THE step that drives everything: advance the sim by `dt` seconds under `input`
  //   input = { left, right, jump, mine }
  //     left/right/jump — movement booleans (`jump` is the held state)
  //     mine — {c,r} world tile to mine this frame, or null. Mining is DECOUPLED from
  //            movement (#3): you can mine any solid tile within REACH while running,
  //            jumping, or standing still; walking into rock no longer digs it.
  // Returns { events, grounded, jumped } — events feed the presentation's juice.
  function physicsStep(s, input, dt) {
    if (dt > MAX_DT) dt = MAX_DT;            // never advance far enough to tunnel a tile
    if (dt <= 0) return { events: [], grounded: s.grounded, jumped: false };
    const events = [];
    let minedThisFrame = false;
    const mine = (c, r) => { minedThisFrame = true; return mineTile(s, c, r, dt, events); };

    // --- jump input: buffer a fresh press, decay the buffer ---
    const jd = !!input.jump;
    if (jd && !s.jumpLatch) s.jumpBuf = JUMP_BUF;
    s.jumpLatch = jd;
    s.jumpBuf = Math.max(0, s.jumpBuf - dt);

    // --- horizontal intent: accelerate toward run speed, or rub off with friction ---
    const dir = input.left ? -1 : input.right ? 1 : 0;
    if (dir) { s.facing = dir < 0 ? 'left' : 'right'; s.vx += dir * (s.grounded ? RUN_ACCEL : AIR_ACCEL) * dt; }
    else { const f = FRICTION * dt; s.vx = s.vx > 0 ? Math.max(0, s.vx - f) : Math.min(0, s.vx + f); }
    s.vx = clamp(s.vx, -RUN_SPEED, RUN_SPEED);

    // --- gravity ---
    s.vy = Math.min(MAX_FALL, s.vy + GRAVITY * dt);

    // --- integrate + resolve X (stop at walls; mining no longer happens here) ---
    let nx = s.x + s.vx * dt;
    const rTop = Math.floor(s.y - HH + EPS), rBot = Math.floor(s.y + HH - EPS);
    if (s.vx > 0) {
      const col = Math.floor(nx + HW);
      let hit = false; for (let r = rTop; r <= rBot; r++) if (solidCell(s, col, r)) { hit = true; break; }
      if (hit) { nx = col - HW - EPS; s.vx = 0; }
    } else if (s.vx < 0) {
      const col = Math.floor(nx - HW);
      let hit = false; for (let r = rTop; r <= rBot; r++) if (solidCell(s, col, r)) { hit = true; break; }
      if (hit) { nx = col + 1 + HW + EPS; s.vx = 0; }
    }
    s.x = nx;

    // --- integrate + resolve Y (land / bonk head) ---
    let ny = s.y + s.vy * dt;
    const cLeft = Math.floor(s.x - HW + EPS), cRight = Math.floor(s.x + HW - EPS);
    s.grounded = false;
    if (s.vy > 0) {                                        // falling
      const row = Math.floor(ny + HH);
      let hit = false; for (let c = cLeft; c <= cRight; c++) if (solidCell(s, c, row)) { hit = true; break; }
      if (hit) { ny = row - HH - EPS; s.vy = 0; s.grounded = true; }
    } else if (s.vy < 0) {                                 // rising
      const row = Math.floor(ny - HH);
      let hit = false; for (let c = cLeft; c <= cRight; c++) if (solidCell(s, c, row)) { hit = true; break; }
      if (hit) { ny = row + 1 + HH + EPS; s.vy = 0; }      // head bonk
    }
    s.y = ny;

    // --- mining: a separate aim/target action, independent of movement (#3) ---
    // Reach is a tile ring around the player (Chebyshev), so base REACH=1 = the eight
    // adjacent tiles; a future upgrade widens the ring.
    if (input.mine) {
      const tc = input.mine.c, tr = input.mine.r;
      if (solidCell(s, tc, tr) && Math.abs(tc - Math.floor(s.x)) <= REACH && Math.abs(tr - Math.floor(s.y)) <= REACH) mine(tc, tr);
    }

    // --- jump (after ground state is known this frame) ---
    let jumped = false;
    if (s.jumpBuf > 0 && (s.grounded || s.coyote > 0)) {
      s.vy = -JUMP_VEL; s.grounded = false; s.coyote = 0; s.jumpBuf = 0; jumped = true;
      events.push({ type: 'jump', c: Math.floor(s.x), r: Math.floor(s.y) });
    }
    s.coyote = s.grounded ? COYOTE : Math.max(0, s.coyote - dt);

    // idle → forget the current dig target so re-engaging restarts the hit timer cleanly
    if (!minedThisFrame) { s.digKey = null; s.digTime = 0; }

    const dr = Math.floor(s.y); if (dr > s.depth) s.depth = dr;
    return { events, grounded: s.grounded, jumped };
  }

  const atSurface = (s) => s.y <= SURFACE + 1;

  const PHYS = { HW, HH, GRAVITY, MAX_FALL, RUN_SPEED, JUMP_VEL, REACH };

  const Delve = {
    // world (re-exported from blocks.js for convenience)
    WIDTH, SURFACE, ORES, ORE_BY_ID, rarityOf, blockAt, solidAt, oreAt, rockHp, tileInfo,
    // sim
    UPGRADES, TECH, PHYS, isRich, newGame, stats, upgradeCost, buyUpgrade, buyTech,
    physicsStep, mineTile, atSurface, isDug, solidCell, key,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Delve;
  else root.Delve = Delve;
})(typeof self !== 'undefined' ? self : this);
