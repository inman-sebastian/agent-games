# DELVE dev tools

Cheap headless verification, all driven from the shell. **Use these first — Playwright /
MCP is a last resort.** Reading browser-automation screenshots (especially full-viewport
or hi-DPI) is slow and burns tokens; these tools answer almost every question in text or a
tiny cropped PNG. If something isn't covered, extend a tool rather than defaulting to
Playwright. (Only genuinely live questions — input feel, real FPS — need the browser, and
even then read the `?debug` overlay text, not screenshots.)

## `verify.ts` — the balance gate

Drives a greedy bot through the SAME engine the player uses and asserts it reaches
every ore tier down into Mythril within a sane action budget, plus static invariants
on the ore table, cost curves, and world gen. Run it after any logic / economy /
world-gen change:

```sh
pnpm verify          # from games/delve/ (or the workspace: pnpm --filter delve verify)
node tools/verify.ts # equivalent, from games/delve/
```

## `sim.ts` — headless sim & world inspection (no browser, no images)

Runs the SAME pure engine the game uses (`src/scripts/engine.ts`), so any logic / world-gen
/ economy / cluster question is answerable in text.

```sh
node tools/sim.ts state  [--seed N] [--from save.json]      # raw state as JSON
node tools/sim.ts probe  --seed N --c C --r R               # tileInfo at one cell
node tools/sim.ts map    --seed N [--c C --r R --w W --h H] # ASCII ore/cluster map
node tools/sim.ts play   --seed N --do "d600 r120" [--from save.json]
```

- `map` prints an ASCII grid of the static world (`.` rock, letters = ore tiers) plus
  ore-coverage % and per-tier counts — ideal for eyeballing cluster shape/size/density.
- `play` runs an action script through the platformer physics (tokens `<key><frames>`,
  key ∈ d = mine down / l = run left / r = run right / u = jump; frames are 1/60s) and
  dumps the resulting state + a mined-ore summary — ideal for pacing/economy checks.
- `--from` loads a save JSON (merged over `newGame`, like the game) to inspect/continue
  a specific state.

## `server-check.ts` — client/server protocol smoke test (no browser)

Spawns the **real** server (`server/index.ts`) against a throwaway data dir, then drives the
WebSocket protocol the way `src/net.ts` does and asserts the P2 store-of-record behaviour:
join → `hello{fresh}` seeded from the proposal, `sync` persisted + acked, reconnect →
`hello{fresh:false}` hydrating the synced progress, and a protocol-version mismatch rejected.
Exits non-zero on any failed assertion.

```sh
pnpm server:check
```

## `src/labs/render.html` + `shot.sh` — precise cropped renders (no MCP)

`src/labs/render.html` draws EXACTLY one world region through the shared render modules
into a canvas sized to the crop. `shot.sh` screenshots it with headless Chrome to a tight
PNG you then `Read` locally — no Playwright, and the image is only as big as the thing you
want to see. The pages are ES modules, so `shot.sh` needs a running dev server: start
`pnpm dev` and point `SHOT_BASE` at it (e.g. `SHOT_BASE=http://localhost:5199`).

```sh
SHOT_BASE=http://localhost:5199 tools/shot.sh 'c=41&r=100&w=16&h=12&scale=3&cave=shaft'          # → /tmp/delve-shot.png
SHOT_BASE=http://localhost:5199 tools/shot.sh 'r=150&w=14&h=10&scale=3&cave=none&lamp=0' out.png  # raw ore-block art
```

Query params (all optional): `seed`, `c`,`r` (centre tile), `w`,`h` (region in tiles),
`scale` (px per art px), `cave` (`shaft`|`none`), `lamp` (1 apply lighting / 0 raw art),
`miner` (0/1), `vision` (lamp reach — crank it high to saturate the lighting). Window size
is derived from `w`/`h`/`scale`, so the PNG is exactly the crop.

`shot.sh` takes an optional third arg — the **page** to shoot, a path under the Vite root
(`src/`), default `labs/render.html` — so it also captures the style lab, the light lab, or
the game headlessly:

```sh
SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=40&h=24&scale=2' /tmp/lights.png labs/light-lab.html  # the light lab
SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=30&h=18&scale=2' /tmp/game.png index.html             # the game itself
```

## `src/labs/light-lab.html` — colored-light blending sandbox

A live scene that drives the real lighting system with several coloured emitters over a
rock chamber, so you can see how lights blend (additive per-channel, max-propagated
flood-fill), how occluders shadow, and how the additive cap reads. Open it in a browser,
or `shot.sh` a frame. Keys: **H** toggle hue-preserving vs per-channel cap · **Space** pause
· **O** toggle occluders.

**Rule of thumb:** reach for `sim.ts`/`verify.ts` first (free, text); render a crop only
when you truly need pixels, and keep `w`/`h`/`scale` small. Playwright only as a last
resort.
