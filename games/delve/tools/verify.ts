// verify.ts — the runnable balance gate. Digging is free and ore is sold on demand, so a hard
// soft-lock is impossible by construction; the real risk is PACING (an economy that stalls, or
// a rock-hp curve the pick can never keep up with). We drive a greedy bot through the SAME
// physics the player uses and assert it reaches every ore tier down into Mythril within a sane
// budget, plus static invariants on resources, the ore table, cost curves, and world gen.
// Run: `pnpm verify` (or `tsx tools/verify.ts`).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as engine from '@delve/shared';
import { all, shapes } from '@delve/shared';
import type { UpgradeLevels, SaveState } from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) return;
  failures++;
  console.log(`BAD  ${message}`);
}

// --- static invariants ---
check(engine.WIDTH >= 5, 'mine should be reasonably wide');
for (let i = 1; i < engine.ORES.length; i++) {
  check(
    engine.ORES[i].value > engine.ORES[i - 1].value,
    `ore values ascend (${engine.ORES[i].name})`,
  );
  check(
    engine.ORES[i].band[0] >= engine.ORES[i - 1].band[0],
    `ore bands descend (${engine.ORES[i].name})`,
  );
}
for (const kind of Object.keys(engine.UPGRADES) as (keyof UpgradeLevels)[]) {
  check(engine.upgradeCost(kind, 1) > engine.upgradeCost(kind, 0), `${kind} cost is monotonic`);
}

// --- resource validation: every entity conforms + resources/index.ts imports them all ---
const STRATA_COUNT = 5;
const ORE_COUNT = 9;
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
check(strata.length === STRATA_COUNT, `${STRATA_COUNT} strata resources (got ${strata.length})`);
check(ores.length === ORE_COUNT, `${ORE_COUNT} ore resources (got ${ores.length})`);
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
    ore.value > 0 && ore.hp >= 0 && ore.weight > 0 && HEX_COLOR.test(ore.color),
    `ore ${ore.name}: value/hp/weight/color`,
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
  const state = engine.newGame(999);
  let maxX = state.x;
  let minX = state.x;
  for (let frame = 0; frame < 3000; frame++) {
    engine.physicsStep(state, { right: true }, DT);
    if (state.x > maxX) maxX = state.x;
  }
  for (let frame = 0; frame < 6000; frame++) {
    engine.physicsStep(state, { left: true }, DT);
    if (state.x < minX) minX = state.x;
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

// --- greedy playthrough: mine straight down, reinvest coins as they accrue ---
// The bot aims its mine action at the tile directly below: it breaks that tile and gravity
// drops it in, one row at a time — a single-column shaft. Frames stand in for "actions".
const GREEDY_SEED = 12345;
const TARGET_DEPTH = 520; // deep enough to pass the whole Mythril band
const FRAME_BUDGET = 3_000_000;
const FRAMES_PER_SHOP = 4000; // physics frames between shopping trips
const MYTHRIL_MIN_DEPTH = 480; // Mythril band starts here (2× finer grid)
const SHALLOW_BAND_TOP = 8; // ores whose band starts at/above this can be skipped by a 1-wide shaft

function greedyPlaythrough(seed: number): {
  state: SaveState;
  frames: number;
  firstMinedFrame: Record<number, number>;
} {
  const state = engine.newGame(seed);
  const firstMinedFrame: Record<number, number> = {};
  let frames = 0;

  const shop = (): void => {
    engine.sellAll(state); // sell the haul before buying
    for (;;) {
      let cheapest: keyof UpgradeLevels | null = null;
      let cheapestCost = Infinity;
      for (const kind of Object.keys(engine.UPGRADES) as (keyof UpgradeLevels)[]) {
        if (state.up[kind] >= engine.UPGRADES[kind].max) continue;
        const cost = engine.upgradeCost(kind, state.up[kind]);
        if (cost <= state.coins && cost < cheapestCost) {
          cheapest = kind;
          cheapestCost = cost;
        }
      }
      if (!cheapest) break;
      engine.buyUpgrade(state, cheapest);
    }
    engine.buyTech(state, 'scanner');
    engine.buyTech(state, 'lantern');
  };

  while (state.depth < TARGET_DEPTH && frames < FRAME_BUDGET) {
    shop();
    for (
      let i = 0;
      i < FRAMES_PER_SHOP && state.depth < TARGET_DEPTH && frames < FRAME_BUDGET;
      i++
    ) {
      const tileBelow = { column: Math.floor(state.x), row: Math.floor(state.y) + 1 };
      const result = engine.physicsStep(state, { mine: tileBelow }, DT);
      frames++;
      for (const event of result.events) {
        if (event.type === 'break' && event.ore) {
          firstMinedFrame[event.ore] ??= frames;
        }
      }
    }
  }
  shop();
  return { state, frames, firstMinedFrame };
}

const run = greedyPlaythrough(GREEDY_SEED);
console.log(
  `\nGreedy bot: depth ${run.state.depth}, ${run.frames.toLocaleString()} frames, ${run.state.earned.toLocaleString()} coins earned`,
);
console.log('upgrades', run.state.up, 'tech', run.state.tech);

check(run.state.depth >= MYTHRIL_MIN_DEPTH, `bot reached Mythril depth (got ${run.state.depth})`);
check(run.frames < FRAME_BUDGET, `bot finished within frame budget (used ${run.frames})`);
for (const ore of engine.ORES) {
  const frame = run.firstMinedFrame[ore.id];
  console.log(
    `  ${frame ? 'OK ' : '-- '}  ${ore.name.padEnd(8)} ${frame ? `first mined @ frame ${frame}` : '(shallow band, not on shaft path)'}`,
  );
  // Dirt/Copper live in shallow rows a single-column shaft can skip; their reachability is
  // covered by the world-scan above. Everything deeper must fall on the descent path.
  if (ore.band[0] > SHALLOW_BAND_TOP) check(!!frame, `${ore.name} was mined by the greedy bot`);
}
check(Number.isFinite(run.state.coins) && run.state.coins >= 0, 'coins stay finite & non-negative');

console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
