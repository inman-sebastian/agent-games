# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage** ([#90](https://github.com/inman-sebastian/agent-games/issues/90)). Terraria's liquid,
> ported and verified against Terraria's own code, in its lab (`client/labs/liquid-lab.html`). It isn't in
> the game yet. Everything tried before it, and why it failed: [FLUIDS-HISTORY.md](FLUIDS-HISTORY.md).

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## The decision

**The author (2026-09-14): a 1:1 recreation of Terraria's fluids.** Its behaviour exactly, quirks included —
pools filling from where liquid lands, levelling in soft steps, thin films and trickles that linger, the odd
unit of water created or lost. Earlier attempts to improve on Terraria (pressure, flat pools, exact volume)
each produced artifacts of their own; see the history. Where DELVE differs, it's listed under
_Deviations_, and nothing else may.

**The look is DELVE's (the author, 2026-09-14):** the simulation and the shapes it draws are Terraria's; the
colours, edges and light follow DELVE's art direction ([RENDERING.md](RENDERING.md), [PALETTE.md](PALETTE.md)):
whole palette pixels and no smooth gradients, a top-lit rim, water you see the cave through, and lava that
glows and lights the dark. See _The look_.

## The simulation — `shared/src/terraria-liquid.ts`

A port of Terraria 1.4.0.5's `Liquid.cs` and `LiquidBuffer.cs`: `Update`, `UpdateLiquid`, `AddWater`,
`DelWater`, `AddBuffer` and `DelBuffer`, statement by statement, in Terraria's order.

