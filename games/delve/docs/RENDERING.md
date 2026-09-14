# DELVE — rendering

How the cave picture is built, from the atmospheric wall at the back to the ore
crystals on top. All art is drawn in code (canvas, no images/emoji/fonts-as-art) on
a **logical-resolution buffer that is upscaled with `image-rendering: pixelated`**,
so every effect — including gradients, glows and vignette — stays chunky pixels.

## Direction: WebGPU

**Decided by the author (2026-09-13): rendering moves to WebGPU, with as much as possible on the GPU in
shaders.** Tracked in [#68](https://github.com/inman-sebastian/agent-games/issues/68); the spike that
measures it first is [#69](https://github.com/inman-sebastian/agent-games/issues/69).

**When this was decided, everything described below ran on Canvas 2D**, and the expensive parts were
hand-written per-pixel JavaScript loops into `ImageData`: the rock mask, its distance fields and top
light, the stone surface and every material "shader", the lighting glow, the dithered scrim and the
vignette. A chunk cache, a bake Worker and the lighting cost caps existed to make that affordable. Those
loops were already pure functions of position, material, light and time, which is exactly what
fragment and compute shaders run in parallel. The game now renders only through WebGPU (#77, #80); the
TypeScript versions remain as the reference the GPU is gated against and as the labs' renderer.

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
  the scrim and the vignette. **What needs a GPU-native technique:** the chamfer distance
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
- **A frame is 12 passes** in the spike: mask; jump-flood init and 7 steps; shade; light; present.
- **Techniques that changed**, all without measurable cost to the look:
  - The chamfer edge-distance sweep became jump flooding with the chamfer metric.
  - The top-light depth became a bounded 36 px upward scan, exact because brightness has clamped by
    then.
  - The contact-shadow distance became a ±2 px window, exact for the same reason.
- **The light propagation stayed on the CPU** in the spike (`LightingInstance.field`, split out of
  `render` so both renderers read one field). It cost 0.8 ms then; it moved to the GPU in #82 (below).

**Tooling.** probe's headless Chrome exposes a Metal adapter. `pnpm probe --shot` captures WebGPU
pages, which `shot.sh` (with `--disable-gpu`) can't; `probe --no-gpu` shows the WebGPU required screen. The lab's `window.gpuLab.runDiff()` reads the GPU
frame back and diffs it for probe.

**What the spike surfaced for the epic:**

- **Per-row strata ramps come free.** Chunks pick one ramp per band from its centre row, which is the
  seam #54 describes. The GPU shades every pixel with no chunks, so the ramp can follow the row.
- **The material shaders are the real porting cost.** There are 13 JavaScript `shade(ShadeCtx)`
  functions, plus the feathered material blend. The contract maps onto one WGSL function per material,
  selected by id, and the `delve-new-material` skill has to change with it.
- **The render gates need a new basis.** Done in #80: see [The render gate](#the-render-gate-80).
- **Unsupported browsers.** The renderer throws `GpuUnavailable` with a sentence for the page. The
  unsupported-browser screen is renderer-core work.

### Renderer core in the game (#71)

**WebGPU is the renderer, and it's required** ([#77](https://github.com/inman-sebastian/agent-games/issues/77)
— the author's decision, once the GPU path had no remaining known visual differences).

- **No silent fallback.** A browser without WebGPU — or one whose GPU device is lost mid-game — gets a
  **WebGPU required** screen: a terminal `unsupported` app state that says why and offers a reload.
- **There is no Canvas 2D mode in the game.** A `?renderer=2d` developer switch kept it reachable
  until #80 retired the chunk cache, its Worker and the switch, once the
  [render gate](#the-render-gate-80) no longer needed the game's CPU path.

**The world lives on the GPU as a window, not per frame.** `gpu/world-window.ts` keeps a CPU mirror of
cell solidity and surface heights for the view plus a margin, and uploads it whole. The upload is tens
of kilobytes and costs nothing. The spike's 3.7 ms was the _world queries_, and the window removes
them:

- **Scrolling shifts the mirror** and queries only the strips entering it.
- **Digs, including the server's, update single cells** (`worldWindow.dig`).
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
     texture each frame (since split: damage and twinkle into their own layers in #75; dust, particles,
     the player and the reticle into the entity pass in #83, below);
   - the additive glow, the dithered scrim and the vignette, from the same light field.

   The scrim still darkens the player and the particles, as it does today.

3. **Nothing is baked.** The rock is shaded fresh every frame. (At #71 the chunk cache and its Worker
   still existed and sat idle in GPU mode; #80 deleted them.)

**Measured** with `pnpm probe` at a 3400×1900 window, walking right for 4 seconds:

| Renderer   | Main thread per frame                                            | Rock bakes while walking                             |
| ---------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Canvas 2D  | 3.9 ms — lighting 3.1 (scrim 2.5), chunks 0.5                    | 536 bakes, 84 still queued: the Worker can't keep up |
| **WebGPU** | **2.9 ms** — light field 1.3, GPU frame incl. overlay upload 1.2 | **none**; GPU work finishes in ~2.8 ms               |

Two things the integration turned up, both fixed:

- **Digs were still re-baking chunks.** The chunk cache re-baked a dug cell's chunk synchronously
  (about 8 ms on the main thread), and it was still told about every dig in GPU mode, where no chunk is
  ever drawn. Dig notifications then went only to the renderer drawing the rock; #80 removed the cache.
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

### Light propagation on the GPU (#82)

The per-cell light field is computed in `gpu/light.wgsl`, reading solidity from the world window.
The CPU keeps only the **plan** (`lighting.ts` `planField`): the grid window, the seeds, the reach and
the sweep box. `buildField` starts from the same plan, so what seeds where and how far light is looked
for has one home. The frame gains three compute stages:

1. **Seed** the grid from the emitters.
2. **Relax** `reach` Jacobi steps, rounded up to even, ping-ponging two buffers. Each cell in the sweep
   box takes the max of itself and each of its 8 neighbours times the destination cell's attenuation,
   with `DIAGONAL_ATTEN` on diagonals.
3. **Finish** into the glow bytes and brightness `present.wgsl` already read, with `lighting.ts`'s
   caps and `Uint8ClampedArray` rounding. The constants are generated from `lighting.ts`.

**Why Jacobi steps rather than the four corner sweeps.** A sweep is sequential: each cell reads the
neighbours the same sweep just wrote. A relaxation step reads only the previous step, so every cell
runs at once. After `reach` steps every path still carrying more than `PROPAGATION_EPS` has been walked.
The best path to a cell runs diagonal-first (a diagonal step costs ×0.95, a detour a whole extra step
at ×0.84), so its length is the Chebyshev distance and the two methods agree to rounding. The
render gate's lit views compare against the CPU sweeps.

**Measured** at 3400×1900 while walking and digging:

- Main thread per frame: 2.42 ms → **1.46 ms**. The `lighting` phase went from 1.6 ms to 0.0.
- GPU finish time: 3.4 ms → 3.8 ms.

**Dormant branch.** The hue cap (`ADD_MAX`) is ported but never engages with one lamp: its peak
additive is 0.37 against a cap of 0.5. The gate can't see it until something brighter emits.

### Sprites and particles on the GPU (#83)

Everything that moves is drawn by an **entity pass**: one instanced render pass (`gpu/quads.wgsl`) into
an `entities` texture. `present.wgsl` composites it source-over, after damage and twinkle and before
the overlay, which is where Canvas 2D drew them. The game builds a `QuadBatch` (`gpu/quads.ts`) each
frame, in draw order:

- **Dust motes, dig particles and the mining reticle** are solid quads with alpha, as `fillRect` under
  `globalAlpha` drew them. The reticle is `quads.outline`: four edges that touch without overlapping,
  exactly what `strokeRect` at line width 1 covers, so a translucent corner isn't doubled.
- **The player** is a textured quad from a **sprite atlas**. `player.ts` still rasterizes each distinct
  frame once (the material shading per pixel is unchanged; see SPRITES.md). `placePlayer` hands the
  baked canvas and its cache key to `renderer.sprite`, and a shelf packer (`createShelfPacker`,
  property-tested for overlap and bounds) uploads it into a 2048² atlas the first time the key is seen.
  From then on a frame costs one quad. A full atlas starts again from empty.

Quads are premultiplied and blended one / one-minus-src-alpha, and a textured quad copies texels 1:1 at
whole-pixel positions, so sprite edges stay hard.

**The floating reward text stays on the 2D overlay.** Text on the GPU would need a glyph atlas for no
gain. The overlay is cleared and uploaded only on frames that have text; it used to be a full-screen
upload every frame.

**Measured** at 3400×1900 while walking and digging: main thread 1.46 → **1.17 ms**.

**Gated.** gpu-lab draws a player, 48 particles at mixed sizes and alphas, and the reticle on both paths:
Canvas 2D the way the game used to, quads on the GPU. Every gate view covers them. The whole-frame bar
couldn't see a few hundred pixels (unpremultiplied particles passed it), so the gate also checks an
**entity box** around them: at most 0.5% of its pixels off by more than 3 levels. Clean views measure at
most 0.12%. Red-checked:

- unpremultiplied particles fail at 1.3% of the box;
- particles 20% fainter fail at 1.2%;
- the sprite read one atlas texel off fails the identical bar;
- skipping the entity pass fails everywhere.

**Known differences from Canvas 2D, each a later child of #68:**

- **The reticle draws under the floating text**, where Canvas 2D drew it over. The two rarely meet.
- **The sky is one gradient across the screen**, not one per chunk, so #54's banding doesn't happen.
  That's a difference in the GPU path's favour.

### The render gate (#80)

The GPU renderer is checked against `composeBand`, the TypeScript renderer, which acts as the golden
image. There are no stored PNGs to re-bless: an art change needs its TypeScript and its WGSL twin to
agree. `gpuLab.gate()` in `client/labs/gpu-lab.ts` renders each view both ways and diffs them:

- **Seven strata views**, rows 26, 120, 400, 700, 1000, 1250 and 1385 (near the surface down to the
  bedrock above the floor at row 1400), each unlit and lit.
- **One unlit view per registered ore material**, found by scanning `oreAt` for a pocket and centred
  so the pocket sits exposed on the carved tunnel floor, where the top light reaches it. A new material
  is covered with no edit to the gate.

**It fails when:**

- any view has more than 0.1% of pixels off by more than 3 levels;
- any unlit view is under 99.9% identical;
- no view drew a twinkle glint, so the additive blend went unchecked;
- any view has more than 0.5% of its entity box off by more than 3 levels (#83, below);
- or the GPU reported an error.

It sets `document.title` to `PASS` or `FAIL` and returns `{ pass, failures, views }`. Each view carries
its `identical` and `withinSmall` percentages, its `mean` difference, a `histogram` of differences (0–8,
then everything above), the same for the entity box (`entityHistogram`) and its `glints`.

The lit bar was "99.8% within 8 levels" until #82 showed it was too blunt for light. The glow's
bilinear rounding puts a level or two of difference over most lit pixels, so "identical" says nothing
there. And a light that stopped at half its reach only moved the dark edge by a dither step, still
inside 8 levels. Past three levels is where a real change shows: ≤0.01% of pixels in a clean lit view,
0.4% for half the propagation steps, 1.2% for rock conducting like open space.

**Why fractions, not a maximum difference.** A few hundredths of a percent of pixels sit on a
float-rounding edge (a quantise threshold, a distance tie) and land on a neighbouring band, sometimes
far off, so a max limit fails on noise. A material drifting from its twin moves whole regions.
Measured at #80: every unlit view ≥99.96% identical.

**Red-checked.** Making any one material's WGSL twin return grey on its lit faces fails the gate in
that material's own view, for all 12 (copper, iron, silver, gold, emerald, ruby, diamond, mythril,
platinum, obsidian, quartz, stonebricks). A subtle change to copper's noise weight (0.42 → 0.30) also
fails. For the light (#82), halving the propagation steps and making rock conduct like open space
each fail every lit view.

Run it with `pnpm render-gate` while `pnpm dev` is running; it exits 1 on failure. It isn't part of
`pnpm test`, because Node has no WebGPU, so run it before handing over any change to `render/`, a
material or a WGSL file. How to read its output: [tools/README.md](../tools/README.md#pnpm-render-gate--the-gpu-against-its-reference).

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
   for open space, plus a subtle **contact shadow** where rock meets the background. A cell is full or
   a **slope** ([SLOPES.md](SLOPES.md)); the per-pixel mask cuts a slope's open corner and erodes its diagonal
   like any edge. (Stalactites and stalagmites left this layer: they return as biome decorations —
   [JUICE.md](JUICE.md#surface-decoration-planned).) Ore
   is **baked into this layer** through each ore's material shader (feathered into the
   strata — see _Foreground rock & materials_ below), **not** a separate overlay.
3. **Overlays (per-frame)** — animated FX drawn over the cached rock: each exposed, lit
   vein's **twinkle**, **mining-damage** cracks on tiles taking hits, the miner, particles,
   then the **lighting pass** ([LIGHTING.md](LIGHTING.md)) last (lamp glow + darkness scrim
   - vignette). Ore does **not** cast its own light.

Layers 1–2 are specified by `composeBand` in `cave-render.ts` and shaded on the GPU every frame by its
WGSL port (see [ARCHITECTURE.md](ARCHITECTURE.md#how-the-rock-reaches-the-screen)); the overlays
composite on top. A dig updates one cell of the world window, and the next frame shows it.

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
be a pure function of world position (see below).

## Background depth & parallax

**Planned direction.** More background detail is wanted **both above and below ground**, with real
**parallax layers** — the background layer was built with that in mind, and the faint distant-rock
silhouettes (`BG_SILHOUETTE_*`) are the primitive version of it.

Two constraints worth knowing before building it, because they shape the implementation:

- **Parallax isn't a function of world position.** Layers 1–2 are shaded as a pure function of world
  position (what the retired chunk cache relied on, and what the render gate compares). A parallax layer
  moves at a _different rate_ than the world, so its appearance depends on the **camera**, not the
  tile. With the rock shaded every frame there's no cache to fight any more, but it still doesn't
  belong inside `composeBand`'s world-space contract. The same is true of the time-varying sky.
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
- **Baked, not overlaid.** Ore is composited into the rock via
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
