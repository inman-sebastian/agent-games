// sim.js — headless sim & world inspection for DELVE. Runs the SAME pure engine the
// game uses (scripts/engine.js), so logic / world-gen / economy / cluster checks need
// no browser and produce no images — just text. Cheap to run, cheap to read.
//
// Usage:
//   node tools/sim.js state  [--seed N] [--from save.json]      → raw state as JSON
//   node tools/sim.js probe  --seed N --c C --r R               → tileInfo at one cell
//   node tools/sim.js map    --seed N [--c C --r R --w W --h H] → ASCII ore/world map
//   node tools/sim.js play   --seed N --do "d40 r5 d40" [--from save.json]
//        → run an action script (u/d/l/r + count), print resulting state + a summary
//
// Notes: the world is a pure f(seed,c,r); a "state" is just {seed, c, r, dug, dmg,
// coins, up, tech, …}. --from loads a save JSON (merged over newGame, like the game).
'use strict';
const fs = require('fs');
const D = require('../scripts/engine');

// --- tiny arg parser: `cmd --k v --flag` ---
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; opt[k] = v; }
}
const num = (v, d) => v == null ? d : +v;
const seed = num(opt.seed, 12345);

const ORE_GLYPH = { 0: '.', 1: 'd', 2: 'c', 3: 'i', 4: 's', 5: 'g', 6: 'E', 7: 'R', 8: 'D', 9: 'M' };

function loadState() {
  if (opt.from) { const o = JSON.parse(fs.readFileSync(opt.from, 'utf8')); const base = D.newGame(o.seed || seed);
    return { ...base, ...o, up: { ...base.up, ...o.up }, tech: { ...base.tech, ...o.tech } }; }
  return D.newGame(seed);
}

function cmdState() { console.log(JSON.stringify(loadState(), null, 2)); }

function cmdProbe() {
  const c = num(opt.c, 0), r = num(opt.r, 1);
  const info = D.tileInfo(seed, c, r), ore = D.ORE_BY_ID[info.ore];
  console.log(JSON.stringify({ c, r, ore: info.ore, oreName: ore ? ore.name : null, maxHp: info.maxHp, wall: !!info.wall, empty: !!info.empty }, null, 2));
}

// ASCII map of the static world (ore ids over rock). Great for eyeballing cluster
// shape/size/type without an image. Centre defaults to a mid-depth slice.
function cmdMap() {
  const w = num(opt.w, Math.min(D.WIDTH, 64)), h = num(opt.h, 30);
  const cc = num(opt.c, D.WIDTH >> 1), cr = num(opt.r, 140);
  const c0 = Math.max(0, cc - (w >> 1)), r0 = Math.max(1, cr - (h >> 1));
  const counts = {};
  console.log(`world seed=${seed}  cols ${c0}..${c0 + w - 1}  rows ${r0}..${r0 + h - 1}   (. rock  d dirt c copper i iron s silver g gold  E emerald R ruby D diamond M mythril)`);
  for (let r = r0; r < r0 + h; r++) {
    let line = String(r).padStart(4) + ' ';
    for (let c = c0; c < c0 + w; c++) { const o = D.oreAt(seed, c, r); counts[o] = (counts[o] || 0) + 1; line += ORE_GLYPH[o] || '?'; }
    console.log(line);
  }
  const total = w * h, ore = total - (counts[0] || 0);
  console.log(`\nore coverage: ${(100 * ore / total).toFixed(1)}%   by tier: ` +
    D.ORES.map(o => `${o.name}:${counts[o.id] || 0}`).join('  '));
}

// Run an action script and report. Tokens: <dir><count>, dir in u/d/l/r. e.g. "d40 r5 d40".
function cmdPlay() {
  const s = loadState();
  const DIRS = { u: 'up', d: 'down', l: 'left', r: 'right' };
  const seen = {}; let steps = 0, blocked = 0;
  for (const tok of String(opt.do || '').trim().split(/\s+/).filter(Boolean)) {
    const dir = DIRS[tok[0]], n = +tok.slice(1) || 1;
    if (!dir) { console.error('bad action token: ' + tok); process.exit(2); }
    for (let i = 0; i < n; i++) {
      const ev = D.attemptStep(s, dir); steps++;
      if (ev.type === 'blocked') blocked++;
      if (ev.type === 'dig' && ev.broke && ev.ore) { const nm = D.ORE_BY_ID[ev.ore].name; seen[nm] = seen[nm] || { count: 0, coin: 0 }; seen[nm].count++; seen[nm].coin += ev.coin || 0; }
    }
  }
  console.log(JSON.stringify({
    pos: [s.c, s.r], depth: s.depth, coins: s.coins, earned: s.earned,
    steps, blocked, up: s.up, tech: s.tech,
    mined: seen,
  }, null, 2));
}

const cmds = { state: cmdState, probe: cmdProbe, map: cmdMap, play: cmdPlay };
if (cmds[cmd]) cmds[cmd]();
else { console.log('commands: state | probe | map | play  (see header for usage)'); process.exit(1); }
