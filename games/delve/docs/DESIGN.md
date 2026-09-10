# DELVE — game design

The single source of truth for **what DELVE is and how it plays**. Presentation
lives in the art docs ([PALETTE](PALETTE.md), [RENDERING](RENDERING.md),
[LIGHTING](LIGHTING.md), [JUICE](JUICE.md)); code structure lives in
[ARCHITECTURE](ARCHITECTURE.md). Tuning *numbers* (ore values, costs, hp curves)
are owned by the code they live in — this doc names them and points at the source,
so the two can't drift.

## What it is

A moody, pixel-art **incremental mining game**. You dig down and outward through an
open, deepening world of rock strata, breaking ore where you find it, and reinvest
the coins to delve deeper — where the rock is tougher and the ore is rarer.

> This describes the game **as currently implemented**. DELVE is mid-evolution toward
> a Terraria-like mining/exploration game — see [Direction & roadmap](#direction--roadmap)
> for what's changing.

## Core loop

1. **Dig** — run and jump around; aim at nearby rock and hold to mine it — enough hits break the block.
2. **Collect** — mined ore drops into your **inventory** as per-type stacks (rich veins
   yield 3× the ore). Sell it for coins anytime from the ⛏ Upgrades panel — no hauling
   back to the surface, so the loop never strands you.
3. **Spend** — the ⛏ Upgrades panel: leveled upgrades and one-time tech.
4. **Descend** — deeper rock has more hp and rarer, richer ore.

## Controls

Smooth 2D-platformer movement with a **separate aim/mine action** — mining is decoupled
from movement, so you can mine while running, jumping, or standing still:

- **Move:** A/D or ←/→ to run, W / ↑ / Space to jump.
- **Mine (mouse):** aim with the cursor and **hold to mine** the targeted tile (within
  reach); a reticle shows what you're aiming at.
- **Mine (keyboard):** hold **J/K** to mine in the aim direction — S/↓ aims down, A/D or
  ←/→ aim to that side, otherwise the way you're facing.
- **Touch:** on-screen ◄ ► / jump buttons to move; tap or hold a tile to mine it.

## Ore tiers

Ore forms Terraria-style **clusters (nodes)**, not embedded veins — see
[RENDERING.md](RENDERING.md) for how a pocket reads as one crystalline mass. Tiers,
shallow → deep:

> Dirt · Copper · Iron · Silver · Gold · Emerald · Ruby · Diamond · Mythril

Each tier is a first-class **item**: name, value, depth band, rarity (array order),
bonus hp and a codex blurb, each defined in its own **resource file** under
`resources/*.js` (**the source of truth**; see [ARCHITECTURE.md](ARCHITECTURE.md#entity-resources)),
which also carries the ore's art (shape + colour triad). Deeper tiers are exponentially more valuable and tougher, and appear only
within their depth band, so descending is what unlocks the next tier. **Dirt** is a
near-worthless surface filler; **Mythril** is the deep-end payoff.

Mined ore is held in the inventory as these items (with their icons), and every tier
you've ever mined is recorded in the **Collection** codex — lifetime count, deepest
find, and blurb, with undiscovered tiers shown locked.

## Upgrades & tech

Leveled upgrades, geometric cost per level:

- **Pickaxe** — damage per hit.
- **Agility** — move / dig speed.
- **Refinery** — ore is worth more.
- **Fortune** — chance of a **rich vein** (3× value).

One-time **tech** unlocks that change the sim:

- **Ore Scanner** — see ore through rock (beyond lamp reach).
- **Deep Lantern** — widen your vision underground.

Exact base costs, multipliers, caps and their derived effects live in the
`UPGRADES` / `TECH` tables and `stats()` in `scripts/engine.js` — the source of
truth for balance.

## Economy & progression

- Ore is **held in the inventory** and sold for coins (base value × Refinery multiplier)
  from the Upgrades panel, anytime. Coins are spent **only** on upgrades/tech. Rich veins
  (Fortune crits) drop **3× the ore** and get the disproportionate reward beat (see
  [JUICE.md](JUICE.md)). *(No capacity cap yet — a cargo/economy rework is #6.)*
- Base rock hp **grows with depth** (`rockHp` in `blocks.js`), so keeping the
  pickaxe upgraded is what lets you keep descending — the soft progression gate.
- Progress and settings **persist to `localStorage`**, degrading to a sane default
  if storage is missing or corrupt.

## Design pillars

- **Platformer traversal; no fuel, no cargo.** Movement is real 2D platforming —
  gravity, running, jumping. The economy stays **progress-only** where it counts:
  digging is free and ore can be sold anytime (no hauling), so there is no economic
  soft-lock, and `tools/verify.js` proves a greedy bot reaches Mythril within a sane
  budget. (Fuel and cargo — the classic soft-lock generators — stay out.)
  Climbing back up a sheer shaft isn't possible yet; dedicated upward traversal
  (ropes / platforms / ladders) is a future pass.
- **Deterministic, infinite world.** Every cell's static contents are a pure
  `f(seed, c, r)` (see [ARCHITECTURE.md](ARCHITECTURE.md)); the same seed always
  generates the same mine, and only what you've changed is saved.
- **One saturated element.** Ore is the only vivid colour against deliberately muted
  rock, and depth reads by palette (see [PALETTE.md](PALETTE.md)).

## Direction & roadmap

DELVE is evolving from the grid-locked, tunnel-straight-down incremental digger
described above into a real, playable **Terraria-like game** built around mining,
traversal, and exploration. This happens **incrementally**: the sections above
describe the game as *currently implemented*, and each planned change below migrates
into them as it ships. Tracked as an epic in
[#7](https://github.com/inman-sebastian/agent-games/issues/7).

**Staying:** mining as the core mechanic; incremental / progression mechanics.

**Changing** (one GitHub issue each):

- **Open, infinite world in all directions** — no more bounded fixed-column shaft; the
  world generates infinitely horizontally as well as down.
  [#1](https://github.com/inman-sebastian/agent-games/issues/1)
- **Smooth platformer movement** *(shipped)* — gravity, jumping and falling with
  continuous sub-tile position + AABB tile collision, replacing grid-locked
  omnidirectional no-gravity movement.
  [#2](https://github.com/inman-sebastian/agent-games/issues/2)
- **Mining decoupled from movement** *(shipped)* — its own aim/target action (mouse
  hold-to-mine or keyboard J), reach-limited, usable while moving; walking into rock no
  longer digs. [#3](https://github.com/inman-sebastian/agent-games/issues/3)
- **Inventory system** *(shipped)* — mined ore is held as per-type stacks and sold for
  coins from the Upgrades panel, instead of auto-selling on break.
  [#4](https://github.com/inman-sebastian/agent-games/issues/4)
- **Ores as distinct collectibles** *(shipped)* — first-class item defs, ore icons in
  the inventory, and a Collection codex (lifetime mined / deepest, locked until found).
  [#5](https://github.com/inman-sebastian/agent-games/issues/5)
- **Reworked incremental / economy mechanics** — progression rebuilt around the
  inventory, collectibles, and exploration.
  [#6](https://github.com/inman-sebastian/agent-games/issues/6)

…and more to come — this is just the start.

**Also queued** (independent of the direction shift):

- **Rendering perf** — bake ore blocks / cheaper lighting for deep, fully-lit scenes.
- **Miner sprite** — redraw + animate for the finer 32px grid.

The earlier "horizontal camera" and "economy retune" passes are folded into
[#1](https://github.com/inman-sebastian/agent-games/issues/1) and
[#6](https://github.com/inman-sebastian/agent-games/issues/6) respectively.
