// diamond.ts — Diamond (ore id 8). The shared stone surface in a bright cyan palette + the densest
// sparkle and the fastest, most frequent twinkle — flawless and brilliant, the top of the value gradient.
import { hexRgb, colorsFor, facetSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#0a2f33', '#124a52', '#1c7d80', '#2fb6ad', '#79ead9', '#d6fff4']);
const GLINT: Rgb = hexRgb('#f0ffff');

registerOreMaterial(8, {
  feather: 2.0, // crisp, faceted — blends into rock less than the softer gems
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.3, minLit: 0.5 }) ??
      facetSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 6)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // brilliant, fast, frequent flashes — the brightest twinkle of any material
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 0.9, density: 0.7, gap: 0.4 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset), GLINT, ctx.scale);
  },
});
