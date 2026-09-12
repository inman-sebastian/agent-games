// verify.ts — the runnable content gate. There is no economy any more (no coins, no selling — see
// engine.ts): everything mined goes into the inventory. So this asserts the invariants that still
// hold without money — resource conformance, the ore table, world gen, and a movement regression —
// namely that every ore tier is DISCOVERABLE within its band and the world has no leftover bounds.
// The old greedy-bot balance/pacing gate was economy-coupled and has been removed; a new
// progression gate will replace it once the replacement progression system lands.
// Run: `pnpm verify` (or `tsx tools/verify.ts`).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as engine from '@delve/shared';
import { all, shapes } from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) return;
  failures++;
  console.log(`BAD  ${message}`);
}

// --- static invariants ---
check(engine.WIDTH >= 5, 'mine should be reasonably wide');

// --- resource validation: every entity conforms + resources/index.ts imports them all ---
const RAMP_STOPS = 6;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const resourceFiles = readdirSync(join(HERE, '..', 'shared', 'src', 'resources'))
  .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
  .map((file) => file.replace(/\.ts$/, ''))
  .sort();
const indexSource = readFileSync(
  join(HERE, '..', 'shared', 'src', 'resources', 'index.ts'),
  'utf8',
);
const importedByIndex = resourceFiles.every((name) => indexSource.includes(`'./${name}'`));
check(importedByIndex, 'resources/index.ts imports every entity file (no drift)');

const strata = all('strata');
const ores = all('ore');
// counts are derived from the files on disk (no hardcoded totals to drift) — every resource file
// registers exactly one entity, so strata + ores must account for all of them.
check(
  strata.length + ores.length === resourceFiles.length,
  `every resource file registers one entity (${strata.length} strata + ${ores.length} ore = ${resourceFiles.length} files)`,
);
for (const stratum of strata) {
  check(
    !!stratum.id && Number.isFinite(stratum.top) && stratum.top >= 0,
    `strata ${stratum.id}: id + top`,
  );
  check(
    stratum.ramp.length === RAMP_STOPS && stratum.ramp.every((hex) => HEX_COLOR.test(hex)),
    `strata ${stratum.id}: ${RAMP_STOPS}-stop hex ramp`,
  );
}
for (const ore of ores) {
  check(
    Number.isFinite(ore.id) && !!ore.name && ore.band.length === 2,
    `ore ${ore.name}: id/name/band`,
  );
  check(
    ore.hp >= 0 && ore.weight > 0 && HEX_COLOR.test(ore.color),
    `ore ${ore.name}: hp/weight/color`,
  );
  check(
    !!shapes[ore.art.shape] && ore.art.c.length === 3,
    `ore ${ore.name}: art shape + colour triad`,
  );
  check(ore.desc.length > 0, `ore ${ore.name}: codex blurb`);
}

// --- #8 regression: horizontal movement is unbounded (no leftover WIDTH wall) ---
// The world is infinite (#1); movement is continuous physics (#2), not a grid step clamped to
// 0..WIDTH. Walk the open surface far both ways to prove there's no invisible barrier.
const DT = 1 / 60; // one physics frame at 60fps
{
  const state = engine.newSession(999);
  let maxX = state.player.x;
  let minX = state.player.x;
  for (let frame = 0; frame < 3000; frame++) {
    engine.physicsStep(state, { right: true }, DT);
    if (state.player.x > maxX) maxX = state.player.x;
  }
  for (let frame = 0; frame < 6000; frame++) {
    engine.physicsStep(state, { left: true }, DT);
    if (state.player.x < minX) minX = state.player.x;
  }
  check(
    maxX > engine.WIDTH + 20,
    `player moves right past the old WIDTH bound (reached x=${maxX.toFixed(0)})`,
  );
  check(minX < -20, `player moves left into negative columns (reached x=${minX.toFixed(0)})`);
}

// --- world gen: every ore tier must be discoverable within its band ---
const WORLD_SCAN_SEED = 1;
const BAND_SCAN_ROWS = 80; // rows of a tier's band to scan for at least one instance
for (const ore of engine.ORES) {
  const firstRow = ore.band[0];
  const lastRow = Math.min(ore.band[1], firstRow + BAND_SCAN_ROWS);
  let found = 0;
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = 0; column < engine.WIDTH; column++) {
      if (engine.oreAt(WORLD_SCAN_SEED, column, row) === ore.id) found++;
    }
  }
  check(found > 0, `${ore.name} appears within a slice of its band`);
}

console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
