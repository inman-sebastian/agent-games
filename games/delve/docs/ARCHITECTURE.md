# DELVE — architecture

How the code is organized and why. The rule that shapes everything: **one shared
ruleset, imported by everything** — the game, the style lab, and the dev tools all
compose the picture (and the world) from the same modules, so nothing can drift.

## The world model

The mine is a **wide, bounded shaft**: `WIDTH` columns (currently 82), infinite
downward. Every cell's *static* contents are a **pure function of `(seed, c, r)`** —
so the world is never stored, only regenerated on demand. A save therefore holds
only the **dynamic** state: which cells you've dug, in-progress damage, and the
economy (coins, upgrades, tech). See [`blocks.js`](#modules) for the query and
`newGame()` in `engine.js` for the save shape.

There is **no gravity and no fuel** — both are classic soft-lock generators (dig
down, can't get back). Traversal comes from your own persistent tunnels: you can
always climb back the way you came, so the economy is provably progress-only and
[`verify.js`](#verification) can prove it.

## Modules

All under `scripts/`. Each is an IIFE that attaches to `self` (so it works in the
window **and** the Web Worker); `blocks.js` and `engine.js` also `module.exports`
for Node (tools + `verify.js`). No build step.

| Module | Global | Responsibility |
| --- | --- | --- |
| `blocks.js` | `Blocks` | **World definition** — the single source of truth for "what is at a cell". Bounds, block types (depth `STRATA` + the ore table), procedural generation, and the canonical queries `blockAt(seed,c,r)` (full static descriptor) and cheap `solidAt(seed,c,r)`. Pure `f(seed,c,r)`; depends on nothing. *Static only* — dug/damage state lives in the save. |
| `engine.js` | `Delve` | The pure **sim** — player state, dig/move resolution, economy, upgrades — layered over `Blocks`. Re-exports the world query for convenience. Required by `verify.js` and the tools. No DOM, no presentation. |
| `cave-render.js` | `CaveRender` | The **rock renderer** (`composeBand`) plus colour/rng/noise helpers. Reads the depth `STRATA` ramps from `Blocks`. Used by the main thread, the Worker, and the lab. |
| `ore-art.js` | `DelveOre` | Ore/gem **crystal art**: `ORE_ART` (per-id triad + shape), the `SHAPES`, and `drawOreBlock` (cluster-aware full-cell ore rendering). |
| `sprites.js` | `DelveSprites` | The **miner** sprite (`drawMiner`) and future entities. |
| `lighting.js` | `DelveLighting` | The geometry-aware **lighting system** as a config-driven instance: `create()` → push emitters via `addLight()`, then `render(cfg)`. See [LIGHTING.md](LIGHTING.md). |

## Who composes what

- **`index.html`** (the game) keeps only *glue*: input, HUD, save, audio, camera,
  the `requestAnimationFrame` loop — and composes the frame from the modules.
- **`style-lab.html`** (the tuning sandbox) keeps only its UI + a sample-cave
  generator, and renders that sample **through the same modules the game uses**, so
  the two can't drift. Iterate a module and both move together. These `docs/` are
  the only thing kept in sync by hand.
- **`tools/`** (`sim.js`, `render.html`) read the same modules for cheap headless
  checks — see [`tools/README.md`](../tools/README.md).

## The rock chunk pipeline

The rock field is expensive, so it's cached as fixed-position vertical **chunks**
(full field width, a few rows tall). Each chunk is rendered once, the first time it
scrolls into view, and kept — so scrolling back over explored ground is a cheap
blit. Chunk generation runs **off the main thread** in a Web Worker
(`chunk-worker.js`, which `importScripts` `blocks.js` + `cave-render.js`): it
renders into an `OffscreenCanvas` and ships the result back as a transferable
`ImageBitmap`, so descending into fresh depth never stalls the loop (a not-yet-
arrived chunk shows a flat-bg placeholder for a frame or two). **Digging**
re-renders only a small window around the changed tile and patches it into the
affected chunk(s) — synchronously on the main thread (cheap, no dig latency).

Because the renderer lives in `cave-render.js`, imported by *both* the main thread
and the Worker, the look can never drift between them, and all world-space noise is
anchored to world coordinates, so a chunk or a patch looks identical wherever it's
rendered. The lamp, ore, fog-of-war, miner, particles and vignette draw per-frame
on top of the cached rock.

## Verification

`verify.js` is the balance gate. Digging is free and ore sells in place, so a hard
soft-lock is impossible by construction; the real risk is **pacing**. It drives a
greedy bot through the **same engine** the player uses and asserts it reaches every
ore tier — down into Mythril — within a sane action budget, plus static invariants
on the ore table, cost curves, and world gen. Run `pnpm verify` (or `node
verify.js`). The `tools/` give cheaper, more targeted checks.
