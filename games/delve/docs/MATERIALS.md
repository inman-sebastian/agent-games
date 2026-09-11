# DELVE — materials

Every solid tile — plain rock **and** every ore — renders through one shared per-pixel
compositor. The compositor owns the **geometry**; each material owns only its **colour**.
This is what keeps the world cohesive as materials multiply, with no tile atlases and no
autotiling — the seamless, "corners always match" look is _emergent_ from world-anchored
procedural fields (see [RENDERING.md](RENDERING.md)).

**To add a material, use the `delve-new-material` skill** — it's the step-by-step procedure.
This doc is the reference it (and you) build against.

## Division of labour

- **Compositor** (`shadeRock` in `client/src/render/cave-render.ts`) owns geometry for every
  material: the solidity mask, distance fields, top-light, world-anchoring, convex-corner
  rounding, and the **per-pixel feathered colour blend** across material boundaries
  (material↔rock _and_ material↔material — only ever between two _solid_ tiles, so a mined-out
  vein leaves no stain).
- **Material shader** (`client/src/render/materials/<name>.ts`) owns colour only: a function
  `shade(ctx: ShadeCtx) => Rgb`, with full freedom (it imports `vnoise`/`mix`/etc. itself).

## The boundary (where things live)

- **Gameplay data** — band / weight / value / hp / id / name / icon — stays in
  `shared/src/resources/<ore>.ts` (type `ore`), render-free so the server + tools can read it.
- **The shader** lives client-side and **self-registers by the same ore id**
  (`registerOreMaterial(id, material)`), mirroring the one-self-registering-file-per-entity
  pattern in `shared/src/resources/`. `client/src/render/materials/index.ts` imports each file.

## The Material contract (`materials/types.ts`)

```ts
interface Material {
  shade(ctx: ShadeCtx): Rgb;        // REQUIRED — per-pixel colour of the baked surface
  feather?: number;                 // px this material bleeds into neighbours (default 3.2)
  twinkle?: (ctx: TwinkleCtx) => void;   // animated glint on exposed, lit cluster edges
  damage?: (ctx: DamageCtx) => void;     // bespoke break FX (else the shared crack FX is used)
}
```

- `ShadeCtx`: `worldX, worldY` (seed noise with these — stable + seamless), `px, py` (Bayer),
  `localX, localY`, `column, row`, `brightness` (raw geometric top-light 0..1), `edgeDist`, `topDist`.
- `TwinkleCtx`: `g`, `x0,y0 → x1,y1` (the exposed edge in display px), `scale`, `time`, `seed`,
  `litAt(t)` — one glint travels the whole **cluster edge** (adjacent same-material lit tiles).
- `DamageCtx`: `g`, `x, y`, `scale`, `frac` (dig progress), `seed`, `lit`, `dirX, dirY` (mined-from side).

## Shared visual language (non-negotiable)

Every material's `shade` builds on the shared **`stoneSurface(worldX, worldY, px, py, brightness,
colors)`** primitive (`palette.ts`) — the rock's exact craggy + Bayer-dithered recipe — just in
its own palette. `colors` comes from **`colorsFor([6 hex stops, shadow→rim])`** on the
[Resurrect-64](PALETTE.md) palette. This is why an ore reads as "the same rock, made of gold"
rather than a foreign asset. Don't hand-roll a surface; layer FX _on top_ of `stoneSurface`.

## FX catalogue (`materials/fx.ts`) — opt-in

- **`sparkle(ctx, {color, chance?, minLit?, cell?})`** — baked, deterministic star glints on
  lit pixels (size/brightness scale with litness). Returns a colour or `null`; use as
  `sparkle(ctx, …) ?? stoneSurface(…)`.
- **`twinkleFlash(time, seed, {period, density, gap})` + `drawGlint(g,x,y,alpha,color,scale)`** —
  build an animated `twinkle`: one glint hopping the lit edge on an irregular schedule.
- **`drawDamage(ctx)`** — the shared tiered mining-damage cracks; materials get it for free (only
  set `damage` to override with something bespoke).
- A **sheen** (metals) is just a thresholded `vnoise` returning a bright tone above a brightness
  cutoff — see `iron.ts` / `copper.ts`.

## Value-gradient convention

Rarity should read at a glance — tune FX to the tier, not "shiny = valuable":

- **Common metals** (copper, iron): a subtle **sheen**, no twinkle.
- **Mid metals** (silver): brighter sheen + a **rare** cool twinkle.
- **Precious / gems** (gold, emerald, ruby, diamond, mythril): **sparkle + twinkle**, with
  `period` shortening / `density` rising toward the rarest (diamond is the liveliest).

## Not a material

Ore item **icons** (inventory/codex) still use the authored crystal `art.shape` + triad in
`ore-art.ts` — that's separate from world rendering. `dim` ores (dirt) register no material and
render as plain rock.
