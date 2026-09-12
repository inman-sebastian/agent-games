# DELVE — biomes

The catalogue of **places** in the world, and the rules deciding where each one is. A sibling to
[MATERIALS.md](MATERIALS.md): that doc owns what a material _looks_ like, this one owns where
materials _are_ and what the surrounding place is. What the game **is** lives in
[DESIGN.md](DESIGN.md).

> **Status: specified, not implemented.** Nothing in this doc exists in the code yet. What ships
> today is the prototype's placement model — five depth **strata** (`shared/src/resources/*.ts`,
> `type: 'strata'`, each with a `top` row) plus per-material `band: [minRow, maxRow]` ranges — which
> is **depth-only placement**, a leftover from the first version of DELVE when the game was "keep
> digging down." Tracked by [#27](https://github.com/inman-sebastian/agent-games/issues/27).

## The model: signals → biome → contents

**One system, many signals.** Placement resolves a **biome** for each location from a combination
of inputs. The biome then decides rock palette, materials, flora and hazards.

```
(depth, region noise, distance from edge, surface elevation, …)  →  biome  →  contents
```

**The ordering is the load-bearing part.** Biome is decided _first_; contents follow. The
alternative — every material carrying its own spawn rule, with "biome" being whatever emerges where
several happen to coincide — cannot guarantee that a Glowing Mushroom Cavern _reads_ as one. The
discovery pillar needs biomes to be **authored places**, not coincidences.

**Depth is one signal, not the system.** It still matters; it stops being the only input.

**Plain biomes are expected.** Most of the world is an unremarkable background biome that happens
to correlate with depth. That's what the five strata already are, and folding them in doesn't
cheapen the word — every game with biomes has dull ones.

> **Not yet decided:** the exact signal set, each signal's shape, and how signals combine. The
> roster below says _what_ exists; it doesn't say how a Rime Hollow decides where to be.

## The three shapes

| Shape              | Extent                                | Presence            | Discovery                                        |
| ------------------ | ------------------------------------- | ------------------- | ------------------------------------------------ |
| **Band**           | A horizontal layer over a depth range | Guaranteed          | **Unavoidable** — you reach it by digging down   |
| **Pocket**         | A region placed somewhere             | Guaranteed to exist | **Findable** — a player can miss it indefinitely |
| **Surface region** | A horizontal stretch of the surface   | Guaranteed          | Unavoidable (you start there)                    |

**Every world contains every biome.** Presence is never random.

**Presence is not discovery**, and the distinction drives a real rule — see
[Findability](#findability).

## The roster

Each entry is specified by its **unique hazard**, what it **wants the player to bring**, and whether
it's a **reward** (a destination worth seeking) or a **toll** (a barrier that makes the world feel
large). That triple is more useful than a palette and a name, because it says what the place is
_for_.

### Surface regions

Deliberately thin — the mine is the primary play space.

| Biome             | Hazard                      | Wants              | Role                                               |
| ----------------- | --------------------------- | ------------------ | -------------------------------------------------- |
| **Ocean**         | Drowning, increasing depth  | Underwater gear    | **Toll.** The world's horizontal edge              |
| **The Mine Head** | None — **safe at any hour** | —                  | **Hub.** Spawn, base, NPC housing                  |
| **Woodland**      | Enemies at night            | Light              | Default surface. Wood, fibre                       |
| **Crags**         | Falling                     | Vertical traversal | **Reward.** Surface-exposed veins that tease depth |

The Mine Head's safety is a **requirement, not flavour**: death respawns the player on the surface,
and a dangerous night plus an unsafe respawn is a death spiral.

### Bands — guaranteed

Unavoidable, so **this is where materials the crafting tree requires must live**. Five bands, and
they inherit the existing strata palettes so that tuning isn't thrown away.

| Biome            | Hazard                    | Wants            | Materials                                   |
| ---------------- | ------------------------- | ---------------- | ------------------------------------------- |
| **Root Zone**    | None                      | —                | Dirt, clay, copper. The safe teaching layer |
| **Stonework**    | None intrinsic            | —                | Iron, silver, quartz                        |
| **The Deeps**    | Absolute dark, long falls | Light, traversal | Gold, emerald, platinum                     |
| **Basalt Reach** | Heat, tougher rock        | Heat protection  | Ruby, diamond                               |
| **Molten Core**  | The static lava ocean     | Heat protection  | Obsidian, mythril                           |

