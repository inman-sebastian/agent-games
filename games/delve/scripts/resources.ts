// resources.ts — the entity RESOURCE REGISTRY plus the shared procedural art shapes. Each
// entity (every stratum, every ore, more types later) self-registers from its own file under
// resources/*.ts; importing resources/index.ts pulls them all in. This module just collects
// them and exposes typed lookups, so the world, the sim, and the renderers read one source.

import type { ResourceDef, ResourceType, OreResource, StrataResource } from './types';
import { mulberry } from './rng';

const byType: Record<string, ResourceDef[]> = {};
const byKey: Record<string, ResourceDef> = {};

export function register(def: ResourceDef): ResourceDef {
  (byType[def.type] ??= []).push(def);
  byKey[`${def.type}:${def.id}`] = def;
  return def;
}

// All registered defs of a type, in a stable gameplay order (ore by id, strata by depth).
export function all(type: 'ore'): OreResource[];
export function all(type: 'strata'): StrataResource[];
export function all(type: ResourceType): ResourceDef[] {
  const list = (byType[type] ?? []).slice();
  if (type === 'ore') list.sort((a, b) => (a as OreResource).id - (b as OreResource).id);
  else if (type === 'strata') list.sort((a, b) => (a as StrataResource).top - (b as StrataResource).top);
  return list;
}

export function byId(type: 'ore', id: number): OreResource | undefined;
export function byId(type: 'strata', id: string): StrataResource | undefined;
export function byId(type: ResourceType, id: number | string): ResourceDef | undefined {
  return byKey[`${type}:${id}`];
}

// ---- shared procedural art shapes (crystals) -------------------------------------------
// An ore's `art` names one of these shapes; the renderer applies it with a `pen` that fills a
// single rect in absolute canvas coords, so a shape composes over any target. Kept procedural
// (metals get a per-ore seeded wobble; gems are faceted) — the resource just parameterises.

/** Fills one rectangle in absolute canvas pixels. */
export type Pen = (x: number, y: number, width: number, height: number, color: string) => void;

/** `[dark, mid, highlight]` triad. */
type Triad = readonly [string, string, string];

export const OUT = '#0a0912'; // shared dark crystal outline
const WHITE = '#ffffff';
const TAU = Math.PI * 2;

function gem(pen: Pen, cx: number, cy: number, radius: number, [dark, mid, highlight]: Triad): void {
  if (radius < 1) radius = 1;
  for (let dy = -radius; dy <= radius; dy++) {
    const halfWidth = radius - Math.abs(dy);
    pen(cx - halfWidth - 1, cy + dy, 1, 1, OUT);
    pen(cx + halfWidth + 1, cy + dy, 1, 1, OUT);
  }
  pen(cx, cy - radius - 1, 1, 1, OUT);
  pen(cx, cy + radius + 1, 1, 1, OUT);
  for (let dy = -radius; dy <= radius; dy++) {
    const halfWidth = radius - Math.abs(dy);
    pen(cx - halfWidth, cy + dy, 2 * halfWidth + 1, 1, mid);
  }
  for (let dy = -radius; dy <= 0; dy++) {
    const halfWidth = radius - Math.abs(dy);
    pen(cx - halfWidth, cy + dy, halfWidth + 1, 1, highlight); // upper-left facet
  }
  for (let dy = 0; dy <= radius; dy++) {
    const halfWidth = radius - Math.abs(dy);
    pen(cx, cy + dy, halfWidth + 1, 1, dark); // lower-right facet
  }
  pen(cx - 1, cy - radius + 1, 1, 1, WHITE); // glint
}

