// verify.js — runnable balance gate. Digging is free and ore sells in place, so
// a hard soft-lock is impossible by construction; the real risk is PACING (an
// economy that stalls, or a rock-hp curve the pickaxe can never keep up with).
// So we drive a greedy bot through the SAME engine the player uses and assert it
// reaches every ore tier — down into Mythril — within a sane action budget, plus
// static invariants on the ore table, cost curves, and world generation.
// Run: `node verify.js`.
const D = require('./engine');

let bad = 0;
const chk = (cond, msg) => { if (!cond) { bad++; console.log('BAD  ' + msg); } };

// --- static invariants ---
chk(D.WIDTH >= 5, 'mine should be reasonably wide');
for (let i = 1; i < D.ORES.length; i++) {
  chk(D.ORES[i].value > D.ORES[i - 1].value, `ore values ascend (${D.ORES[i].name})`);
  chk(D.ORES[i].band[0] >= D.ORES[i - 1].band[0], `ore bands descend (${D.ORES[i].name})`);
}
for (const k in D.UPGRADES) chk(D.upgradeCost(k, 1) > D.upgradeCost(k, 0), `${k} cost is monotonic`);

// --- world gen: every ore tier must be discoverable within its band ---
for (const o of D.ORES) {
  const r0 = o.band[0], r1 = Math.min(o.band[1], r0 + 40);
  let found = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = 0; c < D.WIDTH; c++)
      if (D.oreAt(1, c, r) === o.id) found++;
  chk(found > 0, `${o.name} appears within a 40-row slice of its band`);
}

// --- greedy playthrough: dig straight down, reinvest coins as they accrue ---
function play(seed) {
  const s = D.newGame(seed);
  const seenTier = {};                 // oreId -> first action it was mined
  let steps = 0;
  const BUDGET = 3_000_000, TARGET = 250;

  const shop = () => {                  // buy cheapest affordable upgrade repeatedly
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

  while (s.depth < TARGET && steps < BUDGET) {
    shop();
    for (let i = 0; i < 40 && s.depth < TARGET && steps < BUDGET; i++) {
      const ev = D.attemptStep(s, 'down');
      steps++;
      if (ev.type === 'dig' && ev.broke && ev.coin > 0) seenTier[ev.ore] = seenTier[ev.ore] || steps;
    }
  }
  shop();
  return { s, steps, seenTier };
}

const run = play(12345);
console.log(`\nGreedy bot: depth ${run.s.depth}, ${run.steps.toLocaleString()} actions, ` +
  `${run.s.earned.toLocaleString()} coins earned`);
console.log('upgrades', run.s.up, 'tech', run.s.tech);

chk(run.s.depth >= 240, `bot reached Mythril depth (got ${run.s.depth})`);
chk(run.steps < 3_000_000, `bot finished within action budget (used ${run.steps})`);
for (const o of D.ORES) {
  const got = run.seenTier[o.id];
  console.log(`  ${got ? 'OK ' : '-- '}  ${o.name.padEnd(8)} ${got ? 'first mined @ action ' + got : '(shallow band, not on shaft path)'}`);
  // Dirt lives only in rows 1-4, which a single-column shaft can skip; its
  // reachability is covered by the static world-scan above. Everything deeper
  // must fall on the descent path.
  if (o.band[0] > 4) chk(!!got, `${o.name} was mined by the greedy bot`);
}
chk(Number.isFinite(run.s.coins) && run.s.coins >= 0, 'coins stay finite & non-negative');

console.log(`\n${bad === 0 ? 'ALL GOOD' : bad + ' CHECK(S) FAILED'}`);
process.exit(bad ? 1 : 0);
