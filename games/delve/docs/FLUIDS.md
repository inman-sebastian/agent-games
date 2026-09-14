# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage** ([#87](https://github.com/inman-sebastian/agent-games/issues/87)). The simulation
> is a GPU compute pass (`client/src/render/gpu/fluid.wgsl`) with a TypeScript twin
> (`client/src/fluid/rule.ts`), exercised by `client/labs/fluid-lab.html`. It isn't in the game yet. The
> numbers here are lab defaults to tune, not decisions.

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## Decisions (2026-09-14)

- **Fluid is made of art pixels.** Every art pixel (8×8 per cell, 16×16 on screen) holds water, lava or
  nothing. This replaces the whole-cell rule. After four grid models (see _History_), the author chose
  to try a pixel liquid instead.
- **It runs on the GPU.** A pixel grid around the player is hundreds of thousands of pixels, stepped
  several times a frame. That's a compute shader's job, not a JavaScript loop's.
- **Single-player first.** The server is authoritative and runs Node with no GPU, so a GPU sim can't be
  the shared ruleset. The sim runs client-side for one player, and replication will be decided later,
  from a working sim with real numbers. Until then, fluid doesn't block or harm the player.
- **The TypeScript twin is the reference.** As with the rock and the materials, the WGSL rule has a
  TypeScript twin that Vitest property-tests, and the lab checks the GPU matches it bit for bit. The
  rule is integer-only and its randomness is a hash of position and pass, so the two can agree exactly.

## What four whole-cell models taught

