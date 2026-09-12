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
`shade(ctx) => Rgb`, built on one of the shared **surface-class primitives** (`stoneSurface` /
`metalSurface` / `facetSurface` / `glassSurface`) so it reads as "the same world, made of X." The
texture is the material's *class* — pick it by what the material physically is, don't invent one.
Ore is **baked** into the rock chunks (no overlay), so once you register the material there is **no
extra render wiring** — the game, worker, and labs all pick it up by ore id.

## Step 1 — gameplay data (`shared/src/resources/<name>.ts`)

Render-free (server + tools read it). Copy an existing ore file and edit. Pick a **new unique
`id`** (existing ids: dirt 1, copper 2, iron 3, silver 4, gold 5, emerald 6, ruby 7, diamond 8,
mythril 9, platinum 10, obsidian 11, quartz 12, stonebricks 13 → new ore = 14+). Ids are
append-only (saves reference them) — never renumber. Then add one import line to
`shared/src/resources/index.ts`.

```ts
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 10,
  name: 'Cobalt',
  band: [200, 340],        // [minRow, maxRow] depth range it spawns in
  weight: 6,               // spawn share within the band (rarer = smaller)
  hp: 7,                   // toughness ON TOP of rock hp (deeper/rarer = higher)
  rarity: 4,               // reward TIER, 0..RARITY_MAX — see below; ties are fine
  color: '#4d65b4',        // single colour for particles / HUD floaties
  desc: 'A cold blue metal from the deep stone.',
  art: { shape: 'nugget', c: ['#26305a', '#4d65b4', '#8fd3ff'] }, // icon shape + [dark,mid,hi] triad
} satisfies OreResource);
```

- `shape` ∈ `nugget | prism | gem | shard | cluster` — metals use `nugget`, gems get a crystal shape.
- There is **no `value`/economy** — everything mined just goes into the inventory. Choose
  `band`/`weight`/`hp` to fit the existing progression (see the table in PALETTE.md and the ore
  resource files). Rarer + deeper ⇒ higher hp + lower weight.
