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

## Testing and verifying — load the `delve-testing` skill first

**Before you test, verify, debug, reproduce a bug, measure performance or drive the game, load the
[`delve-testing`](.claude/skills/delve-testing/SKILL.md) skill.** It picks the cheapest tool for the
question you are actually asking.

The one rule that holds without it: **Playwright and every other browser MCP are the last resort.**
Before any such call, write one line — _"Browser MCP because: rung N can't answer Q, because R"_ —
and if you can't fill it in, don't make the call. A question about a rule is answered by a failing
test on the rule; a number from the running game by `pnpm probe`; a look by `tools/shot.sh`.

After any logic, world-gen or resource change: a test that you watched fail first, then `pnpm test`.
Policy: [docs/TESTING.md](docs/TESTING.md#policy).

Direction & roadmap live in [docs/DESIGN.md](docs/DESIGN.md#direction--roadmap).
