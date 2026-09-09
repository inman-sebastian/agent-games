// generate.js — because no human can playtest, the solver authors. Seeded RNG
// (deterministic → reproducible ship set) sprinkles walls, sand, PITS, blocks
// and targets into a room; the BFS solver keeps only maps solvable with a par
// in a fun band. Then it builds a difficulty curve — base mechanics first,
// fillable-pit levels later — and writes levels.js. Run: `node generate.js`.
const fs = require('fs');
const Engine = require('./engine');

// --- seeded PRNG (mulberry32) so the shipped levels never change under me ---
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260908);

const IW = 6, IH = 6;            // interior size
const MIN_PAR = 4, MAX_PAR = 24; // fun band
const MAX_NODES = 200000;        // keep solver snappy (also used live for hints)

function makeCandidate({ targets, extraBlocks, pits }) {
  const cells = [];
  for (let r = 0; r < IH; r++) cells.push(new Array(IW).fill('.'));
  const free = [];
  for (let r = 0; r < IH; r++) for (let c = 0; c < IW; c++) free.push([r, c]);
  const take = () => free.length ? free.splice(Math.floor(rand() * free.length), 1)[0] : null;

  const put = (ch) => { const p = take(); if (p) cells[p[0]][p[1]] = ch; return p; };

  for (let i = 0, n = Math.floor(rand() * 4); i < n; i++) put('#');   // wall nubs
  const sand = [];
  for (let i = 0, n = 2 + Math.floor(rand() * 4); i < n; i++) { const p = put('='); if (p) sand.push(p); }
  for (let i = 0; i < pits; i++) put('x');                            // hazards

  const isSand = (p) => sand.some(s => s[0] === p[0] && s[1] === p[1]);
  const pp = take(); if (!pp) return null; cells[pp[0]][pp[1]] = isSand(pp) ? 'A' : '@';
  for (let i = 0; i < targets; i++) { const t = take(); if (!t) return null; cells[t[0]][t[1]] = isSand(t) ? 'T' : 'o'; }
  for (let i = 0; i < targets + extraBlocks; i++) { const b = take(); if (!b) return null; cells[b[0]][b[1]] = isSand(b) ? 'B' : '$'; }

  const rows = ['#'.repeat(IW + 2)];
  for (let r = 0; r < IH; r++) rows.push('#' + cells[r].join('') + '#');
  rows.push('#'.repeat(IW + 2));
  return rows.join('\n');
}

// A pit is REQUIRED (the fill mechanic is the point) when the level is
// unsolvable with pits treated as walls, but solvable when they can be filled.
function pitsAsWalls(level) {
  const terrain = level.terrain.map(row => row.map(c => (c === Engine.PIT ? Engine.WALL : c)));
  return Object.assign({}, level, { terrain });
}
function classifyPit(level, normalRes) {
  const hasPit = level.terrain.some(row => row.includes(Engine.PIT));
  if (!hasPit) return { hasPit: false, requiresFill: false, pitMatters: false };
  const wall = Engine.solve(pitsAsWalls(level), MAX_NODES);
  const requiresFill = wall.length === Infinity && !wall.aborted; // can't win unless you fill a pit
  const pitMatters = requiresFill || (wall.length !== Infinity && wall.length > normalRes.length);
  return { hasPit: true, requiresFill, pitMatters };
}

// --- generate a big pool, keep solvable & in-band, dedup by map, tag pits ---
const pool = new Map();
let tries = 0;
while (pool.size < 700 && tries < 120000) {
  tries++;
  const hasPit = rand() < 0.5;
  const cfg = {
    targets: rand() < 0.55 ? 1 : 2,
    extraBlocks: hasPit && rand() < 0.7 ? 1 : 0,   // spare block so a pit can be filled
    pits: hasPit ? 1 + Math.floor(rand() * 2) : 0,
  };
  const map = makeCandidate(cfg);
  if (!map || pool.has(map)) continue;
  const level = Engine.parse(map);
  if (!level.player || level.targets.length === 0 || level.blocks.length < level.targets.length) continue;
  if (Engine.isWin(level, { player: level.player, blocks: level.blocks, filled: [] })) continue; // pre-solved
  const res = Engine.solve(level, MAX_NODES);
  if (res.aborted || res.length === Infinity || res.length < MIN_PAR || res.length > MAX_PAR) continue;
  const cls = classifyPit(level, res);
  pool.set(map, { map, par: res.length, nodes: res.nodes, ...cls });
}

const all = [...pool.values()];
console.log(`pool: ${all.length} solvable in-band levels from ${tries} tries`);

// pick `count` levels from `arr` spread evenly across its par range
function spread(arr, count) {
  const s = arr.slice().sort((a, b) => a.par - b.par);
  if (s.length <= count) return s;
  const lo = s[0].par, hi = s[s.length - 1].par, used = new Set(), out = [], denom = Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const target = lo + (hi - lo) * (i / denom);
    let best = null, bd = Infinity;
    for (const l of s) { if (used.has(l.map)) continue; const d = Math.abs(l.par - target); if (d < bd) { bd = d; best = l; } }
    if (best) { used.add(best.map); out.push(best); }
  }
  return out.sort((a, b) => a.par - b.par);
}

// fill `count` from a preferred pool (spread by par), topping up from a backup
function takeCurve(preferred, backup, count) {
  const p = spread(preferred, Math.min(count, preferred.length));
  const need = count - p.length;
  const b = need > 0 ? spread(backup.filter(x => !p.includes(x)), need) : [];
  return [...p, ...b].sort((a, b) => a.par - b.par);
}

// curve: 4 base levels (no pit), then 8 pit levels that genuinely USE fills —
// prefer levels where filling is required, so the mechanic is the point.
const base = spread(all.filter(l => !l.hasPit), 4);
const requiresFill = all.filter(l => l.requiresFill);
const pitMatters = all.filter(l => l.pitMatters && !l.requiresFill);
const pit = takeCurve(requiresFill, pitMatters, 8);
console.log(`(${requiresFill.length} require-fill, ${pitMatters.length} pit-matters available)`);

const NAMES = ['Drift', 'Brakes', 'Sandbar', 'Detour', 'Sinkhole', 'Threshold',
  'Crossing', 'Pitfall', 'Switchback', 'Chasm', 'Whiteout', 'Abyss'];
const chosen = [...base, ...pit];
const levels = chosen.map((lv, i) => ({ name: `${i + 1}. ${NAMES[i] || 'Level ' + (i + 1)}`, par: lv.par, map: lv.map }));

console.log('\nshipping:');
for (let i = 0; i < levels.length; i++)
  console.log(`  par ${String(levels[i].par).padStart(2)}  ${levels[i].name}${chosen[i].requiresFill ? '  [pit·must-fill]' : chosen[i].hasPit ? '  [pit]' : ''}`);

const body = levels.map(l => `  { name: ${JSON.stringify(l.name)}, par: ${l.par}, map: ${JSON.stringify(l.map)} },`).join('\n');
const file = `// levels.js — GENERATED by generate.js (seed 20260908). Do not hand-edit.
// Every level below was proven solvable (death-free) by the BFS solver; \`par\` is
// its shortest solution. Legend: #wall .ice =sand x=pit @player $block o target
// (A/B/T = player/block/target on sand). A block shoved into a pit fills it.
(function (root) {
  const LEVELS = [
${body}
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = { LEVELS };
  else root.LEVELDATA = { LEVELS };
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(__dirname + '/levels.js', file);
console.log(`\nwrote levels.js with ${levels.length} levels`);
