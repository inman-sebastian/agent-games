// sim.ts — headless sim & world inspection for DELVE. Runs the SAME pure engine the game uses,
// so logic / world-gen / economy / cluster questions are answerable in text with no browser and
// no images. Cheap to run, cheap to read. Run via `tsx tools/sim.ts <command>`.
//
// Commands:
//   state  [--seed N] [--from save.json]        → raw state as JSON
//   probe  --seed N --c C --r R                 → tile info at one cell
//   map    --seed N [--c C --r R --w W --h H]   → ASCII ore/world map
//   play   --seed N --do "d600 r120" [--from save.json]
//        → run an action script through the physics (d = mine down / l = run left /
//          r = run right / u = jump, each followed by a frame count @ 1/60s), then print state
import { readFileSync } from 'node:fs';
import * as engine from '@delve/shared';
import type { Session, Input } from '@delve/shared';

const DT = 1 / 60; // one physics frame at 60fps
const DEFAULT_SEED = 12345;
const DEFAULT_MAP_WIDTH = 64;
const DEFAULT_MAP_HEIGHT = 30;
const DEFAULT_MAP_ROW = 140;

// Glyphs for the ASCII map, keyed by ore id (0 = plain rock).
const ORE_GLYPH: Record<number, string> = {
  0: '.',
  1: 'd',
  2: 'c',
  3: 'i',
  4: 's',
  5: 'g',
  6: 'E',
  7: 'R',
  8: 'D',
  9: 'M',
};

// --- tiny arg parser: `command --key value --flag` ---
const argv = process.argv.slice(2);
const command = argv[0];
const options: Record<string, string | true> = {};
for (let i = 1; i < argv.length; i++) {
  const token = argv[i];
  if (!token.startsWith('--')) continue;
  const keyName = token.slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) {
    options[keyName] = next;
    i++;
  } else {
    options[keyName] = true;
  }
}
const num = (value: string | true | undefined, fallback: number): number =>
  value == null || value === true ? fallback : Number(value);
const seed = num(options.seed, DEFAULT_SEED);

function loadState(): Session {
  if (typeof options.from !== 'string') return engine.newSession(seed);
  const saved = JSON.parse(readFileSync(options.from, 'utf8')) as {
    world?: Partial<Session['world']>;
    player?: Partial<Session['player']>;
  };
  const base = engine.newSession(saved.world?.seed ?? seed);
  return {
    world: { ...base.world, ...saved.world },
    player: {
      ...base.player,
      ...saved.player,
      up: { ...base.player.up, ...saved.player?.up },
      tech: { ...base.player.tech, ...saved.player?.tech },
    },
  };
}

function cmdState(): void {
  console.log(JSON.stringify(loadState(), null, 2));
}

function cmdProbe(): void {
  const column = num(options.c, 0);
  const row = num(options.r, 1);
  const info = engine.tileInfo(seed, column, row);
  const ore = info.ore ? engine.ORE_BY_ID[info.ore] : null;
  console.log(
    JSON.stringify(
      {
        column,
        row,
        ore: info.ore ?? 0,
        oreName: ore ? ore.name : null,
        maxHp: info.maxHp,
        empty: !!info.empty,
      },
      null,
      2,
    ),
  );
}

// ASCII map of the static world (ore ids over rock) — great for eyeballing cluster shape/size.
function cmdMap(): void {
  const width = num(options.w, Math.min(engine.WIDTH, DEFAULT_MAP_WIDTH));
  const height = num(options.h, DEFAULT_MAP_HEIGHT);
  const centerColumn = num(options.c, engine.WIDTH >> 1);
  const centerRow = num(options.r, DEFAULT_MAP_ROW);
  const firstColumn = Math.max(0, centerColumn - (width >> 1));
  const firstRow = Math.max(1, centerRow - (height >> 1));

  const counts: Record<number, number> = {};
  console.log(
    `world seed=${seed}  cols ${firstColumn}..${firstColumn + width - 1}  rows ${firstRow}..${firstRow + height - 1}` +
      `   (. rock  d dirt c copper i iron s silver g gold  E emerald R ruby D diamond M mythril)`,
  );
  for (let row = firstRow; row < firstRow + height; row++) {
    let line = String(row).padStart(4) + ' ';
    for (let column = firstColumn; column < firstColumn + width; column++) {
      const ore = engine.oreAt(seed, column, row);
      counts[ore] = (counts[ore] ?? 0) + 1;
      line += ORE_GLYPH[ore] ?? '?';
    }
    console.log(line);
  }
  const total = width * height;
  const oreTiles = total - (counts[0] ?? 0);
  console.log(
    `\nore coverage: ${((100 * oreTiles) / total).toFixed(1)}%   by tier: ` +
      engine.ORES.map((ore) => `${ore.name}:${counts[ore.id] ?? 0}`).join('  '),
  );
}

// Run an action script through the platformer physics and report.
function cmdPlay(): void {
  const state = loadState();
  const moveKeys: Record<string, 'left' | 'right' | 'jump'> = { l: 'left', r: 'right', u: 'jump' };
  const mined: Record<string, number> = {};
  let frames = 0;

  for (const token of String(options.do ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const key = token[0];
    const repeats = Number(token.slice(1)) || 1;
    if (key !== 'd' && !moveKeys[key]) {
      console.error('bad action token: ' + token);
      process.exit(2);
    }
    for (let i = 0; i < repeats; i++) {
      const input: Input = {};
      if (key === 'd')
        input.mine = { column: Math.floor(state.player.x), row: Math.floor(state.player.y) + 1 };
      else input[moveKeys[key]] = true;
      const result = engine.physicsStep(state, input, DT);
      frames++;
      for (const event of result.events) {
        if (event.type !== 'break' || !event.ore) continue;
        const name = engine.ORE_BY_ID[event.ore].name;
        mined[name] = (mined[name] ?? 0) + (event.qty ?? 0);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        pos: [Number(state.player.x.toFixed(2)), Number(state.player.y.toFixed(2))],
        depth: state.player.depth,
        held: engine.invCount(state.player),
        frames,
        grounded: state.player.grounded,
        up: state.player.up,
        tech: state.player.tech,
        mined,
      },
      null,
      2,
    ),
  );
}

const commands: Record<string, () => void> = {
  state: cmdState,
  probe: cmdProbe,
  map: cmdMap,
  play: cmdPlay,
};
const run = commands[command];
if (run) {
  run();
} else {
  console.log('commands: state | probe | map | play  (see header for usage)');
  process.exit(1);
}
