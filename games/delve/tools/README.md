# DELVE dev tools

Interactive, shell-driven dev tools for **inspecting** the game and its renders. **Use these
(and the tests) first — Playwright / MCP is a last resort.** Reading browser-automation
screenshots (especially full-viewport or hi-DPI) is slow and burns tokens; these answer almost
every question in text or a tiny cropped PNG.

> **Automated testing is separate.** The gate is `pnpm test` (Vitest — sim/world-gen fuzz,
> the client↔server protocol e2e, and DOM). See [`docs/TESTING.md`](../docs/TESTING.md). The
> tools below are for _inspection_, not gating; the retired `verify.ts` / `server-check.ts`
> scripts are now Vitest suites.

## `rig-measure.ts` — how close the humanoid is to its reference, in numbers

```sh
pnpm --filter delve exec tsx tools/rig-measure.ts                       # the comparison table
pnpm --filter delve exec tsx tools/rig-measure.ts --parts               # + every part in isolation
pnpm --filter delve exec tsx tools/rig-measure.ts --png /tmp/rig.png    # idle + 8 walk frames, 4x
pnpm --filter delve exec tsx tools/rig-measure.ts --png /tmp/rig.png --shaded   # textured, not coded
```

Renders the rig in **coded mode** (each part flat-filled in its reference colour), groups pixels by
colour, and prints each part's top, bottom and width against the measurements taken off the
purchased reference pack — converted into _reference_ pixels, so a delta reads as "how many pixels
of the art it was measured from". Each part is measured with nothing else drawn, because the
reference's numbers come from unclipped layers and the arms otherwise hide the torso's edge.

**No browser.** It feeds `drawRig` a plain buffer and writes PNGs through `zlib`, so judging a
silhouette never needs a dev server or a screenshot. `--png` is the one to read when a number looks
right but the shape doesn't.

## `rig-overlay.ts` / `rig-fit.ts` — the overlap measurement, and fitting against it

```sh
pnpm --filter delve exec tsx tools/rig-overlay.ts ~/pack/Idle/'Player Idle 48x48.png'
pnpm --filter delve exec tsx tools/rig-fit.ts     ~/pack/Idle/'Player Idle 48x48.png'
```

`rig-overlay.ts` is the measurement that should have come first: intersection-over-union of our
silhouette against the reference's own frame, plus an ASCII map of exactly where the two disagree
(`#` both, `O` ours only, `R` reference only). Extents and even per-row profiles can agree while the
figure is still visibly wrong; "how many of the same pixels are lit" cannot be gamed.

`rig-fit.ts` runs coordinate descent on that overlap over the PLACEMENT knobs — offsets, splays,
lean, joint leads — and prints the result. Shapes are authored profiles and are not fitted. It
optimises a single frame, so it will trade a small part's accuracy for a large one's: it zeroed the
far arm's angle and collapsed the foot to nothing, because neither costs many pixels. Pin whatever
the gait needs, and re-run `pnpm test` after — the walk invariants are what catch an idle-only win.

Both need the **purchased** reference pack, which is not committed (all game art is authored). They
shell out to `python3` with Pillow to decode the PNG.

The measurements themselves live in [`rig-reference.ts`](rig-reference.ts), shared with
[`rig.test.ts`](rig.test.ts) — so the report and the gate can't disagree about what "close" means.
For _tuning_ rather than checking, use `client/labs/rig-lab.html`, which binds every value in
`render/entity/config.ts` to a live slider over an animating figure.

## `sim.ts` — headless sim & world inspection (no browser, no images)

Runs the SAME pure engine the game uses (`shared/src/engine.ts`), so any logic / world-gen
/ cluster question is answerable in text.

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
  dumps the resulting state + a mined-material summary (`held` + per-type `mined`) — ideal
  for pacing/collection checks.
- `--from` loads a save JSON (merged over `newGame`, like the game) to inspect/continue
  a specific state.

The authoritative-server roundtrip that used to live here (`server-check.ts`) is now the
`server/src/protocol.e2e.test.ts` Vitest suite (run by `pnpm test`).

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

Query params (all optional): `seed`, `c`,`r` (centre tile), `w`,`h` (region in tiles),
`scale` (px per art px), `cave` (`shaft`|`none`), `lamp` (1 apply lighting / 0 raw art),
`miner` (0/1), `lamp` (lamp reach — crank it high to saturate the lighting). Window size
is derived from `w`/`h`/`scale`, so the PNG is exactly the crop.

`shot.sh` takes an optional third arg — the **page** to shoot, a path under the Vite root (client/)
(client/), default `labs/render.html` — so it also captures the style lab, the light lab, or
the game headlessly:

```sh
SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=40&h=24&scale=2' /tmp/lights.png labs/light-lab.html  # the light lab
SHOT_BASE=http://localhost:5199 tools/shot.sh 'view=cave&ui=0&mat=platinum&depth=280&w=14&h=10&scale=3' /tmp/mat.png labs/material-lab.html  # a material in a cave
SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=30&h=18&scale=2' /tmp/game.png index.html             # the game itself
```

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

**Rule of thumb:** run `pnpm test` and reach for `sim.ts` first (free, text); render a crop only
when you truly need pixels, and keep `w`/`h`/`scale` small. Playwright only as a last
resort.
