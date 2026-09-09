// verify.js — runnable quality gate for the SHIPPED levels. Re-solves every
// level from scratch and asserts: solvable, death-free, par matches, in band,
// and the solver's own solution actually wins on replay. Run: `node verify.js`.
const Engine = require('./engine');
const { LEVELS } = require('./levels');

const MIN_PAR = 4, MAX_PAR = 24;
let bad = 0, pitLevels = 0, mustFill = 0;

for (const lvl of LEVELS) {
  const level = Engine.parse(lvl.map);
  const hasPit = level.terrain.some(row => row.includes(Engine.PIT));
  if (hasPit) pitLevels++;
  const shape = level.player && level.targets.length > 0 && level.blocks.length >= level.targets.length;

  const res = Engine.solve(level);
  const ok = shape && res.length === lvl.par && lvl.par >= MIN_PAR && lvl.par <= MAX_PAR;
  if (!ok) bad++;

  // replay the solver's path: it must win, and never pass through a death
  let st = { player: level.player.slice(), blocks: level.blocks.map(b => b.slice()), filled: [] };
  let deathFree = true;
  if (res.moves) for (const m of res.moves) { const ns = Engine.move(level, st, m); if (!ns || ns.dead) { deathFree = false; break; } st = ns; }
  const won = res.moves ? Engine.isWin(level, st) : false;
  if (res.moves && (!won || !deathFree)) bad++;
  if (hasPit && st.filled.length > 0) mustFill++;

  console.log(`${ok && won && deathFree ? 'OK ' : 'BAD'}  par ${String(res.length).padStart(3)} (stored ${String(lvl.par).padStart(2)})  ${hasPit ? (st.filled.length ? 'fill' : 'pit ') : '    '}  ${lvl.name}`);
}

console.assert(LEVELS.length >= 10, 'want at least 10 levels');
console.assert(pitLevels >= 4, 'want several pit levels');
console.assert(mustFill >= 3, 'want several levels whose solution fills a pit');
console.assert(bad === 0, `${bad} level(s) failed verification`);
console.log(`\n${LEVELS.length} levels · ${pitLevels} with pits · ${mustFill} solved by filling · ${bad} bad`);
process.exit(bad ? 1 : 0);
