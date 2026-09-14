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

## The model — a Margolus block automaton

**Why blocks.** A GPU updates every pixel at once, so two liquid pixels can't both be allowed to move
into the same empty pixel. The standard answer for GPU falling-sand is the **Margolus neighbourhood**:
tile the grid into 2×2 blocks, and on alternate passes shift the tiling by one pixel on both axes. Each
block is updated as a unit, and **its rule only rearranges the four pixels inside it**, so:

- **mass is conserved exactly**: a rearrangement can't create or destroy a pixel;
- **nothing moves twice in a pass**, and nothing collides: each pixel belongs to exactly one block;
- **every pixel's result is a pure function of the previous pass**, so the GPU and the TypeScript twin
  agree exactly. Reading pixels outside the block is fine: everyone reads the same previous state.

The shifting tiling lets movement cross block edges: a pixel moves at most one pixel a pass, in any
direction, and the lab runs several passes a frame.

**A pixel's state** (a `u32`): its **kind** (empty, water, lava), a **direction** (left or right) and an
**energy** (0–255). Rock isn't a state. It's the rock's own eroded pixel mask, the same one the
renderer draws (`buildMask` / `mask_main`), so liquid meets the stone's visible edge, not a cell square.
Outside the simulated area counts as rock.

**A block's rule**, applied in this order to the four pixels (top-left `a`, top-right `b`, bottom-left
`c`, bottom-right `d`). Each liquid pixel only acts on a pass where its kind's **chance** comes up (a
hash of position and pass: water every pass, lava about one in four):

1. **Gravity.** In each column, liquid over an empty pixel swaps down. Lava over water swaps too: lava is
   denser and sinks. Falling sets the pixel's energy to full.
2. **Diagonal slide.** Liquid that couldn't fall, over an occupied pixel, moves to the empty diagonal
   below it, but only if the pixel beside it is also empty, so it never squeezes between two diagonal
   rock pixels. Within one block only one diagonal is possible; the alternating tiling gives the other
   on the next pass. It's a fall, so energy is full again.
3. **Sideways flow**, for liquid **standing on something** (lesson 2), into an empty pixel beside it
   in the pixel's direction:
   - **Pressurized** liquid (liquid above it) always flows. That's what empties a pool through a
     breach in its wall. It leaves at full energy, because liquid pushed out of a pool is free to run.
   - **Surface** liquid (nothing above) flows only while it has energy, and spends one per pixel. So
     water landing on a pool runs along it and then **stops**: no skating forever, no jitter (lesson 4).
   - Liquid that's **blocked** in its direction turns around, if it still has energy, and turning costs
     energy too, so liquid boxed in on both sides comes to rest.
   - **Out of energy, liquid still flows toward a drop it can see**: an empty pixel over empty space
     within `sight` pixels (8, one cell) along its row, with nothing in the way. It turns to face a drop
     behind it.

**Why sight exists** (found by the twin's tests). Without it, a settled pool whose wall was dug away
froze into a **45° staircase**, like sand. The pixel at each one-pixel step had nothing above it (not
pressurized), no energy left, and no empty diagonal, so nothing could move. That's the lava-pile
failure again (lesson 3), in pixels. Sight lets a surface keep flowing while it can see a way down,
and still lets a truly flat surface come to rest.

**What that makes.** A falling stream stays a stream (lesson 1). Landing water spreads along the floor
at its own speed until it runs out of room or energy. A heap slides down its sides, because every step
down is a fall that refills energy. A breached pool drains through the hole from the bottom, because its
bottom pixels are pressurized. **Settled liquid is flat**: every row under its surface is full, and a
slope can only survive as a step of one pixel per more than `sight` pixels. It doesn't move again until
something under or beside it changes.

**No pressure beyond that.** A U-bend's far arm fills only as high as the liquid pushed into it can
climb, which is none. As in the whole-cell model, liquid never moves upward.

**Kinds.** Lava sinks through water. The obsidian reaction is the obvious follow-up, and belongs in a
**separate pass after movement** (from the research), where it can be counted against conservation.

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
  - lava sinks through water, and falls slower.

  Each rule was red-checked: removing the support check, lava sinking, pressure flow, the energy cost
  of turning or sight each fails the matching test.

- **The GPU against the twin**, in the lab (`fluidLab.parity()`): the same scene stepped through both,
  compared pixel for pixel over hundreds of passes. It must be **exact**: the rule is integers and
  hashes, so any difference is a porting bug.

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
