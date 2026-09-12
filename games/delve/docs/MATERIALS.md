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
  vein leaves no stain). It will also own **boundary _style_** — whether a given boundary feathers
  at all (see [Hard boundaries](#hard-boundaries-blend-suppression)).
- **Material shader** (`client/src/render/materials/<name>.ts`) owns colour only: a function
  `shade(ctx: ShadeCtx) => Rgb`, with full freedom (it imports `vnoise`/`mix`/etc. itself).

## The boundary (where things live)

- **Gameplay data** — hp / id / name / icon / weight — stays in
  `shared/src/resources/<ore>.ts` (type `ore`), render-free so the server + tools can read it.
  **`band` is on its way out** — see [Placement moves to biomes](#placement-moves-to-biomes).
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

## Placement moves to biomes

> **Decided, not built.** See [BIOMES.md](BIOMES.md).

Today a material declares **where it spawns** as a depth range: `band: [minRow, maxRow]`. That's
depth-only placement, and it's prototype leftover from when DELVE was a dig-down game.

**The direction inverts the ownership: biomes declare their contents.** Placement resolves a biome
from several signals, and the biome's own definition lists the materials it holds and how abundant
each is.

Why that direction and not material-declares-biome-affinity:

- **A biome is an authored _place_**, so its identity includes what's in it. You can read one biome
  file and know what the Glowing Mushroom Cavern contains.
- **Absence is expressible by _omission_.** "This biome has no iron" is simply iron not being listed
  — far clearer than iron carrying a zero weight for every biome it's absent from, and it scales as
  the roster grows.

**The cost is a feature.** Adding a material means editing the biomes it belongs to, which forces a
decision about where it lives instead of letting it leak everywhere by default.

**Consequences for this doc's workflow:**

- `band` on `OreResource` and `top` on `StrataResource` both become obsolete.
- The **`delve-new-material` skill loses its "pick a band" step** and gains "pick the biomes this
  belongs to". That skill needs updating alongside the code change.
- `weight` survives but its meaning narrows: **abundance within a biome**, rather than a share of a
  depth band.

## Hard boundaries (blend suppression)

> **Decided, not built.** See [BIOMES.md](BIOMES.md).

The compositor **always feathers** across a material boundary. That's exactly right for most of the
world, and exactly wrong where crossing into a biome is supposed to be a *moment* — breaking into
the Crystal Vault or reaching the Molten Core should read as one block over and unmistakably
different, not as a soft fade.

So boundary style becomes conditional: **when two adjacent solid tiles belong to biomes whose
boundary is _hard_, skip the feather.**

Three things make this cheaper and less invasive than it sounds:

- **The no-blend path already exists.** `shadeRock` bails out with `if (bestDist === Infinity)
  return` when a pixel has no differing neighbour. A hard boundary is the *same outcome for a
  different reason*, so suppression reuses the existing early-out rather than adding a branch to the
  blend maths.
- **Hardness is a property of the _biome pair_, not the material.** It does **not** belong on the
  `Material` contract — two tiles of the same pair of materials should feather inside a biome and
  not feather across a hard biome edge. The compositor needs a biome lookup per tile, which it does
  not have today; that's the actual work.
- **Sealed pockets get their hard edge for free.** A tool-gated shell *is* a hard boundary, so The
  Works and the Crystal Vault need nothing special here.

> **`feather: 0` does not produce a hard edge — don't reach for it.** The blend half-width is
> `w = Math.max(2, (wa + wb) * 0.5 * BLEND_WIDTH)`, so that floor of 2px survives any material
> declaring zero. Suppression has to happen *before* the blend is computed, which is the early-out
> above.

**Readability requirement:** a hard boundary must change **texture or shape**, not only palette —
never rely on colour alone. The surface classes below are the mechanism: a hard edge between two
materials of *different classes* (say `stoneSurface` against `facetSurface`) already reads
structurally, not just chromatically.

## Shared visual language — surface classes (non-negotiable)

Every material's `shade` builds on **one of the shared surface primitives** in `palette.ts`,
picked by what the material physically *is* — the texture is the material's class, not a per-ore
invention. Each takes the same `(worldX, worldY, px, py, brightness, colors, …)` shape and returns
a quantised, Bayer-dithered colour; `colors` always comes from **`colorsFor([6 hex stops,
shadow→rim])`** on the [Resurrect-64](PALETTE.md) palette. Never hand-roll a surface — pick the
class primitive and layer FX _on top_. The classes:

- **`stoneSurface(wx, wy, px, py, b, colors)`** — the rock's craggy recipe. Plain rock and any
  ore that reads as ore-in-rock (copper's veins, the strata). The default.
- **`metalSurface(wx, wy, px, py, b, colors, blotch, streak)`** — smooth/brushed, no speckle.
  `blotch` = low-freq patchiness, `streak` = fine directional brushing. Iron/silver/platinum/gold.
- **`facetSurface(wx, wy, px, py, b, colors, facet)`** — cut-crystal planes: skewed cells of size
  `facet` px each get a flat tone + faint grain. Emerald/ruby/diamond/mythril/quartz (gems).
- **`glassSurface(wx, wy, px, py, b, colors)`** — smooth dark glossy, brightness pulled down so it
  reads as glass even when lit. Obsidian.

A material may also compose a *structured* surface on top of a class (e.g. `stonebricks.ts` lays a
running-bond brick pattern over `stoneSurface`) — still Resurrect-64, still world-anchored.

The through-line is unchanged: seed all noise with `worldX/worldY` (stable + seamless), quantise to
the ramp, dither with `px/py`. This is why every material reads as the same world in a different
material rather than a foreign asset.

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
