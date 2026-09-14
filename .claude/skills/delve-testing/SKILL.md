---
name: delve-testing
description: How to test, verify, debug, reproduce or measure anything in DELVE (games/delve) — the cheapest tool that can answer the question, with Playwright and every other browser MCP as a LAST resort that needs a written reason. Use BEFORE checking whether a change works, writing or fixing a test, reproducing a reported bug, measuring frame time or performance, inspecting how something looks, or driving the running game — and ALWAYS before calling any Playwright (mcp__plugin_playwright_*) or Chrome (mcp__claude-in-chrome__*) tool on DELVE. Also the checklist before handing a change over.
---

# DELVE — testing and verification

**The rule: answer every question with the cheapest thing that can answer it. A browser MCP call is
the last rung, and you may only climb to it after writing down which rung below failed and why.**

This rule was already in CLAUDE.md, in a skill and in memory, and it was still broken dozens of times
in one session — each call individually reasonable, each one a question a test or a text tool could
have answered. Two things made that easy, and both are fixed: there was no tool that returned TEXT
from the live game (now `pnpm probe`), and the escape hatch was a category ("live feel", "real FPS")
that stretches over anything. So this skill works by the question you are asking, not by category.

Run everything from `games/delve/`.

## The gate — before ANY browser MCP call

State it as a shell call first, and fill it in honestly:

```sh
echo 'Browser MCP because: rung <n> cannot answer <question>, because <concrete reason>'
```

**This is enforced.** A PreToolUse hook (`.claude/hooks/browser-mcp-gate.mjs`, registered in
`.claude/settings.json`) denies any Playwright or Chrome MCP call unless a Bash command starting with
that `echo` ran earlier in the same turn — one gate covers the rest of the turn. It has to be a
command rather than a sentence in your reply: tool calls are in the transcript before the next tool
runs, prose written between them often isn't, so a gate in prose is invisible to the hook.

If you can't name the reason, you don't have one — go back down. Reasons that are NOT reasons:
"it's visual" (`shot.sh`), "it needs input" (`probe --do`), "it needs the live game" (`probe`), "I
want the FPS" (`probe --grep fps`), "I want to see if the bug reproduces" (write the failing test).

## Pick the rung by the question

| The question you're actually asking                                                  | Rung      | Do this                                                                         |
| ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------- |
| Is this rule / behaviour correct? Does this bug exist?                               | **1**     | Write the failing test, then `pnpm test`. See _It needs the live game_ below.   |
| Does the whole thing still hold together?                                            | **1**     | `pnpm test`, `pnpm typecheck`, `pnpm build` — always, before handing over       |
| What does the world / sim contain at X?                                              | **2**     | `pnpm sim state \| probe \| map \| play`                                        |
| How does it look?                                                                    | **3**     | `tools/shot.sh 'QUERY' out.png [page]`, then `Read` the PNG                     |
| How does a **WebGPU** page look? (shot.sh launches Chrome with `--disable-gpu`)      | **4**     | `pnpm probe <page> --wait 3000 --shot out.png`, then `Read` the PNG             |
| What number does the running game show? (fps, frame breakdown, net, position, depth) | **4**     | `pnpm probe index.html --play --grep "<lines>"`                                 |
| What happens after an input? (walk, jump, mine, click a button)                      | **4**     | `pnpm probe index.html --play --do "<steps>" --overlay`                         |
| Does a rendering invariant hold in a real browser canvas?                            | **4**     | `pnpm probe labs/patch-lab.html --wait 5000 --eval "document.title"`            |
| Does it FEEL right — timing, weight, juice?                                          | **human** | That is the author's call; say what you changed and ask them to play it         |
| None of the above, genuinely                                                         | **5**     | Browser MCP — after the gate line. Read text, never a full-viewport screenshot. |

## "It needs the live game" — it usually doesn't

Every one of these went to Playwright once. Each ended as a test that should have been written first.

| Tempted to open the game to check…                          | Instead                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| whether the reticle / reach / mining agrees with the sim    | a test on the shared rule (`withinReach`, `physicsStep`) — `shared/src/engine.test.ts` |
| whether the character flips direction / faces the right way | a property over `physicsStep` inputs — facing is a sim rule                            |
| whether light or rock is stale after digging                | `client/src/render/chunks.test.ts` (chunk vs unlimited context, digs vs full re-bake)  |
| whether an old save / reload behaves                        | `shared/src/hydrate.test.ts`; server side in `server/src/protocol.e2e.test.ts`         |
| whether the client is online / reconciling                  | `client/src/net.test.ts`, `client/src/prediction.test.ts`                              |
| whether movement feels the same after a constant change     | assert it in **world units** — seconds to top speed, blocks of skid (`engine.test.ts`) |
| whether the server survives bad input                       | `server/src/protocol.e2e.test.ts` sends it garbage                                     |

If a question is about a RULE, the answer is a test on the rule. The browser only ever shows you the
rule's consequence, one frame at a time, with nothing left behind to stop it regressing.

