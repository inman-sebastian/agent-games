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

- **The static world gains a shape.** DELVE's world is a pure function of the seed, unbounded and computed per
  cell, so Terraria's Smooth World pass — sequential over a finite world, sharing one random generator, reading
  slopes it set a moment earlier — can't be ported literally. DELVE applies the same rules to each cell against
  the **unsmoothed** world, with a seeded hash of the cell in place of `genRand`. Where Terraria would pound a
  half brick, the cell stays full; where it would kill or place a tile, the cell opens or fills. This is the one
  deliberate deviation in the slope rules, and it's why world generation isn't checked against an oracle.
- **Mining** a slope is mining a cell: same hit points, same drops; dug, it's open like any cell.
- **No save or protocol change.** A cell's shape is computed from the seed, and `dug` already records what's
  been mined. (The hammer would change that: shapes would then need storing and syncing.)
- **Collision** ports Terraria's slope routines onto `physicsStep`, in cells, and is checked against Terraria's
  own `Collision.cs` compiled with stubs (the oracle method from [FLUIDS.md](FLUIDS.md#verification--the-oracle)).
- **Rendering.** The shape feeds the per-pixel rock mask (`buildMask` and its WGSL twin), so light, contact
  shadow and material shading follow the diagonal from the distance fields they already use. New work: erosion
  along the diagonal, the top-light rule for sloped floors, the material cross-fade, stalactites, lighting
  attenuation, damage cracks and twinkles — in TypeScript and WGSL together, gated by `pnpm render-gate`.
- **Liquid rendering** ports `DrawTile_LiquidBehindTile` into the liquid renderer, checked against the oracle.

## Work

Each phase is an issue under the slopes epic, docs first, a failing test before each rule:

1. [#92](https://github.com/inman-sebastian/agent-games/issues/92) Shape model: `shapeAt(seed, c, r)` and the Smooth World rules, in shared; mining a slope.
2. [#93](https://github.com/inman-sebastian/agent-games/issues/93) Collision: the port, and its oracle.
3. [#94](https://github.com/inman-sebastian/agent-games/issues/94) Rendering: the CPU mask and compositor, then the WGSL twin and the render gate.
4. [#95](https://github.com/inman-sebastian/agent-games/issues/95) Liquid behind slopes, and its oracle.
5. The game: slopes live in the world, the render gate green, playtested.
