// render.test.ts — the renderer port against Terraria's own LiquidRenderer (#90). At every
// oracle snapshot, the port's draw cache must hand the draw the same tiles, source rectangles, offsets, trail
// opacity and surface frames as LiquidRenderer.InternalPrepareDraw did on Terraria's own liquid.
import { describe, it, expect } from 'vitest';
import { loadOracle, replay } from './oracle';
import type { TerrariaLiquid } from '@delve/shared';
import { prepareLiquidDraw, type LiquidDraw } from '../../client/src/fluid/terraria-liquid-render';

const { scenes, results } = loadOracle();

describe("the renderer port matches Terraria's LiquidRenderer", () => {
  for (const scene of scenes) {
    it(scene.name, () => {
      const expected = results.find((result) => result.name === scene.name)!.snapshots;
      let snapshot = 0;
      let draw: LiquidDraw | undefined;
      // the oracle's grid sits 10 tiles into its world
      const frame = (liquid: TerrariaLiquid): void => void (draw = prepareLiquidDraw(liquid, 10));
      replay(
        scene,
        (update, liquid) => {
          const oracle = expected[snapshot++];
          if (!draw) throw new Error('no frame drawn');
          for (let index = 0; index < oracle.draw.length; index++) {
            const want = oracle.draw[index];
            const got =
              draw.visible[index] === 0
                ? 0
                : [
                    draw.sourceX[index],
                    draw.sourceY[index],
                    draw.sourceWidth[index],
                    draw.sourceHeight[index],
                    draw.offsetX[index],
                    draw.offsetY[index],
                    Math.round(draw.opacity[index] * 1e4) / 1e4,
                    draw.surface[index],
                  ];
            const where = `${index % liquid.width},${Math.floor(index / liquid.width)} at update ${update}`;
            expect(got, where).toEqual(want);
          }
        },
        frame,
      );
    });
  }
});
