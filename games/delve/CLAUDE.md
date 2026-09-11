# Working on DELVE

For **what DELVE is and how it plays**, read [docs/DESIGN.md](docs/DESIGN.md); the
[README](README.md) indexes all the docs. The root `CLAUDE.md` applies; this file is
just the DELVE-specific working rules.

## Non-negotiables

- **One shared ruleset.** All world + sim logic lives in `@delve/shared` (`shared/src/`) and is
  imported — via `@delve/shared` — by the game (`@delve/client`), the **server** (`@delve/server`),
  and the CLI tools (`tools/`) alike. Render logic lives in `@delve/client` (`client/src/render/`),
  shared between the game and the browser sandboxes (`client/labs/`). Never duplicate a rule — the
  client and server run the _same_ engine; if the game and a lab draw the same thing, they call the
  same module. The typed client/server protocol is `shared/src/protocol.ts`. See the boundary in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **`blocks.ts` is the single source of truth for the world** (`f(seed,c,r)`), and it's
  static-only; dynamic state (dug cells, damage, economy) lives in the save. `engine.ts`
  is the pure sim on top and has no DOM. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Keep the economy soft-lock-free** — digging is free and ore can be sold anytime, so
  the player can never get stranded. No fuel, no hauling requirement, no cargo cap yet.
  (Movement is a gravity platformer as of #2; upward-traversal tools are a future pass.)
  See the design pillars in DESIGN.md.
- **All art is drawn in code** on the Resurrect 64 palette, at logical resolution
  upscaled with `image-rendering: pixelated`. No emoji, clip art, or found images.
- **Write for humans — readable over terse.** Descriptive names, one statement per line,
  named intermediates, typed public surfaces; never hand-compact or minify (the build does
  that). Full standard: [docs/CODE-STYLE.md](docs/CODE-STYLE.md). When porting the old dense
  JS to TS, expand it to this standard — don't transliterate the compaction.
- **Update the docs _first_** when a rule or the art direction changes, then the code —
  the docs are the source of truth others read.

## Verifying your work — cheap tools first; Playwright is a LAST RESORT

Reading MCP/Playwright screenshots (especially full-viewport / hi-DPI) is slow and burns
tokens. **Always** verify with the built headless tools, in this order — only reach for
Playwright when a question is genuinely impossible headlessly, and even then read text,
not images:

1. **Logic / economy / world-gen** → `pnpm verify` (the greedy-bot balance gate) and
   `tools/sim.ts` (`state` / `map` / `probe` / scripted `play`) — pure Node, no browser.
   **Client/server protocol** → `pnpm server:check` (spawns the real server, drives the WS
   join/sync/reconnect roundtrip) — also headless, no browser.
2. **How something looks** → `tools/shot.sh 'QUERY' out.png [page]` — one tight cropped PNG
   via headless Chrome (no MCP), against a running `pnpm dev` server (set `SHOT_BASE`). The
   `page` is a path under the Vite root (`src/`): `labs/render.html` (world crops, the
   default), `labs/style-lab.html`, `labs/light-lab.html`, or `index.html` (the game). Keep
   `w`/`h`/`scale` small so the image is tiny; then `Read` it.
3. **Only if neither can answer it** (live input feel, real FPS) → Playwright with `?debug`,
   and read the **debug-overlay text** via `browser_evaluate` — never a full-viewport / 4K
   screenshot when a small `shot.sh` crop would do.

If no cheap tool covers what you need, **build or extend one** (that's why `shot.sh` takes a
`page` arg and `labs/light-lab.html` exists) rather than defaulting to Playwright. See
[tools/README.md](tools/README.md).

- After any logic / economy / world-gen change, run **`pnpm verify`**.

Direction & roadmap live in [docs/DESIGN.md](docs/DESIGN.md#direction--roadmap).
