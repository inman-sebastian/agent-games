# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage** ([#89](https://github.com/inman-sebastian/agent-games/issues/89)). Interactive
> surface water: `client/src/fluid/surface.ts` and `client/labs/fluid-lab.html`. It isn't in the game.
> The numbers here are lab defaults to tune, not decisions.

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## Decisions (2026-09-14)

- **The target is a look and a feel, not water physics.** The reference is Cainos' _Interactive Pixel
  Water_ for Unity. Simple water bodies with a surface that ripples when anything disturbs it, small
  splashes, and a shader that makes it read as water. Seven simulated models came before this (see
  _History_). The last, a full FLIP liquid, surged and splashed correctly but read as jelly, and full
  physics was never the goal.
- **A body is a volume with one flat level.** Nothing simulates the water inside it. What's alive is the
  **surface**: a row of springs along the top edge.
- **Digging still moves water**, which the design needs (see the epic):
  - when a dig connects bodies or opens a hole under one, volume moves at a set rate until the levels
    settle or the space below fills;
  - the pour is drawn as an animated stream that disturbs the surface it lands in.
  - This is step 2; step 1 is the surface and the look.
- **Pixel style.** Drawn at art resolution with a bright surface line, a see-through tint, wave
  distortion of what's behind it, and shimmer, on the Resurrect-64 palette.
- **Single-player first**, as before.

## What the earlier models taught

