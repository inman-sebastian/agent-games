# DELVE — brainstorm scratchpad

> **Temporary, and no longer just idea capture.** Lives on the `delve/design-brainstorm` branch
> only, and **nothing here is implemented**. But plenty is now *decided* — see the provenance
> markers below, and mind the difference between a decision and a proposal.
>
> **DESIGN.md is provisional, not authoritative.** Where an idea below contradicts
> the shipped design, assume the shipped design is what changes. Ideas that survive
> get folded into [DESIGN.md](DESIGN.md) (what the game is) or the art docs, and
> this file gets deleted.
>
> **Provenance matters here, and this doc got it wrong repeatedly.** Author decisions and agent
> synthesis carry different weight and must stay distinguishable. Three markers:
>
> - **Decided** / **Resolved** — the **author's call**. Build on it.
> - **Guideline** — the agent derived it from the discussion. Useful, advisory, and
>   **overrulable without argument**. A guideline must never harden into a constraint that blocks
>   an idea on its own; if a synthesized principle is being cited as a reason something *can't*
>   happen, that's the bug, not the idea.
> - **Speculative (unratified)** — agent-proposed and **never ruled on by the author**. Do not
>   build on it, and do not cite it as settled. A
>   [provenance audit](#appendix-provenance-audit) found ten such claims that had been written up
>   as decisions; they're indexed there and marked in place.
>
> Three decisions in this doc turned out to be ideas a previous session inflated into settled
> direction (the behaviour-over-numbers rule, horizontal wrapping, and fluid "settling" on
> resume). Assume more exist until audited.
>
> Baseline: DESIGN.md as of `ac8b07a`, re-baselined from `e5754f1` mid-session. Main shipped
> two things this document had been arguing *for* — the coin economy's deletion and the move to
> Vitest — so those passages now read as records of what happened rather than recommendations.
> Everything before this session is prototype.

---

## Glossary

**Provisional, and accepted as good enough for now.** Some of this vocabulary is expected to
change as the docs are ironed out and a real design document is nailed down. Nomenclature drift
has already caused one wrong decision here, so the words are pinned *now* rather than waiting for
the final names, and every section should use them with these meanings until they're revised.

| Term | Means |
| --- | --- |
| **Stat** | A *resolved* number describing current capability, computed by `stats()`. Never stored, always derived from everything below. "Dig damage per hit" is a stat. |
| **Attribute** | A persistent, **player-owned** value that feeds a stat, grown by the player's own progression and **independent of gear or location**. The intrinsic layer. (What `up.pick` / `up.speed` currently stand in for.) |
| **Skill tree** | The structure through which the player *chooses* which attributes to grow. Borrowed from incremental games as much as from RPGs. |
| **Modifier** | A contribution to a stat from a source that isn't an attribute — equipment, environment, a temporary effect. Every modifier has a **source** and a **lifetime**. |
| **Unlock** | A binary capability gate rather than a graded value: you have it or you don't. (`tech.lantern` is an unlock, not an attribute.) |
| **Lamp** | The player's own light **emitter** — reach and intensity. What the code currently calls `vision`. One source among many; the world has its own. |
| **Equipment** | An item occupying a scarce [slot](#limited-slots-as-a-core-loop). Has **its own upgrade path**, and may contribute modifiers to stats. |
| **Loadout** | The set of currently equipped items. |
| **Progression layer** | One independent system that grows over time — attributes, equipment, unlocks. **Layers coexist by design**; they are not alternatives. |

### Retired terms

These appear in older passages and are **actively misleading**. Replace on sight:

| Retired | Why | Use instead |
| --- | --- | --- |
| **Upgrade level** | Implies buying or leveling, which is only one of several sources | **Attribute** |
| **Progression spine** | Implies exactly one system owns "the player gets stronger." False by design — see [T1](#t1-progression-is-layered-so-the-layers-must-do-different-jobs) | **Progression layer**, plural |
| **Progression channel** | Same problem: framed layers as rivals competing for one job | **Progression layer** |
| **Enhancement** | Used loosely for attributes, modifiers and unlocks alike | Whichever of those three is meant |
| **Vision** | Implies revealing tiles. There is no fog of war and no seen-memory — lighting is per-pixel illumination, and any world light source lights the player regardless of their own | **Lamp** (the player's emitter), or **illumination** (what's actually lit) |

---

## 1. What DELVE is becoming

**A Terraria-like.** That inspiration is settled and not up for debate — it's the
foundation, not one option among several.

The genre is best described as the intersection of seven categories. Listing them
together is the fastest honest summary of the target:

| Category          | What it means here                                                          |
| ----------------- | --------------------------------------------------------------------------- |
| **Exploration**   | The primary driver. Digging is how you travel; finding is the reward.       |
| **Open world**    | Large and bounded, with **hard edges** — not infinite, not wrapping. See [§4](#hard-edges--but-not-a-visible-box). |
| **Incremental**   | Continuous, compounding growth in player capability.                        |
| **Survival**      | Enemies + player health + situational breath. **No attrition meters.**      |
| **Crafting**      | Tools, weapons, equipment are made, not just bought.                        |
| **Base building** | _(purpose TBD — see [Open questions](#open-questions))_                      |
| **Light RPG**     | _Elements_ of RPGs, not the genre: equipment, skill trees. See the caveat below. |

**Caveat on "Light RPG": it carried more weight than intended.** It was never meant as a genre
commitment — the intent is that *some elements* of RPGs suit DELVE, specifically **equipment** and
**skill trees**. Skill trees arrive from the incremental side as much as the RPG side, so the
label is doing double duty and overstating both.

What's in: equipment that changes what you can do, and attributes the player invests in
([Progression is layered](#progression-is-layered)). What's out: classes, quests, dialogue trees,
and a character sheet of numbers. Where this table's labels and the doc's prose disagree, the
[Glossary](#glossary) wins.

### Survival, scoped

**Resolved.** Survival here means *danger*, not *attrition*:

- **Enemies exist** and are a real threat.
- **The player has health** and can die.
- **Breath** applies situationally — underwater sections, exactly as in Terraria.

Explicitly **out**: hunger, thirst, stamina, temperature, fatigue, torch fuel, and
every other meter that ticks down while you play normally. Nothing punishes the
player for simply existing in the world; threat comes from what's *in* the world.

### Death: you lose the trip, never the character

**Decided.** The three losable things are cleanly separable, and only the cheapest one is lost:

| | On death |
| --- | --- |
| **Inventory** | **Dropped** — and **recoverable** |
| **Equipment** | Kept |
| **Attributes** | Kept |

The loss is scoped to **the expedition**, which is exactly the unit
[capacity](#capacity-limits-variety-not-volume) already operates on. Nothing that took real
investment is ever at risk, so the
[investment arc](#the-investment-arc) survives — losing the item that used to embarrass you and now
carries you would undo the relationship [§11](#11-equipment-the-investment-arc--the-loadout) is
built around.

**Respawn, in priority order:**

1. **A base**, once bases exist.
2. **A player-placed respawn beacon** — a strong candidate for a piece of equipment.
3. **Fallback:** a determined safe area, or somewhere on the surface.

#### What this settles beyond the question itself

- **Beacons are the first confirmed _placeable_.** That fills the
  [action bar](#the-action-bar-a-satisfactory-style-assignable-bar)'s otherwise-empty "placeable
  materials" category, and it means **placement exists as a mechanic before base building does**.
- **Surface respawn is the launch behaviour, not the fallback.** Bases don't exist and beacons are
  equipment, so the real ordering is surface → beacons → base.
- **A base gets a fourth job** ([Q2](#open-questions)): housing, storage, safe panel use, and now
  respawn point.
- **It decouples Q1 from chaos.** [§10](#10-chaos-floated-not-committed)'s unratified claim was that
  high chaos requires cheap failure. This penalty is *already* cheap, so the chaos question no
  longer has leverage over the death question.

#### Recovering the bag

**Decided.** Recovery has a real problem — there's **no seen-memory and no early map**, so finding
where you died is a genuine navigation task. Two cheap answers, both adopted:

- **The dropped bag emits light.** Light bleeds 2–3 tiles into rock
  ([§6](#light-an-untradeable-floor-everything-above-it-earned)), so the bag **blooms on the rock
  face before it's visible**. No HUD marker, no map dependency, no new system — the same mechanism
  that makes lava and glowing caverns telegraph themselves — and recovery gets *easier* the closer
  you get, which is the right gradient.
- **The bag hovers and bobs.** Motion is the most reliable "look here" signal, and idle life is
  already house style ([JUICE.md](JUICE.md)) — nothing on screen should be perfectly still.

**Residual, multiplayer:** are beacons per-player or shared, and does a placed beacon keep occupying
its equipment slot? Beacons are **world**-scoped state while respawn is a **character** concern, so
a beacon in one world does nothing in another.

### Mining's role is changing

Mining **stays a core loop** — that isn't in question. What changes is its
*purpose*. Until the economy was deleted, mining was the whole game: you dug to get ore to
buy upgrades to dig deeper, a closed incremental loop. Going forward, mining leans much harder
into being **the means of exploration** — the way you move through and open up the world —
rather than an end in itself.

That closed loop is now **gone rather than replaced**: mining drops materials into an inventory
and nothing consumes them. So the reframing here isn't a course correction away from a working
loop, it's the design for the hole where one used to be.

### Everything is mineable, and everything is collectible

**Decided.** Every material in the world can be destroyed and goes into the inventory. Dirt is
collected exactly like stone, exactly like ore — there is no "scenery" tier of tile that exists
only to be deleted.

**This confirms main's material-unification direction and supplies its missing reason.** The
roadmap's phase 3 ("merge the resource types + make the background rock collectible") was
already planned; what it lacked was a *why*. This is it: **everything collectible means
everything is a crafting input**, which is what links material unification to the progression
rebuild rather than leaving it a rendering refactor.

**One exception: bedrock.** The world's vertical bound ([§4](#4-world-topology--hosting)) is
expressed as unbreakable rock, Minecraft-style. Simple, honest, and a single special case in a
system that's otherwise uniform.

**Structures are gated, not exempt** — see
[Breaking into structures](#breaking-into-structures-is-a-tool-gate-not-a-wall).

**Consequence, and it's a real one:** digging is the traversal verb, so *travelling* now
produces items continuously. Combined with finite capacity that makes the bag fill from
movement rather than from discovery — see
[T12](#t12-capacity-as-progression-taxes-the-discovery-pillar).

> **Honest state of the prototype:** there is no real game loop yet. That's expected
> and fine — everything to date has been prototyping (world gen, rendering,
> lighting, movement, client/server). This session is where the actual game gets
> designed.

---

## 2. Discovery & the unexpected

The single most important feel target, borrowed directly from Terraria: **while
digging, you find things you weren't looking for.** The world should regularly
interrupt your intent with something worth abandoning it for.

### Buried structures

Man-made structures buried underground — entombed for who knows how long. The
player breaks through a wall and finds not more rock but an **interior**: a space
that was built, with intent, by someone.

- They are **enterable and explorable** — real interior space, not a decorated
  pocket of ore.
- They can contain **enemies**.
- They can contain **loot**.
- Their age and abandonment is part of the appeal — implied history, no exposition.

### Breaking into structures is a tool-gate, not a wall

**Decided.** Structure walls are breakable **with the right or upgraded tools**. They're not
permanently unbreakable; they're a progression gate. And if a player chooses to demolish a
structure entirely, **that's their call** — no machinery to prevent it.

Two things fall out that are worth building deliberately:

- **A sealed structure you can't open yet is a breadcrumb.** Finding one early and being unable
  to enter is a promise the world makes and later keeps, which is a better answer to
  [T9](#t9-exploration-still-needs-breadcrumbs) than a HUD marker and costs nothing extra.
  Terraria's dungeon works exactly this way.
- **The gate only works if the shell is complete.** If the walls are gated but the rock behind
  them isn't, players tunnel *around* and come up through the floor, and the gate is theatre.
  A gated structure has to be **fully enclosed** in the gated material. Terraria's dungeon is
  entirely dungeon brick for precisely this reason.

**Residual, not urgent:** in a shared world one player can demolish a landmark everyone else was
using. That's the same shared-world griefing question parked in [Q2](#open-questions), not a new
one.

### Underground biomes

Distinct biomes encountered by digging, in the Terraria mold — the example given
was stumbling into a **glowing mushroom cavern**. Each biome should read instantly
as somewhere *else*: its own palette, light, flora, hazards, and finds.

Confirmed so far:

- **Glowing mushroom cavern** (the canonical example).
- **Molten / core biome** at extreme depth — lava pockets, heat, presumably the
  most dangerous band in the world. See [§3](#3-fluids-water--lava).

**Discoverability and exploration are a headline pillar**, not a feature. The
question "what's over there / down there?" is the engine of the game.

### Biomes come in two kinds: bands and pockets

**Decided.** Biome *type* determines its shape in the world, and both shapes are wanted:

| Kind | Shape | Confirmed example |
| --- | --- | --- |
| **Band** | A horizontal layer at a given depth range. Everyone reaches it by digging deep enough. | **Molten core** — the bottom-most layers |
| **Pocket** | A region placed *somewhere*. You find it or you don't. | **Glowing mushroom cavern** |

**Scarcity varies by biome, deliberately.** Some make more sense as a *single* instance, which
makes finding it an event and makes it a **landmark**; others work fine repeated. Which is which
is per-biome, not a global rule.

Three things follow immediately, without waiting for the full roster:

- **Only bands can safely gate progression.** A band is guaranteed by construction — dig down far
  enough and you're in it — so the content gate can assume it exists. A pocket's presence is a
  placement outcome, so **no crafting-tree material may depend on a pocket biome** until pocket
  guarantees are decided. That's an actionable rule now.
- **Bands nearly ship on today's generator; pockets are what need the new one.** Depth bands with
  their own palettes are what the **strata** system already is, so a band biome is an extension of
  something that exists. Pockets are the thing that requires
  [placement beyond depth](#both-of-these-need-a-placement-system-that-main-has-already-named)
  (noise regions, proximity, features).
- **Single-instance biomes are landmarks.** A unique biome is a fixed point players navigate by,
  so landmark-scarcity does navigation work on top of its discovery value. _(This was originally
  justified as compensation for wrapping removing the reference frame; with
  [hard edges decided](#hard-edges--but-not-a-visible-box) the compensation isn't needed, but the
  landmark value stands on its own.)_

#### Parked for a dedicated biome session

Deliberately not answered here — this needs its own Q&A, starting from the **roster** and deriving
the rest from it:

1. **What biome types exist**, and which are bands, pockets, or **surface** regions — a third
   shape, since the surface is [real content](#the-surface-is-real-content-subordinate-to-the-mine).
   Everything below depends on this.
2. **How many pockets per world**, and whether the size preset scales the count (see the
   [per-player density](#player-cap-scales-with-world-size) invariant, which implies a Large world
   gets *more of each* biome rather than *more kinds*).
3. **Per-biome scarcity** — which are single landmarks and which repeat.
4. **Whether every world contains every biome.** Guaranteed presence is what would let a pocket
   biome gate a material; variable presence makes worlds distinct and rerollable but forces the
   gate to prove reachability without assuming any given biome.

### Both of these need a placement system that main has already named

Structures and biomes are the same technical request: *something other than depth decides
what's here.* Today `band` / strata `top` is the **only** input to placement, so the world is a
pure function of row and every biome would be a horizontal stripe. Main's roadmap already calls
this out as a placeholder under **placement beyond depth**, with noise regions, proximity and
features as the intended extra signals — which makes it the shared prerequisite for this whole
section rather than a rendering errand.

The sibling roadmap entry, **unify strata and ore into one material system**, matters here too: it
makes plain rock a collectible material sharing the ore render path, which is what lets a biome be
*built out of its own materials* instead of being a palette swap over the same stone.

There's also an accidental foothold already on main: **Stone Bricks** ships as a registered,
minable material whose own source comment says it belongs in ruins and structures, not in random
veins. A constructed material exists and is looking for a structure to live in.

---

## 3. Fluids: water & lava

**A real fluid simulation is wanted**, not static decorative pools — for **water**
and for **lava**, where deep molten pockets and core-adjacent biomes are part of the
depth payoff.

Why this matters beyond flavour: simulated fluid is one of the strongest generators
of *emergent* situations in this genre. Flooding your own tunnel, draining a cavern
to reach what's in it, breaching a lava pocket and having to outrun it, and
water/lava contact producing stone or obsidian are all player stories that a static
pool can never produce. It also interacts directly with mining: **the player's own
digging is what moves fluid around**, which is a rare case of a system that gets
more interesting specifically because of the core verb.

The known, proven approach here is **cellular-automata fluid** (Terraria, Starbound,
and every falling-sand game), simulated only in active regions near players rather
than world-wide. That's the technique to reach for rather than inventing one.

### Two kinds of fluid

**Decided.** Not all fluid is simulated, and the distinction is load-bearing:

| Kind | Behaviour | Example |
| --- | --- | --- |
| **Static** | Never simulated. A fixed body that defines terrain and can't be drained. | The **lava ocean** at the world floor |
| **Simulated** | Cellular automata, active regions near players. The emergent-story generator. | A lava or water **pocket** the player breaches |

**The lava ocean at the bottom is static**, held in place by the indestructible bedrock floor. It
costs nothing to run, it removes the "lava accumulates at the bottom forever with nowhere to
drain" problem entirely, and because it **can't be drained** it makes the bottom of the world feel
*final* — a hazard and a boundary rather than a puzzle. The [molten core band](#biomes-come-in-two-kinds-bands-and-pockets)
sits here.

Note the parallel with biomes: the same static-vs-dynamic split, and for the same reason — the
guaranteed, structural version is cheap and the placed, interactive version is where the cost and
the interest live.

Costs and consequences are real and tracked in [T2](#t2-fluid-simulation-is-the-biggest-technical-risk-on-the-board).

---

## 4. World topology & hosting

**The world is finite, not infinite.** This reverses the "infinite in all
directions" direction currently in DESIGN.md.

- **Horizontally: large but bounded, with hard edges.** Wrapping was thrown out as a
  *possibility*, inflated by a previous session into settled direction, and has now been
  **rejected**. See [Hard edges — but not a visible box](#hard-edges--but-not-a-visible-box).
- **Vertically: bounded**, and the bound is **bedrock** — unbreakable rock at the deepest row.
  There's a defined maximum depth, tuned as needed; depth doesn't need to be infinite to feel
  deep. Bedrock is the *only* indestructible material in the game
  ([§1](#everything-is-mineable-and-everything-is-collectible)). _(What bounds the world at the
  **top** is still [Q4](#open-questions).)_
- **Large enough** that it never reads as repetitive or obviously constrained.

### Hard edges — but not a visible box

**Decided.** The world has **hard horizontal edges**, not wrapping. **With an explicit constraint:
the world must not read as a literal box.** Bedrock is contextually right for the *bottom* — deep
underground, impassable rock is what you'd expect — but bedrock *side walls* visible at the surface
would read as odd and cheap.

#### The resolution: the two halves are different problems

**Bedrock walls are fine underground and unacceptable on the surface.** Deep in the rock, an
impassable wall reads as "the rock continues and you can't get through," which is exactly what the
floor already says. At the surface, the same wall is a box.

> **_Guideline (agent proposal, not ratified)._** **Ocean at the surface ends, bedrock below the
> waterline.** This is Terraria's answer, and the [factual note](#why-bounded-solves-the-empty-digging-problem)
> below already records why it works — their edges are landmarks and a distinct biome rather than a
> boundary. Why it fits DELVE specifically:
>
> - **The edge becomes a _place_, not a limit** — content, which a bounded world needs anyway.
> - **Water is already a committed system**, so the edge costs no new mechanic.
> - **The stop is enforced by breath, not geometry.** You can swim out; it deepens, there's nothing
>   there, and you run out of air before you run out of world. A survival mechanic doing a wall's
>   job is the opposite of cheap — and it makes
>   [breath load-bearing](#survival-scoped) rather than situational.
> - **The hard stop sits far out past anything worth reaching**, so the player experiences the
>   ocean and never the boundary.

The case for hard edges over wrapping:

- **Edges are landmarks**, which restores the absolute reference frame that
  [T8](#t8-wrapping-removes-the-worlds-absolute-reference-frame) exists to mourn. The factual note
  below already observes that Terraria's edges do real work anchoring direction.
- **The map loses its seam** — a genuine complication for a surface that's been gated as a reward
  ([§12](#gating-which-surfaces-are-earned)).
- **Fluid gets a wall rather than a wrap.** A wrapping world means water flowing off one side
  arrives on the other, so a flood can circle the world and return; a hard edge just stops it.
- **Distance from an edge becomes a usable placement signal**, so "far from spawn" has a real
  maximum and a real meaning.

**Proposed edge material: bedrock**, matching the [bedrock floor](#4-world-topology--hosting), so
the world is a sealed box of one indestructible material rather than three different boundary
treatments. (Terraria's answer is an Ocean biome at each end, which is the richer option and a
candidate for later.)

What wrapping was buying, and what replaces it: *"you can never be permanently lost, travelling in
one direction is always eventually productive."* A bounded world with hard edges keeps most of
that — travel far enough and you hit a known, identifiable boundary, which is *more* orienting
than seamlessly reappearing elsewhere.

### Why bounded solves the empty-digging problem

A finite world means finite space to fill, which means **content density can be
guaranteed** rather than hoped for. Generation can place a known number of
structures, biomes and set-pieces per world and be *sure* the player meets them. In
an infinite world, density is a probability and long empty stretches are inevitable.
This is a much stronger answer to [T9](#t9-exploration-still-needs-breadcrumbs) than
any signalling system would have been.

_(Wrapping was additionally argued to mean "you can never be permanently lost."
[Hard edges](#hard-edges--but-not-a-visible-box) deliver that too — you reach an identifiable,
named boundary rather than reappearing elsewhere.)_

> **Factual note, since it's load-bearing:** Terraria worlds are finite, but they do
> **not** wrap — they have hard edges with Ocean biomes at both ends. The finite
> insight matches Terraria; the wrap is DELVE's own call. Worth knowing because
> Terraria's edges do real work: they're landmarks, they anchor a global sense of
> direction ("the dungeon is west"), and they're a distinct biome in their own right.
> A wrapping world gives that up in exchange for seamlessness — see
> [T8](#t8-wrapping-removes-the-worlds-absolute-reference-frame).

### The surface is real content, subordinate to the mine

**Decided.** There *is* a surface and it **is content**, in the Terraria mould. The subterranean
world remains the **primary play space**; the surface is not a second game, but it is not a barren
flat plane either.

**Half of this was already true in code and the doc didn't know it.** `SURFACE` is row 0, described
in `blocks.ts` as "the open surface yard"; everything above is open sky, the player **spawns**
there, and the darkness scrim is explicitly disabled above it so daylight is unaffected. A surface
exists and has all along.

#### What "not flat" actually costs

**`SURFACE` stops being a constant and becomes a function of column.** That's the first real change
to the generator's *shape*, and it touches:

- world generation (a surface heightmap per column),
- the solidity test (`row > SURFACE` becomes `row > surfaceAt(column)`),
- spawn placement, camera framing, and the lighting's above-sky check.

Contained, but not cosmetic.

#### Why the surface earns investment

It's where the most-visited non-mine activity already lands: **respawn** by default
([§1](#death-you-lose-the-trip-never-the-character)), **bases** and their four jobs, and **NPC
housing** ([§9](#9-npcs--dialogue)). Making the most-visited location the least interesting one
would be the wrong trade.

If the horizontal bound lands on [hard edges](#hard-edges-vs-wrapping), the surface is a **finite
strip with two definite ends** — far more tractable to fill than an endless one, and Terraria puts
its Ocean biomes exactly there.

#### Consequences flagged rather than assumed

- **Surface biomes are a third shape.** The [band/pocket taxonomy](#biomes-come-in-two-kinds-bands-and-pockets)
  was designed underground; surface regions run *horizontally along the surface*. Added to the
  parked biome session.
- **The art direction is entirely subterranean and has to grow.** [PALETTE.md](PALETTE.md) is built
  for muted rock with ore as the one saturated element, and [LIGHTING.md](LIGHTING.md) around
  lamp-only vision against a true void. Sky and daylight are a different register in both, and
  neither doc addresses it. Per the workspace rule, **the style guide gets updated before surface
  art is made**, not after.
#### Day/night: yes to the cycle, no to sleeping

**Decided.** There is a **day/night cycle**. There is **no sleeping** and no way to skip time.

**No sleeping is what gives the cycle teeth, and it serves the primary play space.** If night could
be waited out, the surface would simply pause. Because it can't, **night is a pressure that pushes
the player underground** — which is exactly where DELVE wants them. That's a reason to descend that
isn't greed, and it reinforces
[the mine as the primary space](#the-surface-is-real-content-subordinate-to-the-mine) rather than
competing with it.

It also fits [survival scoped to danger, not attrition](#survival-scoped): night is a *threat*, not
a meter. Sleeping was the part that didn't fit, being closer to a timer than to danger.

**It simplifies the lighting model rather than complicating it.** Today above-ground is a special
case — the scrim is forced off entirely. With a cycle, the sun becomes an **ambient term that
varies with time** and goes to zero at night, so there's one model everywhere: ambient is
time-varying above ground and simply zero below. The lamp then matters on the surface at night by
the same rule it matters underground, with no special-casing. ([LIGHTING.md](LIGHTING.md) needs
updating — it currently documents the scrim as unconditionally off above the surface.)

**Three consequences worth deciding rather than discovering:**

- **The default surface respawn point must be safe at any hour.** Death sends the player to the
  surface ([§1](#death-you-lose-the-trip-never-the-character)); if night is dangerous and respawn
  isn't safe, that's a death spiral. The existing "determined safe area" fallback is the answer —
  this just makes it a requirement rather than a nicety.
- **Time is shared world state, and it's the first global world state that isn't terrain.** All
  players in a world share the hour.
- **What happens to time while a world [hibernates](#world-lifecycle-is-now-a-required-system)?**
  Same shape as the fluid-on-resume question. Advancing in real time is the simplest and matches
  "the world exists whether you're there or not," but it's unresolved.

_(NPC routines are an obvious pairing but were **not** decided — noted as a possibility only.
Cycle length is a tuning number, not needed yet.)_

### Hosted worlds

The client/server split already shipped (authoritative server + client prediction)
feeds directly into this: **players create their own worlds.** The hosting model is
settled in [§7](#decided-shape-one-dedicated-server-many-player-created-worlds) — one
dedicated server holding many player-created world instances, not player-run machines.

World generation parameters become **world-creation settings**:

- **Size presets** — small / medium / large, each with its own
  [player cap](#player-cap-scales-with-world-size).
**Infinite mode is cut.** It was briefly kept as an optional world-creation setting for players
who wanted it, with generation required to work in both modes. That requirement was the most
expensive under-examined commitment in this document, and the mode undoes the exact thing bounding
was adopted to deliver:

- **Guaranteed density is the whole argument for bounding**
  ([above](#why-bounded-solves-the-empty-digging-problem)). Infinite reintroduces probabilistic
  density — the empty-digging problem in full.
- **The content gate can't assert anything about an infinite world.** Its invariants are per-world
  content counts and per-player density, and neither is expressible without bounds. Infinite mode
  would ship permanently unverifiable, without the guarantee every other mode gets.
- **Wrapping is load-bearing elsewhere.** It's why the player can never be permanently lost, and
  the map has to handle a seam. An infinite world has neither, so the navigation story would
  differ between modes too.

The real cost was never a second generator — it was that **every content system would be written
twice, or written to the weaker of two contracts, with tests covering only one.** Cut, so there is
exactly one world contract.

> **Determinism stays; only infinity goes.** The world remains a pure `f(seed, c, r)` — that's
> what makes content verifiable at all. DESIGN.md's pillar bundles the two words ("deterministic,
> infinite world"); only the second is being dropped.

**Docs consequence:** issue
[#1](https://github.com/inman-sebastian/agent-games/issues/1) is currently scoped as *"open,
infinite world in all directions."* That scope is now wrong and needs rewriting to **bounded,
wrapping, open world** — the same kind of rescope that #6 needed.

---

## 5. Combat

**Resolved: a full combat system**, not a mining-flavoured afterthought.

- **Multiple weapons** and **multiple pieces of equipment**.
- Each carries **its own perks and benefits** — weapons and gear are differentiated
  by what they let you do, not just by a damage number.

This confirms combat as a **parallel discipline** to mining, with its own crafting,
its own progression, and its own feel. ("Its own progression" is consistent rather than
competing, since progression is
[layered by design](#t1-progression-is-layered-so-the-layers-must-do-different-jobs).) It's a major scope commitment and should be
planned as one of the game's primary systems rather than a feature.

The "removes a constraint" rule from [§6](#6-the-incremental-loop-rebuilt) applies
here too and is the thing that keeps a weapon roster from being a stat ladder:
a weapon should ideally change *how you fight*, not just how fast things die.

---

## 6. The incremental loop, rebuilt

The incremental side is a **core loop**, not a side system — but the *source* of
progression moves. Progression comes from **finding or crafting tools, weapons and
equipment**, which then **influence the player's abilities and proficiencies**.

Named examples:

- **Reach.** Default mining reach is one tile. Something upgrades it to two, and
  presumably further. (A tiny number with an enormous effect on how mining feels.)
- **Jetpack.** Hold jump to fly, letting the player ascend a vertical shaft directly
  instead of having to dig their way back out.

### Progression is layered

**Decided.** Progression is **several independent systems layered on top of one another**, not
one system that owns getting stronger. Terms are pinned in the [Glossary](#glossary).

- **Attributes** — intrinsic to the player, upgraded **independently** of what's equipped and
  of where the player is standing. These have their **own progression path** (a skill tree is
  the candidate structure, which DELVE inherits from incremental games as much as from RPGs).
- **Equipment** — **its own separate progression**, per the investment arc in
  [§11](#the-investment-arc). Equipment *can* also modify attributes, but the two are **not**
  mutually exclusive and neither is a substitute for the other.
- **Environment** — contextual modifiers applied by where the player is.

The four values still on the player (`up.pick`, `up.speed`, `up.fortune`, `tech.lantern`) were
**kept deliberately** when the economy was stripped, not left behind by it. They stand in for
the attribute layer.

#### What layering demands

- **Each layer must do a different job.** Layered progression breaks when every layer touches
  the same number: if an attribute, a pickaxe tier and an environmental modifier all scale dig
  speed, no single upgrade feels like anything and the tuning surface multiplies. This is the
  standard failure mode in layered-progression games, and the fix is distinct *signatures* per
  layer, not distinct multipliers on one number. Recorded as
  [T1](#t1-progression-is-layered-so-the-layers-must-do-different-jobs), with a candidate split.
- **`stats()` stays the single place capability is resolved.** This is the reason to keep the
  layer rather than delete it: tuning stays centralized instead of scattering across item
  definitions. Attributes and modifiers are inputs; `stats()` resolves them.
- **It's a modifier stack.** A base value plus contributions from many sources, resolved in one
  place — a standard, well-understood pattern. Build it as one, rather than as four integers
  that unrelated systems reach in and poke.
- **Environmental modifiers have a different lifetime from the rest.** Equipment applies while
  equipped; an environmental effect applies while you're *somewhere*. That means temporary,
  contextual modifiers with duration and stacking, and it means `stats()` needs **world
  context**, not just the player. That's a signature change in the shared ruleset, so client and
  server must agree on it — see [ARCHITECTURE.md](ARCHITECTURE.md).
- **The layers must be legible.** If three sources can move one stat, the player needs to see
  *which* moved it. That's a job for the character screen in
  [§12](#the-equipment-screen-is-the-most-important-surface-here).

#### Fortune survives, re-pointed at extraction

**Decided.** Rich veins stay, and so does Fortune — but they're **decoupled**:

- **Rich veins are a property of the world.** Generation decides where they are. They get their
  own **VFX** so they stand out ([JUICE.md](JUICE.md)), and a candidate touch is making them
  *tougher* than the ordinary variant of the same material, so the reward announces itself and
  costs a little to take.
- **Fortune no longer influences whether a vein is rich.** It influences **what you get out of
  mining one**: higher yield, and an increased chance of a **rare, unexpected item**.
- **Fortune lives at the equipment layer**, not the attribute layer — e.g. a rare pickaxe that
  grants Fortune +1. That's a concrete answer to T1's residual work ("decide, per stat, which
  layer is allowed to touch it").

**This fixes a real defect, not just a design question.** `isRich(seed, column, row, fortune)`
currently takes the *player's* fortune as an input, so **whether a tile is rich depends on who is
looking at it.** Under [shared worlds](#7-multiplayer) two players at the same vein would
disagree, and world content stops being a pure function of the seed — which is precisely the
determinism the content gate relies on to verify anything
([below](#the-verify-scripts-actual-flaw-and-what-to-keep)). Re-pointing Fortune at extraction
makes generation player-independent again, and makes rich-vein density something the gate can
assert.

It also matches **Minecraft's Fortune semantics** (affects drops, never generation), so the name
carries the right expectation for free.

**Both payloads have distinct jobs — keep both.** An earlier pass here argued the yield half was
weak because volume costs nothing to carry. That conflated *carrying* with *mattering*: **crafting
is a sink**, so if a recipe needs forty diamond, yield decides how many trips that is. The reason
volume looked free is that **nothing consumes materials yet**, which is a gap in this document
rather than a property of yield.

- **Yield shortens deliberate farming.** A player grinding a known vein for a specific material
  has stopped exploring — the mode where DELVE's pillars are least served. Yield makes that mode
  *shorter*, so it actively serves the exploration pillar rather than being neutral toward it.
- **The rare drop rewards incidental mining** with a discovery, feeding the discovery pillar
  while the player is doing something else.

**Caveat:** *how much* yield is worth can't be settled yet. It's entirely downstream of crafting
costs — cheap recipes make it irrelevant, expensive ones make it a major lever.

**New, small system implied:** mining a tile can yield something **other than** that tile's
material. That's a loot table on a block, and it's the mechanism the "unexpected item" rides on.

#### Light: an untradeable floor, everything above it earned

**Decided.** Light gets a **floor the player can never trade away**, with every improvement above
it **earned and riskable**. The player always keeps enough lamp to not be lost in the dark; brighter,
further and better light comes from equipment (the
[companion lantern](#light-discovery--navigation) is the intended home) and can be given up for
something else. A deep biome may suppress light without ever making the game unplayable.

**"Vision" is a misnomer — retire the word.** There is **no reveal mechanic and no fog of war**.
Lighting is per-pixel illumination on 0..1 ([LIGHTING.md](LIGHTING.md)), and the stat formerly
called vision is simply **the player's lamp emitter** — one source among many. Anything that
implies revealing tiles is wrong: the player walking in pitch darkness will still *see* on
stumbling into a lit area, because the light is the world's, not theirs.

Three consequences that were already true in the engine and unrecorded here:

- **World light sources answer [T9](#t9-exploration-still-needs-breadcrumbs)'s residual local
  cue.** T9 asks for "a glow past the lamp radius." Every emitter obeys the same rules and light
  bleeds 2–3 tiles into solid rock, so a glowing mushroom cavern **announces itself through the
  rock face** before the player reaches it. That cue is free once emissive content exists — it
  needs *content placement*, not a signalling system.
- **Lava telegraphs itself**, for the same reason. A molten pocket glows through the rock before
  it's breached, which turns "don't dig into lava" into a **learnable rule** rather than a gotcha
  — exactly what [§10](#10-chaos-floated-not-committed) demands of chaos and what
  [T4](#t4-auto-mining-interacts-badly-or-brilliantly-with-fluid) needs to stay fair.
- **Environmental suppression has two possible mechanisms**, and the diegetic one composes better:
  make the *rock or air absorb light* in that biome, rather than debuffing the player's lamp stat.
  The first is a property of the place; the second is a number applied to the player.

**Cost, recorded because it's easy to miss:** there is **no persistent explored/seen memory** —
walk away from a tunnel and it returns to the void. So a map is *not* a rendering of where you've
been; it's a **new memory system**. That makes gating it
([§12](#gating-which-surfaces-are-earned)) thematically strong: acquiring a map literally grants
the player a memory the game otherwise doesn't have.

### The design rule behind both

An item doesn't add a number, it **removes a constraint the player has been living
with.** Reach removes "I must be adjacent." The jetpack removes "I must dig my way
out." This is worth adopting for equipment design — it's what separates memorable gear from a
stat ladder, and it applies to weapons ([§5](#5-combat)) as much as to tools.

> **_Speculative (unratified)._** This was synthesized by the agent from the author's two
> examples and then written up as "an explicit, game-wide rule." That's the same overreach
> that happened to the behaviour-over-numbers
> [guideline](#provenance-and-why-this-is-a-guideline). It may well be a rule the author
> endorses, but it is **not** to be treated as one or cited as settled until they say so.
> Note that this framing is weaker than it looks — removing a constraint and raising a number
> aren't opposites, since "more slots" removes "I must turn back when full."

---

## 7. Multiplayer

**Resolved: the game is scoped as multiplayer-compatible.** Player count is set by
the world-size preset ([below](#player-cap-scales-with-world-size)); the existing
infrastructure hasn't been stress-tested.

This is the right call to make early rather than late — retrofitting multiplayer is
famously the expensive version. The client/server split and authoritative netcode
already shipped give it a genuinely strong foundation:

- The **server is authoritative** and clients send **inputs only**, never state — so
  cheating is impossible by construction, which is the hard part to retrofit.
- **Client prediction + reconciliation** against server snapshots already works, and
  deliberately doesn't rely on cross-machine determinism.
- One **shared ruleset** (`@delve/shared`) is imported by both sides, so rules can't
  drift between client and server.
- A **versioned wire protocol** already rejects mismatched clients.

### What's actually built today, precisely

**The slimness is deliberate.** What shipped was a single-player game ported into a
multiplayer-shaped framework with the bare minimum needed to run, kept malleable so
it can grow into whatever the features demand. That's the right call and this section
is a description of the starting point, not a list of oversights.

The current implementation is **authoritative single-player**:

- Each WebSocket connection owns **its own private world** (`server/src/index.ts`
  holds one `Session` per connection — "this connection's authoritative world and
  player"), created from that player's own seed.
- The state message carries **one player** and no roster — there is no representation
  of a second player anywhere in the protocol.
- There are **no replicated entities of any kind**. The wire model is tiles plus one
  player: dug-tile keys and tile-damage progress.
- Persistence is **one whole-file JSON write per player** (`server/src/store.ts`,
  which says so itself: fine for single-player, a real DB is a later concern).

So the *architecture* is multiplayer-shaped and the *hardest* decision (server
authority) is already correct. The multiplayer **feature set** is unbuilt. The gap
is concrete and known-shaped, not vague:

| Needed | Why |
| --- | --- |
| **World instances decoupled from connections** | Many players must join *one* world; today world lifetime is connection lifetime. |
| **Player roster + join/leave** | Snapshots must carry other players; clients must render and interpolate them. |
| **Entity replication** | Enemies, dropped loot, projectiles are all server-owned entities. The protocol currently has no entity concept at all. |
| **Interest management** | A large world can't stream everything to everyone. Today the client receives the world's entire dug-tile set; that doesn't scale with world size or player count. |
| **World-scoped persistence** | Per-player whole-file writes can't hold a shared world, especially with fluid state in it. Note this is *in addition to* a player store, since [characters are portable](#characters-are-portable). |

### Status: pinned, planned-around

**Multiplayer is not fully committed.** The appeal is real — wanting to play this
with friends, and expecting others to want that more than the author does — but so is
the uncertainty about how emergent, simulation-driven systems behave across a network
with multiple clients.

**Decision: plan around multiplayer as if it works, and resolve the open questions by
playtesting rather than by argument.** Questions like "what happens when player A's
drone drops lava on player B" are genuinely not answerable in the abstract; they need
two humans in one world and a real reaction.

#### Why this is a low-risk place to sit

**Nothing in this document requires multiplayer.** Exploration, bounded/wrapping
worlds, biomes, buried structures, combat, fluids, drones, crafting, base building
and the whole progression rebuild are all complete, satisfying systems for one
player. Multiplayer is **purely additive** here, not load-bearing.

That means the decision can stay open for a long time at almost no cost — provided
the distinction below is respected.

#### Pin the feel questions, not the shape questions

Two different kinds of question are hiding under "multiplayer," and only one of them
is safe to defer:

- **Feel questions** — does shared-world drone chaos read as funny or as griefing?
  Are shared bases fun? How much do players get in each other's way? These *cannot*
  be answered without playtesting, they get no cheaper by being decided early, and
  they should be pinned. ✅
- **Shape questions** — is world lifetime separate from connection lifetime? Is
  replication area-of-interest-shaped? Is persistence world-scoped or player-scoped?
  Playtesting can't answer these either, and they get **monotonically more expensive**
  the more systems get built on top of the wrong answer. These should not be pinned. ⚠️

The existing port already got this right: a single-player game in multiplayer-shaped
plumbing. That posture is the thing to maintain — keep building single-player-first,
keep the plumbing multiplayer-shaped.

#### The cheapest way to unpin the feel questions

The pinned questions all need the same thing, and it's much smaller than "multiplayer":
**two players in one world, doing anything at all.** A shared world instance, a player
roster, and other players rendered and interpolated. No entities, no enemies, no fluid,
no shared progression.

That's a small, well-defined milestone, and it converts every pinned question from an
argument into an experiment. Worth doing **early** for that reason alone, well before
the systems whose interactions are in question actually exist.

### Decided shape: one dedicated server, many player-created worlds

**Resolved, and it's the original plan rather than the client-hosted detour.** A
single dedicated server that *we* host, inside which **players create their own
worlds** — small multi-tenant instances, not separate machines.

This drops the browser-can't-listen problem entirely (no WebRTC, no NAT traversal, no
TURN bill) and drops the listen-server social tax (no "we can only play when Dave is
online"). Worlds persist independently of whether their creator is around, and players
can drop in and out freely.

The tradeoffs accepted in exchange are ordinary and known: hosting cost, uptime and
ops are now real, and the [shape questions](#pin-the-feel-questions-not-the-shape-questions)
that a client-hosted model let us defer are now **required work** — world instances
decoupled from connections, world lifecycle, and world-scoped persistence.

### Player cap scales with world size

> **Decided — with the numbers explicitly untested.** Size presets exist, and max players is a
> function of the preset. The **specific counts below are assumed defaults derived from world
> size, not measurements** — the netcode has never been load-tested, so treat them as placeholders
> with the right *shape*, not as a validated budget. [Q5](#open-questions) is the measurement that
> would turn them into real numbers.

Max players is **determined by the world-size preset** rather than being one global
number. Illustrative, not final:

| Preset | Max players |
| --- | --- |
| Small | 4 |
| Medium | 8 |
| Large | 16 |

This is a genuinely good resolution to
[T7](#t7-player-count-and-world-size-interact), because it makes the two knobs
*literally one knob* instead of two that have to be kept in sync. Two things fall out
of it that are worth building on:

1. **The tuning invariant becomes content-per-player, not content-per-area.**
   **_Speculative (unratified)._** If
   structures, biomes and ore are generated per *expected player* rather than per unit
   of world, all three presets feel the same to play — nobody's world is sparse and
   nobody's world is stripped bare in an hour. That's a much easier target to tune
   against, and it makes the discovery pillar hold at every size.
2. **The player picks their own experience honestly.** Small is intimate and dense;
   large is sprawling and social. Neither is the "correct" one.

#### Where the cost and risk concentrate

Worth knowing before large worlds get built: **the cap's top end is where every
"naive is fine" assumption stops being true.**

- At four players, interest management can stay a trivial radius check. At sixteen
  scattered across a large world, it's **mandatory** — sixteen independent interest
  sets and sixteen active fluid regions, with nothing shared between them.
- Per [Target scale](#target-scale), player count multiplies *simulated surface area*,
  not just bandwidth. A large world at capacity is roughly four times the simulation
  load of a small one at capacity, in one process.
- Because the server is ours, **that load is a bill**. Hosting cost scales with
  *concurrent active worlds*, so many small worlds is the cheap case and a few large
  worlds running fluid at capacity is the expensive one.

Practical consequence: **ship Small first.** **_Speculative (unratified)._** It's the cheapest to run, the easiest to
tune, and it's the size that makes the naive implementations acceptable. Medium and
Large can follow once interest management and fluid budgets are real.

#### World lifecycle is now a required system

**_Speculative (unratified)._** That world lifecycle is *required*, and both policies below, are
agent proposals — not author decisions.

With worlds outliving their players, two things need explicit answers:

- **Hibernation.** A world with nobody in it must stop ticking entirely — no fluid, no
  entities, no snapshots. This is the single lever that keeps cost proportional to
  *active* worlds rather than to *created* worlds, and without it a hosted
  multi-tenant model gets expensive fast. **Fluid mid-flow runs to completion on resume**, treating hibernation as *owing time* rather than
  as having stopped. An earlier pass here said it "simply settles, no one is watching," which was
  decided without the author and is ambiguous in an exploitable way: resuming from the paused state
  would make logging out a way to freeze a disaster, and someone would find that within a day.
  Running to completion matches the fiction and costs one settle pass on wake rather than a running
  simulation.
- **Retention.** Created worlds accumulate forever unless something evicts them.
  Abandoned-world cleanup, storage caps, or explicit deletion — not urgent, but it's a
  real cost curve and better decided than discovered.

### World size is fixed at generation

**Decided.** A world's **size preset — and therefore its
[player cap](#player-cap-scales-with-world-size) — is chosen at creation and never changes.**

- **Accepted social friction:** a fifth friend can't join a Small world. They make a new one.
  That's the cost of the decision, not a problem to engineer around.
- **It reinforces verifiability.** A fixed size means a fixed content budget, decided once at
  generation, so the content gate can assert a world's contents without modelling growth.
- **World creation is a one-shot, permanent decision**, which makes the creation screen a real
  surface with real stakes — a second pre-session surface alongside
  [character select](#characters-are-portable).

### Characters are portable

**Decided.** A character belongs to the **player**, not to the world. Attributes, equipment,
inventory and unlocks travel into any world the player joins. Starting a **fresh character** is
supported and must be **easy** — a deliberate choice, not a data-wipe.

This is the Terraria/Valheim model and it's what players of this genre expect. It also makes
drop-in play work: helping a friend in their world costs you nothing, which is the behaviour the
[hosted, multi-tenant shape](#decided-shape-one-dedicated-server-many-player-created-worlds) is
for.

#### What follows from it

- **Persistence forks into three scopes.** **Account** (the codex, settings — shared across all
  of a player's characters), **character** (attributes, equipment, inventory, unlocks), and
  **world** (terrain mutations, fluid, entities, NPCs). The table above lists "world-scoped persistence" as the required work; it's **both**,
  and they have different lifetimes and different owners.
- **The player store holds a collection, not a save.** If fresh characters are easy, players
  will have several. Today it's one JSON file per `playerId`
  (`server/src/store.ts`); it becomes one player → many characters.
- **A character select/create surface now exists**, which wasn't in
  [§12](#the-surface-inventory)'s slate. Added there.
- **Difficulty pacing can no longer be guaranteed, and that's accepted.** A maxed character can
  enter a brand-new world and trivialize it. Terraria accepts exactly this; so do we. The
  consequence for testing is in the gate
  ([below](#the-verify-scripts-actual-flaw-and-what-to-keep)) — it asserts a *fresh character in
  a fresh world*, and the maxed-character case is explicitly **out of scope** rather than a
  balance failure to fix.
- **A well-geared player in a newcomer's world is a social problem, not a systems one.** Same as
  Terraria. Worth not building machinery for.

#### The codex is a ledger, and it's account-scoped

**Decided.** The codex is **never mechanical** — it's a ledger of everything the player has
encountered: enemies fought, NPCs met, materials gathered. Pure information and flavour. A
**recipe book** for crafting is a *separate* system, not a view of this one.

Because it gates nothing, account-level progress leaks no power into a fresh character, so it's
**per account**: the discovery log is the player's and survives starting over.

Three consequences, the last of which affects architecture now:

- **It's not a material list.** Today it records lifetime mined and deepest find per ore. The real
  shape is a **multi-category ledger** over everything encounterable, with materials as one
  category among several.
- **It implies one registry for every encounterable entity.** Materials already self-register one
  file per entity (`shared/src/resources/*.ts`); enemies and NPCs want the same treatment, because
  the codex has to enumerate all three *uniformly*. That's a concrete argument for extending the
  existing registry rather than growing parallel per-type systems.
- **It introduces a third persistence scope.** There is now **world** data, **character** data, and
  **account** data. The codex is the first member of the last group and settings likely belong
  there too — worth pinning while the two-store model is still on paper
  ([above](#what-follows-from-it)).

**Still open, and small:** is the **recipe book** its own surface (making eight in
[§12](#the-surface-inventory)) or a view inside the crafting menu?

### Target scale

**Real target: small parties on bounded worlds** — two to four players, per the
Small preset's cap ([above](#player-cap-scales-with-world-size)). That's the shape to
build and tune for first.

**Blue sky, explicitly not a goal:** dozens of players on a Large world. (This previously read
"on an infinite world"; infinite is [cut](#hosted-worlds), so the blue-sky case is now the top of
the size-preset range rather than an unbounded one.) Noted as something to revisit if it turns out
to be reachable, not something to design toward.

The gap between those two is bigger than the player counts suggest, and it's worth
knowing why: **player count multiplies the simulated surface area, not just the
bandwidth.** Fluid and entities are simulated in active regions around players, so
two players scattered in a Small world means two active regions, while dozens scattered across a
Large one means dozens of independent simulation neighbourhoods with nothing shared between them.
Bandwidth is the easy half.

The good news is that the real target is *dramatically* cheaper than the blue-sky
one, and several things that would be mandatory at scale are optional at four
players: interest management can start as a naive radius cull, entity counts stay
small, spatial partitioning can stay simple, and a single Node process with a fixed
tick is comfortably enough.

### Keeping the blue-sky door open cheaply

One decision now preserves the option later at near-zero cost: **make replication
area-of-interest-shaped from the start**, even when the implementation behind it is a
trivial "is it near the player" check. What forecloses scale isn't a naive
implementation, it's baking *send-everything-to-everyone* into the wire protocol —
which is the current shape, where the client receives the world's entire dug-tile
set. Getting the protocol's shape right is cheap today and expensive to retrofit.

### The ordering consequence

Combat ([§5](#5-combat)) and fluids ([§3](#3-fluids-water--lava)) both require the
entity/replication layer that doesn't exist yet. Enemies are replicated entities;
loot drops are replicated entities; fluid is high-rate replicated world state.

That makes **replication + interest management the load-bearing next system** —
the thing most of the rest of this document is waiting on, whether or not it looks
like the most exciting piece.

---

## 8. Automation

Flagged as **an idea, not a plan** — a direction that seems cool rather than a
scoped feature. Captured as such.

### The illustrative example: mining drones

A rare, high-tier item, found or crafted: **small autonomous drones that follow the
player and fire lasers to mine and collect resources automatically.**

The incremental hook is clean and is most of the appeal:

- Starts as **one drone with a weak laser**.
- Levels into **more drones** (two, three, …) and/or **stronger lasers**.
- Both axes — count and power — scale independently and legibly.

It also satisfies the "removes a constraint" rule from
[§6](#6-the-incremental-loop-rebuilt): drones remove *"I must personally target every
tile."* And it extends naturally into combat ([§5](#5-combat)) — a laser drone that
shoots rock is one target-selection change away from a drone that shoots enemies,
which is a lot of content for very little new machinery.

### Intelligence as the upgrade axis

**The strongest idea in this section.** Rather than (only) scaling count and laser
power, the drone's **competence** is what levels up:

- **Early drone: genuinely stupid.** It destroys any node it judges worth
  destroying, to the player's benefit or detriment. It will absolutely dig into a
  lava pocket and drop a molten waterfall on your head.
- **Upgraded drone: progressively smarter.** It learns to avoid load-bearing blocks,
  to not breach fluid, to keep the player safe from its own actions, and eventually
  to be ruthlessly efficient at the job.

Why this is better than a bigger number:

1. **It inverts the usual incremental axis.** Almost every incremental upgrade makes
   a number larger. This one changes *behaviour*, which is far more memorable and
   fits the "removes a constraint" rule ([§6](#6-the-incremental-loop-rebuilt))
   better than damage-per-laser ever could.
2. **It converts a bug-shaped experience into designed content.** A drone dropping
   lava on you is only funny if the game *told you* the drone is an idiot. Framed as
   a known starting state you grow out of, the lava incident becomes a story the
   player earns early. Unframed, the identical event reads as broken.
3. **It resolves the reaction split honestly.** One player finds the lava waterfall
   hilarious and endearing; another finds it frustrating and assumes it's a bug.
   Both reactions are legitimate. Progression turns that coin-flip into an arc: you
   *start* in the funny version and *earn* your way to the safe one.

### Synthesis: progression unlocks the toggles

**_Speculative (unratified)._** The three-stage arc below, and late-game obedience modes in
particular, are the agent combining two options that were floated rather than the author picking
one.

The two options floated — player settings vs. a progression axis — are better
together than either alone:

- **Early game:** no control. The drone is dumb, and that's the joke.
- **Mid game:** smarter defaults. It stops doing the worst things unprompted.
- **Late game:** smart *and* **directable** — obedience modes the player picks per
  situation (cautious / balanced / reckless), because a maximally cautious drone will
  eventually refuse to mine something you actually want mined.

Framing the settings as **earned** rather than as an options-menu checkbox keeps them
part of the game instead of a configuration screen, and it dodges the usual ceiling
problem where the fully-upgraded version is strictly better but boring.

### Legibility is a hard requirement here

This design only works if the player can always tell *"the drone did something dumb
because drones are dumb"* apart from *"the game is broken."* That's a presentation
requirement, not a simulation one:

- The drone must read as **a character with intent** — visibly choose a target,
  telegraph before firing, react to what it did.
- If it's an invisible effect that silently deletes tiles, the lava incident reads as
  a bug **every single time**, no matter how it's framed in the design.

Upside: this makes the drone the first genuinely characterful entity in a game that
currently has none, and a strong candidate for the game's mascot. That's a lot of
identity for one item.

### The direction it illustrates

The drones matter less than what they point at: **this genre has a lot of room for
automation**, and automation composes unusually well with the incremental pillar.
Other natural candidates, unexplored: auto-collection of drops, storage sorting,
crafting/smelting queues, automatic lighting placement, re-clearing known tunnels.

### The rules that make automation safe here

Automation and exploration want opposite things. Automation's reward is that **you
stop doing the thing**; exploration's reward is that **you do the thing**. Pure
incremental games treat automating the loop as the win condition; exploration games
almost never automate their core verb. Terraria has essentially no automation, and
Factorio has essentially no discovery-as-reward — that's not a coincidence.

The drone design threads this correctly, and *why* it works generalizes into a rule
worth adopting for every future automation idea:

> **Automate the chore, never the choice.** Automation may remove repetition and
> execution. It must never remove the decision of *where to go* or *what's worth
> looking at*.

Drones pass because they mine **what's already around you**, chosen by where **you**
went. The player still decides everything that matters; the drones just stop them
clicking every tile.

Stated intent, which this rule is a formalization of: **nothing — no system, feature,
tool, equipment or weapon — may take away from the core identity of the game, which
is exploration.** Removing the boring, mundane and repetitive parts of exploring does
more good than harm; removing the exploring does not.

A second idea falls out of the drone-intelligence case. **It is a guideline, not a rule** —
see the note below on where it came from:

> **Guideline: prefer upgrading behaviour over upgrading a number.** Where an upgrade *can*
> change what a thing does rather than how much it does, that's usually the more memorable
> and more legible choice, and it produces an arc instead of a multiplier. **Exceptions are
> expected and fine.**

#### Provenance, and why this is a guideline

**The author never agreed to a hard rule here.** What was stated is narrower and weaker:
*most* upgrades feel better and are more interesting when they fundamentally change how
something works. A previous session generalized that into a game-wide rule and then began
citing it as a constraint — including against "more storage space," which the author
considers a perfectly acceptable number upgrade. That was the doc overreaching, and the
rule is downgraded accordingly.

**There are grounded reasons number-go-up is fine**, worth stating so this doesn't drift back:

- **[§1](#1-what-delve-is-becoming) lists Incremental as a genre pillar**, defined as
  "continuous, compounding growth in player capability." Compounding growth is *inherently
  numeric*. A hard no-numbers rule contradicts a pillar the author actually set.
- **Numbers are legible.** The player knows exactly what they got, immediately, with no
  learning curve. A behaviour change has to be discovered and understood first.
- **Numbers are the rhythm section.** If every upgrade is a paradigm shift, nothing reads as
  a baseline and the player is never given a rest. Behaviour changes land harder when they're
  punctuation rather than the whole text.
- **Numbers let players plan.** "Two more levels and I can carry a full stack" is a goal.
  Bespoke behaviour upgrades are surprises, which is great but can't be aimed at.
- **Behaviour upgrades are expensive.** Each is bespoke design, code and tuning. A game where
  every upgrade is unique has far fewer upgrades.

#### The more useful test than "numbers bad"

> **A number earns its place when it changes *what you can attempt*. It's filler when it only
> changes *how fast you do what you already do* — and only when there's no real cost behind the
> thing being sped up.**

**The second clause matters and was missing at first.** Speed counts as *what you can attempt*
whenever it's shortening a cost the player is genuinely paying. A recipe that needs forty units
makes yield meaningful, because yield decides how many trips that is. A rate is filler only when
the loop it accelerates has **no sink** behind it — which is exactly what was empty about Refinery
and about Fortune-as-generation: they multiplied a resource that nothing consumed.

This is a better discriminator, and it retroactively explains two calls already made without
contradicting either:

- **More inventory slots — keep.** It lengthens an expedition, which changes how deep a trip
  can go, which is a different decision ([§12](#gating-which-surfaces-are-earned)).
- **Refinery and Fortune — cut.** Pure rate multipliers on a loop the player was already
  running. Nothing new becomes attemptable ([T1](#t1-progression-is-layered-so-the-layers-must-do-different-jobs)).

**Follow-the-player is therefore load-bearing, not flavour.** **_Speculative (unratified)_** —
the reasoning is the agent's, and the closing claim that it "should survive every future revision"
is not an author decision. The moment drones can
be parked somewhere and left to mine unattended, DELVE becomes an idle game and
exploration becomes optional — the player's optimal move is to stop playing. Tethered
to the player, the same drones are pure upside. This constraint should survive every
future revision of the idea.


---

## 9. NPCs & dialogue

**Resolved: there will be NPCs.** Who they are and what purpose they serve is
undetermined, but their existence is not. Interacting with them is part of the intent,
so the game needs **at minimum a minimal dialogue system**.

Two consequences worth recording now, because they unblock things parked elsewhere:

- **NPCs give base building a candidate job.** [Q2](#open-questions) was parked
  because a base had no function. Terraria's answer is housing, and it works: NPCs
  need somewhere to live, which makes a base a *requirement* rather than decoration.
  This doesn't decide the question, but it removes the reason base building was
  deferred.
- **NPCs are the cheapest place to put tone.** See
  [§10](#10-chaos-floated-not-committed) — a character who *comments* on what just
  happened to you is the single most efficient way to make a chaotic event read as
  intentional rather than broken.

Scope note: a dialogue system is a real system (content authoring, state, triggers,
UI), but "minimal" is doing honest work here. Barks and one-shot lines cover most of
the value; branching trees and quest state are a different and much larger thing.

---

## 10. Chaos (floated, **not** committed)

> **Status: an idea thrown out, not a decision.** Explicitly *not* a pillar yet. The
> analysis below is kept because it's useful if the idea is ever picked up, and
> because the determinism rule it produced is worth applying to any individual chaotic
> system regardless — fluid and cave-ins included. Nothing here should be read as
> settled direction.

The proposal: rather than the drone's stupidity being a one-off quirk, **lean into
chaos and unpredictability across the whole game** — tools that behave unexpectedly,
a world that behaves unexpectedly, as a consistent character trait.

The supporting argument is sound and is the important half: **one unpredictable thing
reads as a bug; many unpredictable things read as a voice.** Volume is what converts
an anomaly into an authored tone. That's a real effect and it's the strongest reason
to treat chaos as a pillar rather than a feature.

### The self-correction is the actual insight

The idea initially framed chaos as unexplored territory, then immediately corrected:
Terraria already leverages chaos — but it's **structured, predictable chaos**. Mining
out a big block of sand will probably collapse on you. Digging the one block holding
back a lava lake is a bad idea. Those produce chaos, but the chaos **follows a strict
set of rules the player can learn**.

That correction is the whole design. It separates chaos that works from chaos that
doesn't, and it's worth stating as the governing rule:

> **Chaos must be deterministic.** The same situation must always produce the same
> outcome. Complexity, cascades and surprise are the goal; *randomness* is not.

### Three things get bundled under "chaos" — they behave differently

| Kind | Example | Verdict |
| --- | --- | --- |
| **Emergent complexity from deterministic rules** | Sand collapses; fluid finds its level; a cave-in cascades | **The gold standard.** Learnable, fair, weaponizable. Scales infinitely and costs nothing in player trust. |
| **Delegated agency** | The drone mines something you didn't choose | **Workable, with care.** Not simulation — it's an *agent* acting for you. Needs visible intent and character or it reads as betrayal ([Legibility](#legibility-is-a-hard-requirement-here)). |
| **True randomness** | A tool that sometimes just misfires | **The dangerous one.** This is what actually reads as broken, and unlike the others it does **not** get better by having more of it. |

The "more of it reads as intentional" argument holds for the first two. It does **not**
hold for the third: randomness that costs the player something they could not have
anticipated is unfair at any volume. Volume fixes *tone*; it can't fix *unfairness*.

Supporting evidence: the games celebrated for chaos are almost all deterministic
simulations, not random ones — Terraria, Noita, Dwarf Fortress, Minecraft. Their
unpredictability comes from **complexity**, not from dice. That's also why players
eventually stop being victims of it and start exploiting it, which is where the
deepest play in all of those games lives.

### The constraint DELVE has that chaos-heavy games usually don't

Most games built on chaos have a **run structure**. Noita and The Binding of Isaac can
be brutal because a run is short and disposable; losing one is the expected outcome,
not a setback.

**DELVE has a persistent world and a persistent character.** Chaos that destroys
persistent progress is far more expensive than chaos that ends a twenty-minute run. So
committing to chaos as a pillar forces a matching commitment:

> **High chaos requires cheap failure.** **_Speculative (unratified)_**, and doubly so since
> chaos itself is uncommitted. If the world is allowed to wreck your plans
> regularly, losing must cost little — quick recovery, little or nothing dropped, the
> setback measured in minutes.

This means **[Q1](#open-questions) (what happens when you die) and the chaos pillar are
the same dial**, not two separate questions. Answer one and the other is largely
determined. If chaos is a pillar, the death penalty must be light.

### Reference worth looking at

**Deep Rock Galactic** is unusually close to this exact target: co-op mining, a hard
cap of four players, procedurally generated caves, environmental hazards, structured
chaos, a strong comedic voice, and an NPC handler who comments on everything. It's the
clearest existing proof that mining plus small-party co-op plus chaos plus humour
composes into a coherent game rather than a tonal mess.


---

## 11. Equipment: the investment arc & the loadout

The part of the drone idea that's actually being committed to, separated from the
chaos framing it arrived in.

### The investment arc

**The goal: use incremental progression to transform something from marginal into
irreplaceable.** An item starts only *sort of* useful and occasionally annoying — the
early drone that mildly wrecks your run because it isn't smart yet — and ends up so
good at its job that you never want to unequip it.

**This should apply across the majority of tools and equipment**, not just the drone.
The drone is the stand-in example, not the special case. Similar idea, not necessarily
identical execution.

What makes this worth building the whole equipment system around: the payoff isn't a
bigger number, it's a **changed relationship**. You remember the item that used to
embarrass you and now carries you. That's a story, and stat ladders don't produce one.
It pairs naturally with removing a constraint ([§6](#6-the-incremental-loop-rebuilt)) and with
the behaviour-over-numbers [guideline](#provenance-and-why-this-is-a-guideline) — noting that
the guideline is advisory, so an arc that runs partly on numbers still qualifies.

**The failure mode to design against:** "bad now, good later" means nobody reaches
later. An item that's genuinely annoying early is an item players shelve and never
invest in. The arc only works if early-stage gear is **useful but flawed**, not
useless and irritating — the drone must save real time from day one while
occasionally embarrassing you. The annoyance is the *texture* of the arc; the utility
is what keeps the player on it.

### Limited slots as a core loop

**Equipment slots are scarce, and that scarcity is a gameplay loop in itself.** With
more good equipment than slots, the player has to genuinely choose a loadout for the
situation they're heading into and the goal of that trip — weighing benefits against
costs rather than accumulating strictly-better gear.

This composes exceptionally well with the constraint-removal rule, and the two
together produce a clean formulation worth keeping:

> **Your loadout is a declaration of which constraints you're accepting for this
> expedition.** Every item removes a constraint; slots are scarce; so choosing gear
> *is* choosing which limitations you'll live with down there.

That's a real decision with real stakes, made fresh before every descent, and it costs
almost nothing to implement beyond the slot limit itself.


### Candidate equipment slate

> **_Speculative (unratified)._** This entire slate is an **agent proposal**, not a decided
> roster. The only items with author provenance are the **jetpack** and the **drone**
> ([§6](#6-the-incremental-loop-rebuilt), [§8](#8-automation)); the scanner exists in the game
> today. Everything else below was invented here. Nine items reading as a settled roster is
> exactly the kind of thing that gets built by mistake.

Ideas that fit the drone's identity. Three properties are the actual bar: it **removes a
constraint**, its early version is **useful but flawed**, and it stays **specialized** so the
loadout choice survives
([T6](#t6-irreplaceable-gear-and-meaningful-loadout-choice-are-in-tension)).

A fourth is **preferred but not required**: that upgrades change behaviour rather than
numbers. That's a [guideline](#provenance-and-why-this-is-a-guideline), so an item whose arc
is partly or wholly numeric is not disqualified — it just needs the number to change what the
player can attempt rather than only a rate.

#### Design the slate by axis, not by item

**_Speculative (unratified)._**

The single most useful rule for choosing what to build: **give each item its own
axis**, so no two compete for the same job. A loadout decision is only real if the
options aren't substitutes. Candidate axes: vertical traversal, horizontal traversal,
bulk excavation, fluid control, light & discovery, navigation, combat support,
environmental survival. One strong item per axis produces genuine choice; three
mining tools produce a tier list.

#### Traversal

- **Jetpack** _(already named)_ — vertical traversal. Removes "I must dig my way back
  out." Early: a short burst, four or five tiles, loud, slow to recharge. Late:
  sustained lift.
  **Caveat, flagged rather than buried:** an endpoint of *unlimited free flight* is the
  one upgrade in this document that breaks two systems at once. It deletes the
  traversal problem permanently ([T10](#t10-the-jetpack-deletes-the-traversal-problem))
  *and* it generalizes, which collapses the loadout choice
  ([T6](#t6-irreplaceable-gear-and-meaningful-loadout-choice-are-in-tension)). A better
  endpoint keeps it specialized: brilliant vertically, mediocre horizontally —
  precision hover in a shaft, not free movement everywhere.

- **Grapple / anchor line** — *horizontal* traversal and precision, deliberately a
  different axis from the jetpack so the two don't substitute. Early: short reach,
  slow retract, occasionally slips off the block. Late: fast, multi-anchor, can haul
  blocks (or yourself) toward the other end.

#### Excavation

- **Charges / shaped explosives** — bulk excavation. Removes "I mine one tile at a
  time." Early: an unpredictable-but-*deterministic* blast shape that will absolutely
  take out things you wanted, including you. Late: directional, shaped, safe-fused.
  Stays specialized by being terrible near loot, structures and fluid — exactly where
  precision matters.

- **Shoring / support tool** — places structural supports. Removes "I can't dig wide
  without collapsing it." Early: clumsy and material-hungry. Late: auto-shores the
  tunnel behind you as you advance. Valuable specifically *because* cave-ins and
  load-bearing blocks are real rules, and it makes those rules into a system the
  player engages with rather than avoids.

#### Fluid

- **Pump / fluid tool** — the purest expression of the specialization principle. Early:
  drains slowly, and mishandled it floods the space you're standing in. Late: directs
  flow, freezes a column, or converts lava to obsidian on contact.
  **Completely dead weight when there's no fluid, and indispensable when there is** —
  which is exactly the shape that keeps a loadout decision alive.

#### Light, discovery & navigation

- **Companion lantern** — a sibling to the drone, and the strongest candidate after it.
  Early: a flickering, unreliable light that gutters at the worst moments. Late: a
  floating orb that **drifts ahead of you and lights up what it finds interesting**.
  That last step turns a light source into a *discovery* tool, which directly addresses
  the residual local-cue problem in [T9](#t9-exploration-still-needs-breadcrumbs) —
  without a HUD marker, and with character.

- **Scanner → cartographer** — the existing Ore Scanner, given an arc. Early: short
  range and **reports false positives**, so it's useful but you learn not to trust it
  fully. Late: maps the surrounding area and marks structures and biomes.
  Worth more in DELVE than in most games because horizontal wrapping removed the
  world's absolute reference frame ([T8](#t8-wrapping-removes-the-worlds-absolute-reference-frame));
  a mapping tool is the answer to a problem the topology created.

#### Combat & survival

- **Combat drone** — the mining drone's sibling, and nearly free once entities exist
  (same entity, different target selection). Early: aggros things you were sneaking
  past. Late: intercepts and body-blocks for you.

- **Heat suit / diving gear** — environmental survival, one per hazard biome. Early:
  buys you a handful of seconds in the molten biome or underwater. Late: sustained
  immunity, or brief lava-wading. The archetypal specialized item: worthless
  everywhere except the one place it's mandatory, which makes packing it a real
  decision about where you're going.

- **Collector / magnet** — automates pickup, freeing the player from chasing drops.
  Early: hoovers up junk indiscriminately and tugs *you* around. Late: filtered, and
  reaches through rock. A chore-automation item, so it must stay on the right side of
  [automate the chore, never the choice](#the-rules-that-make-automation-safe-here).

### The two ideas pull against each other

Recorded as [T6](#t6-irreplaceable-gear-and-meaningful-loadout-choice-are-in-tension)
— "never want to unequip it" and "genuinely choose between equipment" are in direct
conflict unless *irreplaceable* is scoped to a purpose rather than to the game.

---

## 12. UI & interface art

**Status: diagnosed, with a recommended direction. Nothing built, and the diegetic
fork below is genuinely open.**

The UI today is entirely HTML and CSS floating over the game canvas — a top bar, a HUD,
two overlay panels (Inventory, Collection), and a touch pad. That was the right call to
get here and none of it is wasted. But it reads as a web page laid over a game rather
than part of one, and it's worth understanding precisely *why* before reaching for a
rewrite, because the obvious fix is the wrong one.

### The clash is measurable, not a matter of taste

| Evidence | Value |
| --- | --- |
| Colours defined in the UI stylesheet | 7 |
| Of those, present in the render palette (`client/src/render/palette.ts`) | **0** |
| Glyph characters standing in as button icons (`▣ ✦ ♪ ↺ ◄ ► ⤒`) | 7 |
| Pixel grids on screen at once (16px art upscaled 2×, vs. the browser's own) | 2 |

The UI has its own private palette that shares nothing with the game's. It also uses
three materials the world's renderer cannot produce at all: antialiased corner radii, a
backdrop blur, and smooth eased transitions. Nothing in a Resurrect-64 pixel scene can
make a gaussian blur or a subpixel-antialiased curve.

The glyph icons deserve their own callout: those are **found assets**, which the art
direction forbids outright, and they are the loudest "this is a web page" signal on the
screen.

### The diagnosis: a second art direction, not a second technology

**None of the above is caused by HTML.** It's caused by CSS defaults that nobody
overrode. Every single tell in that table is reachable from a stylesheet. That matters,
because it means moving the UI to canvas would fix the clash only incidentally — by
forcing a rewrite that happens to discard the defaults — while charging full price for
it.

### What a full-canvas UI would actually cost

Worth stating plainly, because the cost is concentrated in exactly the surfaces DELVE
already has:

- **Text stops being text.** No reflow, no user font size, no selection, no find-in-page,
  no screen reader output, no input-method support for anyone typing a non-Latin script.
- **Layout and interaction become ours.** Scroll containers, focus management, keyboard
  navigation, and hit testing are all reimplemented by hand.
- **The Inventory and Collection panels are the worst case.** They're scrollable lists of
  labelled items — the single most expensive thing to rebuild in canvas and the single
  cheapest thing the DOM already does well.
- **It contradicts a workspace rule.** The root `CLAUDE.md` says HTML and CSS are for
  chrome while canvas is the play area. Going full-canvas would need to be a deliberate
  amendment to that rule, not a drift past it.

Full-canvas UI *does* ship on the web, but overwhelmingly from engines exporting to it
(Unity, Godot, Bevy). Those builds are exactly the ones known for unreadable text on
high-density displays and broken assistive technology. That's the company this choice
keeps.

### Recommended shape: keep the DOM, force it onto the art's rules

The standard 2026 practice is **hybrid, split by what a thing _is_** rather than by how
it should look: canvas owns anything in world space or needing the art's pixel grid; the
DOM owns anything that is fundamentally a document. Concretely, for DELVE:

- **One shared pixel unit.** Export the art's upscale factor as a CSS custom property and
  express every padding, border, radius and icon size as a multiple of it. This alone puts
  the UI on the game's grid instead of the browser's.
- **Import the palette.** UI colour should come from `palette.ts`, not from seven private
  hexes in a `<style>` block. Two palettes in one game is a one-fact-one-home violation
  waiting to drift, and it's already drifted.
- **Delete the impossible materials.** No blur, no smooth gradients, no antialiased radii.
  Hard-offset shadows and hard-stop gradients read as pixel art; quantise transitions with
  a `steps()` timing function so motion lands on pixel boundaries rather than between them.
- **Nine-slice panel frames via `border-image`.** The standard technique for stylised
  panels in the DOM: draw the frame in code at startup, hand it to CSS as a data URL, and
  it tiles to any panel size without blur. Authored in code, so it satisfies the
  create-every-asset rule, and it needs no build step.

### The one genuinely canvas-shaped win

**Render icons and material swatches with the real material shaders**, into small canvases
embedded in the DOM panels. The shader registry already exists and already draws these
materials in the world, so an inventory slot can show the *actual* material rather than an
imitation of it.

This is cohesion **by construction rather than by imitation**, which is the same principle
the material system already won on — and it kills all seven glyph icons on the way past.
It's the highest-value item in this section and the least speculative.

### The surface inventory

**Confirmed: a healthy combination of overlays and in-game interface.** The full slate,
which is substantially larger than what exists today:

| Surface | Kind | Made of |
| --- | --- | --- |
| **Action bar** | Persistent | Slots + item icons; **assignable, paged** — see below |
| **Mini map** | Persistent | **A world render** |
| **Inventory** | Invoked | Slots + item icons, scrolling |
| **Character / equipment slots** | Invoked | Slots + item icons |
| **Crafting menu** | Invoked | Slots + recipe text, scrolling |
| **Codex** | Invoked | Prose, scrolling _(exists)_ |
| **Full map** | Invoked | **A world render** + chrome |
| **Character select / create** | Pre-session | Roster + creation form; exists because [characters are portable](#characters-are-portable) |

Seven surfaces is an **architecture** decision, not a styling one. Hand-rolling each in
turn is how the style forks, which is the exact failure the workspace rules warn about.

### The action bar: a Satisfactory-style assignable bar

**Decided.** One action bar with a **fixed UI footprint** and **multiple pages** the player can
toggle through, to which **almost anything can be assigned** — the Satisfactory model.

**The key property is that it's an _access_ layer, not a _capability_ layer.** Slots hold
**references**, not the items themselves, so assigning something neither moves nor consumes it.
Two things follow, and both protect decisions already made:

- **It doesn't touch inventory capacity.** Shortcuts cost no slots, so the bar stays out of the
  [variety-limited capacity](#capacity-limits-variety-not-volume) system entirely.
- **Unlimited pages don't undermine scarce equipment slots.** The scarcity that matters is what
  you *can* do ([§11](#limited-slots-as-a-core-loop)), not how fast you reach it. Stated
  explicitly because someone will eventually be tempted to "balance" the game by limiting pages —
  that would be balancing the wrong layer.

Three things it needs:

- **An enumerated assignable set**, because the slot widget has to know what it renders. The
  obvious four: **equipped-gear abilities**, **tools**, **placeable materials**, **consumables**.
  Mining stays *off* the bar — it's the core verb and the player always has it. (Placeable
  materials only become meaningful once placement/building exists, which is [Q2](#open-questions),
  so that entry is ordering rather than a blocker.)
- **Ability icons are a new art category.** The
  [icon pipeline](#the-one-genuinely-canvas-shaped-win) renders materials with their real shaders,
  which is what makes it cohesive — but a grapple or a jetpack burst has no material to render.
  Those need **authored glyphs drawn in code**, a different job from the shader path, and worth
  knowing before the pipeline is built.
- **Paging must work on touch and gamepad**, not just number keys and a scroll wheel. Swipe across
  the bar and shoulder buttons are the natural mappings; the workspace rules require both to be
  real rather than afterthoughts.

### The slate splits on an axis that decides the technology

Not overlay-vs-diegetic — **world render vs document**:

- **Two are world renders.** The mini map and full map are downsampled pictures of the
  world. That's canvas, unambiguously, and drawing them through the existing renderer at
  a coarser scale is the obvious implementation.
- **Five are documents with canvas icons inside them.** Scrolling, labelled, keyboard- and
  gamepad-navigable lists and grids.

This is the natural seam rather than a compromise, and it falls straight out of the hybrid
rule above instead of being imposed on it.

### Four of the seven are the same widget

Action bar, inventory, equipment slots and crafting ingredients are all **one slot
component**: an item icon, a count, and a state (empty / filled / selected / locked /
unaffordable). Build the slot once and the icon pipeline once, and four surfaces come
nearly free.

That promotes [the shader-rendered icon](#the-one-genuinely-canvas-shaped-win) from "nice
cohesion win" to **the load-bearing piece of the entire interface**. It's the right thing
to build first, and the thing most likely to be duplicated badly if it isn't.

The small shared vocabulary worth writing down before any surface is built: **panel frame,
slot, item icon, label, tooltip, focus ring**. That's the UI equivalent of what the
material system did for tiles — one compositor, many materials.

### Three consequences that are already decided elsewhere

**1. Panels do not and cannot pause. _Decided._** This is a **first-class design decision**, not
a consequence of multiplayer — an earlier pass justified it via shared worlds, which are
[not committed](#status-pinned-planned-around), so the justification was weaker than the rule.
The world keeps running while any panel is open.

- Every invoked surface must be **safe to browse while something walks toward you**, which rules
  out opaque full-screen panels.
- The player is **deliberately vulnerable during inventory management**. Terraria makes exactly
  this choice on purpose.
- Combined with [finite capacity](#capacity-limits-variety-not-volume), the full-bag decision now
  gets made *under threat* rather than at leisure.
- **Reading the map is itself risky**, which is a good property for a surface that's a
  [progression reward](#gating-which-surfaces-are-earned).
- **Implementation consequence:** the sim keeps stepping, so no panel may block the frame loop,
  and input routing has to decide per-key whether the UI or the game receives it.
- **It gives a base another job.** If panels can't pause, "somewhere safe to open your inventory"
  becomes a real need — a third functional answer to [Q2](#open-questions), alongside NPC housing
  and storage.

**2. The map is a progression reward, not chrome.** Two threads already point here:
wrapping removed the world's absolute reference frame
([T8](#t8-wrapping-removes-the-worlds-absolute-reference-frame)), and the
scanner → cartographer arc ([§11](#light-discovery--navigation)) *ends* at "maps the
surrounding area and marks structures and biomes." So the map can't ship as a solved
utility. It has to be **designed degraded-first** — mostly blank, earning its detail, with
the seam handled. That's a harder and far more interesting screen than a minimap, and it's
also a partial answer to [T9](#t9-exploration-still-needs-breadcrumbs).

**3. The inventory becomes slotted, and its capacity is itself a progression axis.**
Today inventory is a count per material: no ordering, no positions, no capacity. Both the
action bar and the decision below need the opposite — **ordered slots the player assigns**,
with a finite number of them. See
[T12](#t12-capacity-as-progression-taxes-the-discovery-pillar) for the cost this carries.

### What blocks what

- **Crafting menu** is blocked on knowing what equipment *is* and what it upgrades into
  ([§11](#11-equipment-the-investment-arc--the-loadout)) — there's nothing to craft until the
  equipment layer has shape.
- **Map** is blocked on the bounded world (build order step 1) and wants the cartographer
  arc to exist before it's finished.
- **Slot + icon pipeline** is blocked on nothing. It's buildable today against the
  materials that already exist.

### The equipment screen is the most important surface here

Worth separating from the rest, because it's easy to build it as a stat sheet by default.
[§11](#limited-slots-as-a-core-loop) made scarce slots a core loop, and the formulation was
that **your loadout is a declaration of which constraints you're accepting for this
expedition.** The character screen is *where that declaration is made* — the screen the
player stares at before every descent.

Design consequence: it should show **what you're giving up**, not only what you're wearing.
A screen that surfaces the opportunity cost of each slot is the one that makes the loadout
loop legible; a screen that lists equipped items with stat deltas is the one that turns it
back into a tier list.

### Gating: which surfaces are earned

**Resolved.** Availability and *capability* are gated separately:

| Surface | Available | Notes |
| --- | --- | --- |
| **Inventory** | Immediately | The panel is never locked; its **capacity** grows — see below |
| **Action bar** | Immediately | Not gated at all |
| **Mini map** | **Earned** | A progression reward, per the cartographer arc above |

**Inventory capacity is a progression axis.** A "larger backpack" grants more slots, so how
much you can carry out is something you invest in rather than something you're handed. This
is a deliberate reversal of DESIGN.md's no-capacity-cap pillar, and the reversal is sound
for a reason worth recording precisely:

> **Capacity is not a soft-lock generator here, because digging never requires inventory
> space.** A full bag stops you *collecting*; it can't stop you *mining*, and mining is the
> traversal verb. Fuel genuinely can strand a player (no fuel → no digging → no movement).
> Cargo can't. DESIGN.md's pillar lumps the two together as one category, and **that
> conflation is the error** — the pillar needs amending, not this idea.

#### Capacity limits variety, not volume

**Decided.** **One material = one slot, stacked without limit. There is no weight.** Capacity
caps how many *kinds* of thing you can carry, never how much.

This is what makes "everything is collectible"
([§1](#everything-is-mineable-and-everything-is-collectible)) survivable: dirt and stone are one
slot each forever, so **travelling never fills the bag**. What fills it is meeting materials you
aren't already carrying.

Three properties worth building on:

- **The code already works this way.** Inventory is a count per material — one entry per type,
  unbounded count. Capacity becomes a cap on the number of *entries*, which is close to a free
  change rather than a new data model.
- **The return trip is triggered by success, not by labour.** Grinding a known tunnel never fills
  you; pushing into a new biome fills you fast. Most hauling games get this backwards, and it
  means the expedition loop in
  [What capacity buys](#what-capacity-buys-which-is-more-than-it-costs) fires on discovery rather
  than on volume dug.
- **"Larger backpack" now means "carry more *kinds* of things."** Far more evocative than
  carrying more stuff, and it passes the
  [discriminator](#the-more-useful-test-than-numbers-bad) cleanly: it changes what you can bring
  home from a deep trip.

**Consequence for rich veins.** A 3× material drop costs nothing to *carry*, but that doesn't make
it worthless — **crafting is the sink that gives volume value**. See
[Fortune survives, re-pointed at extraction](#fortune-survives-re-pointed-at-extraction), where
both of Fortune's payloads are kept for different jobs.

#### Slot count is a fine upgrade on its own

Worth stating plainly, because an earlier version of this doc argued otherwise on the strength
of a rule the author never agreed to (see the
[provenance note](#provenance-and-why-this-is-a-guideline)): **"larger backpack" is an
acceptable number upgrade and needs no behavioural justification.** It passes the useful test
anyway — more slots lengthens an expedition, which changes how deep a trip can go.

Behavioural upgrades to the bag are available *in addition*, as enrichment rather than as a
correction, and they're good ideas on their own merits:

- **Compaction** — a pile of ore becomes a single ingot slot. Changes the shape of the
  problem rather than the size of the container.
- **Filtering** — auto-discard what the player has marked as junk. Removes the chore, not the
  choice ([§8](#the-rules-that-make-automation-safe-here)).
- **Sorting** — the bag organizes itself, so browsing it stops being work.
- **Remote deposit** — overflow goes to base storage from wherever you are. **Caution:** this
  removes the return trip and so deletes the expedition loop capacity was introduced to
  create. That's [T10](#t10-the-jetpack-deletes-the-traversal-problem) in a different costume,
  and it wants the same treatment — decide where in the arc it lands, and whether it's
  absolute or metered.

#### What capacity buys, which is more than it costs

- **It creates expedition structure, and DELVE has none today.** Descend, fill, return. That
  gives a trip a natural beginning and end, which the game currently lacks entirely. It's the
  loop Deep Rock Galactic, Valheim and Subnautica all run, and it's load-bearing in each.
- **It gives a base a job, which unblocks [Q2](#open-questions) without needing NPCs.**
  Somewhere to put the overflow is a concrete function, and a cleaner one than housing
  because it doesn't depend on a system that isn't designed yet.
- **It makes the traversal items matter more.** The return trip becomes a real problem rather
  than a hypothetical one, which is exactly what the jetpack and grapple exist to solve.

### The fork worth deciding: overlay or diegetic

A mining game has an obvious in-fiction home for its HUD. Depth on a gauge, materials in a
satchel, vision already tied to a lamp the game simulates. **If the UI becomes part of the
character's equipment it lives in world space, and that is the one argument that
legitimately moves it onto the canvas.**

This is a design question, not a technical one, and it's the real fork here — everything
above assumes the UI stays an overlay. Recorded as [Q6](#open-questions), and it pulls
against readability ([T11](#t11-diegetic-ui-trades-legibility-for-cohesion)).

### Typography is the biggest remaining tell

After colour, the font is what gives the UI away. A pixel face would close most of the
remaining gap, but **every pixel font available to download is a found asset**, which the
art direction forbids. Authoring one means drawing a glyph atlas in code: cheap for
uppercase and digits, expensive for real prose.

A defensible middle path is **two registers, chosen deliberately rather than by accident**:
an authored bitmap face for HUD numbers and labels, with codex blurbs staying vector as the
"field notes" voice. Worth deciding rather than defaulting into.

### HTML-in-Canvas: real, early, and aimed at a different problem

Status as of **2026-09-11**, checked rather than recalled:

| | |
| --- | --- |
| Chrome | Origin trial, **M148–M150**, behind `chrome://flags/#canvas-draw-element` |
| Safari / WebKit | No implementation announced |
| Firefox | No implementation, no flag; Mozilla's standards position undecided, with technical concerns |
| Spec | WICG incubation — **not in the HTML standard** |
| Baseline | **No**, and not close |

The shipped-behind-a-flag surface is `drawElementImage()` for 2D, with
`texElementImage2D()` (WebGL) and `copyElementImageToTexture()` (WebGPU) for texture
upload. The richer `placeElement()` — a *live, interactive, accessibility-preserving*
element inside canvas — is a separate and much earlier proposal (Intent to Prototype).

**It is the wrong tool for the problem in this section.** It composites the DOM into
canvas; it does nothing about how that DOM *looks*. Drawing today's panels through it
yields the same too-clean panels, just in a different buffer.

**It is, however, exactly the tool the diegetic fork would want.** If UI becomes an object
in the world — lit by the lamp, occluded by rock, quantised to the palette — then you need
real text layout rendered into a texture you can then shade yourself. `drawElementImage()`
into an offscreen canvas, then push those pixels through the same dither-and-light
treatment as everything else, is precisely that pipeline. Two caveats even then, and both
bite here specifically:

1. **The snapshot API has no interaction or hit testing.** The live version is the one
   that's further out.
2. **Scrolling and animation inside canvas can't update independently of JS.** The
   Inventory and Collection panels are scrolling lists, so the surface we'd most want it
   for is the surface it handles worst.

**Verdict: watch it, don't plan on it.** Baseline requires all four of Chrome, Edge,
Firefox and Safari; two engines have no implementation and one has open objections. An
origin trial is not a ship commitment. Treat it as a progressive enhancement to revisit if
the diegetic fork is ever taken, never as something the UI depends on.


---

## Tensions

Conflicts between ideas in this doc, or between an idea and something it quietly
deletes. Not objections — things to decide deliberately rather than discover later.

### T1. Progression is layered, so the layers must do different jobs

**The original tension is answered, not dissolved.** It asked which of three systems should
*own* progression. The answer is that they **coexist by design**: attributes, equipment and
environment are separate layers, and equipment may additionally modify attributes. See
[Progression is layered](#progression-is-layered).

**The live tension is what layering costs.** Layers that all scale the same number cancel each
other out as *feel*: if an attribute, a pickaxe tier and an environmental modifier each multiply
dig speed, every individual upgrade is imperceptible, and three systems have to be tuned against
each other forever. That's the standard failure in layered-progression games.

**The fix is a distinct signature per layer, not a distinct multiplier.** Candidate split:

| Layer | Character | Job |
| --- | --- | --- |
| **Attributes** | Broad, slow, permanent, applies everywhere | Raise the floor |
| **Equipment** | Specialized, swappable, situational | Change what's possible *this trip* |
| **Environment** | Temporary, contextual, mostly subtractive | Create pressure in specific places |

Each is felt differently, so the player can tell which layer moved. Residual work: decide, per
stat, which layer is *allowed* to touch it — and prefer that most stats answer to one layer
rather than all three.

### T2. Fluid simulation is the biggest technical risk on the board

Fluid is mutable, high-frequency, world-scale shared state, and the server is now
**authoritative**. That combination is the hard part:

- Fluid must be **simulated server-side** or clients desync from each other and from
  the server's truth.
- Fluid changes touch **many cells per tick**, unlike the current model where the
  player mutates one tile at a time — the existing "only save what changed" and
  client-prediction assumptions are sized for a very different update rate.
- Client prediction of fluid is hard; the likely compromise is predicting *player*
  motion locally while treating fluid as server-owned and interpolated.
- It must be bounded to **active regions** near players, or cost scales with world
  size instead of with what's being played.

None of this makes it a bad idea — it's the single highest-value system discussed so
far. It just wants prototyping early rather than being bolted on late, because it
has the power to reshape the netcode.

### T3. Drones span several progression layers at once

Drone count and laser power are graded values; drone *intelligence* is a behavioural arc; and a
drone is also a **found or crafted item**. Under the old "pick one spine" framing that made
drones a third claimant on progression. Under
[layering](#t1-progression-is-layered-so-the-layers-must-do-different-jobs) it's simply what an
item looks like when it has its own upgrade path — which
[§11](#the-investment-arc) says most equipment should have.

**Residual question, and it's now narrow:** does drone progression live *on the item* (upgrade
the drone) or *on the player* (an attribute that improves every drone)? The first fits the
investment arc and makes a specific drone *yours*; the second is cheaper to build and survives
losing the item. Worth deciding once for all equipment rather than per item.

### T4. Auto-mining interacts badly (or brilliantly) with fluid

Drones that pick their own targets will eventually breach a lava pocket or a water
body on the player's behalf, without the player choosing to. Two readings:

- **Hazard generator** — the player is punished for something they didn't decide,
  which reads as the automation betraying them.
- **Emergent story** — "my drones dug into lava" is a *great* thing to have happen
  once, and exactly the kind of moment simulated fluid exists to produce.

**Resolved in principle:** fluid-awareness is the *upgrade axis* rather than a
default — see [Intelligence as the upgrade axis](#intelligence-as-the-upgrade-axis).
The drone starts fluid-blind (funny, dangerous, framed as such) and earns
fluid-awareness, with late-game toggles letting the player opt back into recklessness
deliberately.

Residual multiplayer question: **whose drone, and whose lava?** In a shared world, one
player's dumb drone can flood a tunnel onto someone else's head. That's either the
best emergent story in the game or the fastest way to end a friendship, and it needs
an answer alongside the rest of the shared-world griefing question
([Q2](#open-questions)).

### T5. Chaos as a pillar would fight DELVE's current tone

_Only applies if chaos is adopted; it currently isn't._ The shipped design describes
DELVE as **moody** — muted rock, one saturated colour,
deliberate atmosphere. Chaos-as-a-voice, self-referential and a bit meme-shaped,
pulls toward **funny**. Those are different games, and the art direction currently
documented in the palette and lighting docs is built for the first one.

This is resolvable — Deep Rock Galactic is atmospheric *and* funny, and the contrast
is part of its appeal — but it resolves by **deciding**, not by drifting. If chaos
becomes a pillar, the art docs need to know, because tone leaks into palette,
animation character, and sound. Per the workspace rule: evolve the style guide
deliberately, don't let it fork silently.

### T6. Irreplaceable gear and meaningful loadout choice are in tension

Both goals come from [§11](#11-equipment-the-investment-arc--the-loadout), and taken
literally they cancel: if fully-upgraded items become things you *never want to
unequip*, the loadout decision collapses into "equip the best set," and the choice
loop dies exactly when the player has the most gear to choose from. Terraria has a
mild version of this — late-game accessory loadouts converge.

**The resolution is specialization, not power.** Upgrades should make an item
irreplaceable **for a purpose**, never in general:

- A fully-upgraded drone is indispensable for bulk excavation and dead weight in a
  fight.
- A fully-upgraded traversal item is indispensable for a deep descent and pointless
  while clearing a known area.

Done this way the choice gets *more* interesting at max level rather than less,
because every option is now excellent at its niche and the opportunity cost of
leaving it behind is high. This is the proven pattern — Monster Hunter, Deep Rock
Galactic's overclocks, and most loadout-driven games work exactly this way.

~~Corollary: slot count should not be a progression reward.~~ **Overruled by the author.**
**Equipment slots ARE an upgradable feature: start with a single slot in the early game and unlock
more as you progress.** (This was unratified agent synthesis, and it also contradicted inventory
slots being a reward.)

**What that changes, and it's mostly for the better.** One slot early makes the loadout decision
*maximally* sharp — you pick exactly one thing — so the choice is hardest when the player has the
fewest options, which is an unusual and good shape. The usual worry is the late game, where more
slots soften the choice.

**The invariant that keeps it alive:** *slot count must grow more slowly than the item roster.* If
the player gains slots faster than they gain specialized items, "equip the best set" wins and the
loop dies; if the roster outruns the slots, every new slot is a new *interesting* decision rather
than a relaxation of an old one. That's concrete enough to **assert in the content gate**, which
is a better guarantee than a design principle.

### T7. Player count and world size interact

**Resolved** — by tying the player cap to the size preset
([§7](#player-cap-scales-with-world-size)), the two knobs become one. The residual
work is the tuning invariant that makes it actually hold: generate content **per
expected player**, not per unit of area, so a small world isn't stripped bare and a
large one isn't empty.

### T8. Wrapping removes the world's absolute reference frame

> **Resolved — moot.** [Hard edges are decided](#hard-edges--but-not-a-visible-box), and they
> *restore* the absolute reference frame this tension was about: there is a real "far west" again,
> distance from an edge is meaningful, and the map has **no seam**. Kept as a record of why
> wrapping was attractive and what it would have cost.

A cylinder has no "far west." Every horizontal position is relative to spawn, and
"go left until you hit the edge" stops being a valid instruction or a valid memory.

Consequences worth deciding on:

- **Navigation and the map** need an origin. Spawn becomes the only fixed point, and
  a minimap has to handle the seam.
- **Landmark-based memory** ("the big cavern near the left edge") gets weaker.
  Player-placed markers or waypoints become more valuable than they'd otherwise be.
- **Directional content placement** ("the deep dungeon is always far from spawn")
  still works, but distance has a maximum of half the world width.

### T9. Exploration still needs breadcrumbs

Largely answered by bounding the world — guaranteed density beats any amount of
signalling. Two residual cases:

- ~~The optional infinite mode reintroduces the original problem in full.~~ **Moot — infinite
  mode is [cut](#hosted-worlds)**, so guaranteed density now holds unconditionally.
- Even at good density, the player needs *local* "there's something here" cues — a draft of air,
  a change in rock, ambient sound, a glow past the lamp radius. **The glow is already free**: every
  light source is an emitter under the same rules and light bleeds 2–3 tiles into solid rock, so
  emissive content announces itself through the rock face
  ([Light](#light-an-untradeable-floor-everything-above-it-earned)). This is a **content-placement**
  job, not a signalling system. The non-visual cues (draft, sound) remain unbuilt.

### T10. The jetpack deletes the traversal problem

Flight is an excellent reward precisely because vertical traversal is currently a
real problem. But the moment it's available, that problem is gone permanently — and
with it the reason for ropes, ladders, platforms, shaft planning, and "how do I get
back up?" tension.

Not a reason to cut it. A reason to decide **when** in the arc it lands, and whether
it's absolute (free flight) or metered (fuel, charge, cooldown) so it changes the
traversal problem rather than ending it.

### T11. Diegetic UI trades legibility for cohesion

A UI that lives in the world is maximally cohesive and *minimally readable*. Lamp-lit,
palette-quantised, occluded text is the same design that makes the world atmospheric, and
atmosphere is the enemy of a glanceable depth readout. The moody, low-contrast look that
[PALETTE.md](PALETTE.md) commits to is working directly against the HUD's job.

It also collides with the readability rule the workspace treats as non-negotiable: state
should be legible without reading text, contrast must survive any display, and none of that
survives being dimmed by a lamp radius.

Not a reason to reject diegetic UI — it's a reason to scope it. The likely resolution is
**diegetic for the ambient and persistent, overlay for the urgent and precise**: a lamp
that dims as a mood signal is diegetic; the number that says how deep you are is not.


### T12. Capacity as progression taxes the discovery pillar

**Supersedes an earlier, wrong version of this tension**, which claimed a capacity cap would
reintroduce soft-locks. It won't — see the
[correction](#gating-which-surfaces-are-earned): digging never consumes inventory space, so a
full bag can't strand anyone. The real conflict is elsewhere and it's sharper.

**[§2](#2-discovery--the-unexpected) is the headline pillar: the world interrupts your intent
with something worth abandoning it for.** A finite bag inverts that. Finding a rare vein with
no space left turns the game's best moment into bad news, and the player learns to *hope they
don't find anything* on the way out. That's the exact opposite of the feel target, and no
amount of tuning the slot count removes it — it's structural.

**The rubble half is solved.** [Capacity limits variety, not
volume](#capacity-limits-variety-not-volume), so dirt and stone occupy one slot each forever and
travelling never fills the bag. Common-material spam — the worst version of this tension, created
when everything became collectible — is gone.

**What's left is sharper, and it's the interesting half.** The bag now fills at exactly the rate
the player *discovers new kinds of material*. So the full-bag moment coincides precisely with the
game's best moment: finding something you've never seen. The tax didn't disappear, it concentrated
onto novelty.

That's a much better problem than rubble spam, because the decision it forces is a real one
("what do I abandon to take this?") rather than a chore. But it's still pointed at the pillar, and
it's worth designing for rather than declaring solved.

Things that reduce the tax, roughly in order of how much they cost to build:

- **Let the player choose what to drop, always.** The decision "is this worth a slot?" is the
  loadout logic applied to loot, which is a *good* decision. The failure mode is a bag that
  silently refuses a pickup, which reads as the game confiscating a discovery.
- **Never cap the thing being explored *for*.** If structures yield equipment and equipment
  doesn't consume material slots, the discovery pillar is insulated from the cargo loop.
- **Compaction as an upgrade** (below) shrinks the problem without removing the loop.
- **The collector/magnet item** ([§11](#combat--survival)) becomes near-mandatory rather than
  optional, because inventory chores are precisely what
  [automate the chore, never the choice](#the-rules-that-make-automation-safe-here) says to
  remove.

Unresolved, and worth deciding deliberately: **does a full bag block the pickup, or auto-drop
the least valuable thing?** The first is honest and annoying; the second is convenient and
occasionally throws away something you wanted.


---

## Open questions

- **Q1. What happens when you die?** **Answered** — drop the inventory (recoverable), keep
  equipment and attributes; respawn at a base, else a placed beacon, else the surface. Full
  treatment in [§1](#death-you-lose-the-trip-never-the-character). Note this is now settled
  *independently* of the chaos question, which previously had leverage over it.

- **Q2. What is a base _for_?** Base building needs a functional reason to exist or
  it becomes decorated storage. Terraria's answer is concrete: NPCs need housing,
  crafting stations must live somewhere, and night is dangerous so you need a safe
  place. Does DELVE have NPCs? A day/night or danger cycle? Deep forward camps that
  save travel time? The answer decides whether base building is a pillar or a hobby.
  Multiplayer sharpens this: is a base **shared** (one party camp everyone builds and
  benefits from) or **per-player** (everyone keeps their own)? Shared bases need
  griefing/permission answers; per-player bases need the world to hold many of them.
  **No longer unblocked — comprehensively answered.** A base now has **four** functions:
  **housing** NPCs ([§9](#9-npcs--dialogue)), **storage** for materials that don't fit
  ([§12](#capacity-limits-variety-not-volume)), a **safe place to open panels** since
  [panels never pause](#three-consequences-that-are-already-decided-elsewhere), and a
  **respawn point** ([§1](#death-you-lose-the-trip-never-the-character)). The question was parked
  because a base had no purpose; it now has more purposes than most of the rest of the doc. What's
  left is *scope and shape*, not justification — plus the shared-vs-per-player question below.

- **Q3. Does the coin economy survive?** **Answered: no — and already shipped.** Coins,
  selling, ore `value`, the Refinery multiplier and the Upgrades panel are deleted from main,
  not retuned. Crafting and equipment are the intended successor, which is still
  undesigned, so the honest state is *deleted, not yet replaced*. Residual: the upgrade
  levels themselves still exist and nothing raises them
  ([T1](#t1-progression-is-layered-so-the-layers-must-do-different-jobs)). See
  [Recommendation](#the-one-thing-to-decide-before-building-anything) and issue #6.

- **Q7. What is the biome roster, and how is each placed?** Parked for a dedicated session — the
  taxonomy (band vs pocket) and per-biome scarcity are settled in principle, but the roster and the
  counts aren't. Full agenda in
  [§2](#parked-for-a-dedicated-biome-session). Blocks whether a pocket biome may gate any
  crafting material.

- **Q4. Is there a surface?** **Answered: yes, and it is content** — Terraria-like. The
  subterranean world stays the **primary play space** (as the name says), but the surface is
  **not a barren flat plane**. Full treatment in
  [§4](#the-surface-is-real-content-subordinate-to-the-mine). Residual: whether there's a
  **day/night cycle**, which is the fork that decides how large the surface gets.

- **Q5. What's the actual concurrency ceiling of the current stack?** The target is
  small parties ([§7](#7-multiplayer)), which is comfortable — but nothing has been
  stress-tested, so the ceiling is unknown rather than known-to-be-fine. A cheap
  headless load harness (N scripted clients against one world) would turn the
  blue-sky question from a guess into a measurement, and would say early whether
  "dozens" is a stretch or a fantasy.

- **Q6. Is the UI an overlay or is it diegetic?** The fork from
  [§12](#12-ui--interface-art). An overlay keeps the DOM, keeps accessibility, and is
  fixed by CSS discipline alone. A diegetic UI puts the interface in the world — lit,
  occluded, part of the character's equipment — which is far more distinctive and far
  more expensive, costs the readability the workspace rules require
  ([T11](#t11-diegetic-ui-trades-legibility-for-cohesion)), and is the only thing that
  would justify moving UI onto the canvas. A split answer is available and probably
  right: diegetic for ambient state, overlay for anything urgent or precise.

---

## Appendix: provenance audit

Run after three separate claims in this document turned out to be ideas a previous session
inflated into settled direction. Method: cross-reference each claim against the commit that
introduced it. The commit bodies have a reliable tell — *"Records the proposed…"* / *"Records the
stated…"* indicates author input, while *"Synthesizes"*, *"Recommends"*, *"Proposes"*, *"Adds"* and
*"generalizes into a rule"* indicate the agent's own work. Several of the latter landed in the doc
as decisions.

### Ratified by the author

The seven-category genre framing; survival as danger rather than attrition; buried structures and
underground biomes; wanting simulated fluid; a **bounded** world; full combat as a parallel
discipline; reach and the jetpack as examples; multiplayer in scope; the two-to-four-player target;
the dedicated multi-tenant server; drones and drone intelligence as the upgrade axis; the
exploration identity constraint; NPCs; the equipment investment arc; **world size presets and the
player-cap-per-preset shape**; and everything in [§12](#12-ui--interface-art), plus every decision
recorded during the audit session itself.

### Speculative — unratified, do not build on

| # | Claim | Where |
| --- | --- | --- |
| 1 | Content generated **per expected player**, not per area | [§7](#player-cap-scales-with-world-size), [T7](#t7-player-count-and-world-size-interact) |
| 2 | **Ship Small first** | [§7](#where-the-cost-and-risk-concentrate) |
| 3 | World **lifecycle is required**; hibernation + retention policies | [§7](#world-lifecycle-is-now-a-required-system) |
| 4 | The **nine-item equipment slate** | [§11](#candidate-equipment-slate) |
| 5 | **One item per axis** | [§11](#design-the-slate-by-axis-not-by-item) |
| ~~6~~ | ~~Slot count is not a progression reward~~ — **overruled**: equipment slots start at one and are unlocked as progression | [T6](#t6-irreplaceable-gear-and-meaningful-loadout-choice-are-in-tension) |
| 7 | **Removes a constraint** as a game-wide rule | [§6](#the-design-rule-behind-both) |
| 8 | **Follow-the-player is load-bearing** and permanent | [§8](#the-rules-that-make-automation-safe-here) |
| 9 | Late-game drone **obedience modes** | [§8](#synthesis-progression-unlocks-the-toggles) |
| 10 | **High chaos requires cheap failure** | [§10](#the-constraint-delve-has-that-chaos-heavy-games-usually-dont) |

### Downgraded during the audit session

- **Behaviour-over-numbers** → a [guideline](#provenance-and-why-this-is-a-guideline), after being
  cited against the author's own "larger backpack" idea.
- **Horizontal wrapping** → [reopened](#hard-edges-vs-wrapping), with hard edges leading. Never
  landed on; only *bounded* was.
- **Fluid "settles on resume"** → replaced with running to completion
  ([§7](#world-lifecycle-is-now-a-required-system)). Decided without the author, and exploitable.

### Could not determine

- Whether the **four-player hard cap** was the author's before it was attached to size presets.
- ~~Whether scarce equipment slots as a core loop was the author's or the agent's.~~ **Moot** —
  the author has since ruled that equipment slots **start at one and grow**, so scarcity is real
  *and* progression touches it.

### Note on the tensions

`T1`–`T13` are analysis rather than decisions, and being the agent's work is appropriate there —
naming conflicts is the job. They're only a problem where a tension asserts a *resolution*, which
is why #6 above is listed despite living in one.

---

## Recommendation

_Opinionated synthesis of everything above — mine, not the author's. Recorded here so
the reasoning survives even if the conclusion gets overruled._

### The one thing to decide before building anything

**~~Pick the progression spine.~~ Answered — the premise was wrong.** Progression is
[layered](#progression-is-layered) by design, so there is no single spine to pick. What follows
was written under the old framing and is kept because its *conclusions* about the coin economy
still hold; read "the spine" as "which layer carries the bulk of the growth."

It read as a decision, not code, free to make now, with four separate systems claiming it ([T1](#t1-progression-is-layered-so-the-layers-must-do-different-jobs),
[T3](#t3-drones-span-several-progression-layers-at-once)): the coin-bought
upgrade panel, crafted/looted equipment, levelable skills, and drone levels.

**My recommendation: equipment and crafting own progression.** This is reinforced by
[§11](#11-equipment-the-investment-arc--the-loadout) — the investment arc and the
loadout loop only exist if equipment carries real weight. Specifically:

- **Retire the coin/upgrade panel** (Pickaxe / Agility / Refinery / Fortune) — **done**, and
  done outside this document. Refinery and Fortune in particular were idle-game multipliers on a
  coin economy, and they pulled against exploration: they made *ore* the point, when the point is
  supposed to be what you find and where you go. Refinery is gone; the remaining levels are inert
  plumbing awaiting an owner.
- **Ore becomes a crafting input, not a currency.** This is the change that makes
  mining serve exploration instead of being a slot machine: you mine because you need
  that material for the thing that gets you deeper, not because it converts to a
  number.
- **Equipment fits the design's stated direction** — it removes constraints
  ([§6](#6-the-incremental-loop-rebuilt)) and it can carry behavioural arcs, which the
  behaviour-over-numbers [guideline](#provenance-and-why-this-is-a-guideline) prefers where
  they fit. The upgrade panel could do neither, and its levers were pure rate multipliers
  rather than numbers that changed what was attemptable.
- **~~Skills stay deferred.~~ Superseded.** This assumed skills were a rival channel. Under
  layering, the **attribute layer is intrinsic and intended**, with a skill tree as its
  candidate structure ([Progression is layered](#progression-is-layered)). What remains
  deferrable is a *large* named-skill system with per-skill experience bars, which is a
  different and much bigger thing than an attribute the player invests in.

This also answers [Q3](#open-questions): coins become vestigial and should go, rather
than surviving as a parallel currency that needs its own justification.

**Agreed, and it already has a home.** This is
[#6 — *delve: rework the incremental / economy mechanics*](https://github.com/inman-sebastian/agent-games/issues/6),
whose intent was always heading here. The scope resolved concretely and then moved on: the
deletion shipped, and #6 is now the **new progression system** rather than either a retune or the
deletion. DESIGN.md's roadmap already describes it that way, so the rewording this section asked
for is done — what #6 now needs is the shape of the equipment and attribute layers, since it has
nothing concrete to build until those exist.

#### Consequence: the balance gate went with it

`tools/verify.ts` proved *"a greedy bot reaches Mythril within a sane budget"* — a
**coin-economy-shaped assertion**. Deleting the economy left it testing nothing real, and main
**deleted the script rather than replacing it**. That was the cheap half of the right move: the
assertion was dead, but the content-quality guarantee it carried — that no broken balance can ship
without a human playing every world — went with it and has no successor.

The replacement still needs building. It follows the same spirit but asserts the *new* pillar:

- Every generated world contains its guaranteed content (structures, biomes, ore
  tiers) at the **per-player density** the presets promise
  ([§7](#player-cap-scales-with-world-size)).
- Every tier of the crafting/equipment tree is **reachable** from a fresh world —
  the materials it needs actually generate at depths the player can survive with the
  gear available up to that point.

That second one is the real progression gate once coins are gone: it's the
crafting-tree equivalent of "the greedy bot reaches Mythril," and it's what stops a
soft-lock where the thing you need to go deeper can only be made from something that
only exists deeper.

#### The verify script's actual flaw, and what to keep

**Agreed that it's biased** — and worth separating the two things wrapped up in that,
because they have opposite fixes.

- **The bias is real.** A *greedy, optimal* bot on a *single* seed proves the best
  case is survivable. It says nothing about a normal player on an unlucky world. It
  answers "is this possible?" when the question worth asking is "is this reliably
  good?" That's a genuine blind spot, and it's why every scenario comes out blue-sky.
- **Determinism is not the flaw — it's the enabling property.** The world is
  `f(seed, c, r)`; determinism is precisely what makes content verifiable at all. The
  fix isn't less determinism, it's **more seeds and worse players**: run hundreds of
  seeds with deliberately imperfect agents and assert *invariants* rather than
  replaying one perfect run. That's property-based testing, and it's the standard
  answer to exactly this bias.

**The move to [Vitest](https://vitest.dev) has shipped** (PR #23), with
[fast-check](https://fast-check.dev) for property/fuzz generation and the policy written down in
[TESTING.md](TESTING.md) — invariants over curated scenarios, red before green, a regression test
per bug. The seeds-and-fuzzing half of the argument above is therefore done, and done well:
`engine.test.ts` drives random input streams over random seeds asserting no-tunneling, no NaN,
bounded velocity, monotonic depth, deterministic replay and material conservation, and
`blocks.test.ts` asserts world-gen determinism plus the ore-stays-in-its-band placement invariant.

**The caveat landed, though.** Vitest is a test *runner*, not a replacement for the gate, and the
gate **disappeared into it rather than becoming one**. Nothing on main asserts content
reachability, content density, or the absence of soft-locks — the class of property the deleted
script existed to guarantee. That's the live gap this section now describes, and it's a standing
violation of the workspace rule on automating content verification rather than an open design
question. It stays blocked on the same thing as everything else here: there's no crafting tree or
bounded world to assert *about* yet, which makes it the natural companion to build order step 1
rather than a separate errand.

The two test types are complementary, not alternatives:

| Type | Catches | Shape |
| --- | --- | --- |
| **Content verification** (the gate, reborn — **not yet built**) | Unsolvable, sparse, or soft-locked worlds | Headless sim, hundreds of seeds, imperfect agents, invariant assertions |
| **End-to-end** | Presentation, input, netcode and integration bugs the sim can't see | Thin, and **headless-first** — consistent with this project's existing preference for cheap tools over browser automation. Exists: `server/src/protocol.e2e.test.ts` covers the real client↔server path |

Invariants worth asserting once it's property-based, over N seeds:

- Every tier of the crafting tree is **reachable** by a **fresh character in a fresh world** —
  both halves stated, since [characters are portable](#characters-are-portable) and the two come
  apart. A maxed character entering a new world is out of scope by design, not a failure.
- Guaranteed content (structures, biomes, ore tiers) meets the promised
  **per-player density** at every size preset.
- No generated cavity or structure can **trap** the player with the traversal available at that
  depth. _(Weak by construction now: everything except bedrock is breakable and digging is free,
  so the player can almost always dig out. It retains teeth only around **bedrock pockets**,
  **fluid** (drowning in a flooded dead end), and **being sealed inside a tool-gated structure
  without the tool**. Assert those three cases specifically rather than the general claim, which
  passes trivially.)_
- No seed produces a world that fails any of the above — reported **as a failing
  seed**, which is reproducible by construction and therefore debuggable.

### Build order

> **Author direction: UI work comes soon.** The material **art direction is largely landed**, so
> the thing that blocked interface work is gone. Note the split, because it decides *what* to build
> first: the **UI foundation** is ready now, while the individual **surfaces** stay blocked on
> their own systems.
>
> | Ready now | Blocked on |
> | --- | --- |
> | The **slot widget** + **shader-rendered icon pipeline** ([§12](#the-one-genuinely-canvas-shaped-win)) | — nothing |
> | **Panel frame** (nine-slice, drawn in code) + the CSS discipline: shared pixel unit, palette imported from `palette.ts`, hard-edged materials ([§12](#recommended-shape-keep-the-dom-force-it-onto-the-arts-rules)) | — nothing |
> | Inventory + Codex panels | — nothing (both exist in some form) |
> | **Action bar** | the assignable set, which needs equipment to exist |
> | **Crafting menu** | the equipment/crafting tree |
> | **Mini map / full map** | the bounded world, and the map is a new *memory* system ([§6](#light-an-untradeable-floor-everything-above-it-earned)) |
> | **Character / equipment screen** | equipment, and now slot progression |
>
> The numbered order below is **[unratified](#appendix-provenance-audit)** agent synthesis; this
> note is the author's direction about UI within it, not a ratification of the rest.

1. **Bound the world and guarantee content density.** *(Small preset only.)*
   Wrapping horizontal bounds, a max depth, and generation that places a known number
   of structures and biomes per world. **No netcode work at all.**

   This is the recommendation I'd defend hardest. DELVE has no game loop yet — it has
   excellent tech and no game. This is the single change that converts it, and it's
   the only way to find out whether the discovery pillar is actually fun before
   spending months on systems that assume it is.

2. **The entity + replication layer, area-of-interest-shaped.**
   Everything downstream waits on it — enemies, loot drops, drones and fluid are all
   replicated entities or replicated world state, and the protocol has no entity
   concept today. Build it naive (a radius check is fine at four players) but build the
   *protocol shape* right, per
   [Keeping the blue-sky door open cheaply](#keeping-the-blue-sky-door-open-cheaply).

3. **Two players in one world, doing nothing in particular.**
   Shared world instance, player roster, remote players rendered and interpolated.
   Small, and it converts every pinned feel question into an experiment
   ([The cheapest way to unpin the feel questions](#the-cheapest-way-to-unpin-the-feel-questions)).
   Do it *before* the systems whose interactions are in doubt exist, not after.

4. **Fluid.** The highest-risk system ([T2](#t2-fluid-simulation-is-the-biggest-technical-risk-on-the-board))
   and the highest-value one. Cellular automata, active regions only, server-owned.
   Prototype it early enough that it can still reshape the netcode rather than having
   to fit around it.

5. **Combat, then drones.** Drones are nearly free once enemies exist — same entity,
   different target selection.

6. **Medium and Large presets.** Only once interest management is real and fluid has a
   measured budget.

### Defer deliberately

Not cuts — parked, with the reason:

| Deferred | Why |
| --- | --- |
| **Base building** | Still parked, but the reason weakened: NPCs are now confirmed ([§9](#9-npcs--dialogue)) and housing them is a proven job for a base. Decide [Q2](#open-questions) deliberately, then build. |
| **Large named-skill system** | Per-skill XP bars levelled by repeated use. The **attribute layer** is intended and not deferred; this is the much bigger version of it. |
| **Branching dialogue** | NPCs are in scope, but barks and one-shot lines carry most of the value ([§9](#9-npcs--dialogue)). Trees and quest state are a much larger system. |
| **Surface layer** | [Q4](#open-questions). A full sky/weather/day-night layer is a large amount of content and changes DELVE's subterranean identity. |
| ~~**Infinite mode**~~ | **Cut, not deferred** — see [§4](#hosted-worlds). It undoes guaranteed density, can't be covered by the content gate, and would have forced every content system to serve two contracts. |
| **Medium/Large worlds, 8–16 players** | Where every naive implementation stops being acceptable. Earn them. |
| **Breadcrumb/signalling layer** | Largely obviated by guaranteed density ([T9](#t9-exploration-still-needs-breadcrumbs)). Revisit only if playtesting shows local cues are still missing. |

### What to measure, not argue about

- **Concurrency ceiling** of the current stack ([Q5](#open-questions)) — a headless
  harness of N scripted clients against one world. Turns the whole scaling
  conversation from a guess into a number.
- **Content-per-player density** — the invariant that makes the size presets
  interchangeable ([§7](#player-cap-scales-with-world-size)). Assert it in the reborn
  content-verification gate
  ([above](#the-verify-scripts-actual-flaw-and-what-to-keep)) so no generated world can
  ship sparse.
