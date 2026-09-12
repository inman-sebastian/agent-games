// silver.ts — Silver (ore id 4). A brighter, cooler steel than iron, plus a rare cool glint on its
// lit edges — soft and precious, but far sparser than the deep gems.
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, metalSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { drawGlint, twinkleFlash } from './fx';

// bright, clean, faintly-blue cool white — the crisp "shiny silver" reference the others diverge from.
const COLORS = colorsFor(['#282a34', '#414653', '#666d7c', '#98a0b0', '#c9cfdc', '#f4f8ff']);
const SHEEN: Rgb = hexRgb('#f8fbff');
const GLINT: Rgb = hexRgb('#ffffff');

registerOreMaterial(4, {
  feather: 2.8,
  shade(ctx: ShadeCtx): Rgb {
    // a brighter, tighter sheen than iron (silver catches light harder)
    if (ctx.brightness > 0.72 && vnoise(ctx.worldX * 0.6, ctx.worldY * 0.6, TEX + 27) > 0.88)
      return SHEEN;
    // near-mirror polish — low blotch (even), fine brushed grain
    return metalSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 0.26, 0.13);
  },
  twinkle(ctx: TwinkleCtx): void {
    // a rare, cool glint hopping along the lit edge — silver "glints", but it's no treasure gem
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 2.4, density: 0.25, gap: 0.5 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset) * 0.8, GLINT, ctx.scale);
  },
});
