// collision.test.ts — player collision against Terraria's own code (#93). Every body in collision-scenes.json was run
// through Terraria 1.4.0.5's WalkDownSlope, SlopeCollision, TileCollision, StepDown and StepUp; the port must return
// the same from each. Within a thousandth of a pixel: C# computes in single precision, and the head-bump nudge
// (0.01 px) isn't a sixteenth.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  OPEN,
  slopeCollision,
  stepDown,
  stepUp,
  tileCollision,
  walkDownSlope,
  type ShapeLookup,
} from '@delve/shared';

interface Case {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  gravity: number;
}
interface Result {
  walk: number[];
  slope: number[];
  tile: number[];
  stepDown: number[];
  stepUp: number[];
}

const here = new URL('.', import.meta.url);
const scenes = JSON.parse(readFileSync(new URL('collision-scenes.json', here), 'utf8')) as {
  name: string;
  width: number;
  height: number;
  shapes: number[];
  cases: Case[];
}[];
const results = JSON.parse(
  gunzipSync(readFileSync(new URL('collision-oracle.json.gz', here))).toString('utf8'),
) as Result[][];

const TOLERANCE = 1e-3;
const close = (got: number[], want: number[]): boolean =>
  got.length === want.length && got.every((value, i) => Math.abs(value - want[i]) <= TOLERANCE);

describe("player collision matches Terraria's Collision.cs", () => {
  // How many bodies each routine actually changed, so a scene set that never reaches a branch shows up.
  const changed = { walk: 0, slope: 0, tile: 0, stepDown: 0, stepUp: 0 };

  scenes.forEach((scene, n) => {
    it(scene.name, () => {
      const shapeAt: ShapeLookup = (column, row) =>
        column >= 0 && column < scene.width && row >= 0 && row < scene.height
          ? scene.shapes[column * scene.height + row]
          : OPEN;
      scene.cases.forEach((body, k) => {
        const want = results[n][k];
        const label = `body ${k}: ${JSON.stringify(body)}`;
        const { w, h } = body;

        const walkVy = walkDownSlope(shapeAt, body, w, h, body.gravity);
        const walk = [body.x, body.y, body.vx, walkVy];
        expect(close(walk, want.walk), `walkDownSlope ${label} got ${walk} want ${want.walk}`).toBe(true);
        if (walkVy !== body.vy) changed.walk++;

        const sloped = slopeCollision(shapeAt, body, w, h);
        const slope = [sloped.x, sloped.y, sloped.vx, sloped.vy];
        expect(close(slope, want.slope), `slopeCollision ${label} got ${slope} want ${want.slope}`).toBe(true);
        if (sloped.y !== body.y || sloped.x !== body.x) changed.slope++;

        const hit = tileCollision(shapeAt, body, w, h);
        const tile = [hit.vx, hit.vy, hit.up ? 1 : 0, hit.down ? 1 : 0];
        expect(close(tile, want.tile), `tileCollision ${label} got ${tile} want ${want.tile}`).toBe(true);
        if (hit.vx !== body.vx || hit.vy !== body.vy) changed.tile++;

        const down = stepDown(shapeAt, body, w, h);
        const stepped = [down.y, body.vy, down.speed, down.offset];
        expect(close(stepped, want.stepDown), `stepDown ${label} got ${stepped} want ${want.stepDown}`).toBe(true);
        if (down.y !== body.y) changed.stepDown++;

        const up = stepUp(shapeAt, body, w, h);
        const climbed = [up.y, body.vy, up.speed, up.offset];
        expect(close(climbed, want.stepUp), `stepUp ${label} got ${climbed} want ${want.stepUp}`).toBe(true);
        if (up.y !== body.y) changed.stepUp++;
      });
    });
  });

  it('the scenes reach every routine', () => {
    for (const [routine, count] of Object.entries(changed)) {
      expect(count, `${routine} changed ${count} bodies`).toBeGreaterThan(50);
    }
  });
});
