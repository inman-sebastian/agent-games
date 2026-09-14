// oracle.ts — the scenes Terraria's own code was run on, and what it produced, for tests to match exactly.
// scenes.json is the input; oracle.json.gz is the output of Terraria 1.4.0.5's decompiled Liquid.cs and
// LiquidRenderer.cs, compiled with stubs and run on those scenes. How to regenerate it: docs/FLUIDS.md,
// "The oracle". The runner here replays a scene through the TypeScript port the same way the oracle did.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  createTerrariaLiquid,
  LIQUID_LAVA,
  LIQUID_WATER,
  type TerrariaLiquid,
} from '@delve/shared';

export interface OracleEvent {
  at: number;
  op: 'dig' | 'build' | 'pour';
  x: number;
  y: number;
  amount?: number;
}

export interface OracleScene {
  name: string;
  rows: string[];
  updates: number;
  snapshotEvery: number;
  events?: OracleEvent[];
}

/** A LiquidRenderer draw entry: source x, y, width, height, offset x, y, opacity, surface (1/0); or 0 if hidden. */
export type OracleDraw = 0 | [number, number, number, number, number, number, number, number];

export interface OracleSnapshot {
  update: number;
  active: number;
  levels: number[];
  draw: OracleDraw[];
}

const here = new URL('.', import.meta.url);

export function loadOracle(): {
  scenes: OracleScene[];
  results: { name: string; snapshots: OracleSnapshot[] }[];
} {
  const scenes = JSON.parse(readFileSync(new URL('scenes.json', here), 'utf8')) as OracleScene[];
  const results = JSON.parse(
    gunzipSync(readFileSync(new URL('oracle.json.gz', here))).toString('utf8'),
  );
  return { scenes, results };
}

/**
 * Replay a scene through the port as the oracle ran it. `frame` is called before every second update (the game
 * renders its water once every second liquid update), then `visit` wherever the oracle took a snapshot.
 */
export function replay(
  scene: OracleScene,
  visit: (update: number, liquid: TerrariaLiquid) => void,
  frame: (liquid: TerrariaLiquid) => void = () => {},
): void {
  const width = scene.rows[0].length;
  const height = scene.rows.length;
  const solid = new Uint8Array(width * height);
  scene.rows.forEach((line, y) =>
    [...line].forEach((c, x) => (solid[y * width + x] = c === '#' ? 1 : 0)),
  );
  const lava = scene.rows.some((line) => line.includes('L'));
  const liquid = createTerrariaLiquid(width, height, solid, lava ? LIQUID_LAVA : LIQUID_WATER);
  scene.rows.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (c === '~' || c === 'L') liquid.level[y * width + x] = 255;
    }),
  );
  // at start every wet tile joins the list, column by column
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (liquid.level[y * width + x] > 0) liquid.addWater(y * width + x);
    }
  }
  for (let update = 0; update <= scene.updates; update++) {
    if (update % 2 === 0) frame(liquid);
    if (update % scene.snapshotEvery === 0) visit(update, liquid);
    if (update === scene.updates) break;
    for (const event of scene.events ?? []) {
      if (event.at !== update) continue;
      const index = event.y * width + event.x;
      if (event.op === 'dig') liquid.setSolid(index, false);
      else if (event.op === 'build') liquid.setSolid(index, true);
      else liquid.pour(index, event.amount ?? 0);
    }
    liquid.step();
  }
}
