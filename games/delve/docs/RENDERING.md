# DELVE — rendering

How the cave picture is built, from the atmospheric wall at the back to the ore
crystals on top. All art is drawn in code (canvas, no images/emoji/fonts-as-art) on
a **logical-resolution buffer that is upscaled with `image-rendering: pixelated`**,
so every effect — including gradients, glows and vignette — stays chunky pixels.

## Grounding

Derived from studying real references the user vetted: **Dome Keeper**, **SteamWorld
Dig**, **Super Motherload**, Quintino "Deep Cave", BigManJD. Hard-won principles:

- Blocky isn't the enemy; _flat, unlit_ rock is. Tactile rock reads great.
- **Dark mass centers + a lighter background** are what separate foreground rock
  from open/dug space. This is the #1 lever.
- Edges must connect **globally** (a per-pixel field), not per-tile, or they
  misalign; AO/outline must hug the real pixel contour, not the tile box.
- Render all lighting at logical resolution, then upscale — never smooth gradients.

## Resolution & pixel density

Art is authored at what _looks like_ 16×16 tiles. The scene renders to a **logical**
buffer at that art resolution and is displayed at an **integer scale** (currently
2×, i.e. 32 on-screen px per tile), with `image-rendering: pixelated` handling the
device's own pixel density. Do **not** render the whole scene at the device scale —
that would multiply the (per-pixel) lighting cost for no visual gain.

The canvas **fills the whole viewport edge-to-edge**: its logical width is the full
field width and its logical height matches the window aspect, so tiles stay square
with no letterboxing. The HUD floats as an **overlay** on top, not in a chrome bar.

## Layers (composited bottom-to-top)

