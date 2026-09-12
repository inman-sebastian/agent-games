// obsidian.ts — Obsidian (ore id 11). Volcanic glass: near-black, glossy, with sharp cool specular
// glints only on the brightest faces (its glassy signature) + a rare cool twinkle. A deliberately
// DARK material — it stays black when lit, so it reads as glass, not just unlit rock.
import { hexRgb, colorsFor, glassSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#08080c', '#111019', '#1c1a2a', '#2b2840', '#403c5e', '#726d9e']);
const GLINT: Rgb = hexRgb('#d6cfff');

registerOreMaterial(11, {
  feather: 2.4,
  shade(ctx: ShadeCtx): Rgb {
    // glassy specular: sharp cool glints on only the brightest faces; else near-black glass
    return (
      sparkle(ctx, { color: GLINT, chance: 0.14, minLit: 0.72 }) ??
      glassSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    // a rare, cold glass glint hopping the lit edge
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 2.0, density: 0.35, gap: 0.5 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset) * 0.85, GLINT, ctx.scale);
  },
});
