# DELVE — game design

The single source of truth for **what DELVE is and how it plays**. Presentation
lives in the art docs ([PALETTE](PALETTE.md), [RENDERING](RENDERING.md),
[LIGHTING](LIGHTING.md), [JUICE](JUICE.md)); code structure lives in
[ARCHITECTURE](ARCHITECTURE.md). Tuning *numbers* (ore values, costs, hp curves)
are owned by the code they live in — this doc names them and points at the source,
so the two can't drift.

## What it is

A moody, pixel-art **incremental mining game**. You tunnel straight down through
deepening rock strata, break ore where you find it, and reinvest the coins to dig
deeper — where the rock is tougher and the ore is rarer.

## Core loop

1. **Dig** — move into a rock cell to chip it; enough hits break the block.
2. **Earn** — ore sells the instant its block breaks, **in place**. There is no
   cargo and no hauling back to the surface; the loop never asks you to stop digging.
3. **Spend** — the ⛏ Upgrades panel: leveled upgrades and one-time tech.
4. **Descend** — deeper rock has more hp and rarer, richer ore.

## Controls

- **Keyboard:** WASD / arrow keys.
- **Mouse:** hold toward a wall to dig.
- **Touch:** drag toward a wall (larger targets on coarse pointers).

One input drives one dig/step; the sim gates the next action until the current one
settles, and unclaimed intent is buffered rather than dropped.

## Ore tiers

Ore forms Terraria-style **clusters (nodes)**, not embedded veins — see
[RENDERING.md](RENDERING.md) for how a pocket reads as one crystalline mass. Tiers,
shallow → deep:

> Dirt · Copper · Iron · Silver · Gold · Emerald · Ruby · Diamond · Mythril

Each tier has a depth band, spawn weight, coin value and bonus hp — all defined in
the `ORES` table in `scripts/blocks.js`, **the source of truth** (this list is only
the ordering). Deeper tiers are exponentially more valuable and tougher, and appear
only within their depth band, so descending is what unlocks the next tier. **Dirt**
is a near-worthless surface filler; **Mythril** is the deep-end payoff.

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

- Coins are earned **only** by breaking ore and spent **only** on upgrades/tech.
  Rich veins (Fortune crits) pay 3× and get the disproportionate reward beat (see
  [JUICE.md](JUICE.md)).
- Base rock hp **grows with depth** (`rockHp` in `blocks.js`), so keeping the
  pickaxe upgraded is what lets you keep descending — the soft progression gate.
- Progress and settings **persist to `localStorage`**, degrading to a sane default
  if storage is missing or corrupt.

## Design pillars

- **No gravity, no fuel, no cargo.** All three are classic soft-lock generators
  (dig down, can't get back / strand yourself). Traversal is your own persistent
  tunnels — you can always climb back the way you came — so the economy is provably
  **progress-only**, and `tools/verify.js` proves a greedy bot reaches Mythril within a
  sane budget.
- **Deterministic, infinite world.** Every cell's static contents are a pure
  `f(seed, c, r)` (see [ARCHITECTURE.md](ARCHITECTURE.md)); the same seed always
  generates the same mine, and only what you've changed is saved.
- **One saturated element.** Ore is the only vivid colour against deliberately muted
  rock, and depth reads by palette (see [PALETTE.md](PALETTE.md)).

## Roadmap (deferred passes)

Queued, not yet started:

- **Economy retune** — rarer, richer clusters (the `ORES` table is the home).
- **Rendering perf** — bake ore blocks / cheaper lighting for deep, fully-lit scenes.
- **Viewport fit + horizontal camera** — the field currently overflows and is
  centred; lateral movement needs a camera.
- **Miner sprite** — redraw + animate for the finer 32px grid.
