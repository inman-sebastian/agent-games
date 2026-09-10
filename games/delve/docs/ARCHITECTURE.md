# DELVE — architecture

How the code is organized and why. The rule that shapes everything: **one shared
ruleset, imported by everything** — the game, the style lab, and the dev tools all
compose the picture (and the world) from the same modules, so nothing can drift.

## Toolchain

DELVE is **TypeScript + ES modules**, bundled by **Vite**. The browser pages
(`index.html`, `style-lab.html`, `tools/render.html`, `tools/light-lab.html`) are Vite
entries — each loads one `<script type="module">` that imports the shared `scripts/`
modules; `vite dev` serves them with HMR and `vite build` emits them to `dist/`. The Node
tools (`tools/verify.ts`, `tools/sim.ts`) and the future server import the exact same
`scripts/` modules directly and run under `tsx`. There are no runtime globals and no
hand-written bundle — the module graph is the source of truth. Coding standards live in
[CODE-STYLE.md](CODE-STYLE.md).

## The world model

The mine is **open and unbounded in every direction** — every cell below the surface is
rock until you dig it (issue #1). Each cell's *static* contents are a **pure function of
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

All under `scripts/`, each a TypeScript ES module with explicit `export`s (no globals). The
browser gets them through Vite; Node tools import them directly under `tsx`.

| Module | Key exports | Responsibility |
| --- | --- | --- |
| `types.ts` | domain types | Shared type definitions (world, save, resources, sim I/O) — pure types, no runtime code. |
| `rng.ts` | `tileRand`, `vnoise`, `mulberry`, `hashXY` | Deterministic PRNG + value-noise helpers, seeded by world coordinate so texture is stable per cell. |
| `resources.ts` | `register`, `all(type)`, `byId`, `shapes` | **Entity registry** — plus the shared procedural art **shapes** (nugget/gem/prism/shard/cluster). Each entity self-registers from its own file under `resources/*.ts`; this module just collects them. |
| `blocks.ts` | `blockAt`, `solidAt`, `oreAt`, `STRATA`, `ORES` | **World definition** — world-gen logic and the canonical queries. Sources its block types (depth `STRATA` + the ore table) from the registry; owns generation (`oreAt`, `strataIndexAt`, `rockHp`). Pure `f(seed,c,r)`. *Static only* — dug/damage state lives in the save. |
| `engine.ts` | `newGame`, `physicsStep`, `mineTile`, `stats`, economy | The pure **sim** — player physics, dig resolution, economy, upgrades — layered over `blocks`. Re-exports the world query (`export * from './blocks'`). Required by the `tools/`. No DOM, no presentation. |
| `cave-render.ts` | `composeBand`, `setStrata`, colour/noise helpers | The **rock renderer** plus colour/rng/noise helpers. Reads the depth `STRATA` ramps via `setStrata`. Used by the main thread, the Worker, and the labs. |
| `ore-art.ts` | `drawOreBlock`, `ORE_ART`, `SHAPES` | Ore-**block** renderer (cluster-aware full-cell) + a thin facade over the registry's art. |
| `sprites.ts` | `drawMiner` | The **miner** sprite (and future entities). |
| `lighting.ts` | `create`, `LAMP_COLOR` | The geometry-aware **lighting system** as a config-driven instance: `create()` → push emitters via `addLight()`, then `render(cfg)`. See [LIGHTING.md](LIGHTING.md). |
| `chunk-worker.ts` | (module worker) | Off-thread rock-chunk generator; imports `composeBand`/`setStrata` from `cave-render`. See [the pipeline](#the-rock-chunk-pipeline). |

## Entity resources

Every game entity — each depth **stratum** and each **ore** today, more types later — is
its own **self-registering file** under `resources/*.ts` that calls
`register({ type, id, … })`. A resource is plain data plus its **art as a function** (ores
declare `art: { shape, c:[dark,mid,hi] }`, reusing the registry's shared shapes). This
keeps each entity individually tunable, gives new ones a single standard, and is a clean
target for future tooling.

`resources/index.ts` imports every entity file, so a single `import '../resources/index'`
(pulled in transitively by `blocks.ts`) populates the registry before any world query runs
— the same in the browser, in Node, and in tests. The Worker doesn't load the registry at
all: it only renders rock, and the strata palette is posted in its init message
(`setStrata`).

**Adding an entity:** create `resources/<name>.ts` (self-registering), add its import to
`resources/index.ts`, done — `verify.ts` validates the schema and that the index matches
the directory (no drift).

## Who composes what

- **`index.ts`** (the game, loaded by `index.html`) keeps only *glue*: input, HUD, save,
  audio, camera, the `requestAnimationFrame` loop — and composes the frame from the modules.
- **`style-lab.ts`** (the tuning sandbox, loaded by `style-lab.html`) keeps only its UI + a
  sample-cave generator, and renders that sample **through the same modules the game uses**,
  so the two can't drift. Iterate a module and both move together.
- **`tools/`** (`sim.ts`, `render.ts`, `light-lab.ts`) read the same modules for cheap
  headless / sandbox checks — see [`tools/README.md`](../tools/README.md).

## The rock chunk pipeline

The rock field is expensive, so it's cached as world-anchored **chunks** (a `CW×CH` tile
block on a 2D grid, since the world is unbounded in both axes). Each chunk is rendered once,
the first time it scrolls into view, and kept — so scrolling back over explored ground is a
cheap blit. Chunk generation runs **off the main thread** in a module Web Worker
(`chunk-worker.ts`, created with `new Worker(new URL('./scripts/chunk-worker.ts',
import.meta.url), { type: 'module' })` so Vite bundles it): it renders into an
`OffscreenCanvas` and ships the result back as a transferable `ImageBitmap`, so descending
into fresh depth never stalls the loop (a not-yet-arrived chunk shows a flat-bg placeholder
for a frame or two). If Workers/OffscreenCanvas are unavailable, it falls back to a
synchronous main-thread render. **Digging** re-renders only a small window around the
changed tile and patches it into the affected chunk(s) — synchronously on the main thread
(cheap, no dig latency).

Because the renderer lives in `cave-render.ts`, imported by *both* the main thread and the
Worker, the look can never drift between them, and all world-space noise is anchored to
world coordinates, so a chunk or a patch looks identical wherever it's rendered. The lamp,
ore, fog-of-war, miner, particles and vignette draw per-frame on top of the cached rock.

## Verification

`tools/verify.ts` is the balance gate. Digging is free and ore sells anytime, so a hard
soft-lock is impossible by construction; the real risk is **pacing**. It drives a greedy
bot through the **same engine** the player uses and asserts it reaches every ore tier —
down into Mythril — within a sane action budget, plus static invariants on the ore table,
cost curves, world gen, and the resource registry (index↔directory drift). Run `pnpm
verify`. The other `tools/` give cheaper, more targeted checks.
