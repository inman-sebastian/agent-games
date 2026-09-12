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

## Policy

The default going forward — deliberately lightweight, so it's a habit, not bureaucracy:

1. **Logic is tested; feel is eyeballed.** The pure layers — sim, world-gen, protocol, and the
   progression/economy when it returns — are deterministic and invariant-rich, so a change there
   isn't done until a test covers it (ideally written first — see red-before-green). Rendering,
   art, juice, lighting, and sprite motion are tuned **by eye** with `shot.sh`/`?debug`; don't
   force assertions onto how something looks.
2. **Red before green.** For any new invariant, watch it FAIL first (break the code it guards, or
   write the test before the fix). A test that passes against a real bug is worse than none — this
   is the only cheap guarantee it has teeth. (The ore-break conservation test exists precisely
   because a near-vacuous property passed against an injected bug.)
3. **Invariants over cases.** Prefer a fast-check property that holds for *all* inputs over a
   hand-picked example — bounds, determinism, conservation, "never happens" rules.
4. **Every bug gets a regression test.** When you find one, write the failing test, then fix it.
   Each bug becomes permanent coverage.

**Not** policy: coverage thresholds, and test-first on mechanics you haven't designed yet — game
mechanics are discovered by playing and tuning, so encode a rule as a test once it's *decided*,
not before.

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
  _(The band invariant is temporary: `band` goes away with
  [biome-declared placement](MATERIALS.md#placement-moves-to-biomes), and is replaced by the
  reachability claims in [The content gate](#the-content-gate-missing).)_
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

## The content gate (missing)

> **This is a known gap, not a decision.** `tools/verify.ts` used to prove *"a greedy bot reaches
> Mythril within a sane budget."* That claim was coin-economy-shaped, so deleting the economy left
> it testing nothing real — and it was **deleted rather than replaced**. What went with it is the
> guarantee that **no broken content can ship without a human playing every world**, which is a
> standing violation of the workspace rule on automating content verification.

### What the old gate got right and wrong

- **The bias was real.** A *greedy, optimal* bot on a *single* seed proves the best case is
  survivable. It says nothing about a normal player on an unlucky world — it answers "is this
  possible?" when the useful question is "is this *reliably* good?"
- **Determinism was never the flaw — it's the enabling property.** The world is `f(seed, c, r)`;
  that's precisely what makes content verifiable at all. The fix isn't less determinism, it's
  **more seeds and worse players**: hundreds of seeds, deliberately imperfect agents, asserting
  **invariants** rather than replaying one perfect run. Failures report as a **failing seed**, which
  is reproducible by construction.
- **Vitest is a runner, not a replacement.** The valuable thing was the *claim*. The gate should
  become a test here, not disappear into the suite.

### The claims it should make

The [biome roster](BIOMES.md) makes these crisp for the first time — the old depth-range assertions
couldn't express any of them:

| Claim | Blocked on |
| --- | --- |
| **All 16 biomes generate in every world**, non-unique pockets at the promised per-player density | Biomes ([#27](https://github.com/inman-sebastian/agent-games/issues/27)) |
| **Every material is obtainable in at least one biome** (never "every biome has every material") | Biomes |
| **Every _required_ material is reachable by a fresh character in a fresh world** | Biomes + the crafting tree ([#6](https://github.com/inman-sebastian/agent-games/issues/6)) |
| **Slot count grows more slowly than the item roster** — or "equip the best set" wins and the loadout loop dies | Equipment ([#6](https://github.com/inman-sebastian/agent-games/issues/6)) |
| **No trap** — asserted as the three cases that actually have teeth | Bounded world, fluid, gated structures |

**Both halves of the reachability claim matter.** Characters are
[portable](ARCHITECTURE.md#persistence-three-scopes), so "fresh world" and "fresh character" come
apart — and a **maxed character entering a new world is out of scope by design**, not a balance
failure to chase.

**On "no trap":** the general claim is near-vacuous now that everything but bedrock is breakable and
digging is always free — the player can nearly always dig out, so it would pass trivially and test
nothing. Assert the three specific cases instead: **bedrock pockets**, **drowning in a flooded dead
end**, and **being sealed inside a tool-gated structure without the tool**.

### What's assertable today — and the first one is written, then retired

Most of the above waits on systems that don't exist. One didn't, and it has now run its full course
in `shared/src/resources/resources.test.ts` — which makes it the worked example of the pattern.

**It started as an `it.fails`.** The bug: `rarityOf` returned an ore's position in the registry, and
the client scales every reward cue by it, so appending four ore files made quartz (band 95) out-rank
mythril (band 480) and made stone bricks (band 20) the loudest event in the game
([#46](https://github.com/inman-sebastian/agent-games/issues/46)). Asserting the *broken* invariant
with `it.fails` bought three things:

- The suite **stayed green** (`88 passed | 1 expected fail`), so the gate wasn't broken for everyone.
- The bug was **on record as executable code**, not just as an issue.
- When #46 was fixed the test **started failing**, forcing the fixer to deal with it. It cleaned
  itself up, exactly as designed.

**And then it argued with its own premise, which is the more interesting half.** The retired test
asserted that registry order should agree with *depth* order. Fixing the bug properly showed that
premise was wrong: depth says where a material is, not how special it is. Quartz is deeper than gold
and far more plentiful. A depth-ordered rarity would also have been built on the placement system,
which is itself being demoted from depth-only ([BIOMES.md](BIOMES.md)). So the replacement asserts
what actually matters — that rarity is authored, that the top tier is held alone, that shallow
material never reaches the celebration tier, and that rarity and depth are *allowed to disagree*.

The lesson to carry: an `it.fails` records a bug faithfully, but it also freezes whatever theory you
had when you found it. Re-derive the invariant when you fix it rather than flipping the assertion.

That's red-before-green without holding CI hostage, and it's the recommended shape for any invariant
discovered ahead of its fix.

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
