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
  static-only. Dynamic state is split for multiplayer: a shared **`WorldState`** (dug cells,
  tile damage) + a per-player **`PlayerState`** (position, material inventory, upgrade levels),
  bundled as a **`Session`**. `engine.ts` is the pure sim on top (session-based) with no DOM.
  The **server is authoritative** — clients send inputs only, predict locally, and reconcile.
  See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **No economy — collection only.** There is no money, selling, or shop: everything mined
  goes into the inventory. Digging is free and collecting is unconditional (no fuel, no
  hauling, no cargo cap), so the player can never get stranded. Upgrade _levels_ still exist
  and drive stats, but nothing raises them yet — a new (non-monetary) progression system is
  the next major pass (#6). (Movement is a gravity platformer as of #2; upward-traversal is a
  future pass.) See the design pillars in DESIGN.md.
- **World art is drawn in code** on the Resurrect 64 palette, at logical resolution upscaled with
  `image-rendering: pixelated`. No emoji, clip art, or found images. **Character art is the one
  exception**: player and entity frames are imported from a purchased, game-licensed asset pack and
  then coloured here, because the pack ships a colour-coded template rather than finished art — so
  the silhouettes and motion are imported and every colour is authored on the palette. The pipeline,
  the reasoning and what it still owes: [docs/SPRITES.md](docs/SPRITES.md).
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

1. **Logic / world-gen / protocol** → `pnpm test` (Vitest — the gate). Property/fuzz tests over
   the sim + world-gen, the real client↔server protocol e2e (spawns the server), and the client
   save/DOM under happy-dom; see [docs/TESTING.md](docs/TESTING.md). Favor an **invariant/property**
   over a curated case. For interactive inspection (not gating), `tools/sim.ts` (`state` / `map` /
   `probe` / scripted `play`) — pure Node, no browser.
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

- After any logic / world-gen / resource change, run **`pnpm test`** (and add/extend a test for it).
- Follow the **testing policy** — [docs/TESTING.md](docs/TESTING.md#policy): logic is tested / feel is
  eyeballed, red-before-green (see a new invariant fail first), invariants over cases, and every bug
  gets a regression test. It's the default for your own work here, not just the human's.

Direction & roadmap live in [docs/DESIGN.md](docs/DESIGN.md#direction--roadmap).