0. **Sky** — above the surface row only: a vertical gradient, zenith → horizon
   (`SKY_TOP`/`SKY_HORIZON` in `cave-render.ts`). See [Sky](#sky) — it has two known defects.
1. **Background** — a lighter, cooler, desaturated atmospheric wall (its own palette,
   derived per-stratum — see [PALETTE.md](PALETTE.md)), with a depth gradient + faint
   distant-rock silhouettes. Drawn first; open/dug tunnels reveal it. Built to accept
   **parallax** layers later — see [Background depth & parallax](#background-depth--parallax).
2. **Foreground rock + ore** — the diggable solid, composited on top with transparency
   for open space, plus a subtle **contact shadow** where rock meets the background. Ore
   is **baked into this layer** through each ore's material shader (feathered into the
   strata — see _Foreground rock & materials_ below), **not** a separate overlay.
3. **Overlays (per-frame)** — animated FX drawn over the cached rock: each exposed, lit
   vein's **twinkle**, **mining-damage** cracks on tiles taking hits, the miner, particles,
   then the **lighting pass** ([LIGHTING.md](LIGHTING.md)) last (lamp glow + darkness scrim
   + vignette). Ore does **not** cast its own light.

Layers 1–2 are drawn by `composeBand` in `cave-render.ts` and cached as chunks (see
[ARCHITECTURE.md](ARCHITECTURE.md#the-rock-chunk-pipeline)); the overlays draw per-frame on
top of the cached rock. A dig re-bakes only the affected chunk region.

## Sky

Above the surface row, `composeBand` fills each scanline with a `mix()` between a zenith and a
horizon colour. It's the only part of the frame that isn't tile-driven.

**Two known defects, both to fix with the day/night work** (see
[PALETTE.md](PALETTE.md#surface--daylight)):

- **The colours are off-palette.** `#0e1830` → `#6a86b4`, neither in Resurrect 64. This is the one
  place above ground that breaks the palette rule. The replacement ramps are specified in
  PALETTE.md, keyed per phase of the cycle.
- **The gradient is smooth, not dithered.** Every other surface here quantises and Bayer-dithers to
  hold the pixel-art grain — rock, the darkness scrim, the vignette. The sky interpolates per
  scanline, so it's the single continuous-tone element in the game and reads as from a different
  renderer up close. It wants the same `DSTEP`-style ordered dither as the scrim.

**It will also stop being static.** With a [day/night cycle](DESIGN.md#the-world) the two stops
become a function of time, interpolated between phase keyframes — which means the sky can no longer
be baked into a world-space chunk (see below).

## Background depth & parallax

**Planned direction.** More background detail is wanted **both above and below ground**, with real
**parallax layers** — the background layer was built with that in mind, and the faint distant-rock
silhouettes (`BG_SILHOUETTE_*`) are the primitive version of it.

Two constraints worth knowing before building it, because they shape the implementation:

- **Parallax can't live in the chunk cache.** Layers 1–2 are cached as **world-space** chunks, which
  works because a tile's appearance depends only on its world position. A parallax layer moves at a
  *different rate* than the world, so its appearance depends on the **camera**, not the tile — so it
  needs its own per-frame pass (or a cache keyed by camera offset), not a place in `composeBand`.
  The same is true of the time-varying sky.
- **Lamp-only visibility fights background detail underground.** The ambient floor is zero and the
  scrim reaches full on an unlit pixel ([LIGHTING.md](LIGHTING.md)), so anything beyond lamp reach
  is *black* — including background layers. Underground parallax therefore only reads inside the
  lit radius, which is a narrow band. That's a genuine tension with the true-void decision, and it
  resolves one of three ways: accept that underground parallax is close-range detail rather than
  depth cueing; exempt background layers from the scrim (which weakens the void); or lean on
  **emissive** background content, which the [emitter model](LIGHTING.md) already supports. Above
  ground, with a daylight ambient, parallax reads normally and is the cheap win.

## Foreground rock & materials (per-pixel field)

Solid tiles — rock **and** ore — all render through one shared per-pixel compositor
(`shadeRock` inside `cave-render.ts`). The compositor owns the **geometry**; each material
owns only its **colour**. This is the material system (no tile atlases, no autotiling — the
seamless look is emergent from world-anchored fields). See [MATERIALS.md](MATERIALS.md) for
the authoring spec and the material contract.

- **Solidity is a per-pixel field.** A tile is solid, then its boundary with open space is
  eroded by world-space noise (gentle, ~0.4–1.8px) so edges are organic and **connect
  seamlessly** across tiles. **Convex corners** are additionally bitten by a small
  noise-varied quarter-disc, so blocks never read as perfectly square.
- **Top-lit, dark-bodied.** Baked brightness falls off from _every_ exposed edge with a
  **top-light bias** (up-facing surfaces brightest), over a range that spans ~1–1.5 tiles,
  so exposed rock reads as a broad softly-fading band (the interior of a large mass still
  falls to near-black — dark centers read as depth). The lamp then adds its own falloff on
  top ([LIGHTING.md](LIGHTING.md)).
- The surface→center transition is **organic, not a colour band**: multi-octave noise +
  ordered (Bayer) dithering (the shared `stoneSurface` recipe). Dark body left **empty**
  (no grit — it read busy). Rim is desaturated stone, not molten orange.
- **Materials colour the pixel.** Where a tile carries an ore, that ore's **material shader**
  (`shade(ctx) => Rgb`) colours the pixel through this same geometry — every material builds
  on one of the shared **surface-class primitives** (`stoneSurface` / `metalSurface` /
  `facetSurface` / `glassSurface`, see [MATERIALS.md](MATERIALS.md)) in its own
  [Resurrect-64](PALETTE.md) ramp, so all solid tiles share one visual language ("the same
  world, made of gold"). The compositor **feathers a
  colour blend** across material boundaries (material↔rock _and_ material↔material) so
  neighbours cross-fade instead of meeting at a hard seam. The blend only crosses **two solid
  tiles** — an open (dug) neighbour is the silhouette edge, so a mined-out vein leaves **no
  colour stain** on the surrounding rock.

## Ore (baked, procedural clusters)

- **Placement** is a pure `f(seed,c,r)` in `shared/src/blocks.ts` (`oreAt`): a low-frequency
  value-noise field is thresholded into blobby pockets; a coarse region grid gives each pocket
  a single ore type (weighted by depth band), so adjacent same-ore cells read as one mass.
- **Baked, not overlaid.** Ore is composited into the rock chunk via
  `materialAt = (c,r) => oreMaterial(oreAt(seed,c,r))` passed to `composeBand`, so it feathers
  into the strata seamlessly (there is no `drawOreBlock` overlay anymore). It's simply _there_;
  there is **no reveal** step.
- **No ore emission.** Veins read purely by their lit surface + baked `sparkle` and animated
  `twinkle` FX — they do **not** cast coloured light. **Lamp-only vision** (LIGHTING.md) hides
  unlit ore in the void, so discovery still matters.
- **Damage** is a shared, tiered **crack FX** (`fx.drawDamage`), keyed on `world.dmg`, drawn
  per-frame over damaged tiles; breaking a tile drops the ore into the inventory (juice moves
  to the break — see [JUICE.md](JUICE.md)).
- The per-ore crystal **shapes** (`SHAPES`/`ORE_ART` in `ore-art.ts`) live on only as the
  inventory/codex **icon**. **Dirt** is a `dim` ore with no material: it renders as plain rock.
