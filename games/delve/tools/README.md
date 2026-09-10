# DELVE dev tools

Cheap headless verification so we don't lean on browser automation (Playwright) for
everything — big token savings. All driven from the shell.

## `verify.js` — the balance gate

Drives a greedy bot through the SAME engine the player uses and asserts it reaches
every ore tier down into Mythril within a sane action budget, plus static invariants
on the ore table, cost curves, and world gen. Run it after any logic / economy /
world-gen change:

```sh
pnpm verify          # from games/delve/ (or the workspace: pnpm --filter delve verify)
node tools/verify.js # equivalent, from games/delve/
```

## `sim.js` — headless sim & world inspection (no browser, no images)

Runs the SAME pure engine the game uses (`scripts/engine.js`), so any logic / world-gen
/ economy / cluster question is answerable in text.

```sh
node tools/sim.js state  [--seed N] [--from save.json]      # raw state as JSON
node tools/sim.js probe  --seed N --c C --r R               # tileInfo at one cell
node tools/sim.js map    --seed N [--c C --r R --w W --h H] # ASCII ore/cluster map
node tools/sim.js play   --seed N --do "d40 r5 d40" [--from save.json]
```

- `map` prints an ASCII grid of the static world (`.` rock, letters = ore tiers) plus
  ore-coverage % and per-tier counts — ideal for eyeballing cluster shape/size/density.
- `play` runs an action script (tokens `<dir><count>`, dir ∈ u/d/l/r) and dumps the
  resulting state + a mined-ore summary — ideal for pacing/economy checks.
- `--from` loads a save JSON (merged over `newGame`, like the game) to inspect/continue
  a specific state.

## `render.html` + `shot.sh` — precise cropped renders (no MCP)

`render.html` draws EXACTLY one world region through the shared render modules into a
canvas sized to the crop. `shot.sh` screenshots it with headless Chrome to a tight PNG
you then `Read` locally — no Playwright, and the image is only as big as the thing you
want to see.

```sh
tools/shot.sh 'c=41&r=100&w=16&h=12&scale=3&cave=shaft'          # → /tmp/delve-shot.png
tools/shot.sh 'r=150&w=14&h=10&scale=3&cave=none&lamp=0' out.png  # raw ore-block art
```

Query params (all optional): `seed`, `c`,`r` (centre tile), `w`,`h` (region in tiles),
`scale` (px per art px), `cave` (`shaft`|`none`), `lamp` (1 apply lighting / 0 raw art),
`miner` (0/1), `vision` (lamp reach). Window size is derived from `w`/`h`/`scale`, so the
PNG is exactly the crop.

**Rule of thumb:** reach for `sim.js` first (free); only render a crop when you truly
need to see pixels, and keep `w`/`h`/`scale` small.
