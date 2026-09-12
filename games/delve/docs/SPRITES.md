# Character sprites

How DELVE's non-block entities are drawn. Blocks and materials are unaffected — they stay fully
procedural; see [MATERIALS.md](MATERIALS.md) and [RENDERING.md](RENDERING.md).

## Status: proposed, not ratified

**This contradicts two standing rules and needs an explicit decision before it ships.**

- The workspace rule in the root `CLAUDE.md`: _"Create every asset yourself… never use found
  images as game assets."_
- DELVE's own pillar, stated at the outset: _"all art in this game is generated procedurally."_

Character art here is **imported from a purchased third-party asset pack**, not authored. That is a
deliberate change of direction after five rounds of procedural character work (see below), and it is
the author's call to make, not the agent's. Two things to settle:

1. **Do the rules change, or does this approach go?** If it stays, `CLAUDE.md` and the design pillar
   should be amended to say "world art is procedural; character art is imported", so the docs stop
   contradicting the code.
2. **Does the pack's licence permit it?** Most itch.io packs allow use in a game but prohibit
   redistributing the raw assets. The `.aseprite` sources are deliberately **not** committed, but the
   imported pixel data is, and this repository is not private. Worth reading the licence before this
   merges.

## Why this instead of the procedural rig

The procedural rig is parked on `main` (issue #47). It built a real skeleton with two-bone IK,
authored width-profile strokes, and three independent measurements against the pack. It reached:

| measure              | result                    |
| -------------------- | ------------------------- |
| per-part shape error | 1.20 reference px per row |
| walk pose error      | 1.54 reference px per row |
| silhouette overlap   | 73%                       |

And it still did not read as the same character. Each round fixed one measured quantity and moved
another, because a parametric skeleton approximating hand-placed pixels is a large coupled search
with no exact solution in it. The frames themselves are exact by definition, so the frames won.

What survives from that work and is still worth keeping: the measurement tools
(`tools/rig-measure.ts`, `rig-overlay.ts`, `rig-fit.ts`), which now serve as the yardstick for any
future procedural entity, and the finding that drove this change — that bounding boxes and even
per-row profiles can all agree while a figure is visibly wrong.

## The format

A sprite pixel does **not** store a colour. It stores an **index into its layer's ramp**.

That is the pixel-mapping idea from the UV-encoding devlog applied to a 2D sprite: the frame says
_where to look_, and what it finds there is swappable. One set of frames therefore serves every skin
tone, every armour set and every material, because re-skinning a body part is substituting that
layer's ramp — the same trick the material system already uses for rock.

```
SpriteAnim
  name, w, h, frames, durations[]
  layers[]            bottom-to-top paint order
    name              a slot (see below)
    palette[]         '#rrggbb' — swap this to re-skin the part
    cels[]            one per frame, or null where the layer is empty
      x, y, w, h
      data            w*h indices, base64. 0 = transparent, n = palette[n-1]
```

Runtime is [`client/src/render/entity/sprite.ts`](../client/src/render/entity/sprite.ts):
`drawSprite(img, anim, frame, originX, originY, { scale, flip, skin, tint })`. The origin is the
sprite's **bottom-centre**, so a frame drops onto a ground contact point without an offset — the same
contract the rig used.

Two rules the runtime enforces:

- **Integer scale only.** A sprite is never resampled. Pixel art scaled by 1.5 has soft edges no
  palette can fix.
- **Flip indices, not pixels.** Mirroring is applied while reading the source, so a flipped frame is
  exactly as crisp as an unflipped one.

## Slots

Layer names are normalised at import time to a fixed set, in paint order:

```
arm.far  leg.far  torso  leg.near  arm.near  head  weapon  fx.damage
```

This is load-bearing, not tidiness. Equipment overrides key on the layer name, so a chest piece that
fits the idle has to fit the walk too — and the pack calls the same body part `Back Arm` in one file,
`Back Hand` in another and `Left Arm` in a third. An un-normalised import would give one body part
three names across animations and silently break every override.

`weapon` exists because the pack already separates swords and guns onto their own layers, which is
the equipment pipeline for free. `fx.damage` is the pack's baked damage flash, kept as its own layer
rather than skipped so the import stays exact — a caller that wants to render the flash itself simply
does not draw that slot.

A layer that is empty in every frame is dropped rather than emitted with an empty palette.

## Importing

```sh
pnpm --filter delve exec tsx tools/import-aseprite.ts <file.aseprite> <EXPORT_NAME> \
  [--skip a,b] [--keep-strays] [--allow-unknown-layers] [--trust-source]
```

Reads the layered `.aseprite` directly — no Aseprite install, no intermediate export. Output goes to
`client/src/render/entity/sprites/` and is committed; the `.aseprite` sources are not.

**It verifies before it writes, and refuses on a mismatch.** The emitted data is decoded back,
composited, and compared pixel for pixel against the file's own layers. When a sibling PNG export
exists it is diffed too, which catches the errors a self-consistent round trip cannot. The pack is
inconsistent across its forty-odd files and every flag below exists because a real file needed it:

| symptom                              | meaning                                                 | flag                                        |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------- |
| pixels we have, the export lacks     | stray marks on a layer the artist hid                   | dropped by default; `--keep-strays` to keep |
| same pixels, different colours       | layer opacity or a blend mode, which the reader ignores | `--trust-source` keeps the layer unblended  |
| differences both ways, spread evenly | the PNG export is older than the `.aseprite`            | `--trust-source`                            |
| a layer maps to no slot              | add a `SLOTS` pattern                                   | `--skip` it, or `--allow-unknown-layers`    |

## Checking your work

```sh
pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> out.png [--scale 3] [--flip] \
  [--skin torso=#4d9be6] [--hide fx.damage]
```

Renders any imported animation to a PNG with no browser and no dev server. For the interactive
version — every animation playing, per-layer visibility, per-layer recolouring — use
`client/labs/sprite-lab.html`.

`tools/sprites.test.ts` is the gate. It does not re-check fidelity, since the importer already
proved that; it guards what can rot afterwards: a module added and forgotten in the registry, a
hand-edit to generated data, an index outside its palette, a layer name that drifts.

## What is not solved yet

- **Scale.** The pack's figure is 29px tall on a 48px canvas, about 1.8 tiles. DELVE committed to
  Terraria's 2×3 tiles. Drawing the sprite at 2× makes the character ~58px, which is not 3 tiles
  either. This needs a decision, and it is the same tension that made the procedural attempt hard.
- **Palette.** The pack's colours are its own, not Resurrect-64. Re-skinning every layer to the
  game's palette is a ramp table, not new art, but it has to be authored.
- **Shading.** The pack's parts are flat single colours, so a substituted ramp is flat too. Armour
  with DELVE's banded top-lit look needs more indices per part than the pack provides, which means
  authoring shading detail on top of the imported silhouettes.
- **Animations the pack flattened.** Slide, Dash, Katana Walk, side Climb and running Shoot have no
  per-part layers and cannot be imported into this format as-is.
