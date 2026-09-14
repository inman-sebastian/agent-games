# DELVE dev tools

Interactive, shell-driven dev tools for **inspecting** the game and its renders. **Which one to
reach for is decided by the [`delve-testing`](../../../.claude/skills/delve-testing/SKILL.md) skill** —
this file is the reference for how each one works. Playwright / browser MCP is the last resort
there, behind a written reason; these answer almost every question in text or a tiny cropped PNG.

> **Automated testing is separate.** The gate is `pnpm test` (Vitest — sim/world-gen fuzz,
> the client↔server protocol e2e, and DOM). See [`docs/TESTING.md`](../docs/TESTING.md). The
> tools below are for _inspection_, not gating; the retired `verify.ts` / `server-check.ts`
> scripts are now Vitest suites.

## `import-aseprite.ts` — lift layered frames out of a `.aseprite` file

```sh
pnpm --filter delve exec tsx tools/import-aseprite.ts <pack-root>
pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> out.png [--scale 3] [--template]
```

Reads the layers directly — no Aseprite install, no intermediate export — normalises layer names to
DELVE's slots, maps every colour to an index in one shared template palette, and writes committed
modules under `client/src/render/entity/sprites/`. Driven by
[`sprite-manifest.ts`](sprite-manifest.ts), which is also where the pack animations deliberately
**not** imported are recorded, with reasons. **It verifies before it writes and refuses on a mismatch**: the
emitted data is decoded back and diffed pixel for pixel against both the file's own layers and its
sibling PNG export.

`sprite-shot.ts` renders any imported animation to a PNG with no browser and no dev server, which is
how an import gets checked; `--template` shows the pack's raw code colours rather than the authored
skin. `client/labs/sprite-lab.html` is the interactive version, with per-layer
visibility and recolouring.

Adding another entity — an enemy, an NPC, a prop — is one entry in
[`sprite-manifest.ts`](sprite-manifest.ts) and a re-run. Slots are declared per entity; the template
palette is shared, so a skin or material authored once applies across entities.

Full pipeline, format and the open questions: [`docs/SPRITES.md`](../docs/SPRITES.md). The
step-by-step procedure is the `delve-import-sprites` skill.

## `sim.ts` — headless sim & world inspection (no browser, no images)

Runs the SAME pure engine the game uses (`shared/src/engine.ts`), so any logic / world-gen
/ cluster question is answerable in text.

```sh
node tools/sim.ts state  [--seed N] [--from save.json]      # raw state as JSON
node tools/sim.ts probe  --seed N --c C --r R               # the block descriptor at one cell
node tools/sim.ts map    --seed N [--c C --r R --w W --h H] # ASCII ore/cluster map
node tools/sim.ts play   --seed N --do "d600 r120" [--from save.json]
```

- `map` prints an ASCII grid of the static world (`.` rock, letters = ore tiers) plus
  ore-coverage % and per-tier counts — ideal for eyeballing cluster shape/size/density.
- `play` runs an action script through the platformer physics (tokens `<key><frames>`,
  key ∈ d = mine down / l = run left / r = run right / u = jump; frames are 1/60s) and
  dumps the resulting state + a mined-material summary (`held` + per-type `mined`) — ideal
  for pacing/collection checks.
- `--from` loads a save JSON (merged over `newGame`, like the game) to inspect/continue
  a specific state.

The authoritative-server roundtrip that used to live here (`server-check.ts`) is now the
`server/src/protocol.e2e.test.ts` Vitest suite (run by `pnpm test`).

## The debug overlay's frame breakdown — where a frame actually goes

`?debug` (or F3) prints a **per-pass cost breakdown**, which is the tool to reach for before
optimising anything in the renderer:

```
fps   120.0   frame 2.72ms
phase damage 0.0  twinkle 0.3  entities 0.0  lighting 2.3  gpu 1.2
light field 0.4ms  scrim 1.5ms
```

The render passes run in sequence, so one timestamp between each is enough. `light field` / `scrim`
split the lighting pass, because the two scale with completely different things (cells vs pixels) and
the split is the only way to tell which one a change actually hit.

Alongside it are per-pass toggles (`lighting`, `fog`, `twinkle`, `damage`) to isolate a pass by
switching it off.

**"The game feels slow" is not a diagnosis.** A frame budget read off this panel at the window size
that actually hurts is — the 2×2 split's regression turned out to be three passes computing things
they immediately discarded, which no amount of reading the code had suggested. Note that headless
Chrome caps rAF at ~30fps regardless of load, so read `frame`, not `fps`, unless you're on real
hardware.