- One liquid tile per DELVE dig cell (the cell is DELVE's tile: what the player digs). Levels 0–255.
- Liquid moves only through the active list, processed in 7 slices per cycle (`cycles` at full graphics
  quality), with the kill sweep, the overflow buffer and the stuck flush.
- **30 updates a second**: Terraria calls `UpdateLiquid` every second world update.
- A dug or built cell, and liquid poured in, frame the 3×3 around it column by column, as
  `WorldGen.SquareTileFrame` does; that's the order those tiles join the list.
- `WorldGen.genRand` (one use: 254 → 255 one time in 30) is a seeded xorshift, so runs are deterministic.

## The renderer — `client/src/fluid/terraria-liquid-render.ts`

A port of `LiquidRenderer.InternalPrepareDraw` and `InternalDraw`: gap fill, the waterfall trail (10 tiles
under water, 3 under lava), walls and edges and the frame they pick, edge smoothing, the corner fixes and
inner corners, then each tile's source rectangle, offset and opacity. The cache is kept from frame to frame,
as Terraria keeps it, so a hidden tile keeps the walls it last had.

**The texture is DELVE's, on Terraria's layout.** Terraria's liquid texture is pixel art drawn at 2×: 24 × 40
pixels a frame (8 a tile), which is exactly DELVE's art pixel. DELVE's (`texel`) has the same geometry:

- rows 0–2 an edge block, rounded at the top corners and open at the bottom, with a narrow two-sided column
  cut into its middle; row 3 the column's sides flaring into a surface line (inner corners); row 4 body;
- an edge is two pixels, and each pixel knows whether it's on a **top** edge or a **side** edge;
- 16 animation frames at 6 a second (Terraria's rate without wind): a shimmer of pixels drifting just under
  top edges; a separate unanimated surface frame, which underground tiles with a plain top edge use.

**The picture refreshes every second liquid update.** Terraria renders liquid into a render target
(`Main.waterTarget`) on one frame in four (`Main.renderCount`, advanced each frame by the lighting pass) and
draws that target every frame. At 60 frames a second with liquid every second frame, that's once every second
liquid update, always at the same point of the cycle. It matters: a stream pouring over a lip alternates
between two states from one update to the next, and drawn every update it flickers where it leaves one pool
and where it lands in the next. The renderer keeps a water target per liquid, re-rendered when the update
count reaches a new even number, and paints it every frame (`client/src/fluid/terraria-liquid-render.test.ts`
fails if the picture changes on an odd update).

### On the GPU (#96) — `client/src/render/gpu/liquid.ts`, `liquid.wgsl`

Everything drawn is on the GPU ([RENDERING.md](RENDERING.md#direction-webgpu)); the TypeScript renderer
stays the reference it's gated against, and the labs' renderer.

- **The per-cell plan stays on the CPU**, as the light field's plan does. Terraria's draw cache is a run of
  order-dependent passes (the waterfall trail's last writer wins, the corner fixes read neighbours the same
  pass just changed) that the oracle checks exactly, and it costs a fraction of a millisecond on a screen of
  cells. So `planLiquid` builds, per cell, what's drawn there: the tile's source rectangle and offset in
  this animation frame, whether the tail rule draws it, and the rectangle behind a slope. Both renderers read
  that one plan. It's rebuilt when the picture refreshes (every second liquid update).
- **Every pixel is WGSL**, in three compute stages: **kinds** (the texel from the tile's rectangle, the gap
  and side-edge settling, liquid behind slopes), **heat** for lava, and **colour** (see-through water from
  the brightness of the scene under it; lava's molten surface), which runs every frame because both move.
- **Heat is a relaxation, not jump flooding.** Heat is the distance to open air **through** the lava, with
  rock a barrier, which jump flooding (nearest seed, ignoring what's between) can't respect. Each step, every
  non-rock pixel takes the least of itself and its four neighbours plus one, as the light field relaxes. The
  steps stop at the deepest cooling depth (73 px): past it heat is zero whatever the distance. The reference
  measures the same distance, breadth first (`surfaceDistance`).
- **Gated** (`liquidLab.gate()` in `client/labs/liquid-lab.ts`, run by `pnpm render-gate` after the rock's gate).
  Ten views — the reservoir, the breaches mid-flow and later, a U-bend, three gaps, a pool over a cave, the
  slopes scene, and lava twice — are stepped to a set update, drawn by both renderers, and diffed. A view fails
  past 0.1% of pixels off by more than 3 levels or under 99.9% identical, and a **water** view fails if more
  than 2 pixels differ at all: water is integer logic but for one brightness threshold, and its rarest features
  (the shimmer, a gap filled inside a moving body) are a handful of pixels a frame, which the fractions can't
  see. Measured: every water view identical, lava 99.997–100% (noise on float thresholds). Red-checked: 20 fewer
  heat steps, no liquid behind slopes, the see-through threshold moved, lava's noise weight changed, the
  shimmer's hash changed and the gap fill removed each fail it.
- **Cost**, at a 3400×1900 window (1696×944 art px), gate timings: a refresh (plan upload, kinds, 73 heat steps)
  8–19 ms of GPU, once per refresh; a colour 15–34 ms including a 6 MB readback the game won't do. The heat steps
  cover the whole picture; confining them to the lava's box plus the cooling depth is the next saving, when
  liquid is in the game.

## The look

Everything is whole pixels of the [Resurrect 64](PALETTE.md) ramps below: no translucent blends and no smooth
gradients. Water and edges are flat palette colours; lava's transitions use the rock's Bayer dither.

- **Hard edges.** Terraria's waterfall trail — ten tiles of fading copies under falling liquid (three under
  lava) — is still computed, because the oracle checks it, but where it only fades into the air (a tail) it
  isn't drawn: it read as a smooth gradient, and its per-tile opacity steps as a checker. Where it bridges a
  gap to more liquid further down the stream, it's drawn solid, so a falling mass has no holes. Two things follow
  from not drawing the tails, both handled at paint time: a face that Terraria left unedged (its trail beside
  it counted as liquid) gets its side edge where the cell beside it is open air with nothing drawn; and the
  pixels a partly filled tile leaves uncovered inside the body (a drawn cell under a drawn cell, closed in
  either side) are body, not holes.
- **Top-lit rim, dimmer sides**, as rock is lit from above: a top edge is **Surface** outside and **Light**
  inside; a side edge is **Light** outside and **Mid** inside. The shimmer runs just under top edges.
- **Water is see-through, in palette.** A water body pixel takes the water ramp colour that matches the
  brightness of what's behind it: dark behind → **Deep**, the cave wall → **Body**, bright → **Mid**. The cave
  reads through the water as shapes in blue, and every pixel stays a palette colour. The split points are tuned
  to the Stone background's two wall tones; each stratum's background will want its own.
- **Lava is a molten surface**, in the same language as the rock ([MATERIALS.md](MATERIALS.md#shared-visual-language--surface-classes-non-negotiable)):
  `moltenSurface` lumps a heat field with world-anchored value noise, quantises it into lava's six-stop ramp
  (`LAVA_BANDS`: `#6e2727 #ae2334 #e83b3b #fb6b1d #f79617 #f9c22b`) with the shared Bayer dither, and moves: the
  molten blobs drift, and a crust of darker plates floats on the hot top, split by glowing seams. **Heat** is
  the geometry's say, like rock's top-light: hottest at the surface line (`#f9c22b`), cooling with each pixel's
  **distance to open air** (`surfaceDistance`: breadth first, in 4-connected steps). Open air is judged by pixel:
  nothing drawn and not rock, so the empty top of a partly filled tile counts and heat starts where the lava
  does, while a cell the sim briefly empties inside moving lava (drawn filled) doesn't. Rock is a barrier, so air
  behind a wall never warms the lava in front of it. Measured in 2D, heat changes by at most a step between
  neighbours, so it wraps smoothly round every step and corner of the surface — measuring down columns and along
  rows left hard lines at corners and where tiles were filled to different heights. It cools over about 56 art px, along a
  wandering line to a calm, solid dark body (it sits exactly on a band, so there's no dither checker,
  and its texture fades with the heat — the rock's rule that grit reads busy).
- **Lava is emissive.** It's drawn after the lighting pass, so darkness never dims it, and every lava tile open
  to the air above or beside it is a **light**: a lamp-field emitter in lava orange (`LAVA_LIGHT`), so lava
  lights the cave out of the void by the same rules as the miner's lamp ([LIGHTING.md](LIGHTING.md)) — pooling
  down open space, dying a couple of blocks into rock. Water isn't emissive; it's lit and darkened like the rock
  around it.

**Palette (Resurrect 64).**

| Role     | Water     | Lava      |
| -------- | --------- | --------- |
| Deep     | `#323353` | `#6e2727` |
| Body     | `#484a77` | `#ae2334` |
| Mid      | `#4d65b4` | `#e83b3b` |
| Light    | `#4d9be6` | `#fb6b1d` |
| Surface  | `#8fd3ff` | `#f9c22b` |
| Foam     | `#c7dcd0` | `#fbff86` |
| Specular | `#ffffff` | `#ffffff` |

The Deep Stone stratum's ramp is this same blue, so water may vanish against it; **T** in the lab swaps to
the teal ramp to compare.

## Verification — the oracle

Nothing here is checked against a reading of Terraria's code: it's checked against the code running.

- **The harness** (`tools/terraria-oracle/harness/`) compiles Terraria 1.4.0.5's decompiled `Liquid.cs`,
  `LiquidBuffer.cs` and `LiquidRenderer.cs`, unmodified, against minimal stubs (`Stubs.cs`: tiles, the
  3×3 framing, a seeded `genRand`). `Program.cs` runs each scene in a world with a 10-tile rock margin and
  writes every tile's level, the active list's size, and every tile's draw entry (source rectangle, offset,
  trail opacity, surface frame), with the water rendered once every second update, as the game renders it.
- **The scenes** (`tools/terraria-oracle/scenes.json`): a dropped block, full and partial breaches, three
  gaps, a pool drained into a cave, pouring, a U-bend, terraces, digging inside a moving pool, digging inside
  a settled pool, a breach big enough to fill more than a slice of the list, a lava breach, and an overflow
  past the list's 25,000 entries.
- **The tests** (`tools/terraria-oracle/liquid.test.ts`, `render.test.ts`) replay every scene through the
  ports and require **exact** equality with the oracle at every snapshot: levels, list size and draw
  entries. Each fix below was seen failing its scene first.

**What the oracle found in the earlier port**, each invisible to the tests that came before it:

- the 7- and 5-tile averages set their neighbours in the order −3…+3; Terraria's is −1, +1, −2, +2, −3, +3;
- a changed tile woke its 3×3 row by row; Terraria's framing goes column by column;
- the overflow buffer queued tiles without marking them and emptied first-in-first-out; Terraria marks them
  and moves the last entry into the first;
- the sim ran at 60 updates a second, to match on-screen speed; Terraria's rate per tile is 30;
- the renderer's texture was a single static frame of one-pixel lines, and darkened with depth.

**Terraria behaviours the oracle confirms**, which look like bugs and aren't: a drained pool leaves films of
1–3 levels that trickle down a shaft long after (the pool-over-a-cave scene still has 32 active tiles after
400 updates); breaches and pours create or lose a few units; a U-bend never levels.

To regenerate: run `tools/terraria-oracle/harness/fetch.sh` (it fetches `Liquid.cs`, `LiquidBuffer.cs` and
`LiquidRenderer.cs` from the 1.4.0.5 decompile, [AliceSavard/Terarria1405](https://github.com/AliceSavard/Terarria1405),
and extracts the Smooth World pass, the player collision methods and `DrawTile_LiquidBehindTile` for
[SLOPES.md](SLOPES.md) — Re-Logic's code, `.gitignore`d), then, with the
.NET 8 SDK, `dotnet run -c Release -- ../scenes.json out.json` and gzip `out.json` to `oracle.json.gz`.

## Deviations

- **Liquid is drawn behind rock.** Terraria's tiles are whole squares; DELVE's rock mask erodes into open
  cells, and liquid isn't drawn over those pixels (the author asked for no wetting of the rock's edge).
- **The look** (above): the waterfall trail isn't drawn; edges are top-lit; water is see-through in palette
  rather than 60% translucent; lava is emissive and lights the cave through DELVE's lighting rather than
  Terraria's corner-light tint.
- **No wave shader, no lava bubbles.** Terraria distorts liquid with a wave filter and spawns lava dust.
- **Liquid behind slopes** is Terraria's rectangle clipped to the slope's open half, in DELVE's look
  ([SLOPES.md](SLOPES.md)).
- **Left out because DELVE doesn't have them:** half bricks, platforms, honey, water–lava reactions
  (one liquid per simulation for now), underworld evaporation, multiplayer sync, panic mode.

## The lab

`client/labs/liquid-lab.html` starts on the port. A scene starts as the oracle's do: its tiles filled, then
every wet tile on the list column by column. Scenes: reservoir, full breach, partial breach, three gaps, gap
under water, pool over a cave, lava breach, U-bend, slopes (sloped banks and a shelf with a sloped underside, [SLOPES.md](SLOPES.md)), terraces. **S** (or `?sim=pipes`) switches to the cell
pipes for comparison. **L** toggles DELVE's lighting: lamp-only darkness with the lamp on the pointer, and
lava's light.

## Not built yet

- **World integration.** The step on the server's tick; digging frames the tiles around it; the GPU pass in
  the game's renderer, reading the rock mask and the composed scene it already has.
- **Netcode.** Terraria sends changed tiles by chunk (`NetLiquidModule`); the same, to the clients that see
  them.
- **Reactions.** Water meeting lava makes obsidian (`LavaCheck`).
- **Static bodies, breath, running to completion on resume** (the epic).
