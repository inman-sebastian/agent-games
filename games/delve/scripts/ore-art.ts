// ore-art.ts — draws an ore BLOCK (the full-cell crystalline mass in the world). The per-ore art
// (crystal shape + colour triad) and the shared shapes live in the resource registry; this module
// is the block renderer plus a thin ORE_ART/shapes facade over the registry.
import { T, TEX } from './cave-render';
import { vnoise, mulberry, hashXY } from './rng';
import { OUT, shapes, all } from './resources';
import type { OreArt } from './types';

// ore art keyed by ore id, sourced from the ore resources.
export const ORE_ART: Record<number, OreArt> = {};
for (const ore of all('ore')) ORE_ART[ore.id] = ore.art;

export { shapes as SHAPES, OUT };

// world-anchored faceted fill: two value-noise octaves pick dark/mid/highlight per pixel so the
// crystal texture flows continuously across cells (hand-tuned frequencies/thresholds).
const FACET_FREQ = 0.5;
const FACET_DARK_BELOW = 0.42;
const FACET_HIGH_ABOVE = 0.66;
const SPARKLE_FREQ = 1.3;
const SPARKLE_HIGH_ABOVE = 0.85;
const SPARKLE_DARK_BELOW = 0.13;
const RIM_NOISE_FREQ = 0.6;
const RIM_NOISE_THRESHOLD = 0.35;
const CRACK_START = 0.15; // damage fraction at which cracks begin to show
const TWO_PI = Math.PI * 2;

type SameOre = (dColumn: number, dRow: number) => boolean;

/**
 * Draw an ore BLOCK into 2D context `g`: the tile is (column,row) with top-left pixel (x,y),
 * damage `frac` in 0..1. `sameOre(dc,dr)` returns whether the neighbour is part of the SAME ore
 * node, so a pocket tiles into one crystalline mass and only cluster-boundary edges get the
 * outline + top rim. There is no reveal — the block simply *is* ore; damage shows as cracks.
 */
export function drawOreBlock(
  g: CanvasRenderingContext2D,
  art: OreArt,
  x: number,
  y: number,
  column: number,
  row: number,
  frac: number,
  sameOre: SameOre,
): void {
  if (!art) return;
  const [dark, mid, highlight] = art.c;
  const worldX0 = column * T;
  const worldY0 = row * T;
  const pixel = (a: number, b: number, w: number, h: number, color: string): void => {
    g.fillStyle = color;
    g.fillRect(x + a, y + b, w || 1, h || 1);
  };

  // crystalline body: base fill + world-anchored facet pixels (only non-base drawn)
  pixel(0, 0, T, T, mid);
  for (let dy = 0; dy < T; dy++) {
    for (let dx = 0; dx < T; dx++) {
      const worldX = worldX0 + dx;
      const worldY = worldY0 + dy;
      const facet = vnoise(worldX * FACET_FREQ, worldY * FACET_FREQ, TEX + 11);
      const sparkle = vnoise(worldX * SPARKLE_FREQ + 7, worldY * SPARKLE_FREQ, TEX + 12);
      let color = facet < FACET_DARK_BELOW ? dark : facet > FACET_HIGH_ABOVE ? highlight : mid;
      if (sparkle > SPARKLE_HIGH_ABOVE) color = highlight;
      else if (sparkle < SPARKLE_DARK_BELOW && facet < 0.6) color = dark;
      if (color !== mid) pixel(dx, dy, 1, 1, color);
    }
  }

  // cracks as damage rises (the block is ore — no crystal reveal)
  if (frac > CRACK_START) {
    const rand = mulberry(hashXY(column, row, 91));
    const crackCount = 1 + Math.floor(frac * 3);
    for (let k = 0; k < crackCount; k++) {
      const angle = rand() * TWO_PI;
      let cx = T / 2 + Math.cos(angle) * 2;
      let cy = T / 2 + Math.sin(angle) * 2;
      const steps = 2 + Math.floor(frac * 4);
      for (let s = 0; s < steps; s++) {
        if (cx < 1 || cx > T - 1 || cy < 1 || cy > T - 1) break;
        pixel(cx | 0, cy | 0, 1, 1, OUT);
        cx += Math.cos(angle);
        cy += Math.sin(angle);
      }
    }
  }

  // cluster-boundary edges only: top rim highlight (inside), then dark outline (edge)
  const openUp = !sameOre(0, -1);
  const openDown = !sameOre(0, 1);
  const openLeft = !sameOre(-1, 0);
  const openRight = !sameOre(1, 0);
  if (openUp) {
    for (let dx = 0; dx < T; dx++) {
      if (vnoise((worldX0 + dx) * RIM_NOISE_FREQ, worldY0 * RIM_NOISE_FREQ, TEX + 13) > RIM_NOISE_THRESHOLD) pixel(dx, 1, 1, 1, highlight);
    }
    pixel(0, 0, T, 1, OUT);
  }
  if (openDown) pixel(0, T - 1, T, 1, OUT);
  if (openLeft) pixel(0, 0, 1, T, OUT);
  if (openRight) pixel(T - 1, 0, 1, T, OUT);
}
