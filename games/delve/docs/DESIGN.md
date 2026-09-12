# DELVE — game design

The single source of truth for **what DELVE is and how it plays**. Presentation
lives in the art docs ([PALETTE](PALETTE.md), [RENDERING](RENDERING.md),
[LIGHTING](LIGHTING.md), [JUICE](JUICE.md)); code structure lives in
[ARCHITECTURE](ARCHITECTURE.md). Tuning _numbers_ (ore values, costs, hp curves)
are owned by the code they live in — this doc names them and points at the source,
so the two can't drift.

## What it is

A moody, pixel-art **mining game**. You dig down and outward through an open,
deepening world of rock strata, breaking and **collecting** the materials you find —
delving deeper, where the rock is tougher and the materials are rarer.

> **How to read this doc.** Everything down to [Design pillars](#design-pillars) describes the game
> **as currently implemented**. [The decided design](#the-decided-design) is what it's becoming —
> settled, not yet built. Where the two disagree, the decision wins. The world's places are in
> [BIOMES.md](BIOMES.md) and the interface is in [UI.md](UI.md).

## Core loop

1. **Dig** — run and jump around; aim at nearby rock and hold to mine it — enough hits break the block.
2. **Collect** — everything you mine drops into your **inventory** as per-type stacks
   (rich veins yield 3× the material). There's no selling and no money — mined materials
   are simply kept.
3. **Descend** — deeper rock has more hp and rarer materials.

_A fourth beat is coming: **return**. Once inventory capacity is finite, a trip has a natural end
and the loop becomes descend → fill → return, triggered by how much you've **found** rather than by
how much you've dug. See [The decided design](#inventory-capacity-limits-variety-not-volume)._

> **No economy.** There is no currency and nothing to buy. The old coins/selling/shop
> loop was removed; what a player _does_ with collected materials, and how progression
> is earned, is being rebuilt — see [Direction & roadmap](#direction--roadmap).

## Controls

Smooth 2D-platformer movement with a **separate aim/mine action** — mining is decoupled
from movement, so you can mine while running, jumping, or standing still:

- **Move:** A/D or ←/→ to run, W / ↑ / Space to jump.
- **Mine (mouse):** aim with the cursor and **hold to mine** the targeted tile (within
  reach); a reticle shows what you're aiming at.
- **Mine (keyboard):** hold **J/K** to mine in the aim direction — S/↓ aims down, A/D or
  ←/→ aim to that side, otherwise the way you're facing.
- **Touch:** on-screen ◄ ► / jump buttons to move; tap or hold a tile to mine it.
- **Start / pause:** the game opens on a **title screen** (Descend to play); **Esc** pauses and
  opens the pause menu (Esc again resumes). Opening Inventory / Collection pauses too — the whole
  screen flow is a small state machine (see [ARCHITECTURE.md](ARCHITECTURE.md#state-machines)).
  _**Pausing is being removed entirely** — it can't coherently exist in an online game on a
  server-hosted world. See [UI.md](UI.md#nothing-pauses-ever)._

## Ore tiers

Ore forms Terraria-style **clusters (nodes)**, not embedded veins — see
[RENDERING.md](RENDERING.md) for how a pocket reads as one crystalline mass. Tiers,
shallow → deep:

> Dirt · Copper · Iron · Silver · Gold · Quartz · Emerald · Platinum · Ruby · Diamond ·
> Obsidian · Mythril
>
> _(Plus **Stone Bricks**, registered as an ore so it flows through the whole pipeline, but a
> constructed material that belongs in ruins rather than random veins — see
> [BIOMES.md](BIOMES.md).)_

Each tier is a first-class **item**: name, depth band, rarity (registry order — see
[#46](https://github.com/inman-sebastian/agent-games/issues/46): the newer ores were appended, so
rarity no longer tracks depth, which mis-scales the **break FX**), bonus hp
and a codex blurb, each defined in its own **resource file** under
`shared/src/resources/*.ts` (**the source of truth**; see [ARCHITECTURE.md](ARCHITECTURE.md#entity-resources)),
which also carries the ore's art (shape + colour triad). Deeper tiers are tougher and
rarer, and appear only within their depth band, so descending is what unlocks the next
tier. **Dirt** is common surface filler; **Mythril** is the deep-end find.

Mined ore is held in the inventory as these items (with their icons), viewable in the
**▣ Inventory** panel, and every tier you've ever mined is recorded in the **Collection**
codex — lifetime count, the deepest row you found it at, and its blurb, with undiscovered tiers
shown locked.

> **Removed:** the HUD's "rarest material found" stat (`player.best`). It was prototype leftover
> from the dig-down game, it ranked by registry order so it was wrong anyway, and it isn't relevant
> to the direction below. Per-material "deepest row" in the codex is a different thing and stays.

## Upgradable stats

> **Terminology:** these are **attributes**, not "upgrade levels" — the latter implies buying, which
> is only one of several possible sources. See the [Glossary](#glossary).

A player carries **attributes** that drive derived stats via `stats()` in
`shared/src/engine.ts`:

- **Pickaxe** (`up.pick`) — dig damage per hit.
- **Agility** (`up.speed`) — dig / move speed.
- **Fortune** (`up.fortune`) — chance of a **rich vein** (3× materials). _Being re-pointed: Fortune
  will affect what you **get from** a rich vein, not whether one exists — today it makes world
  content depend on who's looking. See [Rich veins and Fortune](#rich-veins-and-fortune)._
- **Deep Lantern** (`tech.lantern`) — widened **lamp reach** (`stats().lamp`). _(An unlock, not an
  attribute.)_

The plumbing is in place, but **nothing raises these right now** — the coin shop that used to buy
them was removed with the economy, so they sit at base values and dig power/speed/lamp are
effectively constant. They were **kept deliberately**: they're the attribute layer, and `stats()` is
the single place capability is resolved. See [Progression](#progression).

## Collection & progression

- Everything mined is **held in the inventory** as per-type stacks — no selling, no
  money. Rich veins drop **3× the material** and get the disproportionate reward beat
  (see [JUICE.md](JUICE.md)). _(No capacity cap **yet** — capacity becomes finite and
  variety-limited; see [the decided design](#inventory-capacity-limits-variety-not-volume).)_
- Base rock hp **grows with depth** (`rockHp` in `blocks.ts`). With upgrades currently
  fixed, this is a raw difficulty ramp rather than a tuned gate — the progression system
  that balances it against earnable power is the next major pass.
- Progress and settings **persist to `localStorage`**, degrading to a sane default
  if storage is missing or corrupt.

## Design pillars

- **Platformer traversal; no fuel.** Movement is real 2D platforming — gravity, running,
  jumping. **Digging is always free**, so the moment-to-moment loop can never strand you.
  Climbing back up a sheer shaft isn't possible yet; dedicated upward traversal (ropes /
  platforms / ladders / a jetpack) is a future pass.

  **Fuel is a soft-lock generator and stays out; cargo is not.** This pillar used to exclude
  both, and that conflation was wrong: with no fuel you cannot dig, so you cannot move, so
  you are stranded — but a full bag only stops you *collecting*, never *mining*, and mining
  is the traversal verb. So **inventory capacity is finite**, and it's a progression axis: one
  material occupies one slot, stacked without limit, with no weight — capacity caps how many
  *kinds* of thing you carry, never how much. See [Direction & roadmap](#direction--roadmap).
- **Deterministic world.** Every cell's static contents are a pure `f(seed, c, r)` (see
  [ARCHITECTURE.md](ARCHITECTURE.md)); the same seed always generates the same mine, and only
  what you've changed is saved. **Determinism is load-bearing** — it's what makes content
  verifiable at all (see [TESTING.md](TESTING.md)), so nothing may make generation depend on
  who is looking at it.

  _The world is currently **infinite** horizontally, which is being reversed: it becomes large
  but **bounded**, with hard edges and a bedrock floor. Only infinity is dropped; determinism
  stays. See [Direction & roadmap](#direction--roadmap)._
- **One saturated element.** Ore is the only vivid colour against deliberately muted
  rock, and depth reads by palette (see [PALETTE.md](PALETTE.md)).

---

# The decided design

Everything above describes the game **as it exists today**. Everything below is **decided but not
yet built** — the output of a full design session, with the reasoning preserved in the git history
of `BRAINSTORM.md`. Where a decision here contradicts a section above, **the decision wins and the
section above is what changes.**

Two topics have their own docs because they're large catalogues rather than mechanics:
**[BIOMES.md](BIOMES.md)** owns the world's places, and **[UI.md](UI.md)** owns the interface.

## What DELVE is becoming

**A Terraria-like.** The intersection of seven categories, which together are the fastest honest
summary of the target:

| Category | What it means here |
| --- | --- |
| **Exploration** | The primary driver. Digging is how you travel; finding is the reward |
| **Open world** | Large and bounded, with hard edges. **Not** infinite |
| **Incremental** | Continuous, compounding growth in player capability |
| **Survival** | Enemies, health, situational breath. **No upkeep meters** |
| **Crafting** | Tools, weapons and equipment are made, not bought |
| **Base building** | Building is a mechanic; a base has four jobs (below) |
| **Light RPG** | *Elements* of RPGs — equipment and skill trees. Not the genre |

**"Light RPG" is deliberately narrow.** It was never a genre commitment. What's in: equipment that
changes what you can do, and attributes the player invests in. What's out: classes, quests,
dialogue trees, and a character sheet of numbers.

**Mining stays the core verb, but its purpose moves.** It becomes **the means of exploration** —
how you travel through and open up the world — rather than an end in itself.

## Survival, death, and what the world can take from you

**Survival means _danger_, not _attrition_.** Enemies are a real threat, the player has health and
can die, and breath applies underwater.

> **No meter is an _upkeep cost_. Meters as _hazard timers_ are fine.**
>
> An **upkeep cost** ticks down because you exist, and paying it is a chore with no decision in it.
> Hunger, thirst, stamina, temperature, fatigue, torch fuel — **out, permanently.**
>
> A **hazard timer** runs only while you're in a state you **entered** and can **leave**. A danger
> with an exit, which is the same shape as any other threat in the world.

**Breath is a hazard timer**, not an exception to the rule — and it matters more than "situational"
suggests, because fluid is simulated and the player's own digging moves it, so drowning is something
that happens *to* you mid-core-verb rather than something you opt into. The
[world-edge death timer](#the-world) is a hazard timer too.

### Death costs the trip, never the character

| | On death |
| --- | --- |
| **Inventory** | **Dropped** — and recoverable |
| **Equipment** | Kept |
| **Attributes** | Kept |

The loss is scoped to **the expedition**, which is the unit inventory capacity already operates on.
Nothing that took real investment is ever at risk, so an item's
[investment arc](#equipment--the-loadout) survives.

**The dropped bag emits light and bobs**, so it blooms on the rock face before it's visible —
recovery with no HUD marker and no map dependency, using the same mechanism that makes lava
telegraph itself. Motion is the most reliable "look here" signal.

**Respawn, in priority order:** a base, else a player-placed **respawn beacon**, else a determined
safe area or the surface. The default surface respawn point **must be safe at any hour**, because a
dangerous night plus an unsafe respawn is a death spiral.

## The world

**Everything is mineable, and everything is collectible.** Dirt collects exactly like ore — there
is no scenery tier of tile that exists only to be deleted. Everything collectible means everything
is a **crafting input**, which is what makes mining serve exploration instead of being a slot
machine. **Bedrock is the single exception.**

**Bounded, with hard edges — not infinite, not wrapping.** Bounding is what makes guaranteed
content density possible, which is the real answer to the empty-digging problem: a finite world has
finite space to fill, so generation can place a known amount of content and be *sure* the player
meets it.

**But the world must never read as a literal box.** Bedrock is right for the floor; visible bedrock
side walls are not. So the boundary is **layered**, because every equipment item exists to remove a
traversal constraint and **any boundary made of traversal constraints gets defeated by design**:

| Layer | Catches |
| --- | --- |
| **Ocean** at both surface ends | Most players, who never test it — it deepens, and nothing is out there |
| **Breath** | Anyone swimming |
| **A death timer at the true edge** | *Everything else* — building, flight, grapple, and anything added later |

The death timer is the Destiny pattern: reach the true edge and a countdown says turn back or die.
**Legible, recoverable, and fair.** The world must also **extend visually past the playable limit**,
so the player never sees an edge.

**The surface is real content**, Terraria-like — subordinate to the mine, but not a barren flat
plane. That makes surface height a function of column rather than a constant.

**There is a day/night cycle, and no sleeping.** No sleeping is what gives the cycle teeth: night
can't be waited out, so **night is a pressure that pushes the player underground**, which is a
reason to descend that isn't greed. Night is a threat, not a meter.

**Size presets, fixed at creation.** A world's size — and therefore its player cap — is chosen once
and never changes. A fifth friend can't join a Small world; they make a new one.

**Buried structures are tool-gated, not sealed.** Their walls break with the right or upgraded
tools, so a structure you can't open yet is a **promise the world makes and later keeps**. The gate
only works if the shell is **complete** — gated walls with ordinary rock behind them just get
tunnelled around. Demolishing a structure entirely is the player's call.

The world's **places** — biomes, their roster, scarcity, placement and boundaries — are in
**[BIOMES.md](BIOMES.md)**.

## Progression

**Progression is layered.** Several independent systems on top of one another, not one system that
owns getting stronger.

| Layer | Character | Job |
| --- | --- | --- |
| **Attributes** | Broad, slow, permanent, applies everywhere | Raise the floor |
| **Equipment** | Specialized, swappable, situational | Change what's possible *this trip* |
| **Environment** | Temporary, contextual, mostly subtractive | Create pressure in specific places |

**Each layer must do a different job.** Layers that all scale the same number cancel out as *feel*:
if an attribute, a pickaxe tier and an environmental modifier each multiply dig speed, every
individual upgrade is imperceptible and three systems have to be tuned against each other forever.

**The four values on `PlayerState` are the attribute layer**, kept deliberately when the economy was
stripped. `stats()` stays the single place capability is resolved — which is why the layer is kept
rather than deleted, since tuning stays centralized instead of scattering across item definitions.
It wants building as a **modifier stack**: a base value plus contributions from many sources.

**Environmental modifiers have a different lifetime**, so `stats()` needs **world context**, not
just the player. Client and server must agree on it.

**When a number is worth having:** a number earns its place when it changes *what you can attempt*,
and is filler when it only changes *how fast you do what you already do* **and** nothing real is
being sped up. Crafting is a sink, so yield matters; a multiplier on a loop with no sink does not.

### Light

Light gets a **floor the player can never trade away** — always enough lamp to not be lost in the
dark. Everything above the floor is **earned and riskable**, coming from equipment. A deep biome may
suppress light, and the diegetic mechanism is that the *place absorbs it*, not that the player's
lamp is debuffed.

There is **no fog of war and no seen-memory**: lighting is per-pixel illumination, and any world
light source lights the player regardless of their own. A **map is therefore a memory system**, not
a rendering of where you've been — which is what makes gating it apt.

### Inventory capacity limits variety, not volume

**One material, one slot, stacked without limit. No weight.** Capacity caps how many *kinds* of
thing you carry. Dirt and stone are one slot each forever, so **travelling never fills the bag** —
what fills it is meeting materials you aren't already carrying.

Two properties worth building on: the **return trip is triggered by success, not labour** (grinding
a known tunnel never fills you; pushing into a new biome fills you fast), and **"larger backpack"
means carrying more _kinds_ of things**.

### Rich veins and Fortune

**Rich veins are a property of the world.** Generation decides where they are, they get their own
effects, and a candidate touch is making them tougher than the ordinary variant so the reward
announces itself.

**Fortune does not influence whether a vein is rich** — it influences **what you get out of mining
one**: higher yield, and an increased chance of a **rare, unexpected item**. It lives at the
**equipment** layer.

This matters beyond flavour: `isRich` currently takes the *player's* fortune, so **whether a tile is
rich depends on who is looking at it** — which breaks under shared worlds and breaks the determinism
the content gate relies on. Re-pointing Fortune at extraction makes generation player-independent
again. (Same semantics as Minecraft's Fortune: drops, never generation.)

It also implies a small system: **mining a tile can yield something other than that tile's
material** — a loot table on a block.

## Equipment & the loadout

**The investment arc.** An item starts *sort of* useful and occasionally annoying, and ends up so
good at its job you never want to unequip it. The payoff isn't a bigger number, it's a **changed
relationship** — you remember the item that used to embarrass you and now carries you.

**The failure mode to design against:** "bad now, good later" means nobody reaches later. Early-stage
gear must be **useful but flawed**, not useless and irritating. The annoyance is the *texture* of the
arc; the utility is what keeps the player on it.

**Slots are scarce, and they grow.** Equipment starts at a **single slot**, with more unlocked
through progression. One slot early makes the loadout decision maximally sharp — you pick exactly one
thing — so the choice is hardest when the player has the fewest options.

> **Your loadout is a declaration of which constraints you're accepting for this expedition.**

**The invariant that keeps it alive late:** *slot count must grow more slowly than the item roster.*
Gain slots faster than specialized items and "equip the best set" wins and the loop dies; let the
roster outrun the slots and every new slot is a new *interesting* decision.

### Equipment needs the world creates

**Decided: these needs exist**, because [biomes](BIOMES.md) are built around them and a biome
without an answer is just a wall. **The items that fill them are candidates, not decisions.**

| Need | Created by |
| --- | --- |
| **Underwater gear** | The Ocean, the Flooded Warren |
| **A fluid tool** | The Flooded Warren |
| **A structural / shoring tool** | Deadfall's cave-ins and load-bearing rock |
| **A light source worth a scarce slot** | Nullshade, which absorbs lamplight |
| **Heat protection** | Basalt Reach, the Molten Core |
| **A tool that breaks gated shells** | The Works, the Crystal Vault |
| **Vertical traversal** | Deep shafts; the jetpack is the named answer |

Candidate designs — a pump, a shoring tool, a companion lantern, a grapple, shaped charges, a
collector, a combat drone — are **proposals**, not a roster.

### Two guidelines for judging equipment

Both are **guidelines**, not rules: useful lenses, overrulable without argument, and neither may
block an idea on its own.

- **Prefer removing a constraint over adding a number.** Reach removes "I must be adjacent"; the
  jetpack removes "I must dig my way out". Note the two aren't opposites — a bigger backpack
  removes *"I must turn back when full"*.
- **Prefer one item per axis.** Vertical traversal, horizontal traversal, bulk excavation, fluid
  control, light, navigation, combat support, environmental survival. A loadout decision is only
  real if the options aren't substitutes; three mining tools produce a tier list.

**Irreplaceable is scoped to a purpose, never to the game.** A fully-upgraded excavation item is
indispensable for bulk digging and dead weight in a fight. Done that way the choice gets *more*
interesting at max level, not less.

## Automation

**A direction, not a plan.** Mining drones are the illustrative case: small autonomous helpers that
**follow the player** and mine alongside them, with **intelligence as the upgrade axis** rather than
power — an early drone is genuinely stupid and will dig into a lava pocket, and it earns its way to
competence. That inverts the usual incremental axis (behaviour rather than magnitude) and turns a
bug-shaped experience into designed content, provided the drone reads as **a character with visible
intent** rather than an invisible effect that silently deletes tiles.

**Two rules govern any automation here.**

> **Automate the chore, never the choice.** Automation may remove repetition and execution. It must
> never remove the decision of *where to go* or *what's worth looking at.*

That's a formalisation of the stated identity constraint: **nothing may take away from the core
identity of the game, which is exploration.** Removing the boring, mundane and repetitive parts of
exploring does more good than harm; removing the exploring does not.

> **Drones follow the player.** Parked somewhere and left to mine unattended, they'd make DELVE an
> idle game where the player's optimal move is to stop playing. Tethered, the same drones are pure
> upside.

That second one is a *consequence* of the first, not an independent law — if a future design
genuinely satisfies "automate the chore, never the choice" some other way, this follows rather than
forbids.

## Combat

**A full parallel discipline** to mining, with its own crafting, its own progression and its own
feel — not a mining-flavoured afterthought. Multiple weapons and multiple pieces of equipment, each
differentiated by **what it lets you do** rather than by a damage number.

## NPCs

**NPCs exist.** Who they are is undetermined; their existence isn't. Interacting with them needs **at
minimum a minimal dialogue system** — barks and one-shot lines carry most of the value, while
branching trees and quest state are a much larger thing.

## Base building

**Building is a mechanic**, and a base has **four jobs** — which is what moved it from "decorated
storage" to justified:

1. **Housing** for NPCs.
2. **Storage** for materials that don't fit a variety-limited bag.
3. **A safe place to open panels**, since [nothing pauses](UI.md#nothing-pauses-ever).
4. **A respawn point.**

What's left is scope and shape, not justification — plus whether a base is shared or per-player in a
multiplayer world.

## Characters, worlds and multiplayer

**A character belongs to the player, not the world.** Attributes, equipment, inventory and unlocks
travel into any world you join, and **starting a fresh character is easy**. That's what makes
drop-in play work: helping a friend costs you nothing.

**Difficulty pacing therefore can't be guaranteed, and that's accepted.** A maxed character can
enter a brand-new world and trivialize it. The testing consequence is explicit — the content gate
asserts a *fresh character in a fresh world*, and the maxed case is **out of scope by design**.

**The codex is a ledger and never mechanical** — a record of everything encountered: enemies fought,
NPCs met, materials gathered. It's **account-scoped**, so it survives starting over. A **recipe book**
for crafting is a separate system.

**Nothing pauses, ever** — see [UI.md](UI.md#nothing-pauses-ever).

Persistence scopes, world lifecycle and the protocol live in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Glossary

Nomenclature drift caused a real wrong decision during the design session, so these words are pinned.

| Term | Means |
| --- | --- |
| **Stat** | A *resolved* number describing current capability, computed by `stats()`. Never stored |
| **Attribute** | A persistent, player-owned value feeding a stat, grown independently of gear or location |
| **Skill tree** | The structure through which the player *chooses* which attributes to grow |
| **Modifier** | A contribution to a stat from something other than an attribute. Has a **source** and a **lifetime** |
| **Unlock** | A binary capability gate rather than a graded value |
| **Lamp** | The player's own light **emitter** — reach and intensity. One source among many |
| **Equipment** | An item occupying a scarce slot. Has its own upgrade path; may contribute modifiers |
| **Loadout** | The set of currently equipped items |
| **Progression layer** | One independent system that grows over time. Layers **coexist by design** |

**Retired — replace on sight:** *upgrade level* (implies buying, only one of several sources → use
**attribute**); *progression spine* / *progression channel* (imply one system owns getting stronger,
false by design → use **progression layer**, plural); *vision* (implies revealing tiles; there's no
fog of war → use **lamp**, or **illumination**); *enhancement* (used loosely for all three of
attribute, modifier and unlock).

## Direction & roadmap

DELVE is evolving from the grid-locked, tunnel-straight-down incremental digger described at the top
of this doc into a real, playable **Terraria-like game**. That happens **incrementally**: the
current-state sections migrate into [the decided design](#the-decided-design) as each piece ships.

Tracked as an umbrella epic in
[#7](https://github.com/inman-sebastian/agent-games/issues/7), which indexes the epics below.

**Staying:** mining as the core verb; incremental / progression mechanics.

### Shipped

Smooth platformer movement ([#2](https://github.com/inman-sebastian/agent-games/issues/2)) ·
mining decoupled from movement ([#3](https://github.com/inman-sebastian/agent-games/issues/3)) ·
the inventory ([#4](https://github.com/inman-sebastian/agent-games/issues/4)) ·
ores as distinct collectibles ([#5](https://github.com/inman-sebastian/agent-games/issues/5)) ·
data-driven entity resources ([#9](https://github.com/inman-sebastian/agent-games/issues/9)) ·
the Vite/TypeScript client, Node server and authoritative simulation
([#10](https://github.com/inman-sebastian/agent-games/issues/10),
[#11](https://github.com/inman-sebastian/agent-games/issues/11),
[#12](https://github.com/inman-sebastian/agent-games/issues/12)) ·
the state machine primitive and screen flow.

**Economy removed** — coins, selling and the coin-bought shop are gone; ore `value` and the
`stats()` refine multiplier were deleted. The only surviving loop is mine → collect. Attributes
stayed as plumbing, deliberately.

**Being reversed:** the infinite world
([#1](https://github.com/inman-sebastian/agent-games/issues/1)) shipped, and is deliberately being
undone — the world becomes bounded with hard edges, because bounding is what makes guaranteed
content density possible.

### Epics

| Epic | What it delivers |
| --- | --- |
| [#25](https://github.com/inman-sebastian/agent-games/issues/25) | Migrate the design brainstorm into these docs _(this section's source)_ |
| [#26](https://github.com/inman-sebastian/agent-games/issues/26) | Bound the world — hard edges, bedrock floor, surface, day/night |
| [#27](https://github.com/inman-sebastian/agent-games/issues/27) | Biomes & placement — replace depth-only spawning ([BIOMES.md](BIOMES.md)) |
| [#6](https://github.com/inman-sebastian/agent-games/issues/6) | New progression system — layered attributes, equipment & crafting |
| [#28](https://github.com/inman-sebastian/agent-games/issues/28) | UI foundation & surfaces ([UI.md](UI.md)) |
| [#29](https://github.com/inman-sebastian/agent-games/issues/29) | Entities, replication & combat |
| [#30](https://github.com/inman-sebastian/agent-games/issues/30) | Fluid simulation — water & lava |
| [#13](https://github.com/inman-sebastian/agent-games/issues/13) | Server/client architecture — world instances, persistence scopes |

### Also queued

- **[#45](https://github.com/inman-sebastian/agent-games/issues/45) — the server needs a fixed
  tick.** `physicsStep` is input-driven rather than clocked, which blocks day/night, fluid, entities
  and hibernation, and is why client-side pause currently works at all.
- **[#46](https://github.com/inman-sebastian/agent-games/issues/46) — `rarityOf` is registration
  order**, so the break FX (pitch, particles, shake) scale by the wrong number: quartz outshines
  mythril and stone bricks outshines everything. Rarity wants to be **authored** on the resource
  rather than a side effect of import order.
- **Unify strata and ore into one material system.** Strata (`type:'strata'`) and ores
  (`type:'ore'`) are separate shapes; the direction is **one material shape for everything
  mineable**, so dirt, clay and stone become collectible too and share the shader/surface-class
  render path. Phase 1 (strata visible in the material lab) shipped. This is now a *prerequisite*
  for [everything is collectible](#the-world).
- **Placement beyond depth.** Superseded in principle by [BIOMES.md](BIOMES.md): biome resolves from
  several signals, then decides contents. `strata.top` and per-material `band` ranges become
  obsolete.
- **Rendering perf** — bake ore blocks / cheaper lighting for deep, fully-lit scenes.
- **Miner sprite** — redraw + animate for the finer 32px grid.
