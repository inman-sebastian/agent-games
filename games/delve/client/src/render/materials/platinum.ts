// platinum.ts — Platinum (ore id 10). A brighter, cooler-white metal than silver, with a tight
// premium sheen and a refined cool glint — the same rock made of a rarer metal.
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, metalSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { drawGlint, twinkleFlash } from './fx';

// pale WARM champagne/greige — a premium warm-white that reads clearly apart from silver's cool blue
// (and far from gold's saturated yellow: this is a desaturated warm grey, not a colour).
const COLORS = colorsFor(['#2a2620', '#45403a', '#6b645a', '#98907e', '#c6bda8', '#f2ecdc']);
const SHEEN: Rgb = hexRgb('#fff4e0');
const GLINT: Rgb = hexRgb('#ffe9c8');

registerOreMaterial(10, {
  feather: 2.8,
  shade(ctx: ShadeCtx): Rgb {
    // a bright, tight sheen on the best-lit faces — brighter + rarer than iron/silver
    if (ctx.brightness > 0.76 && vnoise(ctx.worldX * 0.6, ctx.worldY * 0.6, TEX + 41) > 0.9)
      return SHEEN;
    // soft satin sheen — mid blotch, minimal streak (a calmer, premium finish vs silver's mirror)
    return metalSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 0.34, 0.09);
  },
  twinkle(ctx: TwinkleCtx): void {
    // refined, sparse cool glint hopping the lit edge — a touch livelier than silver's
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.8, density: 0.4, gap: 0.5 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset) * 0.9, GLINT, ctx.scale);
  },
});
