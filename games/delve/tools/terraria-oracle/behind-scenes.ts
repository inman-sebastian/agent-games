// behind-scenes.ts — writes behind-scenes.json, the neighbourhoods the liquid-behind-tile oracle runs (#95): a solid
// middle tile, full or sloped, among open, full and sloped neighbours holding no, some or full liquid.
// Run: `npx tsx tools/terraria-oracle/behind-scenes.ts`, then the harness's `behind` mode.
import { writeFileSync } from 'node:fs';

const COUNT = 6000;
let random = 0x1b873593;
const next = (maximum: number): number => {
  random ^= random << 13;
  random >>>= 0;
  random ^= random >>> 17;
  random ^= random << 5;
  random >>>= 0;
  return random % maximum;
};
const pick = (values: number[]): number => values[next(values.length)];

const scenes = Array.from({ length: COUNT }, () => {
  const shapes = Array.from({ length: 9 }, () => pick([-1, -1, -1, 0, 0, 1, 2, 3, 4]));
  shapes[4] = pick([0, 1, 2, 3, 4]);
  // levels around Terraria's thresholds (160, 240) and the 32-unit steps of the level line
  const liquid = Array.from({ length: 9 }, () =>
    pick([0, 0, 0, 255, 255, 1 + next(254), 160, 161, 240, 241, 32, 33, 128]),
  );
  return { shapes, liquid };
});
writeFileSync(new URL('behind-scenes.json', import.meta.url), JSON.stringify(scenes));
console.log(`${scenes.length} neighbourhoods`);
