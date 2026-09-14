// collision-scenes.ts — writes collision-scenes.json, the bodies the collision oracle runs (#93): bodies at real
// DELVE surfaces (smoothed, so full of slopes) and anywhere in random grids of slopes, with Terraria's body and
// DELVE's. Every number is a whole sixteenth of a pixel, so single-precision C# and the port compute the same.
// Run: `npx tsx tools/terraria-oracle/collision-scenes.ts`, then the harness's `collision` mode.
import { writeFileSync } from 'node:fs';
import { shapeAt, surfaceAt, OPEN } from '@delve/shared';

interface Case {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  gravity: number;
}
interface Scene {
  name: string;
  width: number;
  height: number;
  shapes: number[];
  cases: Case[];
}

const WIDTH = 24;
const HEIGHT = 16;
const CASES = 250;
const BODIES = [
  { w: 20, h: 42 }, // Terraria's player
  { w: 29, h: 58 }, // DELVE's miner
];
const GRAVITY = 0.375;

let random = 0x9e3779b9;
const next = (maximum: number): number => {
  random ^= random << 13;
  random >>>= 0;
  random ^= random >>> 17;
  random ^= random << 5;
  random >>>= 0;
  return random % maximum;
};
const sixteenths = (from: number, to: number): number => from + next((to - from) * 16 + 1) / 16;

const pick = (values: number[]): number => values[next(values.length)];

/**
 * A body somewhere in the grid; near a floor when `onGround`, moving any way, often resting (vy = gravity). Half
 * are snapped onto the comparisons' boundaries — an edge or the centre on a tile edge, the feet a step's
 * threshold from a tile top — which random sixteenths almost never land on.
 */
function bodyIn(shapes: number[], onGround: boolean): Case {
  const { w, h } = BODIES[next(BODIES.length)];
  const snapped = next(2) === 0;
  const edgeColumn = 4 + next(WIDTH - 8);
  const x = snapped
    ? edgeColumn * 16 - pick([0, w, Math.trunc(w / 2)]) + pick([-1, 0, 0, 1])
    : sixteenths(3 * 16, (WIDTH - 3) * 16 - w);
  let y = sixteenths(3 * 16, (HEIGHT - 3) * 16 - h);
  if (onGround) {
    const column = Math.floor((x + w / 2) / 16);
    let row = 2;
    while (row < HEIGHT - 1 && shapes[column * HEIGHT + row] === OPEN) row++;
    const offset = snapped ? pick([-17, -16, -9, -8, -7, -1, 0, 1, 4]) : sixteenths(-20, 12);
    y = row * 16 - h + offset;
  }
  const vx = snapped ? pick([0, -1, 1, -2, 2, -16, 16]) : sixteenths(-8, 8);
  const vy = next(2) === 0 ? GRAVITY : sixteenths(-10, 10);
  return { x, y, vx, vy, w, h, gravity: GRAVITY };
}

const scenes: Scene[] = [];
for (const seed of [1, 12345, 777, 20260914]) {
  for (const column of [40, 333, 1210, 4831]) {
    const firstColumn = column - WIDTH / 2;
    const firstRow = surfaceAt(seed, column) - HEIGHT / 2;
    const shapes: number[] = [];
    for (let x = 0; x < WIDTH; x++)
      for (let y = 0; y < HEIGHT; y++) shapes.push(shapeAt(seed, firstColumn + x, firstRow + y));
    const cases = Array.from({ length: CASES }, () => bodyIn(shapes, true));
    scenes.push({ name: `seed ${seed} column ${column}`, width: WIDTH, height: HEIGHT, shapes, cases });
  }
}
for (let k = 0; k < 8; k++) {
  const shapes = Array.from({ length: WIDTH * HEIGHT }, () => {
    const roll = next(10);
    return roll < 5 ? OPEN : roll < 7 ? 0 : 1 + next(4);
  });
  const cases = Array.from({ length: CASES }, () => bodyIn(shapes, next(2) === 0));
  scenes.push({ name: `random slopes ${k}`, width: WIDTH, height: HEIGHT, shapes, cases });
}
writeFileSync(new URL('collision-scenes.json', import.meta.url), JSON.stringify(scenes));
console.log(`${scenes.length} scenes, ${scenes.length * CASES} bodies`);
