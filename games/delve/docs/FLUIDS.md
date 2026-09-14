# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage.** The simulation lives in `shared/src/fluid.ts` and is exercised by
> `client/labs/fluid-lab.html`. It isn't in the game, the server or the protocol yet. The numbers here
> are lab defaults to tune, not decisions.

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## Fluid is made of cells, like everything else

**A cell is either full of fluid or empty.** No partial levels, no thin film on a floor, no sloped or
rounded surface. Fluid only ever fills empty space, a whole cell at a time, on the same grid the player
digs. (A cell is the unit you mine: 8 art px, 16 on screen.)

This is an **art-direction decision**, and it outranks fidelity. Everything else in the world reads as
blocks, and a fluid with sub-cell levels didn't. The first prototype used Terraria's 0–255 levels, and
in the lab it produced 1 px strips on flat floors and smooth curves across flowing surfaces, neither of
which a 2D block world can contain. The shapes fluid makes are now whole cells, so they can only be the
shapes the terrain makes.

It costs detail that levels bought: a small amount of water can't spread into a thin sheet, and a
surface in motion steps a whole cell at a time. The model below is built to make that read as
deliberate.

## The model — gravity first, then resting bodies level

Two phases per tick, in this order, and a cell takes part in only one:

**1. Gravity.** Every active cell with an empty cell below it falls one cell, bottom row first. That's
all a falling cell does that tick. **Falling fluid is never part of a pool**, however many cells of
its kind are around it, so a stream stays a stream until it lands.

**2. Resting bodies level.** A **body** is the fluid of one kind that's connected, left, right, up or
down, through cells that **rest**: rock or other fluid directly under them. For each body that has an
awake cell:

- Its **sources** are its surface cells, the ones with nothing of their kind above.
- Its **openings** are the places it can put a cell. For each body cell, look at the empty cell beside
  it. If that cell has something under it, the opening is that cell. If it's over air, the body's edge
  overhangs a drop, and the opening is the cell **below** it, so the fluid spills and falls.
- The **highest sources move to the lowest openings**, one cell per opening, for as long as the opening
  is strictly lower than the source.

The rules that make it behave:

- **Every move lands strictly lower than where it started.** A fall is one row down; a levelling move
  pairs a source with an opening below it. Total height only ever falls, so every body settles and
  nothing oscillates.
- **Mass is a cell count.** A move empties one cell and fills another, so fluid is conserved exactly by
  construction, and identically on every machine. No level system managed this (see prior art).
- **Nothing spreads in mid-air.** An opening either has something under it or is a spill over an edge.
  A body grows along floors and over ledges, never sideways out into the air.
- **A pool drains and fills evenly.** Cells leave from the body's highest row and arrive at its lowest
  openings, so the surface falls or rises a row at a time, instead of the columns nearest the change
  emptying first.
- **Flow has a speed.** A body gains at most one cell per opening per tick, so a breach's front
  advances a cell per tick along the floor, and spills fall a cell per tick.
- **Every settled pool is flat, water and lava alike.** A settled body has no opening lower than its
  highest cell: every row under its top row is full, and the top row holds the remainder. There's no
  distance limit anywhere, so this holds for a pool of any width and for a one-cell-thick sheet.
- **It doesn't jitter.** No move is sideways at the same height.
- **No pressure** (decided). An empty cell with the body only underneath it isn't an opening, so a body
  never grows upward. The far arm of a U-bend, or a tunnel up the far side of a lake, fills only to
  the height of the connection.
- **Moving fluid.** The sim returns every move with its type. A **fall** slides down one cell. A
  **merge** isn't animated: a body's cells are indistinguishable, so the honest picture is the pool
  losing a cell at its surface and gaining one at its edge.
- **Kinds don't mix.** To water, lava is a wall, and the reverse. The obsidian reaction is the obvious
  follow-up. Per the research, it belongs in a **separate pass after movement**, so the result doesn't
  depend on scan order and every reaction can be logged against the conservation count.
- **Lava is slow, not thick.** It follows exactly the same rules, and both of its phases run once every
  `LAVA_TICK_INTERVAL` ticks (4).

### History

Four models, each found wanting in the lab, recorded so the next change starts from the right place:

1. **0–255 levels.** It drew 1 px films and curved surfaces (above).
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

4. **Gravity, then resting bodies** (this one). Built from those three faults, with the in-motion
   shapes tested every tick.

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

## Sleeping and active regions

Only cells that might change are stepped:

- **The active set** holds the fluid next to anything that changed last tick. Nothing wider is needed:
  one awake cell makes its whole body level, so a change anywhere in a pool reaches all of it. A settled lake leaves the set and costs nothing.
- **Terrain changes wake fluid.** Digging a cell next to a lake has to be reported (`wakeAround`), or
  the lake sleeps through its own breach.
- **Active regions near players only** (the epic's decision). `stepFluid` takes an optional region
  predicate. Cells outside it **stay in the active set but aren't stepped**, so fluid far from everyone
  freezes mid-flow and resumes when a player returns. The same mechanism serves hibernation's "owing
  time" rule later.

## What the lab measures

The netcode is sized for one player changing one tile at a time, and fluid is the thing that breaks
that assumption. So the lab reports, per tick:

- **Active cells**, the CPU cost.
- **Changed cells**, the replication cost. At roughly 5 bytes per changed cell (a packed key and a
  kind) and the server's 20 Hz broadcast, the HUD turns it into an upper-bound bandwidth figure.
- **Cell count per kind**, which must never drift.

## Lab findings

Measured with `pnpm probe` against the lab, recorded here because they're what the netcode decision
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

## Verification

`shared/src/fluid.test.ts`, as properties over random terrain and random pours:

- **Cells are conserved exactly**, every tick.
- **Every move lands strictly lower**, and **no cell moves twice in a tick**.
- **Every pool settles flat**, water and lava, in a basin far wider than any search distance.
- **Nothing spreads into mid-air**: a levelling move lands on support, or just past an edge it spills
  over.
- **In motion, checked every tick**: a dam breach pours down the far face and spreads along the floor
  with no air under it, and a pool draining through a hole in its floor stays flat to one row the
  whole way down, with nothing under the ceiling below.
- **At the edges**: a one-cell sheet that reaches a ledge drains off it completely, and a pool
  overflows a wall lower than its surface.
- **Fluid never occupies a solid cell.**
- **Stepping is deterministic.**
- **Fluid always settles onto support**: every resting fluid cell has rock or fluid under it, so
  nothing hangs in the air.
- **A closed basin settles flat**: the active set empties, and every row under the top one is full.
- **Fluid resting on fluid follows it down** when the cell below leaves, including when it was asleep.
- **An inactive region freezes** its fluid without losing any of it.
