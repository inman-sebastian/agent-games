// behind.test.ts — liquid behind a tile against Terraria's own code (#95). Every neighbourhood in behind-scenes.json
// was run through Terraria 1.4.0.5's TileDrawing.DrawTile_LiquidBehindTile; the port must draw the same rectangle
// behind the middle tile, or none, and hide it where Terraria draws it at no brightness.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { liquidBehindTile } from '../../client/src/fluid/terraria-liquid-render';

const here = new URL('.', import.meta.url);
const scenes = JSON.parse(readFileSync(new URL('behind-scenes.json', here), 'utf8')) as {
  shapes: number[];
  liquid: number[];
}[];
const results = JSON.parse(
  gunzipSync(readFileSync(new URL('behind-oracle.json.gz', here))).toString('utf8'),
) as (0 | number[])[];

describe("liquid behind a tile matches Terraria's DrawTile_LiquidBehindTile", () => {
  it('every neighbourhood', () => {
    scenes.forEach(({ shapes, liquid }, n) => {
      const at = (i: number): { shape: number; liquid: number } => ({
        shape: shapes[i],
        liquid: liquid[i],
      });
      const rect = liquidBehindTile({
        shape: shapes[4],
        liquid: liquid[4],
        left: at(3),
        right: at(5),
        above: at(1),
        below: at(7),
      });
      const want = results[n];
      const got = rect
        ? [rect.x, rect.y, rect.sourceX, rect.sourceY, rect.width, rect.height, rect.hidden]
        : 0;
      const expected = want === 0 ? 0 : [...want.slice(0, 6), want[6] === 0];
      expect(got, `neighbourhood ${n}: ${JSON.stringify({ shapes, liquid })}`).toEqual(expected);
    });
  });
});
