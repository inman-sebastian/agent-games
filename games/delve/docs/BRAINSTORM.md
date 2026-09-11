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

| Category          | What it means here                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| **Exploration**   | The primary driver. Digging is how you travel; finding is the reward.   |
| **Open world**    | Infinite in all directions, freely traversable, no bounded shaft.       |
| **Incremental**   | Continuous, compounding growth in player capability.                    |
| **Survival**      | Enemies + player health + situational breath. **No attrition meters.**  |
| **Crafting**      | Tools, weapons, equipment are made, not just bought.                    |
| **Base building** | _(purpose TBD — see [Open questions](#open-questions))_                  |
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

**Discoverability and exploration are a headline pillar**, not a feature. The
question "what's over there / down there?" is the engine of the game.

---

## 3. The incremental loop, rebuilt

The incremental side is a **core loop**, not a side system — but the *source* of
progression moves. Progression comes from **finding or crafting tools, weapons and
equipment**, which then **influence the player's abilities and proficiencies**.

Named examples:

- **Reach.** Default mining reach is one tile. Something upgrades it to two, and
  presumably further. (A tiny number with an enormous effect on how mining feels.)
- **Jetpack.** Hold jump to fly, letting the player ascend a vertical shaft directly
  instead of having to dig their way back out.

The pattern behind both: an item doesn't just add a number, it **removes a
constraint the player has been living with**. That's a strong, cohesive design rule
and worth stating explicitly as one.

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

### T2. The jetpack deletes the traversal problem

Flight is an excellent reward precisely because vertical traversal is currently a
real problem. But the moment it's available, that problem is gone permanently — and
with it the reason for ropes, ladders, platforms, shaft planning, and "how do I get
back up?" tension.

Not a reason to cut it. A reason to decide **when** in the arc it lands, and whether
it's absolute (free flight) or metered (fuel, charge, cooldown) so it changes the
traversal problem rather than ending it.

### T3. Exploration needs breadcrumbs

An infinite world plus rare structures plus random digging means the player can dig
for a long time and find nothing. Terraria avoids this with visible cave mouths,
background shifts, ambient audio, and a map — the world constantly signals "there's
something over here."

DELVE currently has an Ore Scanner and a lamp radius, both short-range. Discovery as
a pillar needs a deliberate **signalling layer** — something that makes the
interesting thing findable without making it un-surprising.

---

### T4. Water is a whole system

Situational breath implies **water bodies in the world**, which is one of the larger
systems on the table: fluid generation, flow/settling behaviour when you mine into a
pocket, swimming physics, buoyancy, a breath meter and drowning, plus water
rendering and lighting through it.

Terraria's water is a genuinely deep system and a lot of its best emergent moments
(flooding your own tunnel, draining a cavern) come from flow being simulated rather
than static. The cheap version is **static water bodies that never flow** — fine to
swim in, no emergent behaviour. Worth choosing the tier deliberately, because the
gap in cost between them is large.

## Open questions

- **Q1. What happens when you die?** Health and enemies mean death, and death is the
  moment that decides how bravely players explore. Respawn at a base, at the surface,
  at a checkpoint? Do you drop coins, inventory, or nothing? A harsh answer makes
  deep exploration feel expensive and players play conservatively; a soft answer
  keeps the "just see what's down there" impulse alive.

- **Q2. What is a base _for_?** Base building needs a functional reason to exist or
  it becomes decorated storage. Terraria's answer is concrete: NPCs need housing,
  crafting stations must live somewhere, and night is dangerous so you need a safe
  place. Does DELVE have NPCs? A day/night or danger cycle? Deep forward camps that
  save travel time? The answer decides whether base building is a pillar or a hobby.

- **Q3. Is combat its own discipline, or an extension of mining?** Enemies imply
  weapons, and weapons imply a combat system with its own depth, feel and
  progression. The cheap, cohesive version is that your pickaxe *is* your weapon and
  combat is mining-flavoured. The expensive version is a parallel weapon/combat track
  with its own crafting tree. Both are valid; they're very different amounts of work.

- **Q4. Does the coin economy survive?** See [T1](#t1-three-progression-channels-now-exist).
  If crafting and loot become the progression spine, coins, selling, and the
  Upgrades panel may be vestigial — or may become a parallel currency track that
  needs its own justification.
