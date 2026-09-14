// smooth.test.ts — world smoothing against Terraria's own code (#92). Every grid in smooth-scenes.json (real DELVE
// chunks and synthetic terrain) was run through Terraria 1.4.0.5's "Smooth World" pass; the port must leave every
// tile with the same active, slope and half-brick bits.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { smoothWorld, xorshift, type SmoothGrid } from '@delve/shared';

const here = new URL('.', import.meta.url);
const scenes = JSON.parse(readFileSync(new URL('smooth-scenes.json', here), 'utf8')) as {
  name: string;
  width: number;
  height: number;
  state: number;
  active: number[];
}[];
const results = JSON.parse(
  gunzipSync(readFileSync(new URL('smooth-oracle.json.gz', here))).toString('utf8'),
) as { tiles: number[] }[];

describe("world smoothing matches Terraria's Smooth World pass", () => {
  scenes.forEach((scene, n) => {
    it(scene.name, () => {
      const count = scene.width * scene.height;
      const grid: SmoothGrid = {
        firstColumn: 0,
        firstRow: 0,
        width: scene.width,
        height: scene.height,
        active: Uint8Array.from(scene.active),
        slope: new Uint8Array(count),
        half: new Uint8Array(count),
      };
      smoothWorld(grid, xorshift(scene.state));
      const expected = results[n].tiles;
      for (let index = 0; index < count; index++) {
        const got = [grid.active[index], grid.slope[index], grid.half[index]];
        const want = expected.slice(index * 3, index * 3 + 3);
        const x = Math.floor(index / scene.height);
        const y = index % scene.height;
        expect(got, `tile ${x},${y}`).toEqual(want);
      }
    });
  });
});
