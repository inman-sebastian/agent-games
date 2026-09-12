// quartz.ts — Quartz (ore id 12). Milky-white crystal on the shared stone surface + a baked sparkle
// and a modest crystalline twinkle. Common and pretty — brighter than the metals, calmer than gems.
import { hexRgb, colorsFor, facetSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

// milky ICY cyan-white — a cold crystalline tint (plus its sparkle, vs the metals' sheen) sets it
// apart from the greys; far paler than diamond's saturated teal.
const COLORS = colorsFor(['#2c3138', '#45505a', '#657782', '#93aab4', '#c6dde2', '#ffffff']);
const GLINT: Rgb = hexRgb('#eaffff');

registerOreMaterial(12, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    // faceted crystal — cut planes instead of craggy rock
    return (
      sparkle(ctx, { color: GLINT, chance: 0.2, minLit: 0.58 }) ??
      facetSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 5)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // modest, cool crystalline flashes — present but calmer than the precious gems
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.6, density: 0.45, gap: 0.45 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset) * 0.95, GLINT, ctx.scale);
  },
});