The whole-cell prototypes ([#66](https://github.com/inman-sebastian/agent-games/issues/66), closed PR
[#67](https://github.com/inman-sebastian/agent-games/pull/67)) failed on look, but they taught rules
that don't depend on the grid's resolution. The pixel model is built on them:

1. **Gravity first, and falling liquid never levels.** A stream stays a stream until it lands.
   Treating falling fluid as part of a pool grew wedges in mid-air.
2. **Nothing spreads sideways unless it's supported.** A move sideways starts from liquid standing on
   something. Going past an edge is a spill, and the next pass it falls.
3. **Viscosity is slowness in time, never shorter reach.** Lava's shorter search distance is what
   heaped it into mounds. Lava follows the same rules as water, just less often.
4. **Surface liquid mustn't skate forever or jitter.** Landing water slid across a pool looking for a
   place to settle, and cells moving sideways at the same height jittered.
5. **Mass is conserved exactly, by construction,** not by clean-up passes that delete or round.
6. **Test shapes in motion,** not only settled ones. Every whole-cell bug was a shape mid-flow that no
   settled-state test could see.

## The model — head, fall, flow

**Why blocks.** A GPU updates every pixel at once, so two liquid pixels can't both be allowed to move
into the same empty pixel. The standard answer for GPU falling-sand is the **Margolus neighbourhood**:
tile the grid into 2×2 blocks, and on alternate passes shift the tiling by one pixel on both axes. Each
block's rule only rearranges the four pixels inside it, so mass is conserved exactly and nothing moves
twice. Every stage below reads only the stage before it, so the GPU and the TypeScript twin agree
exactly.

**A pixel's state** (a `u32`): its **kind** (empty, water, lava), a **direction** (left or right) and an
**energy** (0–255). Rock isn't a state. It's the rock's own eroded pixel mask, the same one the renderer
draws (`buildMask` / `mask_main`), so liquid meets the stone's visible edge. Outside the grid counts as
rock.

**A pass is three stages** (`rule.ts`):

1. **Head.** `headSteps` (4) relaxation steps of a **hydraulic head** field, the height of the surface
   of the body a pixel is part of.
   - Head flows only through **resting** liquid (liquid standing on something), so a falling stream
     never pressurizes the pool it lands in (lesson 1).
   - A step costs 1/256 px sideways, 1 px up and nothing down. Every cycle costs something, so a head
     left behind by a drained surface climbs back to the truth instead of circulating. The sideways cost
     is tiny because it's how far out of level a settled body can stay: at ¼ px a wide pool froze three
     pixels terraced; at 1/256 it settles flat.
   - A pixel is **under pressure** when its body's surface stands **more than one pixel** above it.
     One pixel isn't pressure: a stray pixel on a pool's partial top row would otherwise push the
     pixel under it into the row's gaps forever (found by the basin property).
2. **Fall.** A run of liquid (up to 64 px) over an empty pixel falls one pixel, **all of it at once**.
   - Every pixel of the run finds the same bottom, so the run moves together and a stream stays whole
     instead of scattering into dots.
   - The run's bottom pixel rolls its kind's chance, so lava falls a quarter as often.
3. **Flow**, one Margolus block pass, in this order:
   - **Lava sinks** through water.
   - **Diagonal slide:** liquid over something moves to the empty diagonal below, past an empty side.
   - **Sideways flow**, only for liquid **standing on something** (lesson 2):
     - Under pressure, it flows toward the open side, at full energy.
     - At the surface, it flows the way it faces while it has energy, spending one per pixel.
       Turning around when blocked costs energy too, so surface liquid runs and then stops (lesson 4).
     - Out of energy, it still flows toward a **drop it can see**: an empty pixel over empty space
       within `sight` (8) pixels along its row. So a slope doesn't freeze like sand, while a flat
       surface comes to rest.

**What that makes.**

- Falling liquid stays in whole streams.
- A settled pool is flat to one pixel, with a clean surface.
- A pool pushes out through a hole at the foot of its wall and runs along the floor beyond, but never
  climbs above the hole (no pressure beyond head; liquid never moves up).
- A dug-away dam face collapses at once instead of draining through a one-pixel curtain.

**Kinds.** Lava sinks through water. The obsidian reaction belongs in a separate pass after movement.

## Verification

- **The twin, in Vitest** (`client/src/fluid/rule.test.ts`), as properties over random rock and random
  pours:
  - pixels of each kind are conserved exactly, every pass;
  - liquid never occupies rock;
  - stepping is deterministic;
  - **in motion, every pass**: no sideways move starts from an unsupported pixel;
  - the random worlds include settled liquid (energy spent), because that's where the rules differ.
    Fresh pours alone hid a bug that lost mass;
  - a closed basin settles: it stops changing, every row under the top is full, and the top row
    holds the remainder;
  - a settled pool pushes out through a hole at the foot of its wall and runs along the floor beyond,
    but never stacks above the hole (no pressure);
  - a settled pool levels flat across the whole floor when its wall is dug away (the staircase above);
  - lava sinks through water, and falls slower;
  - a falling column stays one unbroken run, every pass;
  - a wide pool whose wall is dug away settles flat to one pixel (it fails at the old ¼ px head cost);
  - a dug-away dam face collapses under its own head: 187 pixels past the face after 50 passes, against
    50 without the head field.

  Each rule was red-checked, and each fails its test without it: the support check, lava sinking,
  pressure flow, the energy cost of turning, sight, the head field, falling runs, and the
  more-than-one-pixel pressure threshold (pinned as a fast-check example).

- **The GPU against the twin**, in the lab (`fluidLab.parity()`): the same scene stepped through both,
  compared pixel for pixel over hundreds of passes. It must be **exact**: the rule is integers and
  hashes, so any difference is a porting bug.

## Lab findings (#87, open)

`client/labs/fluid-lab.html` runs the rule on WebGPU over `composeBand` rock, with three scenes
(reservoir, cascade, lava meets water), pour/dig/build brushes, `fluidLab.parity()` and
`fluidLab.dump()`.

- **The GPU port is exact.** Every scene stepped 300–400 passes through the twin and the GPU agrees pixel
  for pixel. Parity fails on a planted off-by-one in the shader, and on a changed head cost.
- **Fixed from the author's review:**
  - **Gaps between liquid and rock.** Water was drawn 86% opaque over the rock renderer's dark contact
    shadow. Liquid is opaque now, and water under a rock overhang isn't drawn as surface.
  - **Falling pixels disconnected, like particles.** The 2×2 block pulls a falling column apart into
    alternating pixels; the fall stage moves whole runs.
  - **Spikes on a settled surface.** A scene filled as a rectangle left the rock's eroded notches empty,
    and pressure rightly drained the top rows into them. Scene fills now flood the notches, as generated
    lakes will need to.
- **Open, blocking: slopes level far too slowly.**
  - A dug-away reservoir collapses into a 45° slope at once, but the slope then barely moves. After 5 s
    at 16 passes a frame it's still a dune.
  - Measured in the twin: the slope's edge pixels are under pressure with open space beside them, yet
    mass crosses the slope at about one pixel per pass in total. Each move needs the pixel below to have
    moved first, and space only enters the body at the toe.
  - Pressure decides _whether_ liquid moves; this is about _how much_ can move per pass, which the 2×2
    block caps.
- **Tried and set aside: row transport.** An extra stage in 8-pixel row blocks swapped runs of
  pressurized liquid with runs of supported empty space, so liquid could cross up to 7 px a pass.
  - Measured against the same rule without it, it **didn't level any faster** (9–29 px against 12–27 after
    1,600 passes on a 160×64 dune).
  - On a slope, only one pixel ahead of an edge is supported, so it moved one pixel, like the 2×2 block.
    Letting it move over unsupported space would spread liquid in mid-air (lesson 2).
  - An earlier "improvement" came from comparing against the previous commit instead of the rule without
    transport. The gain was the head cost, which stayed.
  - The patch is kept outside the repo.
- **What's left:**
  - Resting liquid needs a model that moves bulk volume, not surface pixels: a height field (virtual
    pipes / shallow water) for resting bodies, with this automaton for falling and splashing.
  - Or accept slow levelling for large bodies.
- **Cost:** 16 passes over 480×320 art pixels take ~5 ms to GPU done. A game-sized area would need
  fewer passes or a smaller active region.

## History — four whole-cell models

Recorded so the next change starts from the right place. All four ran on the grid the player digs: the
first with fluid levels per cell, the other three with whole cells. Each was found wanting in the lab:

1. **0–255 levels.** It drew 1 px films and curved surfaces, which is what started the whole-cell rule.
2. **Whole cells, row search.** Cells looked 16 cells along their row for somewhere lower. Wide pools
   settled into 16-cell steps, lava's 2-cell reach heaped mounds, and landing fluid skated across the
   surface.
3. **Whole cells, per-cell pool search.** A cell with its kind above or below it searched through the
   pool, with no limit, and moved the top of its own column. Pools finally settled flat, but moving
   fluid misbehaved badly: a breach grew a wedge of water hanging in mid-air, and a stream through a hole
   spread into a V under the ceiling. The review asked to step back, and three faults turned up:
   - "In a pool" meant "has neighbours of its kind", which is also true of a falling stream.
   - A pool could place a cell anywhere empty and lower, including in mid-air.
   - The cell that moved was the top of whichever column was being processed, not the pool's highest
     cell, so a draining surface went ragged.

   The underlying mistake was patching the previous rule each time instead of stating the physics
   first. The tests only checked final settled shapes, never the shape of fluid while it moves.

4. **Gravity, then resting bodies.** Built from those three faults, with the in-motion shapes tested
   every tick. The author wasn't happy with where it left fluid, and moved it to art
   pixels on the GPU (#87), carrying these lessons.

## Prior art

A targeted research pass (September 2026) into how the genre actually does this. Tags: **[P]** from
decompiled or open source, **[W]** from a wiki or talk.

| Game                   | Model                                                                                                                                                                                                                                                                                              | Taken for DELVE                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Terraria** [P]       | A byte level per tile. Falls, then **averages 1–3 tiles either side with rounding**, and deletes small amounts (under 2, under 20 when it can flow). A 5,000-cell active queue with overflow buffer; panics into a whole-world "Settling liquids" pass. The server stops sending liquid when busy. | The active set, and settling before play    |
| **Starbound** [P]      | Float level plus a real pressure field (U-bends work). Unseeded random left/right order. Zeroes tiny levels                                                                                                                                                                                        | Reactions as a separate pass after movement |
| **Noita** [W]          | Whole-pixel materials, bottom-up, in place, a **per-pixel "moved this frame"** stamp, 64×64 chunks with dirty rects, 4-pass checkerboard threading. Documents surface water sliding forever without a longer search or sleep                                                                       | Whole cells; chunked dirty regions later    |
| **Minecraft** [W]      | Source and flowing blocks with levels 0–7. Flowing water searches **up to 4 blocks for the nearest way down** and flows only that way                                                                                                                                                              | Flowing toward the way down: spills         |
| **Dwarf Fortress** [W] | Depth 1–7. Pressure by **teleporting** falling water through full tiles to the nearest open tile, never higher than one level under its source                                                                                                                                                     | Moving through full cells, but never upward |
| **ONI** [W]            | One element per cell, with mass. Minimum-flow thresholds stop endless trickles                                                                                                                                                                                                                     | One kind per cell                           |

**The conclusion that shaped the model:** every level-based system in the survey deletes or rounds
fluid to get it to settle, so none conserves exactly. Whole cells that only move are the one approach
that does, and it needs no clean-up hacks.

Sources: [Terraria `Liquid.cs` (decompiled)](https://github.com/TheVamp/Terraria-Source-Code/blob/master/Terraria/Liquid.cs) ·
[Terraria wiki: Liquids](https://terraria.wiki.gg/wiki/Liquids) ·
[OpenStarbound `StarCellularLiquid.hpp`](https://github.com/OpenStarbound/OpenStarbound/blob/main/source/base/StarCellularLiquid.hpp) ·
[Noita GDC 2019](https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design) ·
[Minecraft wiki: Water](https://minecraft.wiki/w/Water) ·
[DF wiki: Pressure](https://dwarffortresswiki.org/index.php/DF2014:Pressure) ·
[ONI wiki: Fluid mechanics](https://oxygennotincluded.wiki.gg/wiki/Fluid_Mechanics) ·
[W-Shadow: simple fluid simulation](https://w-shadow.com/blog/2009/09/01/simple-fluid-simulation/)

## Whole-cell lab findings (for reference)

Measured on the whole-cell models before the move to pixels. They're the baseline the netcode decision will be argued against once the pixel sim has its own numbers.

will be argued from. Headless Chrome on the author's machine, a 3400×1900 window (212×118 cells).
**These are model 4's figures**; earlier models' are in the table below and in the git history.

| Scene                            | Measured                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Caves**, ~1 s in (peak)        | 578 active, 383 stepped and **223 changed per tick**. **~2.3 ms per tick** (70 ms/s at 30 ticks/s) |
| The same, as replication         | **≤ ~335 cells per 20 Hz broadcast, ≤ ~33 KB/s** at the peak, ~8 KB/s by 2.5 s, ~1 KB/s by 8 s     |
| **Dam breach**, 3 s in           | Only ~10 cells stepped per tick, but **~3 ms per tick**: the whole reservoir is walked as one body |
| **U-bend**, left arm poured full | Left arm stays full; the right arm fills only the channel. **No pressure**, as decided             |
| **Lava over water**, settled     | Drains through the hole as a single column; nothing under the shelf; a flat layer on the water     |

Across the models, on the same caves:

| Model                                | Peak replication | Peak CPU     | In motion                              |
| ------------------------------------ | ---------------- | ------------ | -------------------------------------- |
| 1. 0–255 levels                      | ~120 KB/s        | ~1.3 ms/tick | Films and curves                       |
| 2. Whole cells, row search           | ~68 KB/s         | ~3 ms/tick   | Steps, mounds, skating                 |
| 3. Whole cells, per-cell pool search | ~80 KB/s         | ~5.7 ms/tick | Wedges and Vs hanging in mid-air       |
| 4. Gravity, then resting bodies      | ~33 KB/s         | ~2.3 ms/tick | Falls, spills and spreads along floors |

**Model 4 is the cheapest yet to replicate**, because fluid only changes where it actually flows. Its
CPU cost is the **body walk**: a body with one awake cell is walked whole, every tick, so a large
reservoir feeding a thin breach costs its size (the breach row above). The upgrade path, marked
`ponytail:` in `fluid.ts`, is to keep bodies between ticks and update them as cells move.

What the lab shows that the design still has to answer:

- **The partial top row is a one-row plateau.** When a pool's volume isn't a whole number of rows, its
  top row holds the remainder as a contiguous run, wherever the fluid arrived, with the rest of the
  row one cell lower. Whole cells can't avoid a partial row; only its **position** is a choice.
- **A spreading front is sloped until it settles.** A block of fluid put down on a floor spreads with
  45° stepped sides, because every opening beside it is filled each tick, lowest first. Restricting
  moves to the lowest openings would square the front off, at the cost of a flat one-cell "skirt"
  running out from its base.
- **Lava rests on water.** "Kinds are walls" lets lava lie on top of a pool and interleave with it. The
  obsidian reaction pass would resolve every such contact, which is a reason to build it before fluid
  reaches the game.
