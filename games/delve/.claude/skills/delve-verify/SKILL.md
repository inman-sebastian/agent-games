---
name: delve-verify
description: How to verify a change in DELVE (games/delve) with the cheap headless tools FIRST — sim/balance/protocol checks, typecheck/build, and tiny cropped render screenshots — reserving Playwright/MCP as a genuine last resort. Trigger after making any DELVE change (logic, world-gen, protocol, or visual) and before handing it over, or whenever asked to test/verify/check DELVE. Reading full-viewport browser screenshots is slow and burns tokens; these tools answer almost everything in text or one tiny PNG.
---

# DELVE — verify (cheap tools first)

Verify DELVE changes with the built headless tools before reaching for the browser. Reading
browser-automation screenshots (especially full-viewport / hi-DPI) is slow and token-heavy; the
tools below answer almost every question in text or one tiny cropped PNG. **Playwright/MCP is a last
resort** — and even then read `?debug` overlay _text_, not pictures. If a tool doesn't cover
something, **extend the tool** rather than defaulting to Playwright. Full reference:
[`tools/README.md`](../../../tools/README.md). Run everything from `games/delve/`.

Pick the cheapest rung that answers your question:

## 1. Logic / world-gen / protocol → `pnpm test` (Vitest — the gate)

- **`pnpm test`** runs the whole suite: property/fuzz tests over the sim + world-gen (fast-check —
  no tunneling, determinism, material conservation, ore-always-in-band…), the **real client↔server
  protocol e2e** (spawns the server), and the client save/DOM under happy-dom. `pnpm test:watch`
  while iterating. **Run after ANY logic / world-gen / protocol / resource change**, and add or
  extend a co-located `*.test.ts` for what you changed. Full picture: [`docs/TESTING.md`](../../../docs/TESTING.md).
- Favor an **invariant/property** (holds for all inputs) over a curated case, and give a new
  invariant **teeth**: break the code it guards and confirm the test goes red before trusting it.
- **`pnpm sim <cmd>`** (`tools/sim.ts`) — interactive inspection of the pure engine (not a gate):
  - `pnpm sim state [--seed N] [--from save.json]` — raw state as JSON.
  - `pnpm sim probe --seed N --c C --r R` — the block descriptor at one cell (ore, hp, empty, and
    the generator's block row).
  - `pnpm sim map --seed N [--c C --r R --w W --h H]` — ASCII ore/cluster map + coverage %/tier counts.
  - `pnpm sim play --seed N --do "d600 r120"` — run an action script through real physics, dump result.

## 2. Types + build → always

`pnpm --filter @delve/client typecheck` (or `pnpm typecheck` for all three packages) and `pnpm build`.
Green before shipping.

## 3. How something LOOKS → `tools/shot.sh` (one tiny cropped PNG)

Headless Chrome, no MCP. Needs a running dev server: `pnpm dev`, then `SHOT_BASE=http://localhost:5173`
(use the port `pnpm dev` printed). Then `Read` the PNG.

> **Check the server is really yours.** If `pnpm dev` prints that port 8787 is in use, stop the other
> server before trusting anything. The server exits loudly now, but the client still comes up and
> will happily connect to an OLD server holding the port — whose authoritative corrections make a
> player look frozen, a fix look broken, or old behaviour look current. `lsof -ti:8787 | xargs kill`.

```sh
SHOT_BASE=http://localhost:5173 tools/shot.sh 'QUERY' /tmp/out.png [page]
```

- `page` (under the Vite client root) defaults to `labs/render.html`; also
  `labs/material-lab.html` (per-material surface + cave preview; `mat`/`view`/`depth`/`seed`,
  `ui=0` for a bare shot), `labs/style-lab.html`, `labs/light-lab.html`, `labs/char-lab.html`
  (characters against real collision), or `index.html` (the game — add **`play=1`** to skip the
  title screen, or you capture the title panel).
- `QUERY` sets `w`/`h`/`scale` plus page params. **`w`/`h` are CELLS** (8 art px each) since the 2x2
  split, so the PNG is `w × 8 × scale` px wide — `w=70&scale=5` is 2800px, not tiny. Keep them small.
  Page params, e.g. render lab:
  `seed`, `c`,`r` (centre col/row), `cave=shaft`, `lamp=0|1`, `miner=0|1`, `orestyle=strata|crystal`,
  `dmg=1` (damage-stage inspector).
- Set `WATCHDOG=20` (seconds) for continuously-animating pages (the game, light lab) so capture
  doesn't hang.
- Examples:
  `tools/shot.sh 'orestyle=strata&r=120&cave=shaft&lamp=1&w=70&h=56&scale=5&miner=0' /tmp/w.png labs/render.html`
  · `tools/shot.sh 'view=cave&ui=0&mat=platinum&depth=280&w=14&h=10&scale=3' /tmp/mat.png labs/material-lab.html`

In the running game, the **`?debug`** panel (F3) has live toggle buttons — **lighting / fog /
twinkle / damage** — to isolate a render pass, and a **per-pass frame breakdown** (`phase …`,
`light field … scrim …`, `bakes …`) to read before optimising anything.

**The chunk-context invariant is in `pnpm test`** (`client/src/render/chunks.test.ts`, via a software
canvas). `labs/patch-lab.html` repeats it through Chrome's real canvas with a text `PASS`/`FAIL`
verdict — worth a look after changing how `cave-render` composites, since the test double only models
the canvas calls the renderer makes today.

## 4. Last resort — live feel only (Playwright/MCP)

Only for things a still can't answer: real input feel, real FPS, animation timing. Even then:

- Load `?debug` and read the overlay **text** via `browser_evaluate` — never a full-viewport shot.
- To inspect pixel detail, draw a **zoom-crop overlay** of the game canvas into the page (drawImage a
  small source region onto a scaled offscreen canvas, `image-rendering: pixelated`) and screenshot
  that element — not the 4K viewport.
- Drive input with **trusted** events — Playwright's `page.keyboard.down/up` and `page.mouse` (via
  `browser_run_code_unsafe`). Synthetic `dispatchEvent(new KeyboardEvent(...))` does NOT move the
  player; a probe built on it silently tests nothing. The game reads `e.code`: `KeyA`/`KeyD` or the
  arrows move, `KeyJ` mines (with `KeyS`/↓ held, straight down), hold = down without up.
- **Keyboard mining can't descend a shaft on its own** — it clears one of the two columns the body
  spans (#53). To carve a test tunnel, aim the pointer at each cell, converting world cells to CSS
  pixels from the debug panel's `cam` line and the canvas bounding box.
- A dug world lives on the SERVER, filed under the player id in `localStorage` (`delve.playerId`).
  Clearing `localStorage` gives a fresh world because it drops that id, not because the world was
  stored locally. The server flushes saves every 2.5s and on disconnect, so a dev-server restart
  (on any watched file change) loses at most the last couple of seconds of digging.
- Clean up any screenshot files + `.playwright-mcp/` artifacts afterwards.

## Rule of thumb

Match the tool to the question, cheapest first. Logic / world-gen / protocol → `pnpm test` (+ `sim`
to inspect). Look → `shot.sh` + `?debug`. Feel → Playwright (text). Never a full-viewport screenshot
when a `shot.sh` crop or an overlay text read would do. Missing coverage → add a test or extend a tool.
