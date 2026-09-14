# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage** ([#88](https://github.com/inman-sebastian/agent-games/issues/88)). A real 2D FLIP/PIC
> liquid in `client/src/fluid/flip.ts`, exercised by `client/labs/fluid-lab.html`. It isn't in the game.
> The numbers here are lab defaults to tune, not decisions.

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## Decisions (2026-09-14)

- **Real 2D fluid simulation, not pixelated.** Six grid and pixel models were tried (see _History_). The
  last, a pixel automaton on the GPU, neither behaved nor looked the way the author wanted, so fluid is
  now simulated as a continuous liquid. The author accepts it may contrast with the pixel-art world, and
  wants to see whether it works.
- **FLIP/PIC.** Particles carry the liquid, and a grid solves pressure each step. Pressure is solved
  across the whole body at once, which is exactly what no local automaton managed: a breached reservoir
  surges and levels instead of creeping. The reference is Matthias Müller's _Ten Minute Physics_ FLIP.
- **Smooth, palette-banded rendering.** The surface is drawn smooth from the particles, at screen
  resolution with no pixel snapping, but in a few Resurrect-64 bands, so it belongs to the palette.
- **Single-player first.** The server is authoritative and runs Node with no GPU. The sim runs client-side
  for one player, and replication is decided later, from a working sim with real numbers. Until then,
  fluid doesn't block or harm the player.
- **TypeScript first, WebGPU later.** The sim is built and tuned in TypeScript, where it's testable and
  quick to change, and moves to WebGPU compute once the look and behaviour are right.

## What the grid models taught

The whole-cell prototypes ([#66](https://github.com/inman-sebastian/agent-games/issues/66), closed PR
[#67](https://github.com/inman-sebastian/agent-games/pull/67)) failed on look, but they taught rules
about liquid itself, and the pixel automaton that followed ([#87](https://github.com/inman-sebastian/agent-games/issues/87)) added the last one:

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
7. **Local rules can't level a body.** In a cellular automaton only liquid touching empty space can move,
   so a breached reservoir drains at about one pixel of mass per pass, however much pressure is behind
   it, and a slope stands like a dune. A pressure solve moves the whole body at once. That's why FLIP.

In FLIP, lessons 1–4 aren't rules to encode: they're what gravity, pressure and viscosity produce. Lesson
5 becomes a conserved particle count, with volume held by drift compensation. Lesson 6 stands: the tests
check shapes in motion.

## The model — FLIP/PIC

**Units.** Art pixels and seconds, y pointing down. Gravity is the player's (`engine.GRAVITY`, 46 blocks/s²,
736 px/s²), so liquid and miner fall together. The grid's cell spacing `h` is 4 art pixels, half a world
cell.

**State.**

- **Particles:** position and velocity. Particle radius `r = 0.3 h`, seeded `2r` apart.
- **Grid, a MAC grid:** horizontal velocity `u` on vertical cell faces and vertical velocity `v` on
  horizontal faces; pressure and particle density at cell centres.
- **Solids:** a cell is solid (`s = 0`) when at least half its pixels are rock in the rock's eroded mask
  (`buildMask`). Outside the simulated area is solid.

**A step** (substepped so no particle travels more than a cell):

1. **Integrate:** `v += g·dt`, `x += v·dt`.
2. **Separate particles:** `particleIters` passes of pushing overlapping pairs apart to `2r`, found
   through a spatial hash. It keeps particles from clumping where the grid can't see.
3. **Collide with rock** at pixel resolution. A particle inside a rock pixel moves to the nearest open
   pixel (a distance map rebuilt when the rock changes), and loses its velocity into the wall. So liquid
   meets the eroded stone edge, not the grid's squares.
4. **Particles to grid:** splat particle velocities onto the faces with bilinear weights, and mark
   cells FLUID (holding a particle), AIR or SOLID. Faces touching solid keep zero velocity.
5. **Density:** splat particle counts onto cell centres. Rest density is the mean over fluid cells when
   the liquid is first seeded.
6. **Pressure:** `pressureIters` Gauss–Seidel passes with over-relaxation (1.9), forcing each fluid cell's
   divergence to zero.
   - **Drift compensation:** a cell denser than rest is given extra outflow, so volume doesn't slowly
     vanish as the solver's error accumulates.
     - Its stiffness has to be scaled to our units. The reference subtracts the excess particle count
       straight from divergence, in metres per second with a 3 cm cell, about 33 cells/s per particle.
     - In art pixels that same 1 is a quarter pixel per second. The liquid settled 30–40% compressed,
       so `driftStiffness` is 133 px/s (33 cells/s × 4 px).
7. **Grid to particles:** FLIP's change is measured across the pressure solve alone, so the grid is
   recorded just before the solve, as the reference does. Recording it before the particle-to-grid
   transfer instead fed each step the whole difference from the last one, and a 192 px tank exploded
   to 60,000 px/s. Each particle takes a blend of the new grid velocity (PIC, stable but
   viscous) and its own velocity plus the grid's change (FLIP, lively but noisy). `flipRatio` 0.9 is
   water; lava is a low ratio plus extra damping (slow in time, lesson 3).

**Deterministic.** No `Math.random`: seeding jitter is a hash, and every loop runs in a fixed order, so a
scene replays exactly, which the tests rely on.

## Rendering

- **Splat:** each particle draws a soft disc into a float density target on the GPU, at screen resolution.
- **Threshold into bands:** a full-screen pass turns density into Resurrect-64 colours, water
  `#8fd3ff` rim, `#4d9be6` body, `#4d65b4` deep; lava `#fbff86`, `#f9c22b`, `#fb6b1d`, `#e83b3b`.
- **No pixel snapping:** the edge is smooth at screen resolution. The bands, not the pixels, tie it to
  the art style.

## Lab findings (#88)

`client/labs/fluid-lab.html`, with scenes reservoir, cascade and basin. Left pours, right digs,
shift builds.

- **A breach surges.** Dig the reservoir's wall and the water crosses the floor and splashes up the far
  wall within 0.7 s. It sloshes back as a curling wave and settles flat at its true depth.
  - That's the behaviour no grid or pixel model reached.
- **Streams and splashes.** A pool drains through a hole as a connected stream, splashes on the ledges
  below and drips off their edges.
- **Look:** smooth edges at screen resolution, in three bands (surface highlight, a ~14 px lighter body,
  deep). Small dark specks can appear along a floor where particle density dips. Tunable in the lab:
  splat radius, threshold, rim and deep depth.
- **Cost:** TypeScript, one step per frame. 741 particles take ~3 ms; the 8,137-particle reservoir takes
  16–20 ms, too slow for a frame budget. The sim moves to WebGPU compute next.

## Verification

`client/src/fluid/flip.test.ts`, bounded so the whole file runs in seconds:

- the particle count never changes;
- no particle ends a step inside rock;
- steps are deterministic, and stable (no NaN, speeds bounded);
- **in motion:** a dam break reaches the far wall within a second, then settles flat (surface within 9 px
  after 8 s) at its true depth (±2.5 px), with particles spread near their seeded spacing. That's the case
  the pixel automaton never passed.

Red-checked, and each fails:

- recording the previous grid before the transfer (the explosion);
- unscaled drift stiffness (the compression);
- no rock collision.

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
