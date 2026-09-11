---
name: delve-verify
description: How to verify a change in DELVE (games/delve) with the cheap headless tools FIRST — sim/balance/protocol checks, typecheck/build, and tiny cropped render screenshots — reserving Playwright/MCP as a genuine last resort. Trigger after making any DELVE change (logic, economy, world-gen, protocol, or visual) and before handing it over, or whenever asked to test/verify/check DELVE. Reading full-viewport browser screenshots is slow and burns tokens; these tools answer almost everything in text or one tiny PNG.
---

# DELVE — verify (cheap tools first)

Verify DELVE changes with the built headless tools before reaching for the browser. Reading
browser-automation screenshots (especially full-viewport / hi-DPI) is slow and token-heavy; the
tools below answer almost every question in text or one tiny cropped PNG. **Playwright/MCP is a last
resort** — and even then read `?debug` overlay *text*, not pictures. If a tool doesn't cover
something, **extend the tool** rather than defaulting to Playwright. Full reference:
[`tools/README.md`](../../../tools/README.md). Run everything from `games/delve/`.

Pick the cheapest rung that answers your question:

## 1. Logic / economy / world-gen → pure Node, no browser

- **`pnpm verify`** — the balance gate. Drives a greedy bot through the SAME engine the player uses
  and asserts it can reach every ore tier within a sane budget, plus static invariants (ore table,
  cost curves, world-gen). **Run after ANY logic / economy / world-gen change** (e.g. adding/retuning
  an ore, changing `blocks.ts`/`engine.ts`).
- **`pnpm sim <cmd>`** (`tools/sim.ts`) — inspect the pure engine in text:
  - `pnpm sim state [--seed N] [--from save.json]` — raw state as JSON.
  - `pnpm sim probe --seed N --c C --r R` — tileInfo at one cell.
  - `pnpm sim map --seed N [--c C --r R --w W --h H]` — ASCII ore/cluster map + coverage %/tier counts.
  - `pnpm sim play --seed N --do "d600 r120"` — run an action script through real physics, dump result.

## 2. Client/server protocol → `pnpm server:check`

Spawns the real server and drives the WS join / state-sync / reconnect roundtrip headlessly. Run
after touching `shared/src/protocol.ts`, `@delve/server`, or the client net/prediction/reconcile code.

## 3. Types + build → always

`pnpm --filter @delve/client typecheck` (or `pnpm typecheck` for all three packages) and `pnpm build`.
Green before shipping.

## 4. How something LOOKS → `tools/shot.sh` (one tiny cropped PNG)

Headless Chrome, no MCP. Needs a running dev server: `pnpm dev`, then `SHOT_BASE=http://localhost:5173`
(use the port `pnpm dev` printed). Then `Read` the PNG.

```sh
SHOT_BASE=http://localhost:5173 tools/shot.sh 'QUERY' /tmp/out.png [page]
```

- `page` (under the Vite client root) defaults to `labs/render.html`; also
  `labs/material-lab.html` (per-material surface + cave preview; `mat`/`view`/`depth`/`seed`,
  `ui=0` for a bare shot), `labs/style-lab.html`, `labs/light-lab.html`, or `index.html` (the game).
- `QUERY` sets `w`/`h`/`scale` (**keep small** so the PNG is tiny) plus page params, e.g. render lab:
  `seed`, `c`,`r` (centre col/row), `cave=shaft`, `lamp=0|1`, `miner=0|1`, `orestyle=strata|crystal`,
  `dmg=1` (damage-stage inspector).
- Set `WATCHDOG=20` (seconds) for continuously-animating pages (the game, light lab) so capture
  doesn't hang.
- Examples:
  `tools/shot.sh 'orestyle=strata&r=120&cave=shaft&lamp=1&w=70&h=56&scale=5&miner=0' /tmp/w.png labs/render.html`
  · `tools/shot.sh 'view=cave&ui=0&mat=platinum&depth=280&w=14&h=10&scale=3' /tmp/mat.png labs/material-lab.html`

In the running game, the **`?debug`** panel (F3) has live toggle buttons — **Lighting / Fog /
Twinkle / Damage / Tiles** — to isolate a render pass while diagnosing.

## 5. Last resort — live feel only (Playwright/MCP)

Only for things a still can't answer: real input feel, real FPS, animation timing. Even then:
- Load `?debug` and read the overlay **text** via `browser_evaluate` — never a full-viewport shot.
- To inspect pixel detail, draw a **zoom-crop overlay** of the game canvas into the page (drawImage a
  small source region onto a scaled offscreen canvas, `image-rendering: pixelated`) and screenshot
  that element — not the 4K viewport.
- Drive input by dispatching `KeyboardEvent`s (the game reads `e.code`: `KeyS`/`KeyJ` = mine down,
  `KeyD`/`KeyA` = move, hold = keydown without keyup).
- Clean up any screenshot files + `.playwright-mcp/` artifacts afterwards.

## Rule of thumb

Match the tool to the question, cheapest first. Logic → `verify`/`sim`. Protocol → `server:check`.
Look → `shot.sh` + `?debug`. Feel → Playwright (text). Never a full-viewport screenshot when a
`shot.sh` crop or an overlay text read would do. Missing coverage → extend a tool.
