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

## The model — a cellular automaton, Terraria-style

The canonical approach for tile-based fluid, used by Terraria, Starbound and most falling-sand games.
Chosen over particles (SPH and similar) because fluid has to live on the same cell grid the player
collides with, mines, and that the server replicates.

- **Each cell holds an integer level `0..MAX_LEVEL`** (255) and, when it holds anything, one kind.
  Integers because the server is authoritative and the tests assert **exact** mass conservation, which
  floats can't promise across machines.
- **One tick, per cell with fluid:**
  1. **Fall.** Move as much as fits into the open cell below.
  2. **Spread.** Share what's left with the left and right neighbours that are _lower_, as an integer
     average. The remainder is dealt out one unit at a time, to this cell first and then to the
     neighbours in sweep order, so no unit is ever created or destroyed. (Keeping the whole remainder in
     the centre cell left a stable spike: `0 2 0` never moved. The property test caught it.)
- **Order is deterministic.** Bottom row first, so water falls one cell per tick rather than teleporting
  down a column. The horizontal sweep **alternates direction every tick**, so there's no left/right bias.
- **It always settles.** A fall lowers the total height of the fluid, and a spread lowers the variance
  of a row without raising anything. Neither can repeat forever, so every closed pocket comes to rest.
  The integer average leaves at most one unit of difference between neighbours. At 255 units a cell,
  that's invisible.
- **No pressure.** Water doesn't climb the far arm of a U-bend. This is Terraria's behaviour and the
  cheap one. The compression model (W-Shadow's) buys U-tubes with float masses and a pressure term, at
  the cost of both exactness and never quite settling. **An open question the lab can answer by feel.**
- **Kinds don't mix.** To water, lava is a wall, and the reverse. When they meet, Terraria makes
  obsidian, and obsidian is already a DELVE material, so that reaction is an obvious follow-up. It isn't
  built: it mutates terrain, and terrain mutation from the fluid step needs a protocol answer first.
- **Lava is slow.** It steps once every `LAVA_TICK_INTERVAL` ticks (4 by default), and it only spreads
  across a level difference of at least 24 units (`MIN_SPREAD`), which gives it a thick, lumpy front.

## Sleeping and active regions

Only cells that might change are stepped:

- **The active set** holds every fluid cell that changed last tick, plus its neighbours. A cell leaves
  the set once nothing around it moved, so a settled lake costs nothing.
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
  level) and the server's 20 Hz broadcast, the HUD turns it into an upper-bound bandwidth figure.
- **Total mass per kind**, which must never drift.

## Lab findings

Measured with `pnpm probe` against the lab, recorded here because they're what the netcode decision
will be argued from. Headless Chrome on the author's machine.

| Scene                              | Measured                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Caves**, 212×118 cells, mid-flow | ~1,900 active, ~1,070 stepped and **~830 changed per tick**. **~1.3 ms per tick** (40 ms/s at 30 ticks/s) |
| The same, as replication           | **≤ ~1,250 cells per 20 Hz broadcast, ≤ ~120 KB/s**, from one screen of flowing caves                     |
| **U-bend**, left arm poured full   | Settles with the left arm's surface at row 8 and the right arm's at row 30: **no pressure**, as designed  |
| Any scene, settled                 | 0 active, 0 changed. A still lake is free                                                                 |

What they say:

- **CPU isn't the problem; bandwidth is.** About a microsecond per stepped cell is affordable, even
  server-side across several active regions. But one screen of moving fluid changes more cells per
  tick than a player digs in an hour, and the current wire model sends every dug cell to everyone.
  Fluid is where [interest management](ARCHITECTURE.md#what-real-multiplayer-needs-decided-shape)
  stops being optional.
- **The lack of pressure is visible and consequential.** Tunnel under a lake and up the far side, and
  the water only fills your tunnel to the height of the connection. It never rises to meet you. That's
  safer and less dramatic than real hydraulics. It's a design call rather than a bug; decide it by
  playing the U-bend scene.

## Verification

`shared/src/fluid.test.ts`, as properties over random terrain and random pours:

- **Mass is conserved exactly**, every tick.
- **Fluid never occupies a solid cell.**
- **Stepping is deterministic.**
- **A closed basin settles**: the active set empties, and the surface is flat to within one unit per
  cell.
- **An inactive region freezes** its fluid without losing any of it.
