---
name: delve-new-material
description: Add a new mineable ore/material to DELVE (games/delve) — the full procedure for authoring one so it matches the established procedural material system, Resurrect-64 palette, and value-gradient FX conventions. Trigger when asked to add/create a new ore, gem, metal, or material to DELVE, or when the user runs /delve-new-material. Also the reference for editing an existing material's look.
---

# DELVE — add a material

Author one new mineable ore end to end: gameplay data + a procedural material shader that shares
the rock's visual language. Read [`docs/MATERIALS.md`](../../../docs/MATERIALS.md) (the system spec)
and [`docs/PALETTE.md`](../../../docs/PALETTE.md) (Resurrect-64 + ramps) first — this skill is the
procedure; those own the rules. All paths below are under `games/delve/`.

Core idea: the **compositor** owns geometry; your material owns **colour only** via
`shade(ctx) => Rgb`, built on the shared `stoneSurface` primitive so it reads as "the same rock,
made of X." Ore is **baked** into the rock chunks (no overlay), so once you register the material
there is **no extra render wiring** — the game, worker, and labs all pick it up by ore id.

## Step 1 — gameplay data (`shared/src/resources/<name>.ts`)

Render-free (server + tools read it). Copy an existing ore file and edit. Pick a **new unique
`id`** (existing ids: dirt 1, copper 2, iron 3, silver 4, gold 5, emerald 6, ruby 7, diamond 8,
mythril 9 → new ore = 10+). Then add one import line to `shared/src/resources/index.ts`.

```ts
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 10,
  name: 'Cobalt',
  band: [200, 340],        // [minRow, maxRow] depth range it spawns in
  weight: 6,               // spawn share within the band (rarer = smaller)
  value: 480,              // coins per unit
  hp: 7,                   // toughness ON TOP of rock hp (deeper/rarer = higher)
  color: '#4d65b4',        // single colour for particles / HUD floaties
  desc: 'A cold blue metal from the deep stone.',
  art: { shape: 'nugget', c: ['#26305a', '#4d65b4', '#8fd3ff'] }, // icon shape + [dark,mid,hi] triad
} satisfies OreResource);
```

- `shape` ∈ `nugget | prism | gem | shard | cluster` — metals use `nugget`, gems get a crystal shape.
- Choose `band`/`weight`/`value`/`hp` to fit the existing progression (see the table in PALETTE.md
  and the ore resource files). Rarer + deeper ⇒ higher value + hp + lower weight.
- A `dim: true` ore (like dirt) renders as plain rock — **skip steps 2–3** for it (no material).

## Step 2 — the material shader (`client/src/render/materials/<name>.ts`)

Build a 6-stop **Resurrect-64** ramp (shadow→rim) via `colorsFor`, and `shade` on top of
`stoneSurface`. Register with the **same id** as the resource. Pick the template by tier:

**Metal (sheen, no twinkle)** — copper/iron style:

```ts
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

const COLORS = colorsFor(['#101a30', '#26305a', '#3a4f8a', '#4d65b4', '#7aa0e0', '#bfe0ff']);
const SHEEN: Rgb = hexRgb('#eaf3ff');

registerOreMaterial(10, {
  feather: 2.8,
  shade(ctx: ShadeCtx): Rgb {
    if (ctx.brightness > 0.74 && vnoise(ctx.worldX * 0.55, ctx.worldY * 0.55, TEX + 34) > 0.88)
      return SHEEN;
    return stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS);
  },
});
```

**Gem (baked sparkle + animated twinkle)** — emerald/ruby/diamond style:

```ts
import { hexRgb, colorsFor, stoneSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#0b241a', '#124430', '#1b6543', '#2c9660', '#57c584', '#a9eec6']);
const GLINT: Rgb = hexRgb('#eafff4');

registerOreMaterial(10, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.22, minLit: 0.56 }) ??
      stoneSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS)
    );
  },
  twinkle(ctx: TwinkleCtx): void {
    const f = twinkleFlash(ctx.time, ctx.seed, { period: 1.3, density: 0.6, gap: 0.45 });
    if (f.alpha <= 0) return;
    const x = ctx.x0 + (ctx.x1 - ctx.x0) * f.offset;
    const y = ctx.y0 + (ctx.y1 - ctx.y0) * f.offset;
    drawGlint(ctx.g, x, y, f.alpha * ctx.litAt(f.offset), GLINT, ctx.scale);
  },
});
```

Then **register it**: add `import './<name>';` to `client/src/render/materials/index.ts`.

Rules that keep it cohesive (see MATERIALS.md):
- **Always** build on `stoneSurface` in a `colorsFor([...])` ramp — never hand-roll a surface.
  Seed any noise with `ctx.worldX/worldY` (not px/py) so texture is stable + seamless.
- **Palette**: all six ramp stops from Resurrect-64 (or a `mix()`/`desat()` of them). Dark shadow
  → bright rim. `GLINT`/`SHEEN` are near-white tinted toward the material.
- **Value-gradient**: tune FX to rarity, not "shiny = valuable" — common metals sheen-only; mid
  metals a rare twinkle; gems sparkle + twinkle with `period`↓ / `density`↑ toward the rarest.
- `feather` (px bleed into neighbours) ~2.0 for crisp gems, ~2.6–3.2 for softer metals.
- Damage cracks come **free** (shared `fx.drawDamage`) — only add a `damage(ctx)` for a bespoke break.

## Step 3 — verify (cheap tools first; see [`tools/README.md`](../../../tools/README.md))

Run from `games/delve/`. Assumes `pnpm dev` is running for shots (`SHOT_BASE=http://localhost:5173`).

1. `pnpm verify` — the balance gate; run it because you changed gameplay data (band/weight/value/hp).
2. `pnpm --filter @delve/client typecheck` and `pnpm build` — must be green.
3. **Swatch** (top-lit isolated block; the new ore auto-appears in the grid):
   `WATCHDOG=20 SHOT_BASE=http://localhost:5173 tools/shot.sh 'w=64&h=74&scale=1' /tmp/mat.png labs/material-lab.html` → `Read /tmp/mat.png`.
4. **In world** (baked + feathered + lit), at a depth inside the ore's band:
   `WATCHDOG=25 SHOT_BASE=http://localhost:5173 tools/shot.sh 'orestyle=strata&r=<bandMid>&cave=shaft&lamp=1&w=70&h=56&scale=5&miner=0' /tmp/mat-world.png labs/render.html`.
   (Lamp off shows the raw surface; the `material-lab` field view shows twinkle animating.)
5. Judge it against the value-gradient + shared-language conventions; tune the ramp/FX and re-shot.
   Reach for Playwright only for live animation feel — never for a still a `shot.sh` crop can answer.

## Gotchas

- **Icons are separate.** Inventory/codex icons use the authored `art.shape` + triad from step 1
  (via `ore-art.ts`), not the material shader — set both.
- **No render wiring.** Ore bakes into chunks by id (game, worker, labs) once registered; don't
  touch `index.ts`/`chunk-worker.ts`.
- **Strata** (a depth stratum, not an ore) is the simpler sibling: just a 6-stop ramp + `top` row
  as a `type: 'strata'` resource — no shader. Same palette rules.
- Commit gameplay data (`@delve/shared`) and the shader (`@delve/client`) together; scope the
  branch to DELVE (`delve/…`).
