# DELVE — fluids

Water and lava ([#30](https://github.com/inman-sebastian/agent-games/issues/30)). **The
highest-risk system in the design and the highest-value one**: simulated fluid is the genre's
strongest generator of emergent situations, and it's moved by the core verb, since digging is what
opens a path for it.

> **Prototype stage** ([#90](https://github.com/inman-sebastian/agent-games/issues/90)). The cell-pipe
> liquid (`shared/src/liquid.ts`) and its lab (`client/labs/liquid-lab.html`). It isn't in the game yet.
> The numbers are lab defaults to tune, not decisions.

## Two kinds of body

The distinction is load-bearing (see the epic):

| Body          | Simulated | Example                                                     |
| ------------- | --------- | ----------------------------------------------------------- |
| **Static**    | Never     | The lava ocean on the bedrock floor. Terrain, not a process |
| **Simulated** | Yes       | A flooded pocket you breach. The emergent-story generator   |

Everything below is about the simulated kind. Static bodies aren't built yet.

## Decisions (2026-09-14, #90)

Five attempts came before this one, and each ended buggy, ugly or both (see _History_). The last,
surface water (#89), was patched one review at a time until the author asked for a reset: research how
shipped games and papers actually do it, then choose. These decisions come from that research
(_Research_ below, with sources).

- **Simulate on the dig grid, draw at art resolution.** The liquid lives on the same 8 px cells the
  player digs, as an integer volume per cell. Every shipped side-view dig game does this (Terraria's
  16 px tiles, Starbound's 8 px, Oxygen Not Included's cells); only Noita simulates per pixel, and its
  water reads as water mostly because of its renderer. **All the smoothness is the renderer's job.**
  DELVE's first cell model failed on its picture (1 px films), not its grid: Terraria's renderer exists to
  hide exactly that.
- **The model is cell pipes**: a velocity per cell face, driven by the difference in hydraulic head, with
  slightly compressible full cells to carry pressure (virtual pipes, after O'Brien & Hodgins and Mei et
  al., on a vertical grid). It's the one candidate that covers every failure the reviews found: water
  falls, levels with momentum, fills U-bends, pours out of every opening at its own rate, and keeps a
  falling stream connected. Measured in a headless bench before any code went into the game (see
  _Verification_).
- **Pressure is not optional.** Without it (Terraria), water beside a side opening stands as a wall and
  a U-bend never levels. Those are the author's reported bugs.
- **Exact conservation.** Volumes are integers; every transfer is computed from start-of-step state and
  moved as a whole number of units, so update order doesn't matter and nothing is created or lost.
  Every shipped level-based system in the survey rounds or deletes fluid instead, and players find the
  duplication.
- **Deterministic, in shared, on the CPU.** The server runs the same step. Plain arithmetic, `floor`,
  `min`, `max` and `sqrt` are bit-identical across JavaScript engines; `pow` and `exp` aren't, so
  constants are baked.
- **Draw it like pixel art.** Every reference that looks right (Terraria, Celeste, Noita, Cainos,
  Saint11, Slynyrd) draws liquid on the art grid, in 3–5 tones, with an opaque surface line. The
  smooth, device-resolution surface of #89 is exactly what clashed. Sub-pixel motion is shown by tone,
  not by position ("move light, not shapes"), which answers the "low frame rate" reading that pushed
  #89 off the grid.
- **Falls are drawn as columns, not cells.** A waterfall is a whole-pixel column with vertical streaks, a
  bright mouth and a splash of crown, foam and droplets, sized by the flow the sim reports. Horizontal
  bands at a fixed spacing read as ladder rungs.
- **Single-player first.** When it's networked, clients never run the liquid step (no shipped game's
  client does): the server sends changed cells, quantised, to the clients that can see them.

## Research (September 2026)

Five parallel surveys: grid liquids in shipped games (with headless ports), falling-sand liquids (with a
leveling experiment), flux and pressure models (with a prototype), pixel-art liquid rendering (with
frames and a mock-up), and the engineering around them. Tags: **[S]** read in source, **[M]** measured,
**[V]** seen in frames.

**Simulation.**

- **Terraria** [S]: a byte per 16 px tile at 30 Hz. A tile drops everything that fits straight down
  (so nothing hangs), then sets up to 7 cells of its row to their rounded average (so surfaces stay
  flat). No pressure: side holes leave standing walls and U-bends never level [M]. Rounding, bumps and
  film deletion don't conserve (+1% in a port [M]; the wiki documents duplication).
- **Starbound** [S]: a float level and a pressure per 8 px cell. Pressure pushes overfill sideways and
  up, so U-bends level (8.7 s in a port [M]), but a draining tank slopes by up to 8 cells [M].
- **W-Shadow, jgallant** [S]: compressible diffusion. Slow, and piles at 45° (DELVE's first failure).
- **Noita** [S]: down, diagonal, sideways; no pressure found in the talk, data or shaders. Its water reads
  as water because of flat translucent colour and a refraction shader. Local rules alone can never
  fill a basin connected under the surface [M].
- **Virtual pipes** (O'Brien & Hodgins 1995; Mei, Decaudin & Hu 2007; Dagenais et al. 2018; lisyarus)
  [S]: flux accelerated by head difference, scaled so no cell goes negative. Levels at wave speed, with
  momentum. Nobody found ships momentum pipes on a vertical cell grid; the bench below is DELVE's own
  evidence.
- **Scale** [S]: nobody simulates everything every tick. Terraria keeps an active-cell list that sleeps
  after 8 unchanged updates, with a per-tick budget and watchdogs; Starbound caps background cells per
  update; Noita keeps a dirty rect per 64×64 chunk.
- **Netcode** [S]: Terraria, Starbound and Minecraft clients never simulate liquid. The server sends the
  current value of each changed cell (3–6 bytes) to clients that have the area loaded.

**Rendering.**

- **Terraria** [S]: fills a dry cell between two wet ones, anchors partial cells toward wet neighbours,
  smooths edge heights `(2·self + left + right)/4`, never draws water thinner than a quarter tile,
  trails a fading fall under wet cells over air, and draws waterfalls as decorative sprites.
- **Celeste** [S, V]: renders into a 320×180 buffer. A 1 px surface; big falls built from 1 px vertical
  lines offset by `round(sin(y/6 − 8t)·2)` in 3 px rows; ripples ±2 px at 80 px/s.
- **Cainos, Interactive Pixel Water** [V]: a pixel-stepped two-line surface, a tinted body, outlined
  flip-book splashes. No waterfalls.
- **Saint11, Slynyrd** [V]: 3-colour falls with random-length vertical streaks, a bright mouth, a jagged
  crown and a foam row wider than the fall. "Never move stuff more than 1 pixel."

## Terraria's liquid (the direction)

**Decided by the author (2026-09-14):** emulate Terraria's liquid as closely as possible, in DELVE's art
direction. Pressure, momentum and other mechanisms Terraria doesn't have are out.

It's a **port, not a paraphrase.** Two attempts written from a summary of Terraria's rules added their own
fixes (a full grid sweep, a held-up rule, pressure, erosion wetting), and each departure showed up as scan
lines, stepping, layering and air pockets. So both halves are translated statement by statement from
Terraria 1.4.0.5's decompiled source, kept alongside the research.

**Simulation** — `shared/src/terraria-liquid.ts`, from `Liquid.cs`:

- Every tile holds a liquid level 0–255. Liquid moves only through **an active list** (`Main.liquid`), in the
  order tiles were added: `AddWater` queues a tile, and every change wakes the neighbours it touched.
- **`Update`**, per entry: fall (move what fits into the tile below; both tiles skip their next visit), then
  spread along the row — the rounded average (.NET's round-half-to-even) of 7, 5, 4, 3 or 2 tiles by which of
  its neighbours two and three away are wet — with Terraria's film rule, 250/255 limits and the 254/255
  hysteresis. Lava waits five visits between moves.
- **`UpdateLiquid`** processes the list in slices over 7 cycles; at the end of each cycle, entries unchanged
  for 8 updates leave the list through **`DelWater`**, which deletes films under 2 and wakes what may still
  move. Overflow goes to a buffer; a list stuck at the same size for 10,000 cycles is flushed.
- A dug or built tile wakes the liquid in the 3×3 around it (`WorldGen.SquareTileFrame`).
- **Rate:** Terraria updates liquid 30 times a second on 16 px tiles; DELVE's cells are 8 px, so 60 updates a
  second moves liquid across the screen at Terraria's speed.
- **Left out, because DELVE doesn't have them:** slopes, half bricks, platforms, honey, water–lava reactions
  (one liquid per simulation for now), underworld evaporation, multiplayer sync, and the panic mode that
  settles a whole world after a minute of overflow. Terraria's quirks are kept, rounding included, so volume
  drifts slightly (within 2% in the tests), as it does in Terraria.

**Rendering** — `client/src/fluid/terraria-liquid-render.ts`, from `LiquidRenderer.cs`:

- `InternalPrepareDraw`'s passes, in order: gap fill (a tile between two with liquid, above and below or
  either side, shows their mean); the waterfall trail (10 fading tiles under water, 3 under lava); the four
  walls of each tile cropped toward neighbouring liquid, and the edge flags that pick a texture frame;
  smoothing (`(2·wall + neighbours)/4` along an edge); the two corner fixes; a draw rectangle never smaller
  than a quarter tile, at 60% opacity for water and 95% for lava.
- **The texture is DELVE's**, laid out like Terraria's 48×80 liquid frame (an edge block with a narrow
  two-sided column, inner corners, body): a surface line on top edges, a light line on side edges, and the
  body in DELVE's tint, darkened with depth by Bayer dithering, sampled at 8 px per cell.
- Liquid is drawn inside its own cells only. (Wetting the rock's eroded edge pixels was a DELVE addition;
  the author asked for it to go.)

**Tests** (`shared/src/terraria-liquid.test.ts`, red-checked): a dropped block settles flat, stays within 2%
of its volume and empties the active list (fails with no fall, and with no sleep); a floor hole drains its
pool; a breached reservoir levels across both sides (fails without the row spread); deterministic.

**The lab** starts on it (`client/labs/liquid-lab.html`); **S** or `?sim=pipes` switches to the cell pipes
and the smooth renderer, for comparison.

**Superseded on the way here** (in git history): a Terraria-style sim written from a summary
(`grid-liquid.ts`) and a grid renderer written the same way (`liquid-render-tiles.ts`).

## The model — cell pipes (superseded)

Kept for comparison in the lab while the Terraria-style liquid is judged.

`shared/src/liquid.ts`. Side view, rows grow downward, one cell is 8 art px.

**State.** `volume` per cell (an integer, `UNIT` = one full cell), and a velocity on each cell's right
and bottom face.

**Head.** Up is positive: a cell's floor is at `−row`. A cell filled to `a` (volume ÷ `UNIT`) has head
`−row + a`. A cell holding more than a full cell carries pressure: `−row + 1 + (a − 1)/ε`, so water
compressed by the weight above pushes back.

- **Across a side face,** water only pushes if it's held up: its head counts in proportion to how full
  the cell below is (rock counts as full). Water resting on air falls; it doesn't spread sideways from
  mid-air.

**Each substep** (`HZ` per second):

1. For every open face: `u ← (u + Δt·g·(headA − headB))·keep`, clamped to half a cell per substep.
2. The volume that face wants to move: `u·Δt` across a bottom face, `u·Δt·min(1, a_upwind)` across a
   side face (a shallow cell pours through a shallow window). Below a film threshold nothing moves
   sideways.
3. **Limiter**: each source cell scales everything it would send by
   `K = min(1, volume ÷ outflow)`, from start-of-step volumes, so no cell goes negative. A limited face's
   velocity is scaled by `K` too — except water falling down, which keeps its speed: a stream is thin
   because it's fast. Braked like the rest, a trickle over a lip crept down at a cell or two a second, in
   slow packets that piled into each other, and drew as nothing (the author saw water teleport between
   terraces).
4. Every transfer moves `floor(|T|·K·UNIT)` units from one cell to the other. Order-independent and
   exact.

5. **Surfaces level** (after the pipes, every substep). Each group of connected free surfaces —
   neighbouring columns whose resting water overlaps, not capped by rock — moves volume from columns above
   the group's mean level to those below it: 5% of each difference per substep (most of it closed in a
   tenth of a second), skipped once a group is within 1/32 of a cell, so still water sleeps. Taken from the
   top of high columns, given to the top of low ones (past a full cell, held there as pressure). Exact.
   - **Why:** the author wants surfaces almost completely flat. Momentum alone levels a surface no faster
     than a gravity wave crosses it, so a breached reservoir stood as a long slope for seconds, with bulges
     and dips; Terraria's water reads flat because its levelling averages seven cells at once. Pressure,
     openings, falls and U-bends (whose legs don't share a surface) stay with the pipes.
   - A breach's surface is within 6 art px of flat a second after it opens and within 1 by two seconds
     (76 px at one second without this).
   - The rate was swept headlessly: at 5% a breach is within 3 px of flat at one second and under 1 px by
     1.5 s, and a steady pour into a pool holds a hump of about 2.5 px. At 15–20% the levelling fights the
     pipes' momentum and the surface sloshes worse than without it. Held as pressure in a full top cell, the
     added water came straight back out as sloshing; it goes into the open cell above.
   - **Which water is a surface** (`waterRuns`): a column's run climbs from rock through wet cells and stops
     only below water pouring into it (a partly full cell falling faster than 6 cells/s). Stopping at the
     first partly full cell split a thin, layered pool into runs of different heights a few columns apart:
     they drew as steps and levelled as separate surfaces.

**Parameters (water).** `g = 92` cells/s² (the player's 736 art px/s²), `HZ = 240`, `ε = 0.01`,
`keep` = 20% retained per second, film threshold 2% of a cell. Stable while `Δt·√(g/ε) ≤ 0.6`.

- **Pressure ringing is damped separately.** Across a floor between two full cells, water only moves to
  compress or relax, and at the gentle damping a pool at rest rang for seconds, which would never let it
  sleep. Those faces keep 90% per substep. Side faces keep the gentle damping even when full: damping them
  too turned a breach's bulk flow to syrup (three tests failed).

**What this doesn't model.** Trapped air. Currents pushing the player. Mixing liquids. Evaporation.

**Compression is hidden from the picture.** A 20-cell-deep column holds about 2 cells of extra volume
compressed in its bottom cells. Drawn cell by cell, a deep pool's surface would sink by that much and rise
as it drains. The renderer draws each column of connected water from its total volume instead.

## Rendering

The style spec. Everything is drawn into the art-resolution layer and snaps to whole art pixels.

**Palette (Resurrect 64).**

| Role     | Water     | Lava      |
| -------- | --------- | --------- |
| Deep     | `#323353` | `#6e2727` |
| Body     | `#484a77` | `#ae2334` |
| Mid      | `#4d65b4` | `#e83b3b` |
| Light    | `#4d9be6` | `#fb6b1d` |
| Surface  | `#8fd3ff` | `#f9c22b` |
| Foam     | `#c7dcd0` | `#fbff86` |
| Specular | `#ffffff` | `#ffffff` |

The Deep Stone stratum's ramp is this same blue, so water may vanish against it. The lab compares it
with the teal ramp `#0b5e65 #0b8a8f #0eaf9b #30e1b9 #8ff8e2` before this is final.

**One shape: a density field and a threshold** (`client/src/fluid/liquid-render.ts`, over the rock
already drawn). Every cell gets a visual fill; the fill is interpolated between cell centres at every art
pixel; a pixel is wet where it reaches ½. That's how PixelJunk Shooter and metaball water draw fluid.
Pools, pours, surges and streams come out as one smooth silhouette that joins where they meet, and what
differs inside it is shading, blended per pixel.

- **Why:** the first renderer drew pools, surging masses and falling streams as separate cases. The
  author found the falls didn't blend with the rest, water seemed to stack, a stream vanished when thin
  (water teleported basin to basin), and flowing surfaces grew jagged spikes where the cases met or a
  cell flipped from one to another.
- **Resting water** is laid out from its column's volume: full cells under a top cell holding the
  remainder, so compression at the bottom of a deep pool doesn't sink the surface.
- **Falling water** is drawn by how much flows, not only how much a cell holds: a cell carrying at least
  0.05 cells a second down shows as a thin stream (a visual fill of 0.53), fuller as more flows. Only
  downward flow counts; boosting water flowing across a surface raised pointed peaks at every lip. A dry
  cell between two falling ones is drawn wet, so a trickle's packets don't break into dashes.
- **The body and the falls are two fields.** The body's outline comes only from water that isn't falling;
  falling water is sampled from its own field and dithered over it. Blended into one, a fall's cells flared
  the pool's outline into a mound where it landed.
- **A pool's surface carries across a drain:** a cell its water is pouring down through, with resting water
  on both sides, takes their fill, or the surface dipped into a notch over every hole.
- **Rock in a sample** takes the value of the water beside it in the same sample (across the row first,
  then up or down, then diagonally), so water meets walls and floors flush and never leaks through one.
- **Flow is read from cells that hold water.** A face out of an empty cell still carries a speed (gravity
  accelerates it with nothing to move); counted as flow, it boosted pool surface cells into peaks.
- **Films** on rock under 1.5 px aren't drawn: a drained pool left hairlines along its floor.

**Still water.**

- **Outline:** the Surface colour on every wet pixel touching open air above or beside it. Light on the row
  under a surface.
- **Body:** Mid over what's behind at 45%, darker with depth by world-anchored Bayer dithering toward Deep.
- **Life:** two slow sines travelling opposite ways shift where the field is sampled by up to 1 px, moving a
  kink along the surface (Celeste's idle surface). Sparse glints grow and shrink in place and drift.

**Falling water** is the pool's own tint with no outline, thinned by density, never a separate drawing.
Where the interpolated falling amount passes ½, it shows from a fill of 0.2 and is fully dense by 0.65; a
thinner pixel is drawn only when noise sliding down at the fall's speed (in 2 px droplets) says so, so a
trickle reads as droplets falling, a thick pour as solid water, with a few light streaks riding down it.
Only water falling with something other than water beside it, and fed from above, is falling water:
shaded inside a surge, its pockets hung under the surface as arrows, and a lone drop settling onto a pool
fuzzed the surface. Falling water isn't air to the pool's outline: the outline stops where a fall joins a pool instead of
wrapping it. **Foam** flickers on a pool's outline where a fall comes into it.

- **Why:** outlined like pools, falls read as separate ribbons and trickles as cartoon lines against the
  dithered rock (the author's review); the rock and the pools are soft and dithered, and now the falls
  are too.

**The grid renderer, under comparison** (`client/src/fluid/liquid-render-tiles.ts`, **G** in the lab,
`?render=tiles`). The author wondered whether the smooth look is too realistic: part of Terraria's charm is
that its liquids are drawn on the same grid as its blocks. So the same sim can also be drawn Terraria's
way (after its decompiled `LiquidRenderer`):

- every cell a partial block of its own 8 px, sitting on its floor when held up (by rock, or water that
  isn't falling) and hanging from its ceiling under water pouring over air;
- Terraria's edge smoothing, `(2·self + left + right)/4`, on a pool's top cells, so a surface steps by less
  than a pixel from cell to cell;
- gap fill between resting cells and down a stream, and a trail of three fading cells under water pouring
  over air;
- falling water fills its cell top to bottom, its width showing how much falls, hugging the wall it pours
  down (drawn as blocks hanging from each ceiling, a stream was a dashed ladder);
- a surface line only where water meets air above it, no outlined sides; the same palette, depth dither,
  glints, foam and streaks as the smooth renderer. About 1 ms a frame in the lab.

Both renderers pass the same invariants. If the grid reads better, the sim may be simplified to match
(Terraria-style falls and row averaging with integer volumes and a light pressure rule); that's a separate
decision, after the author compares these by eye.

**Lava** is the same renderer with the lava palette: 95% opaque, its fall fully opaque, streaks at a third
of water's speed, idle motion at 0.3×. In the sim it keeps 2% of its face velocity per second (water 20%),
with a film threshold of 8%: it creeps and settles slowly, but reaches just as far.

**The lab** (`client/labs/liquid-lab.html`) runs the cases the earlier reviews found broken: a reservoir to
dig freely, a full and a partial breach, three gaps, a gap under water, a pool over a cave, a lava breach,
a U-bend, and terraces to pour into. Right-drag digs, shift-drag builds, W pours, T compares teal water.
The sim costs 0.2–0.6 ms a frame there and the renderer 1–4 ms.

## Verification

**Bench** (September 2026, headless, before the model was chosen). Eight scenarios built from the
reviews:

- a full breach and a partial breach of a wall;
- a wall with three gaps;
- a gap below the waterline;
- a pool drained through a hole in its floor;
- a U-bend;
- a shallow dam break;
- a pour down terraces.

Each run checked conservation, water resting on air, films left behind and time to go quiet, and wrote
frame strips.

- Conservation was exact in every scenario, and each went quiet in 6–8 s.
- All three gaps poured at once; a floor hole kept a connected stream.
- 0.03–0.05 ms per substep over 1,000 cells.

**Renderer tests** (`client/src/fluid/liquid-render.test.ts`), run against both renderers, each red-checked: it never paints rock
however the water moves; a still pool's surface is exactly one line; a stream from a hole is drawn with
no dry row between the hole and where it lands.

**Tests** (`shared/src/liquid.test.ts`), each red-checked against a broken rule:

- conserves every unit and never goes negative, through random caves, pours and digs (property);
- deterministic;
- water falls: nothing stays resting on air for a tenth of a second (a landing's bounce may turn around
  there), and a dropped block lands;
- a trickle falls fast, not in slow packets (fails when falling faces are braked by the limiter);
- a breached reservoir stays nearly flat while it levels: within 6 art px at one second, 1 at two (fails
  without surface levelling: 76 px);
- a thin, layered pool is one surface however its cells are filled (fails when a run stops at the first
  partly full cell);
- a heap levels flat to within a pixel;
- both legs of a U-bend level (fails without pressure);
- every gap in a breached wall pours at once (fails when only a surface can spread);
- no wall of water beside a breach: the step is under two cells in 1.5 s, flat in 7.5;
- a pool drains through a floor hole as a connected stream, at most one dry cell in it;
- a settled pool stops moving (fails without the pressure damping);
- a deep pool's surface is drawn from its volume (fails when drawn from cells);
- a stream falling into a pool isn't part of the pool's surface (fails when resting runs climb through
  partly full cells).

## Not built yet

- **Active sets.** Cells sleep when nothing changes, and wake when a neighbour or a dig touches them
  (Terraria's list, Noita's dirty chunks). Needed before world scale.
- **World integration.** The step on the server's tick, around players; digging wakes it.
- **Netcode.** Changed cells, quantised, to the clients that can see them.
- **Films.** Draining leaves shallow films on floors; the renderer doesn't draw a pool under 1.5 px, but
  the volume stays. They want a slow creep toward the nearest way down (or a counted evaporation), never
  silent deletion.
- **Reactions.** Water meeting lava makes rock.
- **The GPU renderer.** The lab draws with the TypeScript renderer; the game gets a WGSL port of it,
  gated against it, once the look is approved.
- **Static bodies, breath, running to completion on resume** (the epic).

## History — surface water (#89, replaced)

Flat bodies with one level each, spring-ripple surfaces, streams between bodies and a device-resolution
water shader, on branch `delve/fluid-surface`. The author's target was Cainos' _Interactive Pixel Water_.

- **What worked:** the spring surface (a damped wave per pixel column) and splashes read well on a
  still pool.
- **What didn't:** every way water moves was a special case bolted onto "a body with a level". Each
  review found the next hole, and each fix was a patch:
  - shown pixels catching up to the true level left walls of water standing where rock had been;
  - two bodies stacked in one shaft; waterfalls cascading over little ledges;
  - a draining pool drawn as a slab past its rim, then as a cliff, then bent across its whole width;
  - fixed-rate spills held reservoirs up as walls for 15 s, then merged into a rubber-band surge;
  - **one spill point per body**, so a wall with three gaps poured from one, while water stood beside
    the other two;
  - sheet-shaped streams that matched neither their openings nor the art.
- **Lessons carried forward:** don't model water as special cases of a static body; don't patch a model
  report by report when a report shows a structural limit; draw on the art grid.

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
