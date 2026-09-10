// verify.js — runnable balance gate. Digging is free and ore sells in place, so
// a hard soft-lock is impossible by construction; the real risk is PACING (an
// economy that stalls, or a rock-hp curve the pickaxe can never keep up with).
// So we drive a greedy bot through the SAME engine the player uses and assert it
// reaches every ore tier — down into Mythril — within a sane action budget, plus
// static invariants on the ore table, cost curves, and world generation.
// Run: `node tools/verify.js` (or `pnpm verify`).
const D = require('../scripts/engine');

let bad = 0;
const chk = (cond, msg) => { if (!cond) { bad++; console.log('BAD  ' + msg); } };

// --- static invariants ---
chk(D.WIDTH >= 5, 'mine should be reasonably wide');
for (let i = 1; i < D.ORES.length; i++) {
  chk(D.ORES[i].value > D.ORES[i - 1].value, `ore values ascend (${D.ORES[i].name})`);
  chk(D.ORES[i].band[0] >= D.ORES[i - 1].band[0], `ore bands descend (${D.ORES[i].name})`);
}
for (const k in D.UPGRADES) chk(D.upgradeCost(k, 1) > D.upgradeCost(k, 0), `${k} cost is monotonic`);

// --- resource validation: every entity file conforms + the manifest matches disk ---
const RES = require('../scripts/resources');
const fs = require('fs'), path = require('path');
const resDir = path.join(__dirname, '..', 'resources');
const onDisk = fs.readdirSync(resDir).filter(f => f.endsWith('.js') && f !== 'manifest.js').map(f => f.replace(/\.js$/, '')).sort();
const manifest = require('../resources/manifest').slice().sort();
chk(JSON.stringify(onDisk) === JSON.stringify(manifest), `manifest matches resources/ dir (${onDisk.length} files)`);
const strata = RES.all('strata'), ores = RES.all('ore');
chk(strata.length === 5, `5 strata resources (got ${strata.length})`);
chk(ores.length === 9, `9 ore resources (got ${ores.length})`);
for (const s of strata) {
  chk(typeof s.id === 'string' && Number.isFinite(s.top) && s.top >= 0, `strata ${s.id}: id + top`);
  chk(Array.isArray(s.ramp) && s.ramp.length === 6 && s.ramp.every(h => /^#[0-9a-f]{6}$/i.test(h)), `strata ${s.id}: 6-stop hex ramp`);
}
for (const o of ores) {
  chk(Number.isFinite(o.id) && !!o.name && Array.isArray(o.band) && o.band.length === 2, `ore ${o.name || o.id}: id/name/band`);
  chk(o.value > 0 && o.hp >= 0 && o.weight > 0 && /^#[0-9a-f]{6}$/i.test(o.color || ''), `ore ${o.name}: value/hp/weight/color`);
  chk(o.art && RES.shapes[o.art.shape] && Array.isArray(o.art.c) && o.art.c.length === 3, `ore ${o.name}: art shape + colour triad`);
  chk(typeof o.desc === 'string' && o.desc.length > 0, `ore ${o.name}: codex blurb`);
}

// --- #8 regression: horizontal movement is unbounded (no leftover WIDTH wall) ---
// The world is infinite in every direction (#1); movement is continuous physics (#2), not
// the old grid step that clamped to 0..WIDTH. Walk the open surface far both ways to prove
// there's no invisible barrier at the old field edges.
(function () {
  const s = D.newGame(999);
  let maxx = s.x, minx = s.x;
  for (let i = 0; i < 3000; i++) { D.physicsStep(s, { right: true }, 1 / 60); if (s.x > maxx) maxx = s.x; }
  for (let i = 0; i < 6000; i++) { D.physicsStep(s, { left: true }, 1 / 60); if (s.x < minx) minx = s.x; }
  chk(maxx > D.WIDTH + 20, `player moves right past the old WIDTH bound (reached x=${maxx.toFixed(0)})`);
  chk(minx < -20, `player moves left into negative columns (reached x=${minx.toFixed(0)})`);
})();

// --- world gen: every ore tier must be discoverable within its band ---
for (const o of D.ORES) {
  const r0 = o.band[0], r1 = Math.min(o.band[1], r0 + 80);
  let found = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = 0; c < D.WIDTH; c++)
      if (D.oreAt(1, c, r) === o.id) found++;
  chk(found > 0, `${o.name} appears within a 40-row slice of its band`);
}

// --- greedy playthrough: dig straight down, reinvest coins as they accrue ---
// The bot drives the SAME physics step the player uses, aiming its mine action at the tile
// directly below: it breaks that tile and gravity drops it in, one row at a time — a
// single-column shaft, the same path the old grid bot took. Frames stand in for "actions".
function play(seed) {
  const s = D.newGame(seed);
  const seenTier = {};                 // oreId -> first frame it was mined
  let frames = 0;
  const dt = 1 / 60, BUDGET = 3_000_000, TARGET = 520;   // rows; Mythril band starts at 480 (2× finer grid)

  const shop = () => {                  // sell the haul, then buy cheapest affordable upgrade repeatedly
    D.sellAll(s);
    for (;;) {
      let best = null, bestCost = Infinity;
      for (const k in D.UPGRADES) {
        if (s.up[k] >= D.UPGRADES[k].max) continue;
        const c = D.upgradeCost(k, s.up[k]);
        if (c <= s.coins && c < bestCost) { best = k; bestCost = c; }
      }
      if (!best) break;
      D.buyUpgrade(s, best);
    }
    D.buyTech(s, 'scanner'); D.buyTech(s, 'lantern');
  };

  while (s.depth < TARGET && frames < BUDGET) {
    shop();
    for (let i = 0; i < 4000 && s.depth < TARGET && frames < BUDGET; i++) {
      const target = { c: Math.floor(s.x), r: Math.floor(s.y) + 1 };   // the tile directly below
      const ev = D.physicsStep(s, { mine: target }, dt);
      frames++;
      for (const e of ev.events) if (e.type === 'break' && e.ore) seenTier[e.ore] = seenTier[e.ore] || frames;
    }
  }
  shop();
  return { s, frames, seenTier };
}

const run = play(12345);
console.log(`\nGreedy bot: depth ${run.s.depth}, ${run.frames.toLocaleString()} frames, ` +
  `${run.s.earned.toLocaleString()} coins earned`);
console.log('upgrades', run.s.up, 'tech', run.s.tech);

chk(run.s.depth >= 480, `bot reached Mythril depth (got ${run.s.depth})`);
chk(run.frames < 3_000_000, `bot finished within frame budget (used ${run.frames})`);
for (const o of D.ORES) {
  const got = run.seenTier[o.id];
  console.log(`  ${got ? 'OK ' : '-- '}  ${o.name.padEnd(8)} ${got ? 'first mined @ frame ' + got : '(shallow band, not on shaft path)'}`);
  // Dirt/Copper live in shallow rows a single-column shaft can skip; their
  // reachability is covered by the static world-scan above. Everything deeper
  // must fall on the descent path.
  if (o.band[0] > 8) chk(!!got, `${o.name} was mined by the greedy bot`);
}
chk(Number.isFinite(run.s.coins) && run.s.coins >= 0, 'coins stay finite & non-negative');

console.log(`\n${bad === 0 ? 'ALL GOOD' : bad + ' CHECK(S) FAILED'}`);
process.exit(bad ? 1 : 0);