- ⚠️ **`band` is on its way out.** Depth-only placement is prototype leftover; placement is moving
  to **biomes declaring their contents**
  ([BIOMES.md](../../../docs/BIOMES.md), [MATERIALS.md](../../../docs/MATERIALS.md#placement-moves-to-biomes)).
  When that lands, this step becomes *"pick the biomes this material belongs to"* and `weight`
  narrows to abundance **within a biome**. Until then, keep using `band` — just don't treat depth as
  the intended long-term answer for where something lives.
- A `dim: true` ore (like dirt) renders as plain rock — **skip steps 2–3** for it (no material).

## Step 2 — the material shader (`client/src/render/materials/<name>.ts`)

Build a 6-stop **Resurrect-64** ramp (shadow→rim) via `colorsFor`, then `shade` on top of the
**surface-class primitive** that matches what the material *is* (see MATERIALS.md for all four):
`metalSurface` for metals, `facetSurface` for gems/crystals, `glassSurface` for glass,
`stoneSurface` for ore-in-rock. Register with the **same id** as the resource. Pick the template:

**Metal (`metalSurface` + sheen, no twinkle)** — copper/iron/silver/platinum style:

```ts
import { vnoise } from '@delve/shared';
import { TEX, hexRgb, colorsFor, metalSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx } from './types';

const COLORS = colorsFor(['#101a30', '#26305a', '#3a4f8a', '#4d65b4', '#7aa0e0', '#bfe0ff']);
const SHEEN: Rgb = hexRgb('#eaf3ff');

registerOreMaterial(14, {
  feather: 2.8,
  shade(ctx: ShadeCtx): Rgb {
    if (ctx.brightness > 0.74 && vnoise(ctx.worldX * 0.55, ctx.worldY * 0.55, TEX + 34) > 0.88)
      return SHEEN;
    // blotch = low-freq patchiness, streak = fine brushing; lower both for a mirror finish
    return metalSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 0.4, 0.12);
  },
});
```

**Gem (`facetSurface` + baked sparkle + animated twinkle)** — emerald/ruby/diamond/quartz style:

```ts
import { hexRgb, colorsFor, facetSurface } from '../palette';
import type { Rgb } from '../palette';
import { registerOreMaterial } from './types';
import type { ShadeCtx, TwinkleCtx } from './types';
import { sparkle, drawGlint, twinkleFlash } from './fx';

const COLORS = colorsFor(['#0b241a', '#124430', '#1b6543', '#2c9660', '#57c584', '#a9eec6']);
const GLINT: Rgb = hexRgb('#eafff4');

registerOreMaterial(14, {
  feather: 2.2,
  shade(ctx: ShadeCtx): Rgb {
    return (
      sparkle(ctx, { color: GLINT, chance: 0.22, minLit: 0.56 }) ??
      facetSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS, 5) // facet px
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

For **glass**, swap in `glassSurface(ctx.worldX, ctx.worldY, ctx.px, ctx.py, ctx.brightness, COLORS)`
(see `obsidian.ts`); for **ore-in-rock**, use `stoneSurface(…, COLORS)` (see `copper.ts`).

Then **register it**: add `import './<name>';` to `client/src/render/materials/index.ts`.

Rules that keep it cohesive (see MATERIALS.md):
- **Pick a surface-class primitive** in a `colorsFor([...])` ramp — never hand-roll a surface.
  Seed any noise with `ctx.worldX/worldY` (not px/py) so texture is stable + seamless.
- **Palette**: all six ramp stops from Resurrect-64 (or a `mix()`/`desat()` of them). Dark shadow
  → bright rim. `GLINT`/`SHEEN` are near-white tinted toward the material.
**Choosing `rarity`.** It is the one input to every reward cue — break pitch, particle count, screen
shake, whether the pickup gets the big floaty — and it is *authored*, not derived. Two rules:

- **Do not derive it from depth.** Depth says where a material is, not how special it is: quartz is
  deeper than gold and far more plentiful. Ask "how should breaking this FEEL?", then place it.
- **The top tier is held alone** by Mythril, and `rarity >= 4` is the tier the game celebrates. A new
  material almost always belongs at or below 4; going higher is a claim that it outranks Diamond.

Rarity used to be the ore's position in the registry, so adding a file silently re-tiered the ones
already there (#46). The field exists so that can't happen again — which also means a new resource
will not compile without it.

- **Value-gradient**: tune FX to rarity, not "shiny = valuable" — common metals sheen-only; mid
  metals a rare twinkle; gems sparkle + twinkle with `period`↓ / `density`↑ toward the rarest.
- `feather` (px bleed into neighbours) ~2.0 for crisp gems, ~2.6–3.2 for softer metals.
- Damage cracks come **free** (shared `fx.drawDamage`) — only add a `damage(ctx)` for a bespoke break.

## Step 3 — verify (cheap tools first; see [`tools/README.md`](../../../tools/README.md))

Run from `games/delve/`. Assumes `pnpm dev` is running for shots (`SHOT_BASE=http://localhost:5173`).

The **material lab** (`labs/material-lab.html`) is the dedicated harness — a sidebar grid of every
material plus a **surface** preview and a **cave-system** preview. It's fully URL-driven, and
`ui=0` renders one bare preview at the top-left framed by shot.sh's `w`/`h`/`scale`, so you can
inspect a material with no Playwright. Params: `mat=<slug>` (lowercased name, spaces stripped),
`view=surface|cave|both`, `depth=<row>`, `scale`, `lit=0|1`, `seed`, `w`/`h`.

1. `pnpm test` — the gate; run it because you changed gameplay data (band/weight/hp). The resource
   + world-gen suites check conformance and that the ore is discoverable within its band; if you
   added a placement/mechanic rule, add a co-located `*.test.ts` for it (see docs/TESTING.md).
2. `pnpm --filter @delve/client typecheck` and `pnpm build` — must be green.
3. **Surface** (the top-lit block, in isolation):
   `SHOT_BASE=http://localhost:5173 tools/shot.sh 'view=surface&ui=0&mat=<slug>&w=8&h=6&scale=4' /tmp/mat.png labs/material-lab.html` → `Read /tmp/mat.png`.
4. **In a cave** (baked + feathered into rock + lamp-lit), the window auto-centres on a vein of the
   selected material at a depth inside its band:
   `WATCHDOG=8 SHOT_BASE=http://localhost:5173 tools/shot.sh 'view=cave&ui=0&mat=<slug>&depth=<bandMid>&w=14&h=10&scale=3' /tmp/mat-cave.png labs/material-lab.html`.
   (Change `seed=<n>` to see a different cave shape; drop `lit=0` to kill the lamp and see the raw surface.)
5. Judge it against the value-gradient + surface-class conventions; tune the ramp/FX and re-shot. The
   interactive lab (`ui=1`, the default) shows twinkle animating — reach for Playwright only for that
   live feel, never for a still a `shot.sh` crop can answer.

## Gotchas

- **Icons are separate.** Inventory/codex icons use the authored `art.shape` + triad from step 1
  (via `ore-art.ts`), not the material shader — set both.
- **No render wiring.** Ore bakes into chunks by id (game, worker, labs) once registered; don't
  touch `index.ts`/`chunk-worker.ts`.
- **Strata** (a depth stratum, not an ore) is the simpler sibling: just a 6-stop ramp + `top` row
  as a `type: 'strata'` resource — no shader. Same palette rules.
- Commit gameplay data (`@delve/shared`) and the shader (`@delve/client`) together; scope the
  branch to DELVE (`delve/…`).
