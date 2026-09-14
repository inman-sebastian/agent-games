// obsidian.ts — Obsidian (ore id 11). Volcanic glass: near-black, glossy, with sharp cool specular
// glints only on the brightest faces (its glassy signature) + a rare cool twinkle. A deliberately
// DARK material — it stays black when lit, so it reads as glass, not just unlit rock.
import { hexRgb, colorsFor, glassSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';
import wgsl from './obsidian.wgsl?raw';

const PALETTE = ['#08080c', '#111019', '#1c1a2a', '#2b2840', '#403c5e', '#726d9e'];
const COLORS = colorsFor(PALETTE);
// Every colour this material uses, registered once: the WGSL twin gets them generated (#73).
const ACCENTS = { glint: '#d6cfff' } as const;
const GLINT: Rgb = hexRgb(ACCENTS.glint);

registerOreMaterial(11, {
  name: 'obsidian',
  palette: PALETTE,
  accents: ACCENTS,
  wgsl,
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
