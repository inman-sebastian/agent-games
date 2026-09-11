# DELVE — architecture

How the code is organized and why. The rule that shapes everything: **one shared
ruleset, imported by everything** — the game, the style lab, and the dev tools all
compose the picture (and the world) from the same modules, so nothing can drift.

## Packages

DELVE is a small **pnpm workspace of three TypeScript packages**, plus the tools and docs:

- **`@delve/shared`** (`shared/`) — the one ruleset: world, sim, resources, RNG, and the
  client/server protocol. Pure, DOM-free. Imported by everything; its `src/index.ts` barrel is
  the public API (`import … from '@delve/shared'`). Builds to `shared/dist`.
- **`@delve/client`** (`client/`) — the browser app: the game (`index.html` + `src/`), the
  renderers (`src/render/`), and the dev sandboxes (`labs/`). A multi-page **Vite** build →
  `client/dist`.
- **`@delve/server`** (`server/`) — the Node + `ws` server (`src/`). Bundled with **esbuild** →
  `server/dist`.

The `tools/` (verify / sim / server-check / shot.sh) and `docs/` sit alongside, owned by the
thin root **`delve`** package that orchestrates `pnpm dev` / `build` / `verify` across the
three. In dev, `@delve/shared` resolves straight to **source** (a Vite alias for the client;
package `exports` → `src` for tsx/tsc/esbuild), so there is no prebuild step; each package
still emits its own `dist/`. There are no runtime globals and no hand-written bundle — the
module graph is the source of truth. Coding standards live in [CODE-STYLE.md](CODE-STYLE.md).

## The world model

