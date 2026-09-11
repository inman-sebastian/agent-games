// gold.ts — Gold (ore id 5). Shared stone surface in a warm gold palette + a baked sparkle, and an
// animated per-frame twinkle on its lit faces. "The same rock, made of gold," with life.
import { hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#3a2b12', '#6b4c18', '#a5771f', '#dda52a', '#f4cb52', '#fdeda8']);
const GLINT: Rgb = hexRgb('#fff8e4');

registerOreMaterial(5, {
  feather: 3.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.14, minLit: 0.66 }) ??
      stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // sparse, irregular warm flashes hopping along a lit gold edge (slower + rarer than the gem)
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.9, density: 0.4, gap: 0.5 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset) * 0.9, GLINT, ctx.scale);
  },
});
