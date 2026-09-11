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
This is a much stronger answer to [T7](#t7-exploration-still-needs-breadcrumbs) than
any signalling system would have been.

Wrapping additionally means **you can never be permanently lost**. Travelling in one
direction is always eventually productive, which keeps exploration low-anxiety.

> **Factual note, since it's load-bearing:** Terraria worlds are finite, but they do
> **not** wrap — they have hard edges with Ocean biomes at both ends. The finite
> insight matches Terraria; the wrap is DELVE's own call. Worth knowing because
> Terraria's edges do real work: they're landmarks, they anchor a global sense of
> direction ("the dungeon is west"), and they're a distinct biome in their own right.
> A wrapping world gives that up in exchange for seamlessness — see
> [T6](#t6-wrapping-removes-the-worlds-absolute-reference-frame).

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

## 7. Multiplayer

**Resolved: the game is scoped as multiplayer-compatible.** Player count per world
is undetermined and the existing infrastructure hasn't been stress-tested.

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

### Proposed shape: host-based, hard cap of 4

**One player hosts, up to three others join. Maximum four players, full stop.**

The hard cap is the best part of this proposal and worth keeping regardless of how
hosting is implemented. A concrete number turns a pile of open-ended scaling
questions into a fixed budget:

- **Interest management can be deferred entirely** for now (keep the protocol's
  *shape* area-of-interest-ready per
  [Keeping the blue-sky door open cheaply](#keeping-the-blue-sky-door-open-cheaply),
  but the implementation can stay naive).
- Entity counts, fluid active-region counts and bandwidth all get a known ceiling.
- Four is enough for the social experience being aimed at, and small enough that
  nothing in the design needs to be built defensively.

Host-authority also **changes nothing conceptually** about what already exists: the
authoritative server, inputs-only clients, and prediction/reconciliation all stay
exactly as they are. The server simply runs somewhere else.

#### What it genuinely buys

- No dedicated hosting infrastructure, no running costs, no ops.
- The "does the world keep running when nobody's there?" question **does** go away —
  the world lives while the host plays and is dormant otherwise.
- Self-hosting was already the intended model ([Hosted worlds](#hosted-worlds)), so
  this is a refinement of the plan rather than a departure from it.

#### The correction: persistence doesn't go away, it relocates

The world still has to be saved — it just gets saved on the host's machine, and the
host's save becomes **the one canonical copy**. Guests hold nothing. That introduces a
failure mode that a dedicated server doesn't have, and it's a *social* one rather than
a technical one:

- The world is playable **only when the host is available**. This is the well-known
  listen-server tax (Valheim, Minecraft LAN, Stardew): "we can only play when Dave is
  online."
- If the host loses their save, everyone loses the world.
- **Host migration** is the classic hard problem. At four players, "the session ends
  when the host leaves" is a completely acceptable answer — but it should be a chosen
  answer, not a discovered one.
- The host plays at zero latency while guests pay full round-trip. Prediction already
  handles this; it's worth knowing it exists.

#### The real cost: browsers can't accept inbound connections

This is the part that needs pricing, and it's specific to DELVE being a **browser
game**. "One client hosts" is cheap in a native game and genuinely expensive in a
browser, because a browser tab cannot listen for incoming connections. The current
stack is Node + `ws`, and a browser cannot run a `ws` server.

Two ways to get host-based play, with very different costs:

| Approach | What it means | Cost |
| --- | --- | --- |
| **Host runs a local server** _(recommended)_ | The existing `@delve/server` becomes something a player launches on their own machine; friends point their browser at it. | **Near zero.** The server already exists and already serves the built client. The client currently derives its WebSocket URL from `location.host` (`client/src/net.ts`), so the change is making that address configurable — a join-by-address field. |
| **Host inside the browser tab** | True peer-hosting with no separate process. Requires **WebRTC data channels**, which means a signalling server, NAT traversal, and a **TURN relay fallback that costs money** for players behind symmetric NATs. | **High**, and it reintroduces hosted infrastructure — the exact thing this proposal was meant to avoid. |

The recommendation is the first row. It delivers the identical social model (a friend
hosts, the world lives on their machine, the session ends when they stop) for
essentially no new architecture, and it keeps every property of the authoritative
server that's already working. "Host" becomes a role a player takes, not a change to
how the game is built.

### Target scale

**Real target: small parties on bounded worlds.** Two players on a small world, four
friends on a medium world — now with a **hard cap of four**, see
[Proposed shape](#proposed-shape-host-based-hard-cap-of-4). That's the shape to build
and tune for.

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

### T5. Player count and world size interact

World size presets ([§4](#4-world-topology--hosting)) and player count are the same
knob viewed from two angles. A small world with eight players is crowded, stripped of
ore fast, and its guaranteed content gets consumed once — the discovery pillar is a
**consumable resource shared between players**. A large world with two players is
lonely and mostly empty.

Worth deciding whether size presets are named for *world scale* (small/medium/large)
or for *party size* (solo/co-op/party), and whether content density scales with
expected player count rather than with area alone.

### T6. Wrapping removes the world's absolute reference frame

A cylinder has no "far west." Every horizontal position is relative to spawn, and
"go left until you hit the edge" stops being a valid instruction or a valid memory.

Consequences worth deciding on:

- **Navigation and the map** need an origin. Spawn becomes the only fixed point, and
  a minimap has to handle the seam.
- **Landmark-based memory** ("the big cavern near the left edge") gets weaker.
  Player-placed markers or waypoints become more valuable than they'd otherwise be.
- **Directional content placement** ("the deep dungeon is always far from spawn")
  still works, but distance has a maximum of half the world width.

### T7. Exploration still needs breadcrumbs

Largely answered by bounding the world — guaranteed density beats any amount of
signalling. Two residual cases:

- The **optional infinite mode** reintroduces the original problem in full, and is
  the mode that most needs a signalling layer.
- Even at good density, the player needs *local* "there's something here" cues —
  a draft of air, a change in rock, ambient sound, a glow past the lamp radius.
  Currently there's only a short-range Ore Scanner and the lamp.

### T8. The jetpack deletes the traversal problem

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
  at a checkpoint? Do you drop coins, inventory, or nothing? A harsh answer makes
  deep exploration feel expensive and players play conservatively; a soft answer
  keeps the "just see what's down there" impulse alive.

- **Q2. What is a base _for_?** Base building needs a functional reason to exist or
  it becomes decorated storage. Terraria's answer is concrete: NPCs need housing,
  crafting stations must live somewhere, and night is dangerous so you need a safe
  place. Does DELVE have NPCs? A day/night or danger cycle? Deep forward camps that
  save travel time? The answer decides whether base building is a pillar or a hobby.
  Multiplayer sharpens this: is a base **shared** (one party camp everyone builds and
  benefits from) or **per-player** (everyone keeps their own)? Shared bases need
  griefing/permission answers; per-player bases need the world to hold many of them.

- **Q3. Does the coin economy survive?** See [T1](#t1-three-progression-channels-now-exist).
  If crafting and loot become the progression spine, coins, selling, and the
  Upgrades panel may be vestigial — or may become a parallel currency track that
  needs its own justification.

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
