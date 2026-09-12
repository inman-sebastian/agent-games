// emerald.ts — Emerald (ore id 6). Shared stone surface in a green palette + a baked sparkle, and a
// livelier animated twinkle than the metals (faster, brighter, cooler) so the gem feels crystalline.
import { hexRgb, colorsFor, facetSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#0b241a', '#124430', '#1b6543', '#2c9660', '#57c584', '#a9eec6']);
const GLINT: Rgb = hexRgb('#eafff4');

registerOreMaterial(6, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.24, minLit: 0.56 }) ??
      facetSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 5)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // livelier crystalline flashes than the metals — more frequent, still irregular — travelling
    // along the lit edge of the whole emerald cluster
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.2, density: 0.6, gap: 0.45 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset), GLINT, ctx.scale);
  },
});