**Every ore that ships today lands in a band**, so no existing material is at soft-lock risk. The
Molten Core is the bottom-most band and holds the **static** lava ocean, penned by the
indestructible bedrock floor (see [DESIGN.md](DESIGN.md)).

### Pockets — placed

Guaranteed to exist, but found rather than reached.

| Biome                       | Hazard                              | Wants                          | Role                                                |
| --------------------------- | ----------------------------------- | ------------------------------ | --------------------------------------------------- |
| **Glowing Mushroom Cavern** | Low — a haven                       | —                              | **Reward.** Visible _through rock_ by its own light |
| **Flooded Warren**          | Drowning                            | Underwater gear, or a fluid tool | Makes a fluid tool matter                         |
| **Rime Hollow**             | Slipping; ice floors that break     | Careful traversal              | Hazard is **movement**, not damage                  |
| **Deadfall**                | Cave-ins, load-bearing rock         | A structural / shoring tool    | Makes structural gear matter                        |
| **The Works**               | Enemies, traps                      | The tool that breaks the shell | Ruins at scale. Home for **Stone Bricks**           |
| **Crystal Vault**           | None — **sealed**                   | The tool that breaks the shell | **The jackpot.** Gems in abundance                  |
| **Nullshade**               | **Absorbs the player's lamp light** | A light source worth a slot    | Makes light-as-equipment matter                     |

**Six of the seven exist to give an equipment _need_ a reason to be packed.** A fluid tool is dead
weight until the Flooded Warren exists, a structural tool is pointless without Deadfall, and light is
never worth a scarce slot without Nullshade. This is what keeps the loadout decision real rather than
theoretical — so cutting a pocket also removes the reason for the gear that answers it.

