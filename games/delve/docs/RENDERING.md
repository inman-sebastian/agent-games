# DELVE — rendering

How the cave picture is built, from the atmospheric wall at the back to the ore
crystals on top. All art is drawn in code (canvas, no images/emoji/fonts-as-art) on
a **logical-resolution buffer that is upscaled with `image-rendering: pixelated`**,
so every effect — including gradients, glows and vignette — stays chunky pixels.

## Direction: WebGPU

**Decided by the author (2026-09-13): rendering moves to WebGPU, with as much as possible on the GPU in
shaders.** Tracked in [#68](https://github.com/inman-sebastian/agent-games/issues/68); the spike that
measures it first is [#69](https://github.com/inman-sebastian/agent-games/issues/69).

**Today everything described below runs on Canvas 2D**, and the expensive parts are hand-written
per-pixel JavaScript loops into `ImageData`: the rock mask, its distance fields and top light, the
stone surface and every material "shader", the lighting glow, the dithered scrim and the vignette. The
chunk cache, the bake Worker and the lighting cost caps exist to make that affordable. Those loops are
already pure functions of position, material, light and time, which is exactly what fragment and
compute shaders run in parallel.

What that does and doesn't change:

- **The simulation stays on the CPU.** `@delve/shared` is the one ruleset the server also runs, with
  no GPU; determinism and the client/server contract depend on it. That includes fluid. Only the
  client's `render/` layer moves. UI chrome stays DOM and CSS.
- **The look doesn't change.** Everything below — the layers, the per-pixel rock field, top light,
  the Resurrect 64 palette, Bayer dithering, nearest-neighbour integer upscale — is the spec the GPU
  renderer implements. The world-anchored hashes and noise (`rng.ts`) use 32-bit wrapping
  arithmetic, which WGSL reproduces exactly; only the final float conversion can move a threshold by a
  hair.
- **What ports mechanically:** noise, the stone surface, quantize/dither, the background, the sky, the
  stalactites, the scrim and the vignette. **What needs a GPU-native technique:** the chamfer distance
  transforms (sequential two-pass sweeps; the GPU equivalent is jump flooding) and the order-dependent
  light propagation.
- **Tooling:** probe's headless Chrome exposes a real WebGPU adapter; `shot.sh` launches Chrome with
  `--disable-gpu`, so WebGPU captures go through probe instead.

The sections below get rewritten as each part moves.

### Spike findings (#69)

`client/labs/gpu-lab.html` renders one carved screen of the real world twice: through the Canvas 2D
path (`composeBand` + `lighting.ts`) and through the compute pipeline in `client/src/render/gpu/`,
which reads the same world predicates, strata ramps, tuning constants and light field. Materials are
out of scope on both sides. Measured with `pnpm probe` on the author's machine (Apple, Metal).

**Fidelity: the port is faithful.**

| Frame                                 | Identical pixels           | Within 8 levels   | Where the rest differ                                                                                                       |
| ------------------------------------- | -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rock, sky, stalactites (lighting off) | **99.99%** (14 of 130,560) | 99.99%            | Single pixels one shading band apart, and one 2×2 silhouette block: noise values landing on a threshold, float32 vs float64 |
| With lighting                         | 75.8%                      | **100%** (max 11) | ±1-level rounding everywhere the glow, scrim and vignette blend — Canvas 2D's 8-bit compositing vs the shader's arithmetic  |

Nothing that differs is visible side by side. A pixel-exact match isn't a goal: the GPU renderer
replaces the CPU one, so the diff proved the port, and after the port the GPU output is the look.

**Cost: a whole screen, every frame, for less than the cached CPU path.** At a 3400×1900 window
(1,696×944 art pixels):

| Path                                                             | Main thread per frame                      | GPU         |
| ---------------------------------------------------------------- | ------------------------------------------ | ----------- |
| Canvas 2D, full recompose (what the chunk cache exists to avoid) | ~760 ms                                    | —           |
| **The game today** (cached chunks, Worker bakes not counted)     | **~4.2 ms** — lighting 3.5, scrim 2.7      | —           |
| **WebGPU, full recompose from scratch**                          | **~3.8 ms** — world upload 3.7, encode 0.1 | **~2.6 ms** |

The GPU path's main-thread cost is almost entirely **rebuilding the world upload from world queries
every frame**: about 25,000 solidity lookups plus the top-light seeds. Nothing requires that. With the
world held on the GPU and updated by deltas (digs, and a row or column entering view), the expected
cost is well under a millisecond on the main thread. That's a projection, not a measurement. Either
way the chunk cache, the bake Worker, and the scrim's CPU cost stop existing.

**Code shape.**

- **WGSL in `.wgsl` files**, imported with Vite's `?raw`. WGSL has no includes, so modules are
  concatenated.
- **Tuning constants are generated from the TypeScript that owns them** (`gpu/constants.ts`). A retune
  in `cave-render.ts` or `lighting.ts` reaches both renderers, and nothing has a second home.
- **Exact integer ports** of `rng.ts` (32-bit wrapping arithmetic) and `palette.ts`'s quantiser.
- **A frame is 12 passes**: mask; jump-flood init and 7 steps; shade; light; present.
- **Techniques that changed**, all without measurable cost to the look:
  - The chamfer edge-distance sweep became jump flooding with the chamfer metric.
  - The top-light depth became a bounded 36 px upward scan, exact because brightness has clamped by
    then.
  - The contact-shadow distance became a ±2 px window, exact for the same reason.
- **The light propagation stayed on the CPU** (`LightingInstance.field`, split out of `render` so both
  renderers read one field). It costs 0.8 ms in the game.

**Tooling.** probe's headless Chrome exposes a Metal adapter. `pnpm probe --shot` captures WebGPU
pages, which `shot.sh` (with `--disable-gpu`) can't; `probe --no-gpu` shows the WebGPU required screen. The lab's `window.gpuLab.runDiff()` reads the GPU
frame back and diffs it for probe.

**What the spike surfaced for the epic:**

- **Per-row strata ramps come free.** Chunks pick one ramp per band from its centre row, which is the
  seam #54 describes. The GPU shades every pixel with no chunks, so the ramp can follow the row.
- **The material shaders are the real porting cost.** There are 13 JavaScript `shade(ShadeCtx)`
  functions, plus the feathered material blend. The contract maps onto one WGSL function per material,
  selected by id, and the `delve-new-material` skill has to change with it.
- **The render gates need a new basis.** `chunks.test.ts` and `soft-canvas.ts` test a pipeline that goes
  away, and a CPU-vs-GPU diff only works while both exist. The likely replacements are golden-image
  checks through probe plus invariant tests on the TypeScript that prepares GPU data. That's a decision
  for the epic, not the spike.
- **Unsupported browsers.** The renderer throws `GpuUnavailable` with a sentence for the page. The
  unsupported-browser screen is renderer-core work.

### Renderer core in the game (#71)

**WebGPU is the renderer, and it's required** ([#77](https://github.com/inman-sebastian/agent-games/issues/77)
— the author's decision, once the GPU path had no remaining known visual differences).

- **No silent fallback.** A browser without WebGPU — or one whose GPU device is lost mid-game — gets a
  **WebGPU required** screen: a terminal `unsupported` app state that says why and offers a reload.
- **`?renderer=2d` is a developer switch, not a player fallback.** It keeps the Canvas 2D path
  reachable for `gpu-lab`'s parity diffs while both renderers exist. The chunk bake Worker is only
  created in that mode.
- **Retiring Canvas 2D is the render-gates child of #68.** It waits on a verification basis that
  doesn't depend on the CPU renderer.

**The world lives on the GPU as a window, not per frame.** `gpu/world-window.ts` keeps a CPU mirror of
cell solidity and surface heights for the view plus a margin, and uploads it whole. The upload is tens
of kilobytes and costs nothing. The spike's 3.7 ms was the _world queries_, and the window removes
them:

- **Scrolling shifts the mirror** and queries only the strips entering it.
- **Digs, including the server's, update single cells** through the same hooks the chunk cache uses.
- **A new world resets it.**

The margin covers the top light's 12 rows of context above the view. The shader derives top-light
seeds and sky heights from the window itself.

**The frame graph:**

1. **Rock:** compute passes over the band of cells under the view (mask, jump flood, shade), as in the
   spike.
2. **Present:** one screen-space fragment pass composites, in the order the Canvas 2D frame draws them:
   - the rock scene, offset by the camera;
   - the **2D overlay** — damage cracks, twinkle, dust, particles, the player, floaties and the reticle,
     still drawn by the existing code onto the game canvas, now kept transparent and uploaded as a
     texture each frame;
   - the additive glow, the dithered scrim and the vignette, from the same light field.

   The scrim still darkens the player and the particles, as it does today.

3. **Chunk bakes don't run.** The rock is shaded fresh every frame, so the chunk cache and its Worker
   sit idle in GPU mode.

**Measured** with `pnpm probe` at a 3400×1900 window, walking right for 4 seconds:

| Renderer   | Main thread per frame                                            | Rock bakes while walking                             |
| ---------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Canvas 2D  | 3.9 ms — lighting 3.1 (scrim 2.5), chunks 0.5                    | 536 bakes, 84 still queued: the Worker can't keep up |
| **WebGPU** | **2.9 ms** — light field 1.3, GPU frame incl. overlay upload 1.2 | **none**; GPU work finishes in ~2.8 ms               |

Two things the integration turned up, both fixed:

- **Digs were still re-baking chunks.** The chunk cache re-bakes a dug cell's chunk synchronously
  (about 8 ms on the main thread), and it was still told about every dig in GPU mode, where no chunk is
  ever drawn. Dig notifications now go only to the renderer that's drawing the rock.
- **Startup baked ~70 chunks for nothing.** While WebGPU is starting, no rock is drawn at all. Those
  frames sit behind the title screen.

The debug overlay's `renderer` line names the path and adapter, the GPU finish time, and the world
window's size and version.

**The 2D drawing is three layers, not one** ([#75](https://github.com/inman-sebastian/agent-games/issues/75)).
The Canvas 2D frame draws damage cracks, then twinkle glints with `lighter` (adding light), then dust,
particles, the player, floaties and the reticle. So in GPU mode each group gets its own transparent
canvas:

- **under** holds damage, composited source-over;
- **glint** holds twinkle, drawn `lighter` onto transparent pixels, which leaves exactly the light
  each glint adds as premultiplied colour. It is **added** to the frame, so glints brighten as they do
  in Canvas 2D and stay under the player;
- **over** holds everything else, composited source-over as before.

Damage and twinkle only appear inside the lamp's reach, so **under** and **glint** upload only the
lamp's box, a few hundred pixels square, instead of the screen.

**Checked in `gpu-lab`**, which draws twinkle on both paths at a fixed `?time=`.
`gpuLab.glints()` reads the CPU and GPU colour at every glint pixel:

- **Match:** a ruby glint's five pixels are identical with lighting off, and within one level with
  lighting on.
- **Negative control:** compositing glints source-over instead, as before #75, makes those pixels up to
  41 levels dimmer than Canvas 2D.
- **Whole frame, lit, with the glint:** 99.998% within 8 levels, and three outliers, all rock
  threshold flips.

**Ores are on the GPU too** ([#73](https://github.com/inman-sebastian/agent-games/issues/73)):

- **Every material has a WGSL twin**, and the compositor ports the feathered material blend; see
  MATERIALS.md's _GPU twins_.
- **Parity, measured with `gpu-lab` (lighting off) at seven depths covering every ore band:**
  99.94–99.99% of pixels identical and ~99.99% within 8 levels, with 12–16 threshold-flip outliers per
  130,560 pixels, the same float32 cause as the rock alone.
- **GPU validation errors surface.** A shader that fails to compile doesn't throw, it just draws
  nothing. The renderer keeps the first error, and both the debug overlay's `renderer` line and the lab
  HUD show it, so `probe` can read it.

**Known differences from Canvas 2D, each a later child of #68:**

- **Sprites and particles are rasterised by Canvas 2D** and uploaded, not drawn by the GPU.
- **The sky is one gradient across the screen**, not one per chunk, so #54's banding doesn't happen.
  That's a difference in the GPU path's favour.

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

The world grid is **cells** of 8×8 art px, and four cells make a **block** of 16×16 — the unit the
materials were authored at and the one the world is generated on ([DESIGN.md](DESIGN.md#block-granularity--the-22-split-done)).
The scene renders to a **logical** buffer at art resolution and is displayed at an **integer scale**
(`UPSCALE` = 2: 16 on-screen px per cell, 32 per block), with `image-rendering: pixelated` handling
the device's own pixel density. Do **not** render the whole scene at the device scale —
that would multiply the (per-pixel) lighting cost for no visual gain.

The canvas **fills the viewport edge-to-edge**: `fit()` sizes it to the window in whole cells (plus
one of overscan), centred, so cells stay square with no letterboxing. The world renders past its
playable edges (DESIGN.md: the player never sees an edge), so the canvas is a camera window onto it,
not a view of a fixed field; its size is capped
(`MAX_VIEW_TILES`, in cells) only so a huge window can't ask for an unbounded canvas. The HUD floats as an **overlay** on top, not in a chrome bar.

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
   - vignette). Ore does **not** cast its own light.

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
  renderer up close. It wants the same `DITHER_STEPS`-style ordered dither as the scrim.

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
  _different rate_ than the world, so its appearance depends on the **camera**, not the tile — so it
  needs its own per-frame pass (or a cache keyed by camera offset), not a place in `composeBand`.
  The same is true of the time-varying sky.
- **Lamp-only visibility fights background detail underground.** The ambient floor is zero and the
  scrim reaches full on an unlit pixel ([LIGHTING.md](LIGHTING.md)), so anything beyond lamp reach
  is _black_ — including background layers. Underground parallax therefore only reads inside the
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
