# DELVE — brainstorm scratchpad

> **Temporary.** Raw idea capture from a design session, living on the
> `delve/design-brainstorm` branch only. Nothing here is decided or implemented.
>
> **DESIGN.md is provisional, not authoritative.** Where an idea below contradicts
> the shipped design, assume the shipped design is what changes. Ideas that survive
> get folded into [DESIGN.md](DESIGN.md) (what the game is) or the art docs, and
> this file gets deleted.
>
> Baseline: DESIGN.md as of `ac8b07a`, re-baselined from `e5754f1` mid-session. Main shipped
> two things this document had been arguing *for* — the coin economy's deletion and the move to
> Vitest — so those passages now read as records of what happened rather than recommendations.
> Everything before this session is prototype.

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
*purpose*. Until the economy was deleted, mining was the whole game: you dug to get ore to
buy upgrades to dig deeper, a closed incremental loop. Going forward, mining leans much harder
into being **the means of exploration** — the way you move through and open up the world —
rather than an end in itself.

That closed loop is now **gone rather than replaced**: mining drops materials into an inventory
and nothing consumes them. So the reframing here isn't a course correction away from a working
loop, it's the design for the hole where one used to be.

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
This is a much stronger answer to [T9](#t9-exploration-still-needs-breadcrumbs) than
any signalling system would have been.

Wrapping additionally means **you can never be permanently lost**. Travelling in one
direction is always eventually productive, which keeps exploration low-anxiety.

> **Factual note, since it's load-bearing:** Terraria worlds are finite, but they do
> **not** wrap — they have hard edges with Ocean biomes at both ends. The finite
> insight matches Terraria; the wrap is DELVE's own call. Worth knowing because
> Terraria's edges do real work: they're landmarks, they anchor a global sense of
> direction ("the dungeon is west"), and they're a distinct biome in their own right.
> A wrapping world gives that up in exchange for seamlessness — see
> [T8](#t8-wrapping-removes-the-worlds-absolute-reference-frame).

### Hosted worlds

The client/server split already shipped (authoritative server + client prediction)
feeds directly into this: **players create their own worlds.** The hosting model is
settled in [§7](#decided-shape-one-dedicated-server-many-player-created-worlds) — one
dedicated server holding many player-created world instances, not player-run machines.

World generation parameters become **world-creation settings**:

- **Size presets** — small / medium / large, each with its own
  [player cap](#player-cap-scales-with-world-size).
- **Optional truly-infinite world** for players who explicitly want it and accept
  the tradeoff: lower content density and duller stretches between discoveries.
  (Deferred, not a launch feature — see [Defer deliberately](#defer-deliberately).)

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
| **World-scoped persistence** | Per-player whole-file writes can't hold a shared world, especially with fluid state in it. |

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

1. **The tuning invariant becomes content-per-player, not content-per-area.** If
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

Practical consequence: **ship Small first.** It's the cheapest to run, the easiest to
tune, and it's the size that makes the naive implementations acceptable. Medium and
Large can follow once interest management and fluid budgets are real.

#### World lifecycle is now a required system

With worlds outliving their players, two things need explicit answers:

- **Hibernation.** A world with nobody in it must stop ticking entirely — no fluid, no
  entities, no snapshots. This is the single lever that keeps cost proportional to
  *active* worlds rather than to *created* worlds, and without it a hosted
  multi-tenant model gets expensive fast. (Fluid mid-flow at hibernation simply settles
  on resume; no one is watching.)
- **Retention.** Created worlds accumulate forever unless something evicts them.
  Abandoned-world cleanup, storage caps, or explicit deletion — not urgent, but it's a
  real cost curve and better decided than discovered.

### Target scale

**Real target: small parties on bounded worlds** — two to four players, per the
Small preset's cap ([above](#player-cap-scales-with-world-size)). That's the shape to
build and tune for first.

**Blue sky, explicitly not a goal:** dozens of players on an infinite world. Noted as
something to revisit if it turns out to be reachable, not something to design toward.

The gap between those two is bigger than the player counts suggest, and it's worth
knowing why: **player count multiplies the simulated surface area, not just the
bandwidth.** Fluid and entities are simulated in active regions around players, so
two players scattered in a bounded world means two active regions, while dozens
scattered across an infinite world means dozens of independent simulation
neighbourhoods with nothing shared between them. Bandwidth is the easy half.

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

A second rule falls out of the drone-intelligence idea and generalizes just as well:

> **Upgrade the behaviour, not the number.** Where an upgrade *can* change what a
> thing does rather than how much it does, prefer that. It's more memorable, it's
> more legible, and it produces an arc instead of a multiplier.

**Follow-the-player is therefore load-bearing, not flavour.** The moment drones can
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

> **High chaos requires cheap failure.** If the world is allowed to wreck your plans
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
It's the natural partner of the two rules already adopted — removes a constraint
([§6](#6-the-incremental-loop-rebuilt)) and upgrades behaviour, not numbers
([§8](#the-rules-that-make-automation-safe-here)).

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

Ideas that fit the drone's identity. Each needs the same four properties: it
**removes a constraint**, its early version is **useful but flawed**, its upgrades
change **behaviour rather than numbers**, and it stays **specialized** so the loadout
choice survives ([T6](#t6-irreplaceable-gear-and-meaningful-loadout-choice-are-in-tension)).

#### Design the slate by axis, not by item

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

## Tensions

Conflicts between ideas in this doc, or between an idea and something it quietly
deletes. Not objections — things to decide deliberately rather than discover later.

### T1. Three progression channels now exist

Progression can arrive by three different routes: the **orphaned upgrade levels**
(`up.pick` / `up.speed` / `up.fortune`, plus `tech.lantern`), **crafted or looted equipment**,
and **levelable skills**. Each is a complete progression system on its own.

**Partly resolved by main, not by this document.** The coin economy is deleted — coins, selling,
ore `value`, the Refinery multiplier and the Upgrades panel that bought levels are all gone. The
*levels* survive on `PlayerState` and still feed `stats()`, and **nothing raises them**, so dig
power, speed, fortune and vision are constants. The first channel is therefore no longer a rival
design competing for the spine; it's live plumbing with no owner. The question it leaves behind is
sharper than the original three-way one: does equipment **replace** those levels outright, or
**become the thing that raises them**?

Reach is the concrete case: it reads equally naturally as a purchased upgrade level,
a crafted pickaxe's stat, or a mining-skill rank. Whichever it is, the other two
channels get quieter. Worth deciding which channel *owns* "the player gets stronger"
before building any of them.

Refinery is already gone with the economy. **Fortune is the one surviving idle-game lever** — a
multiplier on rich-vein chance, which makes *ore quantity* the reward in a design that wants the
reward to be what you find and where you go. Whatever owns progression should decide deliberately
whether Fortune is kept, not inherit it because the field is still on the struct.

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

### T3. Automation is a third claimant on the progression spine

Drone count and laser power are, mechanically, exactly the leveled-upgrade pattern
that [T1](#t1-three-progression-channels-now-exist) is already about. Drones as a
*found/crafted item* fit the equipment channel; drones as a *levelable thing* fit the
skill or coin-upgrade channel. Same unresolved question, now with a third claimant.

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

Corollary worth stating: **slot count should not be a progression reward**, or at
most a very rare one. Handing out slots dissolves the tension that makes the system
work. The scarcity *is* the mechanic.

### T7. Player count and world size interact

**Resolved** — by tying the player cap to the size preset
([§7](#player-cap-scales-with-world-size)), the two knobs become one. The residual
work is the tuning invariant that makes it actually hold: generate content **per
expected player**, not per unit of area, so a small world isn't stripped bare and a
large one isn't empty.

### T8. Wrapping removes the world's absolute reference frame

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

- The **optional infinite mode** reintroduces the original problem in full, and is
  the mode that most needs a signalling layer.
- Even at good density, the player needs *local* "there's something here" cues —
  a draft of air, a change in rock, ambient sound, a glow past the lamp radius.
  Currently there's only a short-range Ore Scanner and the lamp.

### T10. The jetpack deletes the traversal problem

Flight is an excellent reward precisely because vertical traversal is currently a
real problem. But the moment it's available, that problem is gone permanently — and
with it the reason for ropes, ladders, platforms, shaft planning, and "how do I get
back up?" tension.

Not a reason to cut it. A reason to decide **when** in the arc it lands, and whether
it's absolute (free flight) or metered (fuel, charge, cooldown) so it changes the
traversal problem rather than ending it.

---

## Open questions

- **Q1. What happens when you die?** Health and enemies mean death, and death is the
  moment that decides how bravely players explore. Respawn at a base, at the surface,
  at a checkpoint? Do you drop inventory, or nothing? A harsh answer makes deep
  exploration feel expensive and players play conservatively; a soft answer keeps the
  "just see what's down there" impulse alive.
  *If* chaos is ever adopted as a pillar
  ([§10](#the-constraint-delve-has-that-chaos-heavy-games-usually-dont)), this is
  largely answered, since high chaos requires cheap failure. Chaos is currently
  uncommitted, so this stays open.

- **Q2. What is a base _for_?** Base building needs a functional reason to exist or
  it becomes decorated storage. Terraria's answer is concrete: NPCs need housing,
  crafting stations must live somewhere, and night is dangerous so you need a safe
  place. Does DELVE have NPCs? A day/night or danger cycle? Deep forward camps that
  save travel time? The answer decides whether base building is a pillar or a hobby.
  Multiplayer sharpens this: is a base **shared** (one party camp everyone builds and
  benefits from) or **per-player** (everyone keeps their own)? Shared bases need
  griefing/permission answers; per-player bases need the world to hold many of them.
  **Partially unblocked by [§9](#9-npcs--dialogue):** NPCs exist, and housing them is
  a proven answer to what a base is for.

- **Q3. Does the coin economy survive?** **Answered: no — and already shipped.** Coins,
  selling, ore `value`, the Refinery multiplier and the Upgrades panel are deleted from main,
  not retuned. Crafting and equipment are the intended successor spine, which is still
  undesigned, so the honest state is *deleted, not yet replaced*. Residual: the upgrade
  levels themselves still exist and nothing raises them
  ([T1](#t1-three-progression-channels-now-exist)). See
  [Recommendation](#the-one-thing-to-decide-before-building-anything) and issue #6.

- **Q4. Is there a surface?** The world is bounded vertically at the bottom; what's
  at the top? A full surface layer with sky, weather and day/night is a large amount
  of content and changes the game's identity (DELVE is currently entirely
  subterranean). A shallow "mouth of the mine" is much cheaper.

- **Q5. What's the actual concurrency ceiling of the current stack?** The target is
  small parties ([§7](#7-multiplayer)), which is comfortable — but nothing has been
  stress-tested, so the ceiling is unknown rather than known-to-be-fine. A cheap
  headless load harness (N scripted clients against one world) would turn the
  blue-sky question from a guess into a measurement, and would say early whether
  "dozens" is a stretch or a fantasy.

---

## Recommendation

_Opinionated synthesis of everything above — mine, not the author's. Recorded here so
the reasoning survives even if the conclusion gets overruled._

### The one thing to decide before building anything

**Pick the progression spine.** It's a decision, not code, it's free to make now, and
four separate systems currently claim it ([T1](#t1-three-progression-channels-now-exist),
[T3](#t3-automation-is-a-third-claimant-on-the-progression-spine)): the coin-bought
upgrade panel, crafted/looted equipment, levelable skills, and drone levels.

**My recommendation: equipment and crafting own progression.** This is reinforced by
[§11](#11-equipment-the-investment-arc--the-loadout) — the investment arc and the
loadout loop only exist if equipment is the spine. Specifically:

- **Retire the coin/upgrade panel** (Pickaxe / Agility / Refinery / Fortune) — **done**, and
  done outside this document. Refinery and Fortune in particular were idle-game multipliers on a
  coin economy, and they pulled against exploration: they made *ore* the point, when the point is
  supposed to be what you find and where you go. Refinery is gone; the remaining levels are inert
  plumbing awaiting an owner.
- **Ore becomes a crafting input, not a currency.** This is the change that makes
  mining serve exploration instead of being a slot machine: you mine because you need
  that material for the thing that gets you deeper, not because it converts to a
  number.
- **Equipment satisfies the rules the design already committed to** — it removes
  constraints ([§6](#6-the-incremental-loop-rebuilt)) and upgrades behaviour rather
  than numbers ([§8](#the-rules-that-make-automation-safe-here)). The upgrade panel
  can do neither.
- **Skills stay deferred.** "Light RPG" is satisfied by equipment alone for a long
  time. Add skills only if equipment turns out to be insufficient — a third channel
  added later is easy; a third channel removed later is not.

This also answers [Q3](#open-questions): coins become vestigial and should go, rather
than surviving as a parallel currency that needs its own justification.

**Agreed, and it already has a home.** This is
[#6 — *delve: rework the incremental / economy mechanics*](https://github.com/inman-sebastian/agent-games/issues/6),
whose intent was always heading here. The scope resolved concretely and then moved on: the
deletion shipped, and #6 is now the **new progression system** rather than either a retune or the
deletion. DESIGN.md's roadmap already describes it that way, so the rewording this section asked
for is done — what #6 now needs is the spine decision above, since it has nothing to build until
something owns "the player gets stronger".

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

- Every tier of the crafting tree is **reachable** from a fresh world.
- Guaranteed content (structures, biomes, ore tiers) meets the promised
  **per-player density** at every size preset.
- No generated cavity or structure can **trap** the player with the traversal
  available at that depth.
- No seed produces a world that fails any of the above — reported **as a failing
  seed**, which is reproducible by construction and therefore debuggable.

### Build order

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
| **Skills** | Third progression channel. Equipment covers "light RPG" alone for now. |
| **Branching dialogue** | NPCs are in scope, but barks and one-shot lines carry most of the value ([§9](#9-npcs--dialogue)). Trees and quest state are a much larger system. |
| **Surface layer** | [Q4](#open-questions). A full sky/weather/day-night layer is a large amount of content and changes DELVE's subterranean identity. |
| **Infinite mode** | Reintroduces the empty-digging problem in full and is the mode that most needs a signalling layer. It's an option, not a launch feature. |
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