The whole-cell prototypes ([#66](https://github.com/inman-sebastian/agent-games/issues/66), closed PR
[#67](https://github.com/inman-sebastian/agent-games/pull/67)), the pixel automaton
([#87](https://github.com/inman-sebastian/agent-games/issues/87)) and the FLIP liquid
([#88](https://github.com/inman-sebastian/agent-games/issues/88)) each left lessons. Those that still
apply to a flat body with a surface:

1. **Water settles flat.** A body's level is one row, whatever shape holds it: no slopes, piles or
   plateaus (the whole-cell and pixel models' hardest problem, answered by construction here).
2. **Viscosity is slowness in time, never shorter reach.** Lava is the same model: a slower flow rate
   and stiffer, slower ripples. It never heaps.
3. **Volume is conserved exactly** when it moves between bodies (step 2): a count of pixels, not a float
   that drifts.
4. **Test behaviour in motion,** not only at rest: ripples spread and die, flows settle.
5. **Local pixel rules can't level a body,** and **full physics isn't the look.** A cellular automaton
   drained a breach through a one-pixel film. FLIP moved the whole body but read as jelly. What sells
   water in a 2D game is the surface and the shader, so that's what's simulated.

## The model — surface water

**A water body** is a region of open pixels below a flat **level** row. It spans the columns of the open
run that holds the level, and in each column it reaches down to the rock below. Its volume is the count
of those pixels. (Step 1 has fixed bodies. Step 2 moves volume between them.)

**The surface** is one spring per pixel column across the body, the standard 2D interactive-water model
(see _Prior art_):

- each column has a vertical offset from the level, in art pixels (down is positive), and a velocity;
- **tension** pulls each column back toward the level, and **damping** bleeds its speed, so disturbances
  die out;
- **spread**: each step, a few passes pass a fraction of each column's height difference to its
  neighbours as velocity, so a disturbance travels outward as ripples;
- **disturb** adds velocity to the columns under an impact, scaled by the impact's speed, falling off
  with distance.

It's pure, deterministic TypeScript, and cheap: a few thousand springs for a screen of water.

**Splashes** are small ballistic droplets thrown up where something breaks the surface. They're
decoration: they fall back, and vanish in water or on rock without adding to it.

## Flow — how digging moves water (step 2)

`client/src/fluid/bodies.ts`. Pure, deterministic, and volumes are whole pixels.

- **A basin fills lowest pixel first** from the body's seeds (where its liquid came to rest). The level
  is the highest row filled. The body's liquid is the first `volume` pixels of that order, sorted lowest
  row first, so any volume stands flat.
- **Pits are part of the basin.** A pixel reached below the level is a pit if everything connected
  below the level lies within `PIT_DEPTH` (3) rows of it. The eroded rock leaves such pits all along a
  floor, and treating each as a way down kept a pool trickling into itself.
- **Deeper, it's a way down: the basin spills.**
  - Its capacity stops below the rim's own row, since water standing that high is already over it.
  - The excess leaves as a **stream** at `streamRate` (900 px of volume per second), falls straight
    down, and joins the body whose basin it lands in, or starts a new body.
- **Bodies merge** when their liquid touches, and when two full bodies spill into each other (they
  stand above a shared rim). A merged body keeps both sets of seeds, so it fills both basins at once.
- **Nothing teleports.** A dig can change the true state at once (a pool joined to an empty basin
  levels immediately), so what's _shown_ follows the true state at the stream rate: the highest pixels
  clear first and the lowest fill first. A breached reservoir's level visibly falls while the other side
  fills from the bottom.
  - The surface is drawn per column from what's shown, so the two sides can stand at different heights
    while water flows.
- **Tests** (`bodies.test.ts`, each red-checked):
  - fills flat;
  - overflows a rim as a stream into the next basin, conserving every pixel;
  - drains through a hole dug in its floor;
  - merges pools joined below their surfaces;
  - one flat pool over a bumpy floor (fails without pits);
  - two full basins join over their rim (fails without the rim merge);
  - a joined basin fills visibly rather than at once (fails if the display snaps);
  - deterministic.

## Rendering

- **Where water is:** in each body column, from the level plus that column's offset down to the rock.
- **Smooth surface, pixel rock.** The water is drawn at screen resolution: the surface height blends
  between neighbouring columns and moves in sub-pixel steps, while the rock inside and behind it is
  sampled per art pixel.
  - The first version snapped the water to whole art pixels. A 1–3 px ripple then stepped a pixel at a
    time, cut square notches, and the author read it as a low frame rate.
  - The lab's **P** key restores the snapped version for comparison.
- **One surface line and one body tint.**
  - The surface is a line one art pixel thick: water `#8fd3ff`, lava `#fbff86`.
  - Below it, one see-through tint over the rock behind: water `#4d65b4` at 55%, lava `#e83b3b` at 92%.
  - The first version stepped through shallow, deep and deepest tints; the author found the bands odd.
- **Life:** short glints glide continuously along just under the surface, fading in and out.
  - Everything that moves moves every frame. The first shimmer stepped 6 times a second, and the rock
    behind wavered a whole art pixel at a time. At a measured steady 60 fps the author still read the
    surface as choppy.
  - Wavering is off by default: pixel art can only waver in whole-pixel jumps.

## Verification

`client/src/fluid/surface.test.ts`:

- a surface at rest stays at rest;
- a disturbance spreads to neighbouring columns;
- ripples die out;
- stepping is deterministic and stays bounded under repeated hard impacts.

## History — the FLIP liquid (#88, set aside)

A real 2D FLIP/PIC liquid (Müller's _Ten Minute Physics_ FLIP, on a 4 px MAC grid), drawn smooth and
palette-banded on WebGPU, on branch `delve/fluid-flip`.

- **What worked:** a dug-away reservoir surged across and up the far wall within 0.7 s and settled flat
  at its true depth. Pools drained as connected streams.
- **Found by measuring:** the reference's drift stiffness is in metres, so in art pixels it was over
  100× too weak (30–40% compression). Recording the grid velocity before the particle transfer rather
  than before the pressure solve made a tank explode.
- **Set aside:** it read as jelly, not water. It cost 16–20 ms per frame at 8,000 particles in
  TypeScript. And the author's reference turned out to be surface water, not full physics.

## History — the pixel automaton (#87, parked)

A Margolus block automaton over art pixels, on WebGPU with an exact TypeScript twin, on branch
`delve/fluid-gpu`. What it got right, and why it was set aside:

- **What worked:**
  - exact GPU/twin parity;
  - a hydraulic head field so a dug-away dam face collapsed at once;
  - whole falling runs so streams stayed connected;
  - flat settled pools with a 1/256 px head cost.
- **The author's review found:** gaps against rock (a see-through shade over the rock's contact shadow),
  particle-like falling pixels, and spiky surfaces, all fixed.
- **The fundamental limit:** slopes levelled at about one pixel of mass per pass, because only liquid
  touching empty space can move.
  - Row transport, letting liquid move up to 7 px along a row, didn't help: on a slope only one pixel
    ahead is supported.
  - The remaining fix, virtual pipes on a layered height field, was a large change with real risks.
    The author chose to try real fluid first.

## History — four whole-cell models (#66, #67)

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

Added for FLIP: [Ten Minute Physics, FLIP fluid (Müller)](https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/18-flip.html) ·
[Extended virtual pipes, multi-layered shallow water](https://www.sciencedirect.com/science/article/abs/pii/S0097849318301341) ·
[webgpu-shallow-water](https://github.com/lisyarus/webgpu-shallow-water)

Added for surface water: [Interactive Pixel Water (Cainos, Unity Asset Store)](https://assetstore.unity.com/packages/vfx/shaders/interactive-pixel-water-346638),
the target look · [Make a Splash with Dynamic 2D Water Effects (Hoffman, Envato Tuts+)](https://gamedevelopment.tutsplus.com/tutorials/make-a-splash-with-dynamic-2d-water-effects--gamedev-236),
the spring surface · [Cyanilux: 2D water shader breakdown](https://www.cyanilux.com/tutorials/2d-water-shader-breakdown/)
