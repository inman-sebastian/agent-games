# DELVE — slopes

Sloped cells: solid on one diagonal half, open on the other, on floors and ceilings. Epic [#91](https://github.com/inman-sebastian/agent-games/issues/91).

## The decision

**The author (2026-09-14): port Terraria's slopes, as with its liquid** — and base the terrain and blocks on
how Terraria does it generally, in DELVE's own art direction. Slopes are mineable like any solid cell.

- **Natural slopes only, for now.** Slopes come from world generation. There is no hammer: the player can mine
  a slope but can't make one (Terraria's hammer cycle is recorded below for when it comes).
- **No half bricks.** DELVE's cell is already half a block (the 2×2 split, [DESIGN.md](DESIGN.md#block-granularity--the-22-split-done)),
  so the states are full and the four slopes.
- **One slope per cell.** The cell is DELVE's tile: what the player digs, what liquid fills, 8 art px. Terraria's
  16 px tile maps to one cell, so a DELVE position × 16 is a Terraria pixel.

- **Rules on the CPU, everything drawn on the GPU** (the author, 2026-09-14, keeping RENDERING.md's
  2026-09-13 decision). World smoothing and collision are shared rules the server runs in Node and the
  oracles check, and Terraria's versions are order-dependent, so they stay in TypeScript. Every visual part —
  the slope mask and shading, lighting, liquid behind slopes — is WGSL, gated against its
  TypeScript reference.

## Terraria's rules (1.4.0.5, decompiled)