The mine is **open and unbounded in every direction** — every cell below the surface is
rock until you dig it (issue #1). Each cell's _static_ contents are a **pure function of
`(seed, c, r)`**, so the world is never stored, only regenerated on demand. A save
therefore holds only the **dynamic** state: which cells you've dug, in-progress damage,
the economy (coins, upgrades, tech), and the player's continuous position/velocity. See
[`blocks.ts`](#modules) for the query and `newGame()` in `engine.ts` for the save shape.
(`WIDTH` still exists as the default spawn column, not a wall.)

Movement is a **gravity platformer** (issue #2): you fall, jump, and run, and mining is a
separate aim/target action (#3). The economy stays **soft-lock-free by construction** —
digging is free and ore sells anytime, so you can never get stranded; upward-traversal
tools are a future pass. [`tools/verify.ts`](#verification) proves the pacing holds.

## Modules

Each is a TypeScript ES module with explicit `export`s (no globals). The **shared** modules
(`@delve/shared`, imported by client + server + tools) are pure and DOM-free; the **render**
modules (`@delve/client`, under `client/src/render/`) draw to a canvas.

### Shared ruleset — `@delve/shared` (`shared/src/`)

| Module        | Key exports                                            | Responsibility                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | domain types                                           | Shared type definitions (world, save, resources, sim I/O) — pure types, no runtime code.                                                                                                                                                                                    |
| `rng.ts`      | `tileRand`, `vnoise`, `mulberry`, `hashXY`             | Deterministic PRNG + value-noise helpers, seeded by world coordinate so texture is stable per cell.                                                                                                                                                                         |
| `registry.ts` | `register`, `all(type)`, `byId`, `shapes`              | **Entity registry** — plus the shared procedural art **shapes** (nugget/gem/prism/shard/cluster). Each entity self-registers from its own file under `resources/*.ts`; this module just collects them. (Named `registry.ts` so it doesn't clash with the `resources/` dir.) |
| `blocks.ts`   | `blockAt`, `solidAt`, `oreAt`, `STRATA`, `ORES`        | **World definition** — world-gen logic and the canonical queries. Sources its block types from the registry; owns generation (`oreAt`, `strataIndexAt`, `rockHp`). Pure `f(seed,c,r)`. _Static only_ — dug/damage state lives in the save.                                  |
| `engine.ts`   | `newGame`, `physicsStep`, `mineTile`, `stats`, economy | The pure **sim** — player physics, dig resolution, economy, upgrades — layered over `blocks`. Re-exports the world query (`export * from './blocks'`). No DOM.                                                                                                              |
| `protocol.ts` | `PROTOCOL_VERSION`, `WS_PATH`, message types           | The typed **client/server wire protocol** (see [the boundary](#client--server-boundary-p2)).                                                                                                                                                                                |
| `index.ts`    | (barrel)                                               | The package's **public API** — re-exports all of the above.                                                                                                                                                                                                                 |

### Client renderers — `@delve/client` (`client/src/render/`)

| Module            | Key exports                                      | Responsibility                                                                                                                           |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `cave-render.ts`  | `composeBand`, `setStrata`, colour/noise helpers | The **rock renderer**. Reads the depth `STRATA` ramps via `setStrata`. Used by the main thread, the Worker, and the labs.                |
| `ore-art.ts`      | `drawOreBlock`, `ORE_ART`, `SHAPES`              | Ore-**block** renderer (cluster-aware full-cell) + a thin facade over the registry's art.                                                |
| `sprites.ts`      | `drawMiner`                                      | The **miner** sprite (and future entities).                                                                                              |
| `lighting.ts`     | `create`, `LAMP_COLOR`                           | The geometry-aware **lighting system**: `create()` → push emitters via `addLight()`, then `render(cfg)`. See [LIGHTING.md](LIGHTING.md). |
| `chunk-worker.ts` | (module worker)                                  | Off-thread rock-chunk generator; imports `composeBand`/`setStrata` from `cave-render`. See [the pipeline](#the-rock-chunk-pipeline).     |

## Entity resources

Every game entity — each depth **stratum** and each **ore** today, more types later — is
its own **self-registering file** under `shared/src/resources/*.ts` that calls
`register({ type, id, … })`. A resource is plain data plus its **art as a function** (ores
declare `art: { shape, c:[dark,mid,hi] }`, reusing the registry's shared shapes). This
keeps each entity individually tunable, gives new ones a single standard, and is a clean
target for future tooling.

`shared/src/resources/index.ts` imports every entity file, so a single `import './resources/index'`
(pulled in transitively by `blocks.ts`) populates the registry before any world query runs
— the same in the browser, in Node, and in tests. The Worker doesn't load the registry at
all: it only renders rock, and the strata palette is posted in its init message
(`setStrata`).

**Adding an entity:** create `shared/src/resources/<name>.ts` (self-registering), add its import to
`shared/src/resources/index.ts`, done — `verify.ts` validates the schema and that the index matches
the directory (no drift).

## Who composes what

- **`client/src/index.ts`** (the game, loaded by `client/index.html`) keeps only _glue_: input, HUD,
  save, audio, camera, the `requestAnimationFrame` loop — and composes the frame from the modules.
- **`client/labs/`** — the browser dev sandboxes, each rendering **through the same modules the
  game uses** so they can't drift: `style-lab.ts` (art tuning over a sample cave),
  `render.ts` (the one-region render harness `shot.sh` captures), `light-lab.ts` (coloured-
  light blending). Iterate a module and the game and the labs move together.
- **`tools/`** — the CLI dev tools (`verify.ts`, `sim.ts`, `shot.sh`) read the same modules
  for cheap headless checks — see [`tools/README.md`](../tools/README.md).

## The rock chunk pipeline

The rock field is expensive, so it's cached as world-anchored **chunks** (a `CW×CH` tile
block on a 2D grid, since the world is unbounded in both axes). Each chunk is rendered once,
the first time it scrolls into view, and kept — so scrolling back over explored ground is a
cheap blit. Chunk generation runs **off the main thread** in a module Web Worker
(`chunk-worker.ts`, created with `new Worker(new URL('./render/chunk-worker.ts',
import.meta.url), { type: 'module' })` so Vite bundles it): it renders into an
`OffscreenCanvas` and ships the result back as a transferable `ImageBitmap`, so descending
into fresh depth never stalls the loop (a not-yet-arrived chunk shows a flat-bg placeholder
for a frame or two). If Workers/OffscreenCanvas are unavailable, it falls back to a
synchronous main-thread render. **Digging** re-renders only a small window around the
changed tile and patches it into the affected chunk(s) — synchronously on the main thread
(cheap, no dig latency).

Because the renderer lives in `cave-render.ts`, imported by _both_ the main thread and the
Worker, the look can never drift between them, and all world-space noise is anchored to
world coordinates, so a chunk or a patch looks identical wherever it's rendered. The lamp,
ore, fog-of-war, miner, particles and vignette draw per-frame on top of the cached rock.

## Client / server boundary (P2)

DELVE runs a **Node + TypeScript server** (`server/`, plain `http` + `ws`) that imports the
**same** engine / blocks / resources the client does — one ruleset, both sides. The wire
protocol is a shared, typed vocabulary in [`shared/src/protocol.ts`](../shared/src/protocol.ts)
(`join` / `hello` / `sync`, plus the forward-looking `intent` reserved for P3), imported by
both `server/src/index.ts` and the client's [`client/src/net.ts`](../client/src/net.ts).

The model is **client-authoritative with the server as the store of record** (authoritative
simulation / anti-cheat is P3):

- The client still runs the sim locally and renders from it (unchanged). On boot it hydrates
  instantly from `localStorage` so it plays offline; then it connects.
- On `join`, the server loads the player's save (one JSON file per player under `server/data/`,
  keyed by a sanitized client id) or creates one from the client's proposed seed, and replies
  `hello` with the snapshot. On the **first** hello the client hydrates to the server's state;
  if the server had none (`fresh`), the client instead pushes its local state up so existing
  progress is adopted, not overwritten.
- The client's normal save cadence writes `localStorage` **and** debounce-`sync`s the state to
  the server, which persists it. Reconnects mid-session keep the live local sim and re-assert
  it. The network is additive — if the server is unreachable, the game plays on unchanged.

**Dev:** `pnpm dev` runs Vite (client, HMR) and the server (`tsx watch`, WS-only) together via
`concurrently`; Vite proxies `/ws` to the server so the browser talks to one origin.
**Prod:** `pnpm build` → `dist/`, then `pnpm start` runs the server with `--serve-static` so
one process serves the built client (via `sirv`) and the WebSocket. `tools/server-check.ts`
(`pnpm server:check`) is the headless gate for the boundary — it drives the real protocol and
asserts the join / sync / reconnect-hydrate behaviour.

## Verification

`tools/verify.ts` is the balance gate. Digging is free and ore sells anytime, so a hard
soft-lock is impossible by construction; the real risk is **pacing**. It drives a greedy
bot through the **same engine** the player uses and asserts it reaches every ore tier —
down into Mythril — within a sane action budget, plus static invariants on the ore table,
cost curves, world gen, and the resource registry (index↔directory drift). Run `pnpm
verify`. The other `tools/` give cheaper, more targeted checks.