function nugget(pen: Pen, cx: number, cy: number, radius: number, [dark, mid, highlight]: Triad): void {
  if (radius < 1) radius = 1;
  // Seed a per-ore wobble from the mid colour so each metal is a distinct lumpy shape.
  let seed = 0;
  for (const ch of mid) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = mulberry(seed || 1);
  const phase1 = rand() * TAU;
  const phase2 = rand() * TAU;
  const phase3 = rand() * TAU;
  const radiusAt = (dx: number, dy: number): number => {
    const angle = Math.atan2(dy, dx);
    const upBias = Math.max(0, -Math.sin(angle));
    return (
      radius *
      (1 + 0.05 * upBias + 0.08 * Math.sin(2 * angle + phase1) + 0.11 * Math.sin(3 * angle + phase2) + 0.07 * Math.sin(5 * angle + phase3))
    );
  };
  for (let dy = -radius - 2; dy <= radius + 2; dy++) {
    for (let dx = -radius - 2; dx <= radius + 2; dx++) {
      if (Math.hypot(dx, dy) <= radiusAt(dx, dy) + 1) pen(cx + dx, cy + dy, 1, 1, OUT);
    }
  }
  for (let dy = -radius - 2; dy <= radius + 2; dy++) {
    for (let dx = -radius - 2; dx <= radius + 2; dx++) {
      if (Math.hypot(dx, dy) > radiusAt(dx, dy)) continue;
      const diagonal = dx + dy;
      const shade = diagonal < -radius * 0.3 ? highlight : diagonal > radius * 0.6 ? dark : mid;
      pen(cx + dx, cy + dy, 1, 1, shade);
    }
  }
  const glintX = cx - Math.round(radius * 0.35);
  const glintY = cy - Math.round(radius * 0.45);
  pen(glintX, glintY, 1, 1, highlight);
  pen(glintX + 1, glintY, 1, 1, highlight);
  pen(glintX, glintY + 1, 1, 1, highlight);
  pen(glintX, glintY, 1, 1, WHITE);
  pen(glintX + 1, glintY, 1, 1, WHITE);
}

function prism(pen: Pen, cx: number, cy: number, radius: number, [dark, mid, highlight]: Triad): void {
  const halfWidthAt = (dy: number): number =>
    dy < -radius + 2 || dy > radius - 2 ? Math.max(0, radius - 2) : radius;
  for (let dy = -radius - 1; dy <= radius + 1; dy++) {
    const halfWidth = halfWidthAt(Math.max(-radius, Math.min(radius, dy)));
    pen(cx - halfWidth - 1, cy + dy, 1, 1, OUT);
    pen(cx + halfWidth + 1, cy + dy, 1, 1, OUT);
  }
  pen(cx, cy - radius - 1, 1, 1, OUT);
  pen(cx, cy + radius + 1, 1, 1, OUT);
  for (let dy = -radius; dy <= radius; dy++) {
    const halfWidth = halfWidthAt(dy);
    pen(cx - halfWidth, cy + dy, 2 * halfWidth + 1, 1, mid);
  }
  for (let dy = -radius; dy <= radius; dy++) {
    const halfWidth = halfWidthAt(dy);
    pen(cx - halfWidth, cy + dy, halfWidth, 1, highlight);
    pen(cx + 1, cy + dy, halfWidth, 1, dark);
  }
  pen(cx - 1, cy - radius + 1, 1, 1, WHITE);
}

function shardSpike(pen: Pen, x: number, y: number, halfHeight: number, halfWidth: number, [dark, mid]: Triad): void {
  for (let dy = -halfHeight; dy <= halfHeight; dy++) {
    const taper = 1 - Math.abs(dy) / (halfHeight + 0.6);
    const width = Math.max(0, Math.round(halfWidth * taper));
    pen(x - width - 1, y + dy, 1, 1, OUT);
    pen(x + width + 1, y + dy, 1, 1, OUT);
    pen(x - width, y + dy, 2 * width + 1, 1, mid);
    pen(x - width, y + dy, width, 1, dark);
  }
  pen(x, y - halfHeight - 1, 1, 1, OUT);
  pen(x, y + halfHeight + 1, 1, 1, OUT);
  pen(x - 1, y - halfHeight + 1, 1, 1, WHITE);
}

function shard(pen: Pen, cx: number, cy: number, radius: number, colors: Triad): void {
  shardSpike(pen, cx - (radius - 1), cy, Math.max(1, radius - 2), 1, colors);
  shardSpike(pen, cx + (radius - 1), cy, Math.max(1, radius - 2), 1, colors);
  shardSpike(pen, cx, cy, radius, Math.max(1, radius - 3), colors);
}

function cluster(pen: Pen, cx: number, cy: number, radius: number, colors: Triad): void {
  const small = Math.max(1, radius - 2);
  gem(pen, cx - 2, cy + 2, small, colors);
  gem(pen, cx + 2, cy + 2, small, colors);
  gem(pen, cx, cy - 1, Math.max(1, radius - 1), colors);
}

export const shapes = { gem, nugget, prism, shard, cluster } as const;
export type ShapeName = keyof typeof shapes;
