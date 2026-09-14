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

## The model — whole cells that only ever move down

A falling-sand automaton. A cell on its own finds its way down like Minecraft water; a cell that is part
of a **pool** (fluid of its kind below it or above it) moves as part of that pool, the way Dwarf
Fortress moves water through full tiles, minus the climbing. Each active fluid cell makes at most one
move per tick, bottom row first:

1. **Fall.** If the cell below is empty, move into it.
2. **Merge.** If the cell is in a pool, take the **top of its column** and search from it _through the
   pool_, moving only **down or sideways, never up**, for the nearest empty cell lower than that top.
   The top moves there. There's no distance limit, so a pool of any width settles flat.
3. **Seek a drop.** A lone cell on rock (no fluid of its kind above or below) looks along its row,
   within `DROP_REACH` cells and only through empty cells, for the nearest **drop**: an empty cell with
   nothing under it. It moves straight to the bottom of it. That's a trickle running along a floor to a
   ledge.
4. **Rest.** Otherwise, stay put.

Ties go to this tick's sweep direction, which alternates every tick.

The rules that make it behave:

- **Every move lands strictly lower than where it started.** Total height only ever falls, which
  guarantees that every body settles and nothing can oscillate. The research below singles this out: a
  sideways step that isn't also a fall is how whole-cell water ends up trading places forever.
- **Mass is a cell count.** A move empties one cell and fills another, so fluid is conserved exactly by
  construction, and identically on every machine. No level system managed this (see prior art).
- **Every pool settles flat, water and lava alike.** A top cell keeps merging while any empty cell
  below it is reachable through its pool, so a settled pool has full rows under a single partial top
  row. That row is still whole cells, just not every one of them.
- **It doesn't jitter.** A cell never moves sideways to a spot as high as itself, so a flat pool is
  still rather than shuffling left and right. That's the classic falling-sand failure.
- **Fluid landing on a pool joins it; it doesn't skate.** A falling cell that lands on its own kind is
  in a pool, so it merges: it goes straight into the nearest open space the pool can reach, and never
  searches across the pool's surface. (The previous version had it slide along the top looking for a
  drop, which read as skating.)
- **Nothing important appears to jump.** The sim returns every move with its type. A **fall** or **drop**
  slides along an L-shaped path (never a diagonal, which would clip a rock corner). A **merge** isn't
  animated: pool cells are indistinguishable, so the honest picture is the arriving cell vanishing into
  the pool and the pool's edge filling where the sim put it.
- **No pressure** (decided). The merge search never goes up, so water never climbs: a U-bend or a
  tunnel dug up the far side of a lake fills only to the height of the connection.
- **Kinds don't mix.** To water, lava is a wall, and the reverse. The obsidian reaction is the obvious
  follow-up. Per the research, it belongs in a **separate pass after movement**, so the result doesn't
  depend on scan order and every reaction can be logged against the conservation count.
- **Lava is slow, not thick.** It follows exactly the same rules and settles into the same flat pools,
  and it steps once every `LAVA_TICK_INTERVAL` ticks (4). (It used to have a 2-cell reach, which made
  it heap into stepped mounds. The author ruled that out: every fluid settles flat.)

### History

- **Levels → whole cells.** The 0–255 prototype drew films and curves (above).
- **A reach-limited row search → the merge search.** The whole-cell model's first version levelled
  pools by looking 16 cells along a row. Any pool wider than that settled into **16-cell-wide steps**,
  lava's 2-cell reach heaped it into mounds, and cells landing on a pool skated across its surface. All
  three came from searching a fixed distance along a row rather than through the pool, and were fixed
  together.

## Prior art

A targeted research pass (September 2026) into how the genre actually does this. Tags: **[P]** from
decompiled or open source, **[W]** from a wiki or talk.

| Game                   | Model                                                                                                                                                                                                                                                                                              | Taken for DELVE                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Terraria** [P]       | A byte level per tile. Falls, then **averages 1–3 tiles either side with rounding**, and deletes small amounts (under 2, under 20 when it can flow). A 5,000-cell active queue with overflow buffer; panics into a whole-world "Settling liquids" pass. The server stops sending liquid when busy. | The active set, and settling before play    |
| **Starbound** [P]      | Float level plus a real pressure field (U-bends work). Unseeded random left/right order. Zeroes tiny levels                                                                                                                                                                                        | Reactions as a separate pass after movement |
| **Noita** [W]          | Whole-pixel materials, bottom-up, in place, a **per-pixel "moved this frame"** stamp, 64×64 chunks with dirty rects, 4-pass checkerboard threading. Documents surface water sliding forever without a longer search or sleep                                                                       | Whole cells; chunked dirty regions later    |
| **Minecraft** [W]      | Source and flowing blocks with levels 0–7. Flowing water searches **up to 4 blocks for the nearest way down** and flows only that way                                                                                                                                                              | The nearest-drop search, for lone cells     |
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

