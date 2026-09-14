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

A falling-sand automaton, with Minecraft's nearest-drop search. Each active fluid cell makes at most
one move per tick, bottom row first:

1. **Fall.** If the cell below is empty, move into it.
2. **Seek a drop.** Look along the row, as far as the kind's **reach** and only through empty cells,
   for the nearest **drop**: an empty cell with nothing under it. Move straight to the bottom of it.
3. **Level.** If the cell has fluid of its own kind above it (so it's inside a body, not on its
   surface), it may also look _through_ fluid of its kind for the nearest empty cell resting on
   something. The **top of its column** moves there. That's how a lake runs out along a flat tunnel
   floor.
4. **Rest.** Otherwise, stay put.

Ties go to this tick's sweep direction, which alternates every tick.

The rules that make it behave:

- **Every move lands strictly lower than where it started.** Total height only ever falls, which
  guarantees that every body settles and nothing can oscillate. This is the property the research below
  singles out: a sideways step that isn't also a fall is how whole-cell water ends up trading places
  forever.
- **Mass is a cell count.** A move empties one cell and fills another, so fluid is conserved exactly by
  construction, and identically on every machine. No level system managed this (see prior art).
- **Settled water is flat.** A cell with water above it and an empty floor cell within reach keeps
  levelling, so a settled pool has full rows under a single partial top row. The top row is still whole
  cells, just not every one of them.
- **It doesn't jitter.** A surface cell never moves sideways to a spot as high as itself, so a flat
  pool is still rather than shuffling left and right. That's the classic falling-sand failure.
- **Nothing appears to jump.** A seek or level move can cross several cells in one tick. The sim returns
  every move, and a renderer slides the cell along an L-shaped path (never a diagonal, which would
  clip a rock corner). The sim decides the end; the animation only travels there.
- **Why levelling moves the column top.** The first version without it failed a hand-traced dam
  break: water on a flat floor can't enter a flat tunnel if moving sideways isn't lower. Moving the top
  of the column is the same final shape as "everything in the column sinks one cell and the bottom
  steps across", done as one strictly-lower move.
- **No pressure** (decided). Levelling only looks along the cell's own row, so water never climbs:
  a U-bend or a tunnel dug up the far side of a lake fills only to the height of the connection.
- **Kinds don't mix.** To water, lava is a wall, and the reverse. The obsidian reaction is the obvious
  follow-up. Per the research, it belongs in a **separate pass after movement**, so the result doesn't
  depend on scan order and every reaction can be logged against the conservation count.
- **Lava is slow and thick.** It steps once every `LAVA_TICK_INTERVAL` ticks (4), and its reach is 2
  cells to water's 16, so it heaps into stepped mounds rather than running flat.

## Prior art

A targeted research pass (September 2026) into how the genre actually does this. Tags: **[P]** from
decompiled or open source, **[W]** from a wiki or talk.

| Game                   | Model                                                                                                                                                                                                                                                                                              | Taken for DELVE                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Terraria** [P]       | A byte level per tile. Falls, then **averages 1–3 tiles either side with rounding**, and deletes small amounts (under 2, under 20 when it can flow). A 5,000-cell active queue with overflow buffer; panics into a whole-world "Settling liquids" pass. The server stops sending liquid when busy. | The active set, and settling before play    |
| **Starbound** [P]      | Float level plus a real pressure field (U-bends work). Unseeded random left/right order. Zeroes tiny levels                                                                                                                                                                                        | Reactions as a separate pass after movement |
| **Noita** [W]          | Whole-pixel materials, bottom-up, in place, a **per-pixel "moved this frame"** stamp, 64×64 chunks with dirty rects, 4-pass checkerboard threading. Documents surface water sliding forever without a longer search or sleep                                                                       | Whole cells; chunked dirty regions later    |
| **Minecraft** [W]      | Source and flowing blocks with levels 0–7. Flowing water searches **up to 4 blocks for the nearest way down** and flows only that way                                                                                                                                                              | The nearest-drop search                     |
| **Dwarf Fortress** [W] | Depth 1–7. Pressure by **teleporting** falling water through full tiles to the nearest open tile, never higher than one level under its source                                                                                                                                                     | Not taken: no pressure, by decision         |
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

- **The active set** holds fluid near anything that changed last tick. Because a cell looks for drops
  along its row, a change wakes fluid within reach in its own row and the row above, not just its
  neighbours. A settled lake leaves the set and costs nothing.
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

| Scene                                       | Measured                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Caves**, 212×118 cells, ~1 s in (peak)    | ~1,400 active, ~770 stepped and **~465 changed per tick**. **~3 ms per tick** (90 ms/s at 30 ticks/s)                                                   |
| The same, as replication                    | **≤ ~700 cells per 20 Hz broadcast, ≤ ~68 KB/s** at the peak, falling to ~10 KB/s by 2.5 s                                                              |
| The same, 6 s in                            | 146 active, 10 changed per tick. By 25 s: **0 active, 0 changed** — settled                                                                             |
| **U-bend**, left arm poured full            | Left arm stays full; the right arm fills only the channel under the divider. **No pressure**, as decided                                                |
| **Lava over water**, 3,000 ticks presettled | Lava pours through the hole and heaps into stepped mounds (one row per two cells) on the water; lava more than 2 cells from the hole stays on the shelf |

Against the levels prototype on the same caves: **about half the peak replication cost, and it settles
in seconds** rather than rippling on. Per stepped cell it's ~3× dearer (a reach-16 row search and a
wider wake), so CPU rose while bandwidth, the real constraint, fell. Interest management is still
what fluid needs from the netcode, but a settled world sends nothing.

What the lab shows that the design still has to answer:

- **Lava rests on water.** "Kinds are walls" lets lava pile on top of a pool, and pillars of it stand
  in water. The obsidian reaction pass would resolve every such contact, which is a reason to build it
  before fluid reaches the game.

## Verification

`shared/src/fluid.test.ts`, as properties over random terrain and random pours:

- **Cells are conserved exactly**, every tick.
- **Every move lands strictly lower**, and **no cell moves twice in a tick**.
- **Fluid never occupies a solid cell.**
- **Stepping is deterministic.**
- **Fluid always settles onto support**: every resting fluid cell has rock or fluid under it, so
  nothing hangs in the air.
- **A closed basin settles flat**: the active set empties, and every row under the top one is full.
- **Fluid resting on fluid follows it down** when the cell below leaves, including when it was asleep.
- **An inactive region freezes** its fluid without losing any of it.
