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

The `tools/` (sim / shot.sh), the Vitest suites (co-located `*.test.ts`), and `docs/` sit
alongside, owned by the thin root **`delve`** package that orchestrates `pnpm dev` / `build` / `test` across the
three. In dev, `@delve/shared` resolves straight to **source** (a Vite alias for the client;
package `exports` → `src` for tsx/tsc/esbuild), so there is no prebuild step; each package
still emits its own `dist/`. There are no runtime globals and no hand-written bundle — the
module graph is the source of truth. Coding standards live in [CODE-STYLE.md](CODE-STYLE.md).

## The world model

The mine is **open and unbounded in every direction** — every cell below the surface is
rock until you dig it (issue #1). Each cell's _static_ contents are a **pure function of
`(seed, c, r)`**, so the world is never stored, only regenerated on demand. Only the
**dynamic** state is held, split for multiplayer (P3, #12) into a shared **`WorldState`**
`{ seed, dug, dmg }` — the terrain everyone digs together, tile-break damage included — and
a per-player **`PlayerState`** (continuous position/velocity + collected-material inventory +
upgrade levels; there is no money). A **`Session`** bundles one world + one player; in multiplayer many Sessions
share one `WorldState`. See [`blocks.ts`](#modules) for the static query and
`newWorld`/`newPlayer`/`newSession` in `engine.ts` for the shapes. (`WIDTH` still exists as
the default spawn column, not a wall.)

Movement is a **gravity platformer** (issue #2): you fall, jump, and run, and mining is a
separate aim/target action (#3). There is **no economy** — everything mined goes into the
inventory (no coins, no selling); digging is free and unconditional, so the loop can't
strand you. Upward-traversal tools are a future pass. The [Vitest suites](#verification)
cover the sim/world-gen invariants.

## Modules

Each is a TypeScript ES module with explicit `export`s (no globals). The **shared** modules
(`@delve/shared`, imported by client + server + tools) are pure and DOM-free; the **render**
modules (`@delve/client`, under `client/src/render/`) draw to a canvas.

### Shared ruleset — `@delve/shared` (`shared/src/`)

| Module        | Key exports                                                        | Responsibility                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | domain types                                                       | Shared type definitions incl. WorldState / PlayerState / Session (the shared-world + per-player split), resources, and the sim + wire I/O. Pure types.                                                                                                                                      |
| `rng.ts`      | `tileRand`, `vnoise`, `mulberry`, `hashXY`                         | Deterministic PRNG + value-noise helpers, seeded by world coordinate so texture is stable per cell.                                                                                                                                                                                         |
| `registry.ts` | `register`, `all(type)`, `byId`, `shapes`                          | **Entity registry** — plus the shared procedural art **shapes** (nugget/gem/prism/shard/cluster). Each entity self-registers from its own file under `resources/*.ts`; this module just collects them. (Named `registry.ts` so it doesn't clash with the `resources/` dir.)                 |
| `blocks.ts`   | `blockAt`, `solidAt`, `oreAt`, `STRATA`, `ORES`                    | **World definition** — world-gen logic and the canonical queries. Sources its block types from the registry; owns generation (`oreAt`, `strataIndexAt`, `rockHp`). Pure `f(seed,c,r)`. _Static only_ — dug/damage live in the shared WorldState.                                            |
| `engine.ts`   | `newSession`, `physicsStep`, `mineTile`, `stats`, `invCount`       | The pure **sim** — player physics, dig resolution, material collection, upgrade-derived stats — layered over `blocks`. Re-exports the world query (`export * from './blocks'`). No DOM.                                                                                                     |
| `fsm.ts`      | `StateMachine`                                                     | A tiny, generic, table-driven **finite state machine** — the reusable primitive under DELVE's state machines (see [State machines](#state-machines)). `send(event)` for constrained flows (rejects illegal transitions), `set(state)` for derived ones; both fire enter/exit hooks. No DOM. |
| `miner.ts`    | `MinerState`, `desiredMinerState`, `newMinerMachine`, `driveMiner` | The **miner's animation/behaviour state** (idle/run/jump/fall/mine) as a state machine over the physics — a pure derivation each tick, `set()` into a `StateMachine` so the client can hook transition juice (landing squash, etc.).                                                        |
| `protocol.ts` | `PROTOCOL_VERSION`, `WS_PATH`, message types                       | The typed **client/server wire protocol** (see [the boundary](#client--server-boundary-p3--authoritative-server)).                                                                                                                                                                          |
| `index.ts`    | (barrel)                                                           | The package's **public API** — re-exports all of the above.                                                                                                                                                                                                                                 |

### Client renderers — `@delve/client` (`client/src/render/`)

| Module            | Key exports                                      | Responsibility                                                                                                                           |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `cave-render.ts`  | `composeBand`, `setStrata`, colour/noise helpers | The **rock renderer**. Reads the depth `STRATA` ramps via `setStrata`. Used by the main thread, the Worker, and the labs.                |
| `ore-art.ts`      | `drawOreBlock`, `ORE_ART`, `SHAPES`              | Ore-**block** renderer (cluster-aware full-cell) + a thin facade over the registry's art.                                                |
| `sprites.ts`      | `drawMiner`                                      | The **miner** sprite (and future entities).                                                                                              |
| `lighting.ts`     | `create`, `LAMP_COLOR`                           | The geometry-aware **lighting system**: `create()` → push emitters via `addLight()`, then `render(cfg)`. See [LIGHTING.md](LIGHTING.md). |
| `chunk-worker.ts` | (module worker)                                  | Off-thread rock-chunk generator; imports `composeBand`/`setStrata` from `cave-render`. See [the pipeline](#the-rock-chunk-pipeline).     |

## State machines

DELVE has one reusable FSM primitive — `StateMachine<S,E>` in `shared/src/fsm.ts` — and drives its
two stateful flows through it, so the pattern is shared, not re-invented:

- **Generic machine (`fsm.ts`).** Table-driven and typed. Two ways to advance it, for DELVE's two
  shapes of state: `send(event)` follows a declared transition table and **rejects** any transition
  not in it (illegal transitions are bugs to catch — e.g. `title` can't jump to `paused`);
  `set(state)` jumps straight to a computed state with no table (for state that's a pure function of
  something else). Both fire optional `onEnter`/`onExit` hooks and no-op on a self-transition. Pure,
  DOM-free, fuzz-tested (`fsm.test.ts`).
- **Miner state (`miner.ts`).** `idle / run / jump / fall / mine`, **derived** from the physics
  snapshot each tick (`desiredMinerState`) and `set()` into a machine — locomotion is freely
  interruptible, so a transition table would be busywork, but the machine still earns its keep: the
  client hooks its `onEnter` to fire landing juice on the air→ground edge. The client reads `.state`
  to pick the walk/idle bob. Tested against real `physicsStep` playthroughs (`miner.test.ts`).
- **App / screen flow (client `index.ts`).** `title → playing ⇄ paused`, a `send()`-driven machine
  and the single source of truth for "is the sim running" — it ticks only in `playing`. There is
  deliberately **no blocking `loading` state**: the client renders from `localStorage` instantly and
  plays offline, connecting in the background, so gating play on the network would regress that. CSS
  keys the visible chrome off `<body data-app>`; the pause menu and the inventory/collection panels
  all route through the one `pause`/`resume` pair. (Client-only — screen flow isn't a shared rule.)

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
`shared/src/resources/index.ts`, done — the resource tests (`shared/src/resources/resources.test.ts`)
validate the schema and that the index matches the directory (no drift).

## Who composes what

- **`client/src/index.ts`** (the game, loaded by `client/index.html`) keeps only _glue_: input, HUD,
  save, audio, camera, the `requestAnimationFrame` loop — and composes the frame from the modules.
- **`client/labs/`** — the browser dev sandboxes, each rendering **through the same modules the
  game uses** so they can't drift: `style-lab.ts` (art tuning over a sample cave),
  `render.ts` (the one-region render harness `shot.sh` captures), `light-lab.ts` (coloured-
  light blending). Iterate a module and the game and the labs move together.
- **`tools/`** — the interactive CLI dev tools (`sim.ts`, `shot.sh`) read the same modules
  for cheap headless inspection — see [`tools/README.md`](../tools/README.md). Automated testing
  lives in the co-located Vitest suites — see [`docs/TESTING.md`](TESTING.md).

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

## Client / server boundary (P3 — authoritative server)

DELVE runs a **Node + TypeScript server** (`server/`, plain `http` + `ws`) that imports the
**same** engine / blocks / resources the client does — one ruleset, both sides. The wire
protocol is a shared, typed vocabulary in [`shared/src/protocol.ts`](../shared/src/protocol.ts),
imported by both `server/src/index.ts` and the client's [`client/src/net.ts`](../client/src/net.ts).

The model is a **central authoritative simulation server** (the Valve/Source lineage) — chosen
after research over peer-to-peer lockstep / rollback, which don't scale for many players and need
perfect cross-machine determinism. The rationale + decision are on issue #12.

- **Clients send inputs only.** Per tick: `input { seq, input }` (movement + a mine target);
  plus the discrete `command` `newGame`. They never send state, so **out-of-reach mining is
  impossible by construction** — the server computes every mutation itself, and `physicsStep`
  enforces mining reach.
- **The server is the single source of truth, and it owns time.** It owns each connection's
  `Session` (its shared world + player), **queues** received inputs and spends them on its own
  fixed tick (WebSocket is ordered/reliable, so they apply in order), validates commands (can't
  afford → no-op), and persists to `server/data/` (a sanitized-id JSON per player). It broadcasts
  authoritative `state` deltas at 20 Hz: the full `PlayerState` + newly-dug tiles + tile damage +
  `ackSeq` (the last input it applied).
- **The client predicts + reconciles.** It runs the sim locally each fixed `TICK_DT` for instant
  feel (movement + optimistic mining), buffering un-acked inputs. On each `state` it adopts the
  authoritative player, applies the world deltas, drops acked inputs, and **replays** the rest —
  re-predicting "now". Any residual difference is absorbed into a decaying render offset so
  corrections never pop. Determinism is desirable (smaller corrections) but **not required**: a
  mispredict is a self-correcting nudge, not a lockstep desync. Offline, it just predicts with no
  server — the network is additive, and `localStorage` is the offline cache.

**Fixed timestep, both sides clocked.** Both step the sim with the same `TICK_DT`
(`TICK_HZ` = 60), which is what makes a replayed input on the client reproduce the server's result.
Each runs its own real clock with the same accumulator shape — banked elapsed time drained into
whole ticks, with bounded catch-up — so neither quietly runs slow when its timer fires late.

**The server's clock is what makes it authoritative over _time_, not just over state.** It used to
step once per received input message, which had two consequences worth remembering because both
looked like design until they were measured:

- **Nothing could happen unprompted.** The world advanced only while somebody held a key, so a
  day/night cycle, draining lava, an enemy acting or a player falling down their own shaft were all
  unreachable — and a client could stop the world by simply going quiet, which is why "nothing
  pauses, ever" ([UI.md](UI.md)) could not be enforced from the client at all.
- **Input rate WAS simulation rate.** A client that sent inputs faster than 60 Hz ran the world
  faster. Measured: a 300-input burst bought 29.8 tiles of travel inside 300 ms of wall clock, with
  no modified client, just a loop.

Now one loop drives every connected session and an input buys a place in a **queue**. A client
earns one input credit per tick, banking at most 8 so ordinary network jitter drains invisibly, so
over any stretch of time it gets exactly the physics steps the clock gave it. When the queue
starves the server repeats the last input for 6 ticks to bridge the gap, then drops to neutral — so
a client that closed its menu or lost the network goes limp under gravity rather than walking on
forever. The loop idles when nobody is connected, which is the hook **hibernation** will hang on.

One cost, recorded because it is permanent: a scripted input stream now costs a tick of real time
per input, so the authority gate's determinism scenario takes seconds rather than milliseconds. Its
step count is chosen against the clock rather than against how much digging is interesting.

**Dev:** `pnpm dev` runs Vite + the server (`tsx watch`,
WS-only) via `concurrently`; Vite proxies `/ws`. **Prod:** `pnpm build` → dist, then `pnpm start`
serves the built client (`sirv`) + the WebSocket from one process. `server/src/protocol.e2e.test.ts`
is the authority gate — it spawns the real server and proves its state equals the client's
prediction for a scripted input stream, that out-of-reach mining is rejected, and that reconnect
hydrates the persisted world.

### What real multiplayer needs (decided shape)

The port was deliberately thin — a single-player game in multiplayer-shaped plumbing, kept
malleable. The *architecture* is right and the hardest call (server authority) is already made; the
**feature set** is unbuilt. The gap is concrete:

| Needed | Why |
| --- | --- |
| **World lifetime decoupled from connection lifetime** | Today each connection owns its **own private world** (`server/src/index.ts` holds one `Session` per socket). Many players must join *one* world, and worlds must outlive their creators. |
| **Player roster + join/leave** | The `state` message carries **one** player and no roster — there is no representation of a second player anywhere in the protocol. |
| **Entity replication** | Enemies, NPCs, dropped loot and projectiles are all server-owned entities. **The protocol has no entity concept at all** — the wire model is tiles plus one player. |
| **Interest management** | The client currently receives the world's **entire** dug-tile set, which doesn't scale with world size or player count. |
| **Three-scope persistence** | See below. A single JSON per player can't hold a shared world. |

**Keep replication area-of-interest-shaped from the start**, even behind a naive radius check. What
forecloses scale isn't a naive implementation — it's baking **send-everything-to-everyone** into the
wire format, which is the current shape and is cheap to fix now and expensive later.

Tracked in [#13](https://github.com/inman-sebastian/agent-games/issues/13); entity replication
itself sits in [#29](https://github.com/inman-sebastian/agent-games/issues/29).

## Persistence: three scopes

> **Decided, not built.** See [DESIGN.md](DESIGN.md#characters-worlds-and-multiplayer).

**A character belongs to the player, not the world** — attributes, equipment, inventory and unlocks
travel into any world you join, and starting a fresh character is easy. That splits saved state into
**three scopes with different owners and lifetimes**:

| Scope | Holds | Lifetime |
| --- | --- | --- |
| **Account** | The discovery codex, settings | Forever; shared across *all* of a player's characters |
| **Character** | Attributes, equipment, inventory, unlocks | Per character; travels between worlds |
| **World** | Terrain mutations (`dug`/`dmg`), fluid, entities, NPCs, time of day | Per world; outlives whoever made it |

**What exists today:** one whole-file JSON per `playerId` under `server/data/`
(`server/src/store.ts`, which says so itself — fine for single-player, a real store is a later
concern). It conflates all three scopes into one document.

**What changes:**

- The player store holds a **collection**, not a save — one player → many characters.
- `WorldState` becomes **world-scoped and shared**, not a field of one player's `Session`. The type
  comments already anticipate this ("in multiplayer one `WorldState` is shared across all players").
- **Whole-file writes stop working.** Fluid alone touches many cells per tick, where the current
  model assumes the player mutates one tile at a time.

### World lifecycle

With worlds outliving their players, two policies become real. **Both are open questions, explicitly
conditional on committing to hosted multiplayer** — they're cost controls for running many worlds,
and that hosting model is planned-around rather than committed. Recorded so the shape is known, not
so it's assumed:

- **Hibernation** — a world with nobody in it stops ticking entirely. It's the lever that keeps cost
  proportional to *active* worlds rather than *created* ones. Fluid mid-flow **runs to completion on
  resume**, treating downtime as owing time rather than having stopped; resuming from the paused
  state would make logging out a way to freeze a disaster.
- **Retention** — created worlds accumulate forever unless something evicts them.

Hibernation presupposes a server tick to stop, and now there is one — the loop already idles with
nobody connected, so what remains is unloading the sessions rather than inventing the lever.

## `stats()` needs world context

> **Decided, not built.** See [DESIGN.md](DESIGN.md#progression).

`stats(player)` resolves derived capability from the player alone. Progression adds
**environmental modifiers** — contextual effects that apply based on *where the player is* — so
capability stops being a pure function of the player and needs the world too.

This is a **shared-ruleset signature change**, so it lands on both sides at once: the client
predicts with it and the server is authoritative with it, and they must agree. Worth doing
deliberately rather than by passing extra arguments at one call site.

## Verification

Testing is **Vitest**, `pnpm test` — see [`docs/TESTING.md`](TESTING.md) for the full picture.
The philosophy is **invariants over curated scenarios**: instead of one hand-scripted "perfect"
playthrough (the retired `verify.ts`), property/fuzz tests (fast-check) assert what must hold
across many random seeds and input streams — no tunneling, deterministic replay, material
conservation, ore-always-in-band — plus the real client↔server protocol e2e (a spawned server)
and the client's save/DOM under happy-dom. The interactive `tools/` (`sim`, `shot.sh`) remain for
inspection, not gating.
