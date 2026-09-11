# DELVE — brainstorm scratchpad

> **Temporary.** Raw idea capture from a design session, living on the
> `delve/design-brainstorm` branch only. Nothing here is decided or implemented.
>
> **DESIGN.md is provisional, not authoritative.** Where an idea below contradicts
> the shipped design, assume the shipped design is what changes. Ideas that survive
> get folded into [DESIGN.md](DESIGN.md) (what the game is) or the art docs, and
> this file gets deleted.
>
> Baseline: DESIGN.md as of `e5754f1`. Everything before this session is prototype.

---

## 1. What DELVE is becoming

**A Terraria-like.** That inspiration is settled and not up for debate — it's the
foundation, not one option among several.

The genre is best described as the intersection of seven categories. Listing them
together is the fastest honest summary of the target:

| Category          | What it means here                                                          |
| ----------------- | --------------------------------------------------------------------------- |
| **Exploration**   | The primary driver. Digging is how you travel; finding is the reward.       |
| **Open world**    | Large, bounded, horizontally wrapping. **Not** infinite — see [§4](#4-world-topology--hosting). |
| **Incremental**   | Continuous, compounding growth in player capability.                        |
| **Survival**      | Enemies + player health + situational breath. **No attrition meters.**      |
| **Crafting**      | Tools, weapons, equipment are made, not just bought.                        |
| **Base building** | _(purpose TBD — see [Open questions](#open-questions))_                      |
| **Light RPG**     | Levelable skills/proficiencies + equipment and weapons. Deliberately light. |

"Light RPG" specifically means two things and no more: **skills that can be leveled
or influenced**, and **equipment/weapons that change what you can do**. Not classes,
quests, dialogue trees, or a stat sheet.

### Survival, scoped

**Resolved.** Survival here means *danger*, not *attrition*:

- **Enemies exist** and are a real threat.
- **The player has health** and can die.
- **Breath** applies situationally — underwater sections, exactly as in Terraria.

Explicitly **out**: hunger, thirst, stamina, temperature, fatigue, torch fuel, and
every other meter that ticks down while you play normally. Nothing punishes the
player for simply existing in the world; threat comes from what's *in* the world.

### Mining's role is changing

Mining **stays a core loop** — that isn't in question. What changes is its
*purpose*. Today mining is the whole game: you dig to get ore to buy upgrades to
dig deeper, a closed incremental loop. Going forward, mining leans much harder into
being **the means of exploration** — the way you move through and open up the world
— rather than an end in itself.

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

Costs and consequences are real and tracked in [T2](#t2-fluid-simulation-is-the-biggest-technical-risk-on-the-board).

---

## 4. World topology & hosting

**The world is finite, not infinite.** This reverses the "infinite in all
directions" direction currently in DESIGN.md.

- **Horizontally: large but bounded, and it wraps.** The leftmost edge of the world
  joins seamlessly to the rightmost edge. Walk far enough in one direction and you
  come back around.
- **Vertically: bounded.** There's a defined maximum depth, tuned as needed. Depth
  doesn't need to be infinite to feel deep.
- **Large enough** that it never reads as repetitive or obviously constrained.

### Why bounded solves the empty-digging problem

A finite world means finite space to fill, which means **content density can be
guaranteed** rather than hoped for. Generation can place a known number of
structures, biomes and set-pieces per world and be *sure* the player meets them. In
an infinite world, density is a probability and long empty stretches are inevitable.
This is a much stronger answer to [T4](#t4-exploration-still-needs-breadcrumbs) than
any signalling system would have been.

Wrapping additionally means **you can never be permanently lost**. Travelling in one
direction is always eventually productive, which keeps exploration low-anxiety.

> **Factual note, since it's load-bearing:** Terraria worlds are finite, but they do
> **not** wrap — they have hard edges with Ocean biomes at both ends. The finite
> insight matches Terraria; the wrap is DELVE's own call. Worth knowing because
> Terraria's edges do real work: they're landmarks, they anchor a global sense of
> direction ("the dungeon is west"), and they're a distinct biome in their own right.
> A wrapping world gives that up in exchange for seamlessness — see
> [T3](#t3-wrapping-removes-the-worlds-absolute-reference-frame).

### Hosted worlds

The client/server split already shipped (authoritative server + client prediction)
feeds directly into this: **players host their own worlds/servers.**

World generation parameters become **server settings**, chosen at world creation:

- **Size presets** — small / medium / large.
- **Optional truly-infinite world** for players who explicitly want it and accept
  the tradeoff: lower content density and duller stretches between discoveries.

This reframes "infinite vs finite" from a design argument into a **player-facing
option with an honestly-stated tradeoff**, which is a much better place for it to
live. It does mean generation and content placement must work in both modes.

---

## 5. Combat

**Resolved: a full combat system**, not a mining-flavoured afterthought.

- **Multiple weapons** and **multiple pieces of equipment**.
- Each carries **its own perks and benefits** — weapons and gear are differentiated
  by what they let you do, not just by a damage number.

This confirms combat as a **parallel discipline** to mining, with its own crafting,
its own progression, and its own feel. It's a major scope commitment and should be
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

### The design rule behind both

An item doesn't add a number, it **removes a constraint the player has been living
with.** Reach removes "I must be adjacent." The jetpack removes "I must dig my way
out." This is worth adopting as an explicit, game-wide rule for equipment design —
it's what separates memorable gear from a stat ladder, and it applies to weapons
([§5](#5-combat)) as much as to tools.

---

## Tensions

Conflicts between ideas in this doc, or between an idea and something it quietly
deletes. Not objections — things to decide deliberately rather than discover later.

### T1. Three progression channels now exist

Progression can now arrive by three different routes: the **coin-bought upgrade
panel** (Pickaxe / Agility / Refinery / Fortune), **crafted or looted equipment**,
and **levelable skills**. Each is a complete progression system on its own.

Reach is the concrete case: it reads equally naturally as a purchased upgrade level,
a crafted pickaxe's stat, or a mining-skill rank. Whichever it is, the other two
channels get quieter. Worth deciding which channel *owns* "the player gets stronger"
before building any of them.

Refinery and Fortune are specifically idle-game levers — multipliers on a coin
economy. They pull toward a different genre than equipment and skills do.

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

### T3. Wrapping removes the world's absolute reference frame

A cylinder has no "far west." Every horizontal position is relative to spawn, and
"go left until you hit the edge" stops being a valid instruction or a valid memory.

Consequences worth deciding on:

- **Navigation and the map** need an origin. Spawn becomes the only fixed point, and
  a minimap has to handle the seam.
- **Landmark-based memory** ("the big cavern near the left edge") gets weaker.
  Player-placed markers or waypoints become more valuable than they'd otherwise be.
- **Directional content placement** ("the deep dungeon is always far from spawn")
  still works, but distance has a maximum of half the world width.

### T4. Exploration still needs breadcrumbs

Largely answered by bounding the world — guaranteed density beats any amount of
signalling. Two residual cases:

- The **optional infinite mode** reintroduces the original problem in full, and is
  the mode that most needs a signalling layer.
- Even at good density, the player needs *local* "there's something here" cues —
  a draft of air, a change in rock, ambient sound, a glow past the lamp radius.
  Currently there's only a short-range Ore Scanner and the lamp.

### T5. The jetpack deletes the traversal problem

Flight is an excellent reward precisely because vertical traversal is currently a
real problem. But the moment it's available, that problem is gone permanently — and
with it the reason for ropes, ladders, platforms, shaft planning, and "how do I get
back up?" tension.

Not a reason to cut it. A reason to decide **when** in the arc it lands, and whether
it's absolute (free flight) or metered (fuel, charge, cooldown) so it changes the
traversal problem rather than ending it.

---

## Open questions

- **Q1. Is this multiplayer?** "Players host their own servers" reads as multiple
  simultaneous players in one world, and the authoritative-server architecture is
  already built for it. But it could also mean self-hosted single-player worlds. The
  answer is load-bearing for combat netcode, fluid authority, base building
  (shared or per-player?), progression, and inventory. Worth answering explicitly.

- **Q2. What happens when you die?** Health and enemies mean death, and death is the
  moment that decides how bravely players explore. Respawn at a base, at the surface,
  at a checkpoint? Do you drop coins, inventory, or nothing? A harsh answer makes
  deep exploration feel expensive and players play conservatively; a soft answer
  keeps the "just see what's down there" impulse alive.

- **Q3. What is a base _for_?** Base building needs a functional reason to exist or
  it becomes decorated storage. Terraria's answer is concrete: NPCs need housing,
  crafting stations must live somewhere, and night is dangerous so you need a safe
  place. Does DELVE have NPCs? A day/night or danger cycle? Deep forward camps that
  save travel time? The answer decides whether base building is a pillar or a hobby.

- **Q4. Does the coin economy survive?** See [T1](#t1-three-progression-channels-now-exist).
  If crafting and loot become the progression spine, coins, selling, and the
  Upgrades panel may be vestigial — or may become a parallel currency track that
  needs its own justification.

- **Q5. Is there a surface?** The world is bounded vertically at the bottom; what's
  at the top? A full surface layer with sky, weather and day/night is a large amount
  of content and changes the game's identity (DELVE is currently entirely
  subterranean). A shallow "mouth of the mine" is much cheaper.