**The _needs_ are ratified; the items that fill them are not.** Specific designs (a pump, a shoring
tool, a companion lantern) are candidates — see [DESIGN.md](DESIGN.md#equipment--the-loadout).

**Nullshade suppresses light by absorbing it** — a property of the _place_, not a debuff applied to
the player's lamp. The diegetic mechanism composes with the existing lighting model; a stat penalty
would not.

## Scarcity

| Tier        | Count per world                        | Biomes                                            |
| ----------- | -------------------------------------- | ------------------------------------------------- |
| **Unique**  | Exactly 1, **authored placement**      | Crystal Vault · The Works                         |
| **Several** | A handful, scales with the size preset | Glowing Mushroom Cavern · Rime Hollow · Nullshade |
| **Common**  | Scattered, scales with the size preset | Flooded Warren · Deadfall                         |

**A jackpot that appears four times isn't a jackpot.** Uniqueness is what makes finding the Crystal
Vault an event, and it's the same reason one dungeon works in Terraria.

**Common is right for hazard terrain.** Flooded Warren and Deadfall aren't destinations, they're
texture — and they need to be common, because that's what makes the pump and the shoring tool worth
_carrying_ rather than curiosities.

### Density scales with players, not area

**Decided.** The tuning target is **content per _expected player_**, not content per unit of area.
A world's player cap rises with its size, and content rises with the cap — so a Large world at
sixteen players holds roughly four times what a Small one at four does.

The point is that **every preset feels the same to play**: nobody's world is sparse and nobody's is
stripped bare in an hour. Size becomes a neutral preference (intimate and dense vs. sprawling and
social) rather than a difficulty setting.

For pockets specifically: a Large world gets **more of each** pocket, not more *kinds* — the roster
is fixed across presets. Unique pockets don't scale at all, which is why they're
[placed by rule](#placement).

## Placement

**Two modes, and the generator needs both:**

- **Noise-placed** — most pockets. Region noise decides where they land.
- **Authored-placed** — the unique pockets, positioned by rule.

**Authored placement isn't a nicety; it protects uniques from world size.** A unique pocket is
**one instance regardless of preset**, so it doesn't scale while everything else does. Randomly
placed, the Crystal Vault gets progressively harder to find as worlds grow. Placed by rule, it stays
findable at any size.

It also buys **learnable geography across worlds** — "the Works is always deep and far from spawn"
is knowledge that survives starting a new character, which is exactly why Terraria's dungeon sits at
a known direction from spawn. **Hard edges are what make this possible**: with a bounded,
non-wrapping world, distance-from-spawn and distance-from-edge are meaningful again.

> **Not yet decided:** the actual placement rules for the Crystal Vault and The Works.

## Materials

**Distribution is deliberately uneven.** Biomes are not uniform in what they hold:

- Some are **abundant** in a material where others are sparse.
- Some **lack** certain materials entirely.

That unevenness does three jobs: it **rewards discovering a new biome** with materials the player
has never seen, it gives a **reason to return** to a specific place, and it gives yield-Fortune
somewhere to matter — you go where the thing you need is dense.

### The invariant

> **Every material is obtainable in _at least one_ biome.**
> Never "every biome carries every material" — exclusivity is the feature.

### Placement tiers

| Tier                                           | Rule                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Required** — the crafting tree depends on it | Must be obtainable from a **guaranteed, unavoidable** biome (a band), _or_ from a pocket with a [findability affordance](#findability) |
| **Optional / bonus**                           | Free to be exclusive to any pocket                                                                                                     |

### Findability

Because every pocket is guaranteed to _exist_, a required material in a pocket is **not a
soft-lock** — the material is definitely in the world. It's a potential **stall**, if the player
never finds the pocket. So:

> **A required material in a pocket needs a findability affordance.** Its own light (the Glowing
> Mushroom Cavern already qualifies — light bleeds 2–3 tiles into rock, so it blooms on the rock
> face before you see it), an authored placement rule, or reachability via the scanner/cartographer.

### Schema direction

**Biomes declare their contents**, rather than materials declaring where they spawn. A biome is an
authored place, so its identity includes what's in it — and _"this biome has no iron"_ is expressible
by **omission**, which is far clearer than iron carrying a zero weight for every biome it's absent
from.

Cost: adding a material means editing the biomes it belongs to. That's a feature. It forces a
decision about where a new material lives instead of letting it leak everywhere by default.

Consequence: `strata.top` and every material's `band: [min, max]` become obsolete, and the
`delve-new-material` skill loses its "pick a band" step.

## Boundaries

**Boundary style is a property of the biome, set by its job.**

- **Tolls and destinations get hard boundaries.** Crossing into the Molten Core or breaking into the
  Crystal Vault should be a _moment_ — one block over and the rock is unmistakably different.
- **Texture blends.** A cave that happens to be flooded isn't an event, and a hard line around it
  would read as an authored box rather than as terrain.

| Boundary    | Biomes                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| **Hard**    | Ocean · Molten Core · Glowing Mushroom Cavern · The Works · Crystal Vault · Nullshade · Rime Hollow             |
| **Blended** | Root Zone · Stonework · The Deeps · Basalt Reach · The Mine Head · Woodland · Crags · Flooded Warren · Deadfall |

### What this costs the renderer

- **Blended is already built.** The compositor feathers per-pixel across material↔material
  boundaries ([MATERIALS.md](MATERIALS.md)) — which is exactly this behaviour. Blended biomes are
  close to free.
- **Hard needs blend _suppression_**, which is new and **inverts the compositor's current
  assumption** that it always feathers: when two adjacent _solid_ tiles belong to biomes whose
  boundary is hard, skip the feather.
- **Sealed pockets get their hard edge for free.** A tool-gated shell _is_ a hard boundary, so The
  Works and the Crystal Vault need no special rendering to feel abrupt.
- **Readability:** a hard boundary must change **texture or shape**, not only palette — never rely
  on colour alone.

## Verification

The roster makes the content gate's claims crisp and checkable, which the old depth-range assertions
never were. Asserted over many seeds (see [TESTING.md](TESTING.md)):

- **All 16 biomes generate in every world**, with non-unique pockets at the promised per-player
  density.
- **Every material is obtainable in at least one biome.**
- **Every required material is reachable** by a fresh character in a fresh world.
- **No seed** violates any of the above — reported as a failing seed, reproducible by construction.

## Still open

- The **signal set** and how signals combine.
- **Authored placement rules** for the Crystal Vault and The Works.
- The **7–12 new pocket materials** — names, art, and which biome each belongs to. All optional
  tier, authored via the `delve-new-material` skill. This is the roster's real content cost.
- **Surface biome extent** — how wide a Woodland or Crags region runs, and how the Ocean's width
  relates to the world's.
