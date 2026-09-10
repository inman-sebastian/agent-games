# DELVE

What DELVE is and how it plays: **[docs/DESIGN.md](docs/DESIGN.md)**.

Open `index.html` in a browser. Progress auto-saves to `localStorage`. Run the
balance gate with `pnpm verify` (or `node verify.js`).

## Docs

The design and art direction live in [`docs/`](docs/); this README is the index.

| Doc | What's in it |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | **Start here** — what the game is, the core loop, controls, ore tiers, upgrades, economy, design pillars, and the roadmap. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The shared `scripts/` modules, how the game / style lab / tools compose from them, the `f(seed,c,r)` world model, and the rock chunk pipeline. |
| [docs/PALETTE.md](docs/PALETTE.md) | Resurrect 64, the per-stratum depth ramps, and the ore triads + crystal shapes. |
| [docs/RENDERING.md](docs/RENDERING.md) | Resolution/pixel-density, the composited layers, the per-pixel rock model, and the ore nodes/blocks. |
| [docs/LIGHTING.md](docs/LIGHTING.md) | The independent, geometry-aware lighting system (occlusion, lamp field, gem glow, tuning knobs). |
| [docs/JUICE.md](docs/JUICE.md) | The miner sprite, motion & juice, synthesized sound, and planned surface decoration. |
| [tools/README.md](tools/README.md) | Cheap headless verification — the sim harness and cropped-render tools. |

## Layout

- **`scripts/`** — the shared modules (world, sim, renderers, lighting), imported by
  the game, the style lab, and the tools alike; no build step.
- **`index.html`** — the game (canvas render, input, audio, camera, save, shop chrome).
- **`style-lab.html`** — the art tuning sandbox, rendering through the same modules.
- **`verify.js`** — the greedy-bot balance gate.
- **`tools/`** — headless sim + cropped-render checks.
- **`CLAUDE.md`** — working rules for agents touching this game.