## The rungs

### 1 — `pnpm test` (the gate)

Vitest: property/fuzz tests over the sim and world-gen, the real client↔server e2e (spawns a server),
the chunk-rendering invariant through a software canvas, and the client modules under happy-dom.
Policy lives in [docs/TESTING.md](../../../games/delve/docs/TESTING.md#policy); the parts you must not skip:

- **Red before green.** See every new test FAIL — break the code it guards, or write it before the
  fix. Then restore and see it pass. A test that passes against the bug is worse than none.
- **Every bug gets a regression test**, written failing first.
- **Invariants over cases** — a fast-check property that holds for all inputs beats a curated example.
- **State feel in world units.** Invariants prove the sim is consistent, not that it still feels the
  way it was tuned; a dozen unit bugs after the 2x2 split passed every invariant.
- **Put a rule's test where the rule lives** (`shared/` for sim rules, even if the symptom was visual).

### 2 — `pnpm sim` (inspect the pure engine, no browser)

`state [--seed N]` · `probe --seed N --c C --r R` (one cell's block) · `map --seed N` (ASCII ore map)
· `play --seed N --do "d600 r120"` (a scripted run through real physics). Reference:
[tools/README.md](../../../games/delve/tools/README.md).

### 3 — `tools/shot.sh` (one small PNG, no MCP)

```sh
SHOT_BASE=http://localhost:5173 tools/shot.sh 'play=1&w=30&h=18&scale=2' /tmp/game.png index.html
```

`w`/`h` are CELLS (8 art px each), so the PNG is `w × 8 × scale` wide — keep it small. Pages:
`labs/render.html` (default; world crops), `labs/material-lab.html`, `labs/light-lab.html`,
`labs/style-lab.html`, `labs/char-lab.html`, `index.html` (pass `play=1` or you capture the title).

### 4 — `pnpm probe` (the live game, as text, no MCP)

Headless Chrome driven over the DevTools protocol. Input is **trusted**, so it really moves the
player. Prints JSON.

```sh
pnpm probe index.html --play --grep "^(fps|phase|light field)"          # frame cost breakdown
pnpm probe index.html --size 3400x1900 --play --grep "^(fps|phase)"      # at a big window
pnpm probe index.html --play --do "key:ArrowRight:1200 wait:300" --grep "^pos"
pnpm probe index.html --play --do "aim:0,2:400 aim:-1,2:400 wait:500" --grep "^(pos|save)"  # dig under the feet
pnpm probe index.html --play --do "click:#muteBtn" --eval "document.getElementById('muteBtn').textContent"
pnpm probe labs/patch-lab.html --wait 5000 --eval "document.title"      # a lab's PASS/FAIL
pnpm probe 'labs/gpu-lab.html?light=0' --wait 3000 --shot /tmp/gpu.png  # a WebGPU page, as a PNG
```

Steps for `--do`: `key:<code>:<ms>` · `tap:<code>` · `click:<selector>` · `mouse:<x>,<y>:<ms>` ·
`aim:<dc>,<dr>:<ms>` (pointer on a cell relative to the player) · `wait:<ms>`. Each run is a fresh
browser profile, so a fresh player and world. If probe can't express something you need, **extend
probe** — that is cheaper than a browser session, and the next person gets it too.

### 5 — Browser MCP (Playwright, Chrome) — after the gate line only

For what probe genuinely can't do yet. Even then: read `?debug` overlay text via evaluate, crop any
screenshot to the element, never the full viewport, and delete `.playwright-mcp/` artifacts after.
Then consider extending probe so the next time doesn't need it.

## Traps that cost real time

- **A stale server.** If `pnpm dev` says port 8787 is in use, another (possibly old) server holds it
  and the client will connect to IT. Its authoritative corrections make a player look frozen or a fix
  look broken. `lsof -ti:8787 | xargs kill`, then restart.
- **Synthetic events don't drive the game.** `dispatchEvent(new KeyboardEvent(...))` is untrusted and
  moves nothing. probe and Playwright's `page.keyboard` are trusted.
- **Keyboard mining can't descend** — it clears one of the body's two columns (#53). Use `aim:`.
- **The world lives on the server**, filed under the localStorage player id. A fresh probe profile is a
  fresh player; a dev-server restart loses at most ~2.5s of digging.
- **A headless or background tab may cap `requestAnimationFrame`.** Read `frame` (ms of work), not
  `fps`, when judging cost.
- **Near the surface, a chunk renders its sky per band** (#54) — compare rock renders below it.

## Before handing a change over

- [ ] The rule changed → a test covers it, and you watched it fail without the change
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build` are green — say so with the counts
- [ ] Anything visual → a `shot.sh` crop or a probe verdict you actually read
- [ ] Anything about feel → told the author what to play, rather than claiming it feels right
- [ ] Every browser MCP call in the session had an honest gate line — or there were none
- [ ] Docs updated first where a rule changed (CLAUDE.md: docs are the source of truth)
