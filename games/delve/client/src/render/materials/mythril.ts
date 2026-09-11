// mythril.ts — Mythril (ore id 9). The shared stone surface in a legendary violet palette + a sparkle
// and a magical, lively twinkle — the abyss's rarest ore.
import { hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#1c1630', '#33265a', '#553a86', '#7d54b3', '#a884f3', '#e0c9ff']);
const GLINT: Rgb = hexRgb('#f6ecff');

registerOreMaterial(9, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.26, minLit: 0.55 }) ??
      stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // lively violet flashes travelling the lit edge — magical, second only to diamond
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.1, density: 0.65, gap: 0.42 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset), GLINT, ctx.scale);
  },
});
