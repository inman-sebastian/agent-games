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

1. **Background** — a lighter, cooler, desaturated atmospheric wall (its own palette,
   derived per-stratum — see [PALETTE.md](PALETTE.md)), with a depth gradient + faint
   distant-rock silhouettes. Drawn first; open/dug tunnels reveal it. Built to accept
   **parallax** layers later.
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
  on the shared `stoneSurface` in its own [Resurrect-64](PALETTE.md) ramp, so all solid tiles
  share one visual language ("the same rock, made of gold"). The compositor **feathers a
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
  unlit ore in the void, so discovery still matters (this replaces the old scanner reveal).
- **Damage** is a shared, tiered **crack FX** (`fx.drawDamage`), keyed on `world.dmg`, drawn
  per-frame over damaged tiles; breaking a tile sells the ore (juice moves to the break — see
  [JUICE.md](JUICE.md)).
- The per-ore crystal **shapes** (`SHAPES`/`ORE_ART` in `ore-art.ts`) live on only as the
  inventory/codex **icon**. **Dirt** is a `dim` ore with no material: it renders as plain rock.
