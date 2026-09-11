// ruby.ts — Ruby (ore id 7). The shared stone surface in a crimson palette + a baked sparkle and a
// warm, lively twinkle — a cluster of red fire from the deep stone.
import { hexRgb, colorsFor, facetSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#2a0f1e', '#5a1636', '#8f1c46', '#d23459', '#f0577a', '#ffb0bf']);
const GLINT: Rgb = hexRgb('#fff0f3');

registerOreMaterial(7, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.2, minLit: 0.6 }) ??
      facetSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 5)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // warm crimson flashes travelling the lit edge — lively, a touch slower than emerald
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.4, density: 0.55, gap: 0.45 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset), GLINT, ctx.scale);
  },
});
