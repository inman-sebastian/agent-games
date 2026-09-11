// stonebricks.ts — Stone Bricks (ore id 13). EXPERIMENT: a STRUCTURED material, unlike the organic
// ores. It still builds on the shared `stoneSurface` (bricks are stone), but overlays a regular
// running-bond brick pattern — recessed mortar lines + a per-brick bevel + slight per-brick tint —
// keyed on WORLD coords so courses line up seamlessly across tiles. Shows the material contract can
// express constructed/non-natural looks, not just noise fields. No sparkle/twinkle (it's plain stone).
import { hashXY } from '@delve/shared';
import { hexRgb, colorsFor, stoneSurface, clamp01 } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

const COLORS = colorsFor(['#2a2530', '#3e3546', '#554b5e', '#6f708a', '#9babb2', '#c7dcd0']);
const MORTAR: Rgb = hexRgb('#191620');
const BRICK_W = 16; // one tile wide
const BRICK_H = 8; // half a tile tall → two courses per tile
const MORTAR_PX = 1; // mortar line thickness

registerOreMaterial(13, {
  feather: 2.4,
  shade(ctx: ShadeCtx): Rgb {
    const wx = Math.floor(ctx.worldX);
    const wy = Math.floor(ctx.worldY);
    const course = Math.floor(wy / BRICK_H);
    const offset = (course & 1) === 1 ? BRICK_W / 2 : 0; // running bond: alternate courses shift
    const yInCourse = ((wy % BRICK_H) + BRICK_H) % BRICK_H;
    const bx = wx + offset;
    const xInBrick = ((bx % BRICK_W) + BRICK_W) % BRICK_W;

    // mortar recesses (top of each course + left of each brick), darkened, lit by the geometric light
    if (yInCourse < MORTAR_PX || xInBrick < MORTAR_PX) {
      const m = 0.4 + 0.4 * clamp01(ctx.brightness);
      return [MORTAR[0] * m, MORTAR[1] * m, MORTAR[2] * m];
    }

    // brick face: shared stone texture + a small per-brick tint jitter + a top-lit / bottom-shadowed
    // bevel so each brick reads as a raised block.
    const brickId = hashXY(Math.floor(bx / BRICK_W), course, 61);
    const jitter = ((brickId & 31) / 31 - 0.5) * 0.14;
    const bevel = yInCourse <= 1 ? 0.16 : yInCourse >= BRICK_H - 1 ? -0.12 : 0;
    return stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness + jitter + bevel, COLORS);
  },
});
