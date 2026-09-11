# DELVE

What DELVE is and how it plays: **[docs/DESIGN.md](docs/DESIGN.md)**.

Run `pnpm dev` to start the client (Vite) and the server together, then open the printed URL
to play. Progress is saved on the **server** (with a `localStorage` fallback for offline).
Build with `pnpm build` (emits `dist/`) and serve the built client + WebSocket with
`pnpm start`. Gates: `pnpm verify` (balance) and `pnpm server:check` (client/server protocol).

## Docs

The design and art direction live in [`docs/`](docs/); this README is the index.

| Doc                                          | What's in it                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/DESIGN.md](docs/DESIGN.md)             | **Start here** — what the game is, the core loop, controls, ore tiers, upgrades, economy, design pillars, and the roadmap.                                                                                        |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The three packages (`@delve/shared` ruleset, `@delve/client`, `@delve/server`), how they compose from the shared modules, the `f(seed,c,r)` world model, the rock chunk pipeline, and the client/server boundary. |
| [docs/CODE-STYLE.md](docs/CODE-STYLE.md)     | Coding standards — readable-over-terse source, naming, TypeScript conventions, comments, formatting.                                                                                                              |
| [docs/PALETTE.md](docs/PALETTE.md)           | Resurrect 64, the per-stratum depth ramps, and the ore triads + crystal shapes.                                                                                                                                   |
| [docs/RENDERING.md](docs/RENDERING.md)       | Resolution/pixel-density, the composited layers, the per-pixel rock model, and the ore nodes/blocks.                                                                                                              |
| [docs/LIGHTING.md](docs/LIGHTING.md)         | The independent, geometry-aware lighting system (occlusion, lamp field, gem glow, tuning knobs).                                                                                                                  |
| [docs/JUICE.md](docs/JUICE.md)               | The miner sprite, motion & juice, synthesized sound, and planned surface decoration.                                                                                                                              |
| [tools/README.md](tools/README.md)           | Cheap headless verification — the sim harness and cropped-render tools.                                                                                                                                           |

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
- **`tools/`** — CLI dev tools (run under `tsx`/bash, no build): `verify.ts` (balance gate),
  `sim.ts` (headless sim), `server-check.ts` (protocol smoke test), `shot.sh` (screenshots).
- **`docs/`** — design + art-direction docs (this index points into them).
- **`CLAUDE.md`** — working rules for agents touching this game.
