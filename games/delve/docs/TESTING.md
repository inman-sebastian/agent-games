# DELVE — testing

Tests run on **Vitest**. The guiding principle is **invariants over curated scenarios**: rather
than hand-writing a single "perfect" playthrough and asserting its outcome (the old `verify.ts`
approach, which only ever exercised author-chosen happy paths), we assert properties that must
hold across *many* random seeds and input streams, using **[fast-check](https://fast-check.dev)**
for property/fuzz generation. When a property fails, fast-check shrinks to the minimal
`(seed, script)` that reproduces it.

```sh
pnpm test         # run everything once (CI gate)
pnpm test:watch   # watch mode while iterating
```

## Layout

Tests are **co-located** as `*.test.ts` next to the code they cover. `vitest.config.ts` defines
two projects by environment (`@delve/shared` is aliased to source in both, so there's no prebuild):

| Project | Environment | Covers |
| ------- | ----------- | ------ |
| `node`  | `node`      | the pure sim + world-gen (`shared/`), and the real client↔server protocol (`server/`) |
| `dom`   | `happy-dom` | the client's DOM chrome (`client/`) — save migration, the inventory panel |

## What's covered

- **World-gen** (`shared/src/blocks.test.ts`) — determinism (`blockAt`/`oreAt` pure; same seed →
  same world), ore discoverability across many seeds, the **placement invariant** that ore never
  spawns outside its band, and monotonic depth curves (`strataIndexAt`, `rockHp`).
- **Resources** (`shared/src/resources/resources.test.ts`) — per-entity conformance (parametrized
  over every ore/stratum) + registry↔directory drift (index imports every file).
- **Engine sim + fuzz** (`shared/src/engine.test.ts`) — the core. `fast-check` drives random input
  streams over random seeds, asserting after every step: **no tunneling** into solid rock, **no
  NaN**, bounded velocity, **monotonic depth**, **deterministic replay**, and **material
  conservation** (everything broken is exactly what's in the inventory + codex log). Plus targeted
  ore-break conservation, `mineTile` mechanics, reach enforcement, `isRich`, and the #8
  unbounded-movement regression.
- **Protocol e2e** (`server/src/protocol.e2e.test.ts`) — the fullest end-to-end path short of a
  browser: `beforeAll` spawns the **real** server against a throwaway data dir, then drives the
  WebSocket protocol the way `client/src/net.ts` does. Asserts fresh-world join,
  determinism/authority (server state == the client's local prediction of the same inputs),
  anti-cheat (out-of-reach mine rejected), reconnect hydration, and protocol-version rejection.
  (Slowest suite; isolated port + temp dir keep it hermetic.)
- **Client save + DOM** (`client/src/save.test.ts`, `client/src/ui/inventory.test.ts`) — save
  format migration (incl. old pre-economy saves loading cleanly) and the inventory panel's row
  builder under happy-dom (the ore-icon factory is injected so tests don't touch canvas).

## Not covered here

- **How it looks** — canvas rendering isn't pixel-asserted in Vitest. Use `tools/shot.sh` for tight
  cropped renders (see [tools/README.md](../tools/README.md)). Real-browser E2E (Playwright driving
  the page) is intentionally out of scope for now; it could be added as its own project later.
- **Interactive inspection** — `tools/sim.ts` (`pnpm sim map/probe/play`) stays as a CLI for
  eyeballing world-gen and scripted playthroughs; it's a tool, not a gate.

## Writing a test

- Co-locate as `<thing>.test.ts`; import `{ describe, it, expect }` from `vitest` (no globals).
- Prefer a **property** (`fc.assert(fc.property(...))`) over a fixed case whenever the thing should
  hold for *all* inputs — bounds, determinism, conservation, "never happens" invariants. Put the
  `expect`s inside the property body (they throw on failure); the property callback should return
  nothing.
- **Give it teeth:** before trusting a new invariant test, break the code it guards and confirm the
  test goes red (a property that passes against a real bug is worse than none — see the ore-break
  conservation test, added precisely because the straight-down fuzz rarely hit ore).
