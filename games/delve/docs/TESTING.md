# DELVE — testing

Tests run on **Vitest**. The guiding principle is **invariants over curated scenarios**: rather
than hand-writing a single "perfect" playthrough and asserting its outcome (the old `verify.ts`
approach, which only ever exercised author-chosen happy paths), we assert properties that must
hold across _many_ random seeds and input streams, using **[fast-check](https://fast-check.dev)**
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
3. **Invariants over cases.** Prefer a fast-check property that holds for _all_ inputs over a
   hand-picked example — bounds, determinism, conservation, "never happens" rules.
4. **Every bug gets a regression test.** When you find one, write the failing test, then fix it.
   Each bug becomes permanent coverage.

**Not** policy: coverage thresholds, and test-first on mechanics you haven't designed yet — game
mechanics are discovered by playing and tuning, so encode a rule as a test once it's _decided_,
not before.

## Layout

Tests are **co-located** as `*.test.ts` next to the code they cover. `vitest.config.ts` defines
two projects by environment (`@delve/shared` is aliased to source in both, so there's no prebuild):

| Project | Environment | Covers                                                                                |
| ------- | ----------- | ------------------------------------------------------------------------------------- |
| `node`  | `node`      | the pure sim + world-gen (`shared/`), and the real client↔server protocol (`server/`) |
| `dom`   | `happy-dom` | the client's DOM chrome (`client/`) — save migration, the inventory panel             |

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
  ore-break conservation, `mineTile` mechanics (including that an already-dug cell pays nothing),
  reach — one `withinReach` rule, agreeing cell for cell with what `physicsStep` mines — `isRich`,
  facing as the movement rule alone, and the #8 regression (the old view span is not a wall).
  **Movement feel is stated in world units**: seconds to top speed, blocks of skid, lamp reach in
  blocks, `unstick`'s search in blocks. Those exist because the 2x2 split left a dozen lengths in the
  wrong unit and not one pre-existing test noticed — every invariant held while the game felt
  different. An invariant proves the sim is consistent; only a world-unit assertion proves it still
  feels the way it was tuned.
- **Fluid** (`shared/src/fluid.test.ts`, #30) — the cellular automaton under random terrain and
  pours: exact mass conservation every tick, never in rock or over-full, deterministic, a closed basin
  settles flat to one unit, lava slower than water, kinds never mix, a settled lake sleeps until a
  breach is reported, and fluid outside the active region freezes without loss.
- **The world's bounds** (`shared/src/bounds.test.ts`, #26) — size presets, the bedrock floor and
  the side edges: nothing out of bounds or below the floor is ever `mineable` or broken by
  `mineTile`, a body walking into either edge stops inside the world, every ore band ends above the
  floor, and a save from the infinite world is rescued back inside. The render side's
  `client/src/render/cave-render.test.ts` holds the strata ramp to the sim's `strataIndexAt` and
  checks bedrock's hard top.
- **Restoring a save** (`shared/src/hydrate.test.ts`) — old formats, fields added since, a body
  wedged in rock rescued (or respawned on the save's OWN world), junk that isn't a save at all, and
  the `SAVE_FORMAT` stamp. Pure and in the shared ruleset, because the server applies the same rule.
- **Protocol e2e** (`server/src/protocol.e2e.test.ts`) — the fullest end-to-end path short of a
  browser: `beforeAll` spawns the **real** server against a throwaway data dir, then drives the
  WebSocket protocol the way `client/src/net.ts` does. Asserts fresh-world join,
  determinism/authority (server state == the client's local prediction of the same inputs),
  anti-cheat (out-of-reach mine rejected), reconnect hydration, and protocol-version rejection.
  Also that **the server survives what it is sent** — malformed frames (`null`, arrays, missing
  fields, garbage `seq`) leave it serving the next client, and a save from an older build loads and
  can be mined in. Both were process-killing crashes before; the first test brought the test server
  down outright when it was written. (Slowest suite; isolated port + temp dir keep it hermetic.)
- **Save store** (`server/src/store.test.ts`) — hostile player ids can't read or write outside
  `DATA_DIR`; a corrupt file loads as null. Goes red when the id sanitizing is removed.
- **Rock chunks** (`client/src/render/chunks.test.ts`) — a rendering invariant, in the gate: every
  chunk baked the way the Worker bakes it matches the same chunk baked with unlimited context
  EXACTLY, and digs re-baking only what `chunksReading` names leave nothing stale. Plus the cache: a
  bake that lands after a world reset is dropped (the stale-world bug), a dig re-bakes the chunk under
  the pick at once and sends neighbours to the Worker, and a dig during an in-flight bake bakes once
  more. Node has no 2D canvas, so it renders through `soft-canvas.ts` — a test double that only has
  to be deterministic, since both sides of every comparison go through it; `labs/patch-lab.html`
  repeats the check through Chrome's real canvas.
- **Prediction** (`client/src/prediction.test.ts`) — the client half of the authoritative contract,
  against the real engine: replaying un-acked inputs lands exactly on the prediction, a correction
  never pops the avatar and settles, world deltas apply once, the buffer is bounded.
- **Network status** (`client/src/net.test.ts`) — a fake WebSocket asserts "online" means the server
  accepted the join: not on socket open, not after a rejection, and no gameplay traffic before it.
- **Client cache + DOM** (`client/src/save.test.ts`, `client/src/ui/inventory.test.ts`) — the
  localStorage cache (empty/corrupt storage, round-trip) and the inventory panel's row builder under
  happy-dom (the ore-icon factory is injected so tests don't touch canvas).

## The content gate (missing)

> **This is a known gap, not a decision.** `tools/verify.ts` used to prove _"a greedy bot reaches
> Mythril within a sane budget."_ That claim was coin-economy-shaped, so deleting the economy left
> it testing nothing real — and it was **deleted rather than replaced**. What went with it is the
> guarantee that **no broken content can ship without a human playing every world**, which is a
> standing violation of the workspace rule on automating content verification.

### What the old gate got right and wrong

- **The bias was real.** A _greedy, optimal_ bot on a _single_ seed proves the best case is
  survivable. It says nothing about a normal player on an unlucky world — it answers "is this
  possible?" when the useful question is "is this _reliably_ good?"
- **Determinism was never the flaw — it's the enabling property.** The world is `f(seed, c, r)`;
  that's precisely what makes content verifiable at all. The fix isn't less determinism, it's
  **more seeds and worse players**: hundreds of seeds, deliberately imperfect agents, asserting
  **invariants** rather than replaying one perfect run. Failures report as a **failing seed**, which
  is reproducible by construction.
- **Vitest is a runner, not a replacement.** The valuable thing was the _claim_. The gate should
  become a test here, not disappear into the suite.

### The claims it should make

The [biome roster](BIOMES.md) makes these crisp for the first time — the old depth-range assertions
couldn't express any of them:

| Claim                                                                                                          | Blocked on                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **All 16 biomes generate in every world**, non-unique pockets at the promised per-player density               | Biomes ([#27](https://github.com/inman-sebastian/agent-games/issues/27))                   |
| **Every material is obtainable in at least one biome** (never "every biome has every material")                | Biomes                                                                                     |
| **Every _required_ material is reachable by a fresh character in a fresh world**                               | Biomes + the crafting tree ([#6](https://github.com/inman-sebastian/agent-games/issues/6)) |
| **Slot count grows more slowly than the item roster** — or "equip the best set" wins and the loadout loop dies | Equipment ([#6](https://github.com/inman-sebastian/agent-games/issues/6))                  |
| **No trap** — asserted as the three cases that actually have teeth                                             | Bounded world, fluid, gated structures                                                     |

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
([#46](https://github.com/inman-sebastian/agent-games/issues/46)). Asserting the _broken_ invariant
with `it.fails` bought three things:

- The suite **stayed green** (`88 passed | 1 expected fail`), so the gate wasn't broken for everyone.
- The bug was **on record as executable code**, not just as an issue.
- When #46 was fixed the test **started failing**, forcing the fixer to deal with it. It cleaned
  itself up, exactly as designed.

**And then it argued with its own premise, which is the more interesting half.** The retired test
asserted that registry order should agree with _depth_ order. Fixing the bug properly showed that
premise was wrong: depth says where a material is, not how special it is. Quartz is deeper than gold
and far more plentiful. A depth-ordered rarity would also have been built on the placement system,
which is itself being demoted from depth-only ([BIOMES.md](BIOMES.md)). So the replacement asserts
what actually matters — that rarity is authored, that the top tier is held alone, that shallow
material never reaches the celebration tier, and that rarity and depth are _allowed to disagree_.

The lesson to carry: an `it.fails` records a bug faithfully, but it also freezes whatever theory you
had when you found it. Re-derive the invariant when you fix it rather than flipping the assertion.

That's red-before-green without holding CI hostage, and it's the recommended shape for any invariant
discovered ahead of its fix.

## Not covered here

- **How it looks** — canvas rendering isn't pixel-asserted in Vitest. Use `tools/shot.sh` for tight
  cropped renders (see [tools/README.md](../tools/README.md)). The exception is a rendering
  _invariant_ — see the chunk pipeline above, which is in the gate through a software canvas.
  Real-browser end-to-end testing is intentionally out of scope for the gate. For questions about the
  running game, `pnpm probe` answers in text; which tool to use when is the
  [`delve-testing`](../../../.claude/skills/delve-testing/SKILL.md) skill.
- **Interactive inspection** — `tools/sim.ts` (`pnpm sim map/probe/play`) stays as a CLI for
  eyeballing world-gen and scripted playthroughs; it's a tool, not a gate.

## Writing a test

- Co-locate as `<thing>.test.ts`; import `{ describe, it, expect }` from `vitest` (no globals).
- Prefer a **property** (`fc.assert(fc.property(...))`) over a fixed case whenever the thing should
  hold for _all_ inputs — bounds, determinism, conservation, "never happens" invariants. Put the
  `expect`s inside the property body (they throw on failure); the property callback should return
  nothing.
- **Give it teeth:** before trusting a new invariant test, break the code it guards and confirm the
  test goes red (a property that passes against a real bug is worse than none — see the ore-break
  conservation test, added precisely because the straight-down fuzz rarely hit ore).
