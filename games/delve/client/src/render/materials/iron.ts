// iron.ts — Iron (ore id 3). The shared stone surface in a cool grey-steel palette + a rarer, cooler
// sheen than gold, so it reads as the same rock made of a duller metal.
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, metalSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

// dull, dark gunmetal — the cheap base metal: low, muted values and a duller (non-white) sheen,
// so it reads distinctly darker/flatter than bright silver, warm platinum, or icy quartz.
const COLORS = colorsFor(['#1e2024', '#33373d', '#4b525a', '#686f78', '#878e98', '#a8b0ba']);
const SHEEN: Rgb = hexRgb('#c6ccd4');

registerOreMaterial(3, {
  feather: 2.6,
  shade(ctx: ShadeCtx): Rgb {
    if (ctx.brightness > 0.78 && vnoise(ctx.worldX * 0.55, ctx.worldY * 0.55, TEX + 33) > 0.9)
      return SHEEN;
    // rough, matte gunmetal — high blotch (uneven/pitted), coarse brushed grain
    return metalSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 0.44, 0.16);
  },
});
