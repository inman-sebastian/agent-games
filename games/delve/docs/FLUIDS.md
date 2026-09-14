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
- **the wave**: neighbours pull on each other (a damped 1D wave equation, substepped for stability), so a
  disturbance travels outward as ripples at `waveSpeed`;
- **viscosity** diffuses velocity between neighbours. It damps the shortest ripples and leaves long waves:
  without it, a breach's big step rang at the grid frequency as a sawtooth trailing the surge;
- **drag** grows with a column's speed: a fast bulk surge (a breach levelling) is braked hard, a slow ripple
  barely. With linear damping alone, a levelling surge overshot past level and sloshed back and forth; the
  author called it a rubber band snapping;
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
  - The spill point is the top of the column that actually goes down. The search can meet the drop
    through a notch beside it (the rock mask chips wall corners); a spill at the notch drew a zero-length
    stream.
  - The excess leaves as a **stream** and joins the body whose water it lands in, or starts a new body.
  - **The higher the water stands over the opening, the faster it leaves** (Torricelli). Through an
    opening `a` px high under a head `h`, the jet leaves at √(2g·(h − a/2)), contracted to 0.6 of the
    opening (the discharge coefficient): flow = 0.6·a·√(2g·(h − a/2)), plus a `streamRate` trickle of
    900 px/s. Over an open lip the opening is the whole head, and that's the weir law, ~h^1.5.
    - At a fixed 900 px/s, a breached reservoir's water stood over the lip as a wall for 15+ seconds, then
      merged all at once into a huge surge. Now a deep breach empties in about a second.
    - The opening is the open rows over the lip up to rock: a gap dug under the waterline jets out as
      thick as the gap, fast, while an open lip pours a sheet ⅔ of the head deep (the critical depth).
    - A lip with open space beside its drop pours off sideways; in a shaft or through a hole in a floor, it
      falls straight.
  - **Ledges don't pool.** A landing on a basin smaller than `LEDGE_CAPACITY` (24 px), such as a knob on a
    wall face, runs off that ledge's own spill and keeps falling, as another stream segment. The lab showed
    a stepped cascade of tiny pools down a waterfall. A dry landing inside a larger basin (below where
    that pool could rise) is also still a ledge until the pool reaches it. A basin whose overflow runs
    back into the source isn't a ledge: it fills.
- **Bodies merge** when their liquid touches, and when a body spills into one that's connected to it:
  - the other is full too (both stand above a shared rim), or
  - the other's liquid has risen back up to the spill point (a pool draining down a shaft into water
    that has filled up to meet it). Kept apart, the lab showed two stacked surfaces while one drained into
    the other.

  A merged body keeps both sets of seeds, so it fills both basins at once.

- **A pool that drains still shows its water.** A body holding more than its basin (the floor was dug
  out from under it) shows the excess in its **view**: rows stacked on its own water above the rim, each
  spreading sideways only over rock or water below it. It never shows water past the lip, over the drop.
  The first view flooded past the rim and drew a slab of water standing in the air.
- **Nothing teleports — the surface carries it.** A dig can change the true state at once: a pool joined
  to an empty basin levels immediately. The lab carries each column's _drawn_ surface height across the
  change, as the spring surface's offset from the new true top.
  - Where the rock was, the high side and the low side start as one big displacement. The wave carries
    it as a surge that settles at the true level.
  - A column new to water rises from its floor.
  - A column carries only its own body's surface, or one merged into it, never the pool above it.
  - Open air over a body's water is marked in the liquid mask, so a surface raised above the level draws
    there.
  - The first version moved _shown pixels_ toward the true state at the stream rate, top first. It left
    walls of water standing where the rock had been (the author's report).
- **Over an open lip, the drawn surface bends down to the top of the sheet leaving it** (smoothstep, reach
  2 sheet thicknesses, within 6–24 px). Without it, a draining pool ended in a cliff of water at the edge;
  with a reach proportional to the head, a tall pool bent across its whole width (the author: too extreme).
  A jet from a gap under water leaves the surface alone. Lab only.
- **Tests** (`bodies.test.ts`, each red-checked):
  - fills flat;
  - overflows a rim as a stream into the next basin, conserving every pixel;
  - drains through a hole dug in its floor;
  - merges pools joined below their surfaces;
  - one flat pool over a bumpy floor (fails without pits);
  - two full basins join over their rim (fails without the rim merge);
  - pours past little ledges on a wall face instead of pooling on each (fails without ledge running);
  - in motion, no two bodies' shown water ever stacks in a column (fails without merging on a risen
    spill);
  - a draining pool stays drawn until drained;
  - never draws water standing on air over a breached wall; its stream runs from the real lip, past a dry
    knob, to the floor (fails with the old view, spill point or landing);
  - never counts a pixel twice in a basin, over any rough floor (property; fails when pit pixels were
    queued twice, which inflated capacity);
  - pours a tall head out fast: no wall of water over the lip of a deep breach (fails at a fixed rate);
  - jets out of a gap under the waterline as thick as the gap, at √(2g·h) (fails when a gap pours like
    an open lip);
  - deterministic.

**Lab: digging patches the rock.** A dig used to re-render the whole screen of rock and its mask on the
CPU: 115–215 ms, a lag spike on every cell. The lab now re-renders a strip of columns around the cell.

- The strip is full height, so the strata colours match.
- Only its middle, where the shading can change, is copied back, and the mask is rebuilt for a few cells.
- A dig now costs 10–21 ms, and the water update ~2 ms.
- `fluidLab.verifyRock()` confirms the patched rock and mask match a full recompose exactly.
- The game draws rock on the GPU and doesn't have this cost.

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
- **Streams are falling sheets.** Off a lip, the sheet crosses it `thickness` deep at its `speed`, and its
  upper and lower faces fall as parabolas: a vertical cut through a falling sheet keeps its thickness,
  because the same flow crosses it. Its upper face carries the surface line; a few streaks run along the
  flow. Down a shaft or through a hole in a floor, a column that thins as it speeds up. A sheet stops where
  it enters water. A fall run off ledges draws as one sheet from the first lip.
  - The first streams were 3 px lines at any flow. The first sheets had stripes across the flow, which
    read as rungs, and an open-lip sheet from a gap under water, as deep as the whole pool (the author:
    way off).
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
