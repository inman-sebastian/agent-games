# DELVE

What DELVE is and how it plays: **[docs/DESIGN.md](docs/DESIGN.md)**.

Run `pnpm dev` to start the client (Vite) and the server together, then open the printed URL
to play. Progress is saved on the **server** (with a `localStorage` fallback for offline).
Build with `pnpm build` (emits `dist/`) and serve the built client + WebSocket with
`pnpm start`. Gate: `pnpm test` (Vitest — sim, world-gen, client↔server protocol, and DOM).

## Docs

The design and art direction live in [`docs/`](docs/); this README is the index.

| Doc                                          | What's in it                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/DESIGN.md](docs/DESIGN.md)             | **Start here** — what the game is today (core loop, controls, ore tiers, attributes, pillars), then **the decided design** it's becoming, the glossary, and the roadmap.                                                                                        |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The three packages (`@delve/shared` ruleset, `@delve/client`, `@delve/server`), how they compose from the shared modules, the `f(seed,c,r)` world model, the rock chunk pipeline, and the client/server boundary. |
| [docs/CODE-STYLE.md](docs/CODE-STYLE.md)     | Coding standards — readable-over-terse source, naming, TypeScript conventions, comments, formatting.                                                                                                              |
| [docs/BIOMES.md](docs/BIOMES.md)             | The world's **places** — the biome roster (bands / pockets / surface regions), how placement resolves a biome from signals, scarcity, boundaries, and the material-distribution rules. _(Specified, not yet implemented.)_ |
| [docs/UI.md](docs/UI.md)                     | The interface's art direction and architecture — the world-render/document split, Web Components, the stylesheet discipline, the surface slate, and the icon pipelines.                                                    |
| [docs/PALETTE.md](docs/PALETTE.md)           | Resurrect 64, the per-stratum depth ramps, and the ore triads + crystal shapes.                                                                                                                                   |
| [docs/RENDERING.md](docs/RENDERING.md)       | Resolution/pixel-density, the composited layers, the per-pixel rock & material model, and baked procedural ore.                                                                                                    |
| [docs/MATERIALS.md](docs/MATERIALS.md)       | The procedural material system — compositor/shader split, the `Material` contract, shared `stoneSurface`, the FX catalogue, and the value-gradient convention. (Add one with the `delve-new-material` skill.)      |
| [docs/LIGHTING.md](docs/LIGHTING.md)         | The independent, geometry-aware lighting system — occlusion, the lamp field, lamp-only visibility and the void, coloured emitters, daylight/day-night, the light floor, and tuning knobs.                                                                                                           |
| [docs/JUICE.md](docs/JUICE.md)               | The miner sprite, motion & juice, synthesized sound, and planned surface decoration.                                                                                                                              |
| [docs/TESTING.md](docs/TESTING.md)           | The Vitest setup — node + happy-dom projects, the property/fuzz philosophy (invariants over curated scenarios), what's covered, and how to write a test.                                                           |
| [tools/README.md](tools/README.md)           | Interactive dev tools — the sim inspection CLI and cropped-render screenshots.                                                                                                                                    |

## Layout

A pnpm workspace of three packages (`@delve/shared`, `@delve/client`, `@delve/server`), plus the
tools and docs, orchestrated by the thin root `delve` package. Each package builds to its own
`dist/` (all gitignored).

- **`shared/`** — `@delve/shared`, the one ruleset (world, sim, resources, RNG, and the typed
  client/server `protocol.ts`). `src/index.ts` is the public API; `src/resources/` has one
  self-registering file per entity (each stratum + ore). Imported by everything.
- **`client/`** — `@delve/client`, the browser app: `index.html` + `src/index.ts` (the game),
  `src/render/` (renderers), `src/net.ts` (the server-boundary client), and `labs/` (the dev
  sandboxes: `style-lab`, `render`, `light-lab`). Multi-page Vite build.
- **`server/`** — `@delve/server`, the Node + `ws` server: same engine, owns persistence (store
  of record), serves the build in production. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **`tools/`** — interactive CLI dev tools (run under `tsx`/bash, no build): `sim.ts` (headless
  sim inspection), `shot.sh` (cropped-render screenshots). Automated gating lives in the Vitest
  suites (`pnpm test`), not here — see [docs/TESTING.md](docs/TESTING.md).
- **`docs/`** — design + art-direction docs (this index points into them).
- **`CLAUDE.md`** — working rules for agents touching this game.
