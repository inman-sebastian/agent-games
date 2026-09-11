// copper.ts — Copper (ore id 2). The shared stone surface in a warm ruddy palette + a soft, common
// sheen (no twinkle — it's the cheap starter metal, not a treasure). "The same rock, made of copper."
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

const COLORS = colorsFor(['#2a1712', '#4d2a1c', '#8a4326', '#c06a34', '#e59452', '#f6c288']);
const SHEEN: Rgb = hexRgb('#ffe6c0');

registerOreMaterial(2, {
  feather: 3.0,
  shade(ctx: ShadeCtx): Rgb {
    // a broad, low-frequency warm sheen on the best-lit faces — duller + more common than gold's
    if (ctx.brightness > 0.74 && vnoise(ctx.worldX * 0.5, ctx.worldY * 0.5, TEX + 21) > 0.86)
      return SHEEN;
    return stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS);
  },
});
