# DELVE

What DELVE is and how it plays: **[docs/DESIGN.md](docs/DESIGN.md)**.

Run `pnpm dev` to start the client (Vite) and the server together, then open the printed URL
to play. Progress is saved on the **server** (with a `localStorage` fallback for offline).
Build with `pnpm build` (emits `dist/`) and serve the built client + WebSocket with
`pnpm start`. Gates: `pnpm verify` (balance) and `pnpm server:check` (client/server protocol).

## Docs

The design and art direction live in [`docs/`](docs/); this README is the index.

| Doc | What's in it |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | **Start here** — what the game is, the core loop, controls, ore tiers, upgrades, economy, design pillars, and the roadmap. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The shared `src/scripts/` modules, how the game / style lab / tools compose from them, the `f(seed,c,r)` world model, and the rock chunk pipeline. |
| [docs/CODE-STYLE.md](docs/CODE-STYLE.md) | Coding standards — readable-over-terse source, naming, TypeScript conventions, comments, formatting. |
| [docs/PALETTE.md](docs/PALETTE.md) | Resurrect 64, the per-stratum depth ramps, and the ore triads + crystal shapes. |
| [docs/RENDERING.md](docs/RENDERING.md) | Resolution/pixel-density, the composited layers, the per-pixel rock model, and the ore nodes/blocks. |
| [docs/LIGHTING.md](docs/LIGHTING.md) | The independent, geometry-aware lighting system (occlusion, lamp field, gem glow, tuning knobs). |
| [docs/JUICE.md](docs/JUICE.md) | The miner sprite, motion & juice, synthesized sound, and planned surface decoration. |
| [tools/README.md](tools/README.md) | Cheap headless verification — the sim harness and cropped-render tools. |

## Layout

Everything Vite compiles lives under `src/`; the Node server and run-directly CLI tools live
in `server/` and `tools/`.

- **`src/index.html` + `src/index.ts`** — the game (canvas render, input, audio, camera,
  save, shop chrome).
- **`src/scripts/`** — the shared modules (world, sim, renderers, lighting, and the typed
  client/server `protocol.ts`), imported by the game, the labs, the server, and the tools alike.
- **`src/resources/`** — one self-registering file per entity (each stratum + ore).
- **`src/labs/`** — the browser dev sandboxes (`style-lab.html`, `render.html`,
  `light-lab.html`), each rendering through the same modules the game uses.
- **`src/net.ts`** — the client side of the server boundary (connect, hydrate, sync, reconnect).
- **`server/`** — the Node + `ws` server: imports the same engine, owns persistence (store of
  record), serves the build in production. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **`tools/`** — CLI dev tools that run under `tsx`/bash, no build: `verify.ts` (balance gate),
  `sim.ts` (headless sim), `server-check.ts` (protocol smoke test), `shot.sh` (screenshots).
- **`dist/`** — Vite build output (gitignored; `pnpm build`).
- **`CLAUDE.md`** — working rules for agents touching this game.
