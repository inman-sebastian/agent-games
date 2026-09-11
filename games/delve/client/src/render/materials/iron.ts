// iron.ts — Iron (ore id 3). The shared stone surface in a cool grey-steel palette + a rarer, cooler
// sheen than gold, so it reads as the same rock made of a duller metal.
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

const COLORS = colorsFor(['#242430', '#3c3c48', '#585866', '#7c7c88', '#a6a6b2', '#d0d0da']);
const SHEEN: Rgb = hexRgb('#eef1f7');

registerOreMaterial(3, {
  feather: 2.6,
  shade(ctx: ShadeCtx): Rgb {
    if (ctx.brightness > 0.78 && vnoise(ctx.worldX * 0.55, ctx.worldY * 0.55, TEX + 33) > 0.9)
      return SHEEN;
    return stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS);
  },
});
