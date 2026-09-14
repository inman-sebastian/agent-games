// smooth-scenes.ts — writes smooth-scenes.json, the grids the Smooth World oracle runs (#92): real DELVE chunks
// from several seeds, and synthetic terrain (big steps, overhangs, pillars, caves) so every branch of the pass is
// exercised. Run: `npx tsx tools/terraria-oracle/smooth-scenes.ts`, then the harness's `smooth` mode.
import { writeFileSync } from 'node:fs';
import { chunkSeed, unsmoothedGrid } from '@delve/shared';

interface Scene {
  name: string;
  width: number;
  height: number;
  state: number;
  active: number[];
}

const scenes: Scene[] = [];
for (const seed of [1, 12345, 777, 20260914]) {
  for (const chunk of [-3, 0, 5, 37]) {
    const grid = unsmoothedGrid(seed, chunk);
    scenes.push({
      name: `seed ${seed} chunk ${chunk}`,
      width: grid.width,
      height: grid.height,
      state: chunkSeed(seed, chunk),
      active: Array.from(grid.active),
    });
  }
}

let random = 0x2545f491;
const next = (maximum: number): number => {
  random ^= random << 13;
  random >>>= 0;
  random ^= random >>> 17;
  random ^= random << 5;
  random >>>= 0;
  return random % maximum;
};
for (let k = 0; k < 16; k++) {
  const width = 48;
  const height = 24;
  const active = new Array<number>(width * height).fill(0);
  let surface = 10;
  for (let x = 0; x < width; x++) {
    surface = Math.max(4, Math.min(height - 6, surface + next(7) - 3));
    for (let y = surface; y < height; y++) active[x * height + y] = 1;
  }
  // overhangs, pillars and caves
  for (let n = 0; n < 12; n++) {
    const x0 = next(width - 4);
    const y0 = 2 + next(height - 6);
    const w = 1 + next(4);
    const h = 1 + next(3);
    const fill = next(2);
    for (let x = x0; x < x0 + w; x++)
      for (let y = y0; y < y0 + h; y++) active[x * height + y] = fill;
  }
  scenes.push({ name: `synthetic ${k}`, width, height, state: 1 + next(0x7fffffff), active });
}
writeFileSync(new URL('smooth-scenes.json', import.meta.url), JSON.stringify(scenes));
console.log(`${scenes.length} scenes`);