The game renders through WebGPU (#77), so the `phase` line has `gpu`: building and submitting the GPU frame,
including the overlay upload. A `renderer` line names the path and adapter, the GPU's finish time, and
the world window's size and version (the version moves on every dig and every window shift):

```sh
pnpm probe index.html --size 3400x1900 --play --do "key:ArrowRight:4000" --grep "^(fps|phase|renderer)"
```

## `probe.ts` — the running game, as text (no MCP)

`pnpm probe <page> [flags]` runs a page in headless Chrome, drives it with **trusted** input over the
DevTools protocol, and prints JSON. It fills the gap between `shot.sh` (pixels) and a browser MCP
session: before it, any question that needed a number from the live game — frame time, net status,
where the player ends up after holding a key, a lab's verdict — could only be answered with
Playwright, which is why "Playwright is a last resort" kept being broken. Needs `pnpm dev`
(`PROBE_BASE` to point elsewhere; `CHROME` to pick the binary).

```sh
pnpm probe index.html --play --grep "^(fps|phase|light field)"
pnpm probe index.html --size 3400x1900 --play --wait 4000 --grep "^(fps|phase)"
pnpm probe index.html --play --do "key:ArrowRight:1200 wait:300" --grep "^pos"
pnpm probe index.html --play --do "aim:0,2:400 aim:-1,2:400 wait:500" --grep "^(pos|save)"
pnpm render-gate   # = probe labs/gpu-lab.html --eval "gpuLab.gate()" --assert "document.title === 'PASS'"
```

| Flag                      |                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--play`                  | skip the title screen (`?play=1`)                                                                                                                            |
| `--debug`                 | open the debug panel (implied by `--overlay`, `--grep` and `aim:` steps)                                                                                     |
| `--size WxH`              | viewport in CSS px, default 1280x800                                                                                                                         |
| `--wait ms`               | settle after load, before steps (default 2500)                                                                                                               |
| `--do "steps"`            | `key:<code>:<ms>` · `tap:<code>` · `click:<selector>` · `mouse:<x>,<y>:<ms>` · `aim:<dc>,<dr>:<ms>` (pointer on a cell relative to the player) · `wait:<ms>` |
| `--overlay` / `--grep re` | the debug overlay's lines, all or matching                                                                                                                   |
| `--eval js`               | an expression evaluated in the page (repeatable); its JSON value is printed                                                                                  |
| `--assert js`             | evaluated after the evals; probe exits 1 unless its value is exactly `true` — how a lab verdict becomes a failing command                                    |
| `--shot file`             | a PNG of the viewport after everything else — the capture route for WebGPU pages                                                                             |
| `--no-gpu`                | launch Chrome without WebGPU, to see what a player without it sees                                                                                           |

Each run is a fresh browser profile, so a fresh player id and therefore a fresh world. Page errors
thrown during the run are reported as `pageErrors`. If it can't express something you need, extend
it — that is the point of having it.

## `client/labs/render.html` + `shot.sh` — precise cropped renders (no MCP)

`client/labs/render.html` draws EXACTLY one world region through the shared render modules
into a canvas sized to the crop. `shot.sh` screenshots it with headless Chrome to a tight
PNG you then `Read` locally — no Playwright, and the image is only as big as the thing you
want to see. The pages are ES modules, so `shot.sh` needs a running dev server: start
`pnpm dev` and point `SHOT_BASE` at it (e.g. `SHOT_BASE=http://localhost:5199`).

```sh
SHOT_BASE=http://localhost:5199 tools/shot.sh 'c=41&r=100&w=16&h=12&scale=3&cave=shaft'          # → /tmp/delve-shot.png
SHOT_BASE=http://localhost:5199 tools/shot.sh 'r=150&w=14&h=10&scale=3&cave=none&lamp=0' out.png  # raw ore-block art
```

Query params (all optional): `seed`, `c`,`r` (centre cell), `w`,`h` (region in CELLS — 8 art px each since the 2x2 split, so `shot.sh` sizes the window as `w × 8 × scale`; override with `CELL_PX`),
`scale` (px per art px), `cave` (`shaft`|`none`), `lamp` (1 apply lighting / 0 raw art),
`miner` (0/1), `lamp` (lamp reach — crank it high to saturate the lighting). Window size
is derived from `w`/`h`/`scale`, so the PNG is exactly the crop.

`shot.sh` takes an optional third arg — the **page** to shoot, a path under the Vite root
(client/), default `labs/render.html` — so it also captures the style lab, the light lab and the
material lab headlessly:

```sh
SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=40&h=24&scale=2' /tmp/lights.png labs/light-lab.html  # the light lab
SHOT_BASE=http://localhost:5199 tools/shot.sh 'view=cave&ui=0&mat=platinum&depth=280&w=14&h=10&scale=3' /tmp/mat.png labs/material-lab.html  # a material in a cave
```

### Shooting the real game

Not with `shot.sh`: its Chrome runs with `--disable-gpu`, and the game renders only through WebGPU
(#80 retired the `?renderer=2d` switch that used to make this work), so it would capture the WebGPU
required screen. Use probe, which has a real GPU adapter; `--play` skips the title screen:

```sh
pnpm probe index.html --play --shot /tmp/game.png
```

Headless Chrome starts on a fresh profile, so this is always a new world at the surface — good for
checking lighting, terrain and the HUD, useless for checking saved state. It does not unlock audio;
that needs a real user gesture.

## `client/labs/gpu-lab.html` — the WebGPU spike, CPU and GPU side by side

One carved screen of the real world through the Canvas 2D renderer and through the WebGPU pipeline
(`client/src/render/gpu/`). `?mode=gpu|cpu|diff`, `?light=0` for the rock alone, `?pan=1` to keep the
camera moving, `?c=&r=` for the world cell at the centre. The HUD shows each path's frame cost; `diff`
reads the GPU frame back and heat-maps where it differs from the CPU frame. Ask it through probe:

```sh
pnpm probe 'labs/gpu-lab.html?light=0' --wait 3000 --eval "gpuLab.runDiff().then(s => JSON.stringify(s))"
pnpm probe 'labs/gpu-lab.html?mode=gpu&pan=1' --size 3400x1900 --wait 8000 --eval "JSON.stringify(gpuLab.cost())"
pnpm probe 'labs/gpu-lab.html' --wait 3000 --shot /tmp/gpu.png      # shot.sh can't capture WebGPU
pnpm probe index.html --no-gpu --eval "document.body.dataset.app"   # 'unsupported': the WebGPU required screen
```

## `pnpm render-gate` — the GPU against its reference

`gpuLab.gate()` diffs the WebGPU renderer against `composeBand` over a fixed set of strata views and
one view per registered ore material, and fails on drift past measured tolerances. What it checks,
its thresholds and why they are fractions: [RENDERING.md](../docs/RENDERING.md#the-render-gate-80).

```sh
pnpm dev            # in another terminal
pnpm render-gate    # exits 1 on FAIL
```

It is `probe labs/gpu-lab.html --wait 3000 --eval "gpuLab.gate()" --assert "document.title === 'PASS'"`,
so the printed JSON is the gate's result:

- **`failures`** — empty on a pass; otherwise one line per broken check, naming the view (label,
  column,row, lit or unlit) and the fraction that fell below its bar, or `no view drew a twinkle
glint`, or the GPU error.
- **`views`** — every view with its `identical` and `withinSmall` (within 8 levels) percentages and
  its `glints` pixel count. A material's view is labelled with its name, so a drifting WGSL twin
  points at itself.

To look at a failing view, open `labs/gpu-lab.html?mode=diff&c=<column>&r=<row>` (add `&light=0` for
an unlit one), or `--shot` it through probe. **Red-check a change to the gate** by breaking a WGSL
twin (return grey from its lit faces) and watching that material's view fail, then restore it.

## `client/labs/material-lab.html` — per-material inspector

Every material (rock + all ores) rendered through the **same** compositor the game uses. A sidebar
grid selects the material; the right shows its **surface** (top-lit block) and a **cave system**
where several materials feather into rock and each other, lamp-lit with twinkle animating. It's the
dedicated harness for authoring/tuning a material without driving Playwright. Fully URL-driven:
`mat=<slug>` (lowercased name, no spaces), `view=surface|cave|both`, `depth=<row>`, `scale`
(defaults to 2×, the game's scale), `lit=0|1`, `seed` (the **↻ seed** button randomises the cave
shape _and_ ore), `w`/`h`. `ui=0` renders one bare preview at the top-left framed by shot.sh's
`w`/`h`/`scale`, and the cave view auto-centres on a vein of the selected material — so a single
`shot.sh` shows any material in situ. See the `delve-new-material` skill for the authoring loop.

## `client/labs/light-lab.html` — colored-light blending sandbox

A live scene that drives the real lighting system with several coloured emitters over a
rock chamber, so you can see how lights blend (additive per-channel, max-propagated
flood-fill), how occluders shadow, and how the additive cap reads. Open it in a browser,
or `shot.sh` a frame. Keys: **H** toggle hue-preserving vs per-channel cap · **Space** pause
· **O** toggle occluders.

**Rule of thumb:** a question about a rule is a failing test; about the world, `sim`; about a look,
a small `shot.sh` crop; about the running game, `probe`. A browser MCP session only after writing why
none of those can answer it — the full ladder is the `delve-testing` skill.
