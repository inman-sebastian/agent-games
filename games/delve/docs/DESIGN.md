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

> This describes the game **as currently implemented**. DELVE is mid-evolution toward
> a Terraria-like mining/exploration game — see [Direction & roadmap](#direction--roadmap)
> for what's changing.

## Core loop

1. **Dig** — run and jump around; aim at nearby rock and hold to mine it — enough hits break the block.
2. **Collect** — everything you mine drops into your **inventory** as per-type stacks
   (rich veins yield 3× the material). There's no selling and no money — mined materials
   are simply kept.
3. **Descend** — deeper rock has more hp and rarer materials.

> **No economy.** There is no currency and nothing to buy. The old coins/selling/shop
> loop was removed; what a player *does* with collected materials, and how progression
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

## Ore tiers

Ore forms Terraria-style **clusters (nodes)**, not embedded veins — see
[RENDERING.md](RENDERING.md) for how a pocket reads as one crystalline mass. Tiers,
shallow → deep:

> Dirt · Copper · Iron · Silver · Gold · Emerald · Ruby · Diamond · Mythril

Each tier is a first-class **item**: name, depth band, rarity (array order), bonus hp
and a codex blurb, each defined in its own **resource file** under
`shared/src/resources/*.ts` (**the source of truth**; see [ARCHITECTURE.md](ARCHITECTURE.md#entity-resources)),
which also carries the ore's art (shape + colour triad). Deeper tiers are tougher and
rarer, and appear only within their depth band, so descending is what unlocks the next
tier. **Dirt** is common surface filler; **Mythril** is the deep-end find.

Mined ore is held in the inventory as these items (with their icons), viewable in the
**▣ Inventory** panel, and every tier you've ever mined is recorded in the **Collection**
codex — lifetime count, deepest find, and blurb, with undiscovered tiers shown locked.

## Upgradable stats

A player carries **upgrade levels** that drive derived stats via `stats()` in
`shared/src/engine.ts`:

- **Pickaxe** (`up.pick`) — dig damage per hit.
- **Agility** (`up.speed`) — dig / move speed.
- **Fortune** (`up.fortune`) — chance of a **rich vein** (3× materials).
- **Deep Lantern** (`tech.lantern`) — widened underground vision.

The plumbing is in place, but **nothing raises these levels right now** — the coin shop
that used to buy them was removed with the economy. A future progression pass will wire
non-monetary ways to earn them (see [Direction & roadmap](#direction--roadmap)); until
then they sit at their base values, so dig power/speed/vision are effectively constant.

## Collection & progression

- Everything mined is **held in the inventory** as per-type stacks — no selling, no
  money. Rich veins drop **3× the material** and get the disproportionate reward beat
  (see [JUICE.md](JUICE.md)). _(No capacity cap.)_
- Base rock hp **grows with depth** (`rockHp` in `blocks.ts`). With upgrades currently
  fixed, this is a raw difficulty ramp rather than a tuned gate — the progression system
  that balances it against earnable power is the next major pass.
- Progress and settings **persist to `localStorage`**, degrading to a sane default
  if storage is missing or corrupt.

## Design pillars

- **Platformer traversal; no fuel, no cargo.** Movement is real 2D platforming —
  gravity, running, jumping. Digging is free and collecting is unconditional (no
  hauling, no capacity cap), so the moment-to-moment loop never strands you. (Fuel and
  cargo — the classic soft-lock generators — stay out.) Climbing back up a sheer shaft
  isn't possible yet; dedicated upward traversal (ropes / platforms / ladders) is a
  future pass.
- **Deterministic, infinite world.** Every cell's static contents are a pure
  `f(seed, c, r)` (see [ARCHITECTURE.md](ARCHITECTURE.md)); the same seed always
  generates the same mine, and only what you've changed is saved.
- **One saturated element.** Ore is the only vivid colour against deliberately muted
  rock, and depth reads by palette (see [PALETTE.md](PALETTE.md)).

## Direction & roadmap

DELVE is evolving from the grid-locked, tunnel-straight-down incremental digger
described above into a real, playable **Terraria-like game** built around mining,
traversal, and exploration. This happens **incrementally**: the sections above
describe the game as _currently implemented_, and each planned change below migrates
into them as it ships. Tracked as an epic in
[#7](https://github.com/inman-sebastian/agent-games/issues/7).

**Staying:** mining as the core mechanic; incremental / progression mechanics.

**Changing** (one GitHub issue each):

- **Open, infinite world in all directions** — no more bounded fixed-column shaft; the
  world generates infinitely horizontally as well as down.
  [#1](https://github.com/inman-sebastian/agent-games/issues/1)
- **Smooth platformer movement** _(shipped)_ — gravity, jumping and falling with
  continuous sub-tile position + AABB tile collision, replacing grid-locked
  omnidirectional no-gravity movement.
  [#2](https://github.com/inman-sebastian/agent-games/issues/2)
- **Mining decoupled from movement** _(shipped)_ — its own aim/target action (mouse
  hold-to-mine or keyboard J), reach-limited, usable while moving; walking into rock no
  longer digs. [#3](https://github.com/inman-sebastian/agent-games/issues/3)
- **Inventory system** _(shipped)_ — mined ore is held as per-type stacks in a dedicated
  Inventory panel, instead of auto-selling on break.
  [#4](https://github.com/inman-sebastian/agent-games/issues/4)
- **Ores as distinct collectibles** _(shipped)_ — first-class item defs, ore icons in
  the inventory, and a Collection codex (lifetime mined / deepest, locked until found).
  [#5](https://github.com/inman-sebastian/agent-games/issues/5)
- **Economy removed** _(shipped)_ — coins, selling, and the coin-bought upgrade/tech shop
  are gone; the only surviving loop is mine → collect into inventory. Ore `value` and the
  `stats()` refine multiplier were deleted; upgrade *levels* stay as plumbing (nothing
  raises them yet). [#4](https://github.com/inman-sebastian/agent-games/issues/4)
- **New progression system** _(planned)_ — a non-monetary way to earn the upgrade levels
  (dig power/speed, fortune, vision) and give collected materials a purpose, replacing the
  removed economy. This is the successor to the old economy rework.
  [#6](https://github.com/inman-sebastian/agent-games/issues/6)
- **Unify strata and ore into one material system** _(planned)_ — today strata
  (`type:'strata'`: a depth band's background rock palette, no shader) and ores
  (`type:'ore'`: a collectible, shaded, baked-in object) are separate shapes. The
  direction is **one material shape and one system for everything mineable** —
  dirt, clay, and stone become collectible too, sharing the same shader/surface-class
  render path and inventory as ores. Phased: (1) strata visible in the material lab
  _(shipped)_; (2) strata declare a surface class like ores, plain-rock render dispatches
  through the shared system; (3) merge the resource types + make the background rock
  collectible (pairs with the new progression system + `verify.ts` rework).
- **Placement beyond depth** _(planned)_ — depth (`band` / strata `top`) is currently
  the *only* factor deciding where a material spawns, and that's a **placeholder**.
  Future placement will layer in more signals (noise regions / biomes, proximity,
  features) so material distribution isn't a pure function of row.

…and more to come — this is just the start.

**Also queued** (independent of the direction shift):

- **Rendering perf** — bake ore blocks / cheaper lighting for deep, fully-lit scenes.
- **Miner sprite** — redraw + animate for the finer 32px grid.

The earlier "horizontal camera" and "economy retune" passes are folded into
[#1](https://github.com/inman-sebastian/agent-games/issues/1) and
[#6](https://github.com/inman-sebastian/agent-games/issues/6) respectively — and the
economy that #6 would have retuned has since been removed outright (above), so #6 is now
the *new* progression system rather than a retune.