- **The active set** holds fluid near anything that changed last tick. Because a lone cell looks for
  drops along its row, a change wakes fluid within `DROP_REACH` in its own row and the row above, not
  just its neighbours. A pool needs nothing wider: any active cell in it moves its column's top, so a
  change anywhere in a pool propagates through the cells beside it. A settled lake leaves the set and costs nothing.
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
will be argued from. Headless Chrome on the author's machine. **The figures below are from the
whole-cell model**; the earlier levels prototype's are in the git history.

| Scene                                       | Measured                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Caves**, 212×118 cells, ~1 s in (peak)    | ~1,300 active, ~700 stepped and **~550 changed per tick**. **~5.7 ms per tick** (170 ms/s at 30 ticks/s) |
| The same, as replication                    | **≤ ~820 cells per 20 Hz broadcast, ≤ ~80 KB/s** at the peak, ~18 KB/s by 2.5 s                          |
| The same, 8 s in                            | 40 active, 4 changed per tick, 22 ms/s. Then settled: **0 active, 0 changed**                            |
| **U-bend**, left arm poured full            | Left arm stays full; the right arm fills only the channel under the divider. **No pressure**, as decided |
| **Lava over water**, 4,000 ticks presettled | Lava pours through the hole and settles as a **flat layer** on the water; no mounds                      |

The cost story, across the three versions on the same caves:

| Version                         | Peak replication | Peak CPU     | Settles                        |
| ------------------------------- | ---------------- | ------------ | ------------------------------ |
| 0–255 levels                    | ~120 KB/s        | ~1.3 ms/tick | Kept rippling                  |
| Whole cells, row search of 16   | ~68 KB/s         | ~3 ms/tick   | ~25 s, but in steps and mounds |
| Whole cells, merge through pool | ~80 KB/s         | ~5.7 ms/tick | Flat pools                     |

**The pool search is what costs.** The first measurement of it spent 56 ms/s stepping just 15 cells a
tick, because every awake cell on top of a settling lake searched the whole lake again. A per-tick
memo of searches that came up dry (`DryRuns` in `fluid.ts`) cut that to 22 ms/s. The peak is still
about twice the row-search version, because every move clears the memo. If that ever matters, the
known upgrade is to track each pool's lowest reachable empty cells incrementally rather than
searching for them.

What the lab shows that the design still has to answer:

- **The partial top row is a one-row plateau.** When a pool's volume isn't a whole number of rows,
  its top row holds the remainder as a contiguous run, wherever the fluid happened to arrive, with the
  rest of the row one cell lower. Whole cells can't avoid a partial row, but its **position** is a
  choice. Packing it against a wall would need a sideways move at the same height, which the
  termination argument rules out, unless it gets a potential of its own (for example, distance to the
  nearest wall).
- **A one-cell-thick sheet only drains within `DROP_REACH`.** A sheet on a floor isn't a pool (nothing
  above or below its cells), so its edge looks for a drop only 16 cells along. On the lava-over-water
  shelf, the sheet ends 17 cells from the hole and stays put.
- **Lava rests on water.** "Kinds are walls" lets lava lie on top of a pool and interleave with it. The
  obsidian reaction pass would resolve every such contact, which is a reason to build it before fluid
  reaches the game.

## Verification

`shared/src/fluid.test.ts`, as properties over random terrain and random pours:

- **Cells are conserved exactly**, every tick.
- **Every move lands strictly lower**, and **no cell moves twice in a tick**.
- **Every pool settles flat**, water and lava, in a basin far wider than any search distance.
- **A cell landing on its own kind never makes a drop move** across the pool's surface; it merges.
- **Fluid never occupies a solid cell.**
- **Stepping is deterministic.**
- **Fluid always settles onto support**: every resting fluid cell has rock or fluid under it, so
  nothing hangs in the air.
- **A closed basin settles flat**: the active set empties, and every row under the top one is full.
- **Fluid resting on fluid follows it down** when the cell below leaves, including when it was asleep.
- **An inactive region freezes** its fluid without losing any of it.
