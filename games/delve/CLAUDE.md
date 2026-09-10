# Working on DELVE

For **what DELVE is and how it plays**, read [docs/DESIGN.md](docs/DESIGN.md); the
[README](README.md) indexes all the docs. The root `CLAUDE.md` applies; this file is
just the DELVE-specific working rules.

## Non-negotiables

- **One shared ruleset.** All world + render logic lives in `scripts/` and is imported
  by the game (`index.html`), the style lab (`style-lab.html`), and the tools
  (`tools/`, `verify.js`) alike. Never duplicate a rule in the presentation layer — if
  the game and the lab draw the same thing, they call the same module.
- **`blocks.js` is the single source of truth for the world** (`f(seed,c,r)`), and it's
  static-only; dynamic state (dug cells, damage, economy) lives in the save. `engine.js`
  is the pure sim on top and has no DOM. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Don't add gravity, fuel, cargo, or hauling** — they're deliberately absent to keep
  the economy soft-lock-free (see the design pillars in DESIGN.md). Ore sells in place.
- **All art is drawn in code** on the Resurrect 64 palette, at logical resolution
  upscaled with `image-rendering: pixelated`. No emoji, clip art, or found images.
- **Update the docs *first*** when a rule or the art direction changes, then the code —
  the docs are the source of truth others read.

## Workflow

- After any logic / economy / world-gen change, run **`pnpm verify`** (or `node
  verify.js`) — the greedy-bot balance gate.
- Prefer the cheap headless tools over Playwright/MCP: `tools/sim.js` (state / world
  map / scripted play, no browser) and `tools/render.html` + `tools/shot.sh` (a tight
  cropped PNG of exactly one region). See [tools/README.md](tools/README.md).

Roadmap / deferred passes live in [docs/DESIGN.md](docs/DESIGN.md#roadmap-deferred-passes).
