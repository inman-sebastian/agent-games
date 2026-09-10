# DELVE — rendering

How the cave picture is built, from the atmospheric wall at the back to the ore
crystals on top. All art is drawn in code (canvas, no images/emoji/fonts-as-art) on
a **logical-resolution buffer that is upscaled with `image-rendering: pixelated`**,
so every effect — including gradients, glows and vignette — stays chunky pixels.

## Grounding

Derived from studying real references the user vetted: **Dome Keeper**, **SteamWorld
Dig**, **Super Motherload**, Quintino "Deep Cave", BigManJD. Hard-won principles:

- Blocky isn't the enemy; *flat, unlit* rock is. Tactile rock reads great.
- **Dark mass centers + a lighter background** are what separate foreground rock
  from open/dug space. This is the #1 lever.
- Edges must connect **globally** (a per-pixel field), not per-tile, or they
  misalign; AO/outline must hug the real pixel contour, not the tile box.
- Render all lighting at logical resolution, then upscale — never smooth gradients.

## Resolution & pixel density

Art is authored at what *looks like* 16×16 tiles. The scene renders to a **logical**
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
2. **Foreground rock** — the diggable solid, composited on top with transparency for
   open space, plus a subtle **contact shadow** where rock meets the background.
3. **Overlays** — ore blocks, stalactites/stalagmites, the miner, the lamp glow, and
   a vignette. Lighting ([LIGHTING.md](LIGHTING.md)) draws last, per-frame.

The rock (layers 1–2) is drawn by `composeBand` in `cave-render.ts` and cached as
chunks (see [ARCHITECTURE.md](ARCHITECTURE.md#the-rock-chunk-pipeline)); the overlays
draw per-frame on top of the cached rock.

## Foreground rock model (per-pixel field)

- Rock solidity is a **per-pixel field**: a tile is solid, then its boundary with
  open space is eroded by world-space noise (gentle, ~0.4–1.8px) so edges are organic
  and **connect seamlessly** across tiles/corners.
- **Top-lit, dark-bodied.** Brightness falls off from *every* exposed edge (walls and
  undersides included) with a **top-light bias** (up-facing surfaces brightest). The
  interior of any large mass falls to near-black — **dark centers** — which reads as
  depth and keeps the body calm. The dark body is left **empty** (no random grit — it
  read busy).
- The surface→center transition is **organic, not a colour band**: multi-octave noise
  (lumps poke into light, crevices fall to dark) + ordered (Bayer) dithering, with
  sparse crack detail only in the transition band.
- **Rim** is desaturated and varied between the warm rock tone and a grayer rock tone
  — reads as stone, not molten orange. No moss/flora here (see [JUICE.md](JUICE.md)).

## Ore nodes / blocks (Terraria-style clusters)

Ore is not embedded veins-in-rock — each ore cell **is** an ore **block** that fills
the cell, and adjacent same-ore cells form a **node**: a contiguous cluster that
reads as one crystalline mass (like a Cobalt Ore clump), not confetti.

- **Placement** is a pure `f(seed,c,r)` in `scripts/blocks.ts` (`oreAt`): a
  low-frequency value-noise field is thresholded into blobby pockets, and a coarse
  region grid gives each pocket a single ore type (weighted by depth band). Density is
  kept near the old per-cell value for now; a rarer/richer-cluster economy retune is a
  later pass.
- **Rendering** — `drawOreBlock(g, art, X, Y, col, row, frac, sameOre)` in
  `scripts/ore-art.ts` (approach A): the rock body is drawn by `cave-render`; each ore
  cell is overlaid with a **world-anchored faceted crystalline fill** (noise keyed to
  world coords, so it flows continuously across cells). Only **cluster-boundary** edges
  (where the neighbour isn't the same ore) get the dark outline + a top rim highlight —
  internal cell seams are invisible, so the pocket reads as one block. `sameOre(dc,dr)`
  supplies the neighbour test.
- **No reveal.** The block simply *is* ore; taking damage shows spreading **cracks**
  (`frac` in 0..1), not a growing crystal. Breaking it sells the ore (juice moves to
  the break — see [JUICE.md](JUICE.md)).
- **Only rendered where visible** — within lamp range, or anywhere with the **Ore
  Scanner** — as a per-frame pass over the cached rock (faded by visibility, not
  baked). Exposed ore also emits coloured light through the lighting system, so a
  cluster glows its own hue. The per-ore crystal **shapes** (`SHAPES`) live on as the
  extracted-ore icon and (future) break effect. **Dirt** is a `dim` ore: it renders as
  plain rock.
- *Future refinement (approach B):* fold ore into `cave-render` as a first-class block
  type coloured per-cell, for deeper unification; A gets the look fast.