Read from the source, not a summary; line numbers are in the decompile ([AliceSavard/Terarria1405](https://github.com/AliceSavard/Terarria1405)).

**Representation** (`Tile.cs:216-238, 461`). `slope()` 0–4; 0 is a full block.

| Slope | Open corner  | Solid edges   | Surface                        |
| ----- | ------------ | ------------- | ------------------------------ |
| 1     | top-right    | left, bottom  | floor, descending to the right |
| 2     | top-left     | right, bottom | floor, descending to the left  |
| 3     | bottom-right | left, top     | ceiling                        |
| 4     | bottom-left  | right, top    | ceiling                        |

`WorldGen.SolidTile` is false for a slope; `SolidOrSlopedTile` is true (`WorldGen.cs:42315, 42350`) — rules
that say "solid" mean a full block.

**Liquid simulation** (`Liquid.cs`): no slope checks anywhere. A slope blocks liquid exactly like a full block,
so DELVE's port needs no change: a sloped cell is solid to the sim.

**Liquid rendering.** `LiquidRenderer` treats a slope as solid. `TileDrawing.DrawTile_LiquidBehindTile`
(`TileDrawing.cs:2411-2669`) draws liquid behind every tile before its sprite, so it shows through a slope's
open triangle: sourced from the tile's own liquid and from neighbours whose facing edge is open; a
full-width rectangle from the level line `floor((256 − level) / 32) × 2` px down; the whole tile when wet above
and beside; a strip when wet above or below only; hidden in a ceiling slope unless both side neighbours are wet
or full blocks.

**Collision** (`Collision.cs`), each tick: `WalkDownSlope` (follow a floor slope down instead of launching off),
`StepDown`, `StepUp`, `TileCollision` (floor slopes never snap a landing; skip the side wall of a block entered
from a slope), then `SlopeCollision` (feet ride the 45° line under the near corner; ceiling slopes push the head
down).

**World generation** — the "Smooth World" pass (`WorldGen.cs:7564-7690`): on exposed surfaces, steps become
slopes (or half bricks) 50/50, lone bumps are removed, step corners are filled with a slope, ceilings get
slopes 3/4 half the time, and a floor slope without support on its solid side is undone.

**The hammer** (`Player.cs:29920-29963`, not built): full → half → 1 → 2 → 3 → 4 → full, with 1/2 and 3/4
swapped when only the right neighbour is solid, and ceilings first under a solid above.

## Mapping onto DELVE

- **The static world gains a shape** (`shared/src/slopes.ts`, `shapeAt(seed, column, row)`: open, full, or a
  slope). DELVE's world is a pure function of the seed, unbounded and computed per cell; Terraria's Smooth World
  pass is sequential over a finite world, shares one random generator, and reads tiles it changed a moment
  earlier — a one-cell step would get two slopes side by side if each cell were judged alone. So the pass is
  **replayed statement by statement over fixed chunks of 64 columns**. Its rules read one column either side,
  and it runs two loops over the world: the first reads the column to its left after that loop and the one to
  its right untouched; the second reads the left after both loops and the right after the first. So **from
  column 0 rightward the chunks chain** (#93): each runs its first loop from its left neighbour's first-loop
  result, and its second once its right neighbour has run its first — every seam then reads exactly what one
  continuous pass would (`slopes.test.ts` checks the chain against a continuous run). Left of column 0, outside
  the world, each chunk starts from the unsmoothed world. Chunks that started from the unsmoothed world at
  every seam put two floor slopes side by side at about one seam in fifteen — a sawtooth the pass never makes,
  and one Terraria's collision lets a body's corner sink into. `genRand`, one stream through the whole pass,
  becomes a hash of the seed, the loop, the cell and the draw (`cellGenerator`): the second loop draws at every
  cell it visits, so a stream would make a cell's result depend on how many cells a chunk visited before it.
  Half bricks are tracked while the pass runs (its rules read them) and become full cells after.
  `solidAt` and `blockAt` answer from the shape (`Block.slope`), and `isDug` is just the dug map: smoothing
  fills the heightmap's surface row in places and clears the row below it in others, so "at or above the surface
  is dug" no longer holds.
- **Checked against Terraria's code.** `tools/terraria-oracle/harness/fetch.sh` extracts the Smooth World pass
  from the decompiled `WorldGen.cs` unmodified; `SmoothOracle.cs` runs it (with `SlopeTile`, `PoundTile`,
  `KillTile`, `PlaceTile` and `SolidTile` stubbed to their exact effects during generation) on
  `smooth-scenes.json` — real DELVE chunks from four seeds and synthetic terrain with big steps, overhangs,
  pillars and caves — and `smooth.test.ts` requires every tile's active, slope and half-brick bits to match.
- **Mining** a slope is mining a cell: same hit points, same drops; dug, it's open like any cell.
- **No save or protocol change.** A cell's shape is computed from the seed, and `dug` already records what's
  been mined. (The hammer would change that: shapes would then need storing and syncing.)
- **Collision** (`shared/src/collision.ts`) is Terraria's player collision, ported whole rather than bolted onto
  the old axis-separated resolve: `walkDownSlope`, `stepDown`, `stepUp`, `tileCollision` and `slopeCollision`,
  statement by statement, for gravity pointing down and a world of full cells and slopes (no half bricks,
  platforms, water walking or minecarts). They work in Terraria's units — a DELVE cell is a 16 px tile, velocity
  is pixels per tick — so the rules read like the original. `physicsStep` keeps DELVE's own movement (run,
  friction, gravity, jump, in cells per second), converts the tick's motion to pixels and calls them in
  `Player.DryCollision`'s order (`Player.cs:15167-15330`): walk down a slope, step down when resting, step up
  when not rising, collide with tiles, move, then ride slopes. Grounded means the collision stopped a
  downward move. Two consequences of taking it whole: the body walks down a one-cell ledge instead of dropping
  off it (`StepDown`), and it steps up while falling as well as while standing (`StepUp` only asks that it isn't
  rising). The body is sized in whole pixels, as Terraria's are (29 × 58, 1.8125 × 3.625 cells). Terraria marks
  "no tile found" with -1, which is a row above DELVE's row 0, so the port uses a value no row equals. `bodyFits`
  (spawn, `unstick`, the fuzz tests' never-inside-rock invariant) lets the body overlap a slope's open half. **Checked against Terraria's code:** `fetch.sh` extracts the
  five methods from `Collision.cs` unmodified; `CollisionOracle.cs` runs them on `collision-scenes.json`
  (bodies at real DELVE surfaces and in random slope grids, in whole or sixteenth pixels so single-precision
  C# and the port agree) and `collision.test.ts` requires the same result from each.
- **Rendering** (`buildMask` in `cave-render.ts`, `mask_main` in `rock.wgsl`, in lockstep). A solid cell's shape
  rides in bits 1–3 of the GPU world window. The mask leaves pixels outside a slope's solid half open
  (`insideShape`: the diagonal belongs to the solid half) and treats the diagonal as an edge, eroded by the same
  world noise (`diagonalDistance`, measured like a straight edge, so the pixel on it is half a pixel in). A side
  counts as exposed where the neighbour across it doesn't cover it (`covers`: a slope leaves its open sides
  exposed), and a slope's two tips round like convex corners. Light, contact shadow and material shading follow
  the diagonal from the distance fields they already use; the top-light rule counts a surface as up-facing to
  45° (depth below it up to √2 × the distance to it), so a sloped floor is lit like a flat one. The sky reaches
  down to each column's first full cell (`skyRowAt`), so a surface slope shows sky in its open corner. Damage
  cracks stay in the solid half. Lighting treats a slope as rock, as Terraria's does. Ore twinkles still follow
  only straight faces. **The render gate** gained two slope-sampler views (`gpu-lab`, `?slopes=1` to see it):
  every exposed cell near the centre takes one of the four slopes, since the heightmap has no overhangs to put
  ceiling slopes in the strata views; a broken ceiling slope in the WGSL fails both.
- **Liquid rendering** (#95). The sim is untouched: a slope is solid to liquid, as in Terraria. The renderer ports
  `DrawTile_LiquidBehindTile` (`liquidBehindTile` in `terraria-liquid-render.ts`): for each solid cell, which
  of its neighbours' liquid shows behind it, as the rectangle Terraria draws — from the tile's own liquid and
  from neighbours on its open sides, a full-width block from the level line, a strip under liquid above, hidden
  in a ceiling slope unless both sides are wet or full. The rectangle is filled only inside the slope's **open
  half** (`insideShape`), so a full cell gets none and the rock's eroded edge stays dry, as the author asked of
  liquid beside rock ([FLUIDS.md](FLUIDS.md#deviations)). Those pixels take DELVE's look: body, with the
  surface line where the rectangle's top is Terraria's top edge (source row 0). Terraria also draws the tile's
  side-edge frame there; DELVE draws edges only toward air, so it doesn't. **Checked against Terraria's code:**
  `fetch.sh` extracts the method from `TileDrawing.cs`; `BehindOracle.cs` runs it on random neighbourhoods
  (`behind-scenes.json`) and `behind.test.ts` requires the same rectangle, or none. The lab's **slopes** scene shows it.

## Work

Each phase is an issue under the slopes epic, docs first, a failing test before each rule:

1. [#92](https://github.com/inman-sebastian/agent-games/issues/92) Shape model: `shapeAt(seed, c, r)` and the Smooth World rules, in shared; mining a slope.
2. [#93](https://github.com/inman-sebastian/agent-games/issues/93) Collision: the port, and its oracle.
3. [#94](https://github.com/inman-sebastian/agent-games/issues/94) Rendering: the CPU mask and compositor, then the WGSL twin and the render gate.
4. [#95](https://github.com/inman-sebastian/agent-games/issues/95) Liquid behind slopes, and its oracle.
5. The game: slopes live in the world, the render gate green, playtested.
