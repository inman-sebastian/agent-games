# Character sprites

How DELVE's non-block entities are drawn. Blocks and materials are unaffected — they stay fully
procedural; see [MATERIALS.md](MATERIALS.md) and [RENDERING.md](RENDERING.md).

## Status: decided

Character art is **imported from a purchased third-party asset pack**; world art stays fully
procedural. The pack is licensed for use in games (confirmed by the author, who purchased it). The
`.aseprite` sources are not committed; the imported pixel data is.

This narrows a rule rather than dropping it. The root `CLAUDE.md` says every asset is authored in
code, and DELVE's original pillar said all art is generated procedurally. Both now read as **world
art is procedural, character art is imported and skinned** — and the skinning is the part that is
still authored, which is not a technicality. The pack ships a colour-coded _template_: its pixels are
code colours identifying body parts, so every colour the player sees is decided in
[`client/src/render/entity/skin.ts`](../client/src/render/entity/skin.ts) on Resurrect-64. The pack
gives silhouettes and motion; DELVE gives the art direction.

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
TEMPLATE_PALETTE[]    every code colour across every animation — ONE shared table

SpriteAnim
  name, w, h, frames, durations[]
  ground              the canvas row the feet stand on
  layers[]            paint order, bottom to top, as the source file had it
    name              a slot (see below)
    cels[]            one per frame, or null where the layer is empty
      x, y, w, h
      data            w*h indices, base64. 0 = transparent, n = TEMPLATE_PALETTE[n-1]

SpriteSkin
  colors[]            one replacement per template colour, or null to keep it
  hide[]              slots not to draw
  tint                override every pixel — silhouettes, flashes
```

**The palette is global, not per layer,** and that was a bug worth fixing rather than a design
preference. Built per animation, index 1 meant `#76428a` in one animation and `#c46423` in another,
so any override keyed on it was wrong depending on what was playing. Mapping by colour across the
whole set also absorbs the pack's own layering slop: a few animations paint a stray head-coloured
pixel onto an arm layer, and mapped globally those pixels still come out the right colour.

Each body part carries **two to five shades**, not one flat colour, so a substituted ramp is properly
shaded. `TEMPLATE_PARTS` in `skin.ts` records which part each code colour belongs to and where it
sits in that part's ramp, measured by counting which slot every colour actually lands on across all
fifteen animations.

**`ground` is one shared row, not per animation.** It is a property of the pack's canvas: every file
draws on the same 48px canvas and the grounded animations all bottom out on row 39. Deriving it per
animation as the modal lowest row gave 44 for jump and 38 for push, which would have made the
character jump _downward_ and float while pushing. The importer asserts the grounded animations agree
with it.

**Paint order follows the source file,** not a house order. Re-sorting to a canonical order broke
fidelity: the Run file paints its torso above the near leg where every other animation paints it
below. Equipment only needs the layer _names_ to be consistent, which normalisation guarantees.

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
pnpm --filter delve exec tsx tools/import-aseprite.ts <pack-root>
```

Reads the layered `.aseprite` files directly — no Aseprite install, no intermediate export. Which
files, and with which per-file exceptions, is [`tools/sprite-manifest.ts`](../tools/sprite-manifest.ts);
it also records the pack animations deliberately **not** imported and why, so a gap is a decision on
record rather than an oversight. Output goes to `client/src/render/entity/sprites/` and is committed;
the `.aseprite` sources are not.

It runs as a **batch** because the template palette is shared — see above.

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
  [--template] [--hide fx.damage]
```

`--template` draws the pack's raw code colours instead of the authored skin, which is the view for
checking an import or working out which colour is which part.

Renders any imported animation to a PNG with no browser and no dev server. For the interactive
version — every animation playing, per-layer visibility, per-layer recolouring — use
`client/labs/sprite-lab.html`.

`tools/sprites.test.ts` is the gate. It does not re-check fidelity, since the importer already
proved that; it guards what can rot afterwards: a module added and forgotten in the registry, a
hand-edit to generated data, an index outside its palette, a layer name that drifts.

## The pixel-mapping pipeline

Two dimensions of the same idea, and the second is what makes equipment possible.

**One dimension — a colour table.** A pixel's index resolves through a skin's `colors[]`. Cheap, and
enough for skin tone, a shirt colour, a palette swap. Its ceiling is hard: the source template
carries two to five shades per part, so a colour table can never show more than that.

**Two dimensions — a surface coordinate.** A pixel also resolves to `(along, around)` on its body
part's surface, and a **material** samples that:

```
along    0 at the part's start along its dominant axis, 1 at its end
around  -1 at one silhouette edge, +1 at the other, 0 on the spine
depth    0 at the silhouette, 1 deepest inside
normal   outward, from the gradient of the distance field
```

Those feed a `PartCtx` — the same structure the procedural rig used — so `materials: { torso: … }`
on a skin takes one of the shared part surfaces and shades from the same `colorsFor` swatches and
Bayer dither as the rock. A steel pauldron is the metal material, not an imitation of it. The band
count stops being a property of the imported art, which is what dissolves the shade-count ceiling.

It also means **features are placed by position, not by colour** — a trim at `along > 0.8`, a belt
across the torso, a boot below the shin's midpoint. Authored once, they fit all fifteen animations,
because the coordinates are derived per frame from that frame's own silhouette. No per-animation work
at all.

How the coordinates are derived, in [`surface.ts`](../client/src/render/entity/surface.ts):
`along` and `around` come from scanning the part's **dominant axis** — rows for a tall part, columns
for a wide one, so a foot or an outstretched arm is measured along its length rather than across it.
`depth` and the normal come from a **chamfer distance transform** of the part mask rather than an
assumed limb axis, so a fist, a thigh and a curled-up roll pose all shade correctly without anyone
declaring which way they point. Derived on first draw and cached, so it costs nothing per frame and
adds nothing to the committed data.

**The light is a POSITION, in the sprite's own pixels.** A material's relief is computed against it,
per pixel, so the direction varies across the body:

```
PLAYER_LAMP           the carried lamp — chest height, short reach
lampFrom(dx, dy)      an external light, for an entity the player lights from outside
OVERHEAD              a plain fixed overhead light
```

A position rather than a direction because both interesting cases are radial. The player **carries**
the lamp — the game seeds its emitter at the player's own centre — so an overhead light is wrong in a
specific, visible way: the body should radiate from the lamp and fall off toward the boots. An enemy
is lit from outside, from somewhere off its own canvas, so one vector cannot describe it either.

Two rules here were each arrived at by getting them wrong first.

Distance **flattens the relief toward mid**, it does not darken toward black. The material owns form;
darkness is the lighting pass's job, compositing over the whole frame after the character is drawn.
Multiplying brightness down here made a lamp-lit figure read dimmer than the same figure lit from
overhead, which is the wrong relationship between the two systems.

Shading is computed in the sprite's **own** space, never the mirrored one — light position, pixel
position and surface normal all together. Mirroring the first two but not the normal flips the
lambert's sign, so a character that turned around was lit on the wrong side. Keeping it all in sprite
space also means the light is attached to the body and turns with it, which is what a carried lamp
does; a caller wanting a world-fixed light negates its x offset when the sprite is flipped.

**Materials for characters are calibrated separately.** Use `armourSurface` / `plateArmourSurface`
from `skin.ts`, not `clothSurface` / `plateSurface` from `limb.ts`. The latter were tuned against a
16px tile; pointed at a 3-5px imported limb, their noise swings across most of the band ladder and
the figure comes out as white speckle with its silhouette dissolved. Same lesson the procedural rig
learned about edge erosion — a treatment sized for a tile is most of a small part.

## Adding another entity

`ENTITIES` in [`tools/sprite-manifest.ts`](../tools/sprite-manifest.ts) is a list, and the importer
runs over all of it. An enemy, an NPC or a prop is one entry plus a re-run: a name, a pack
subdirectory, a ground row, a slot table and its animations. Slots are declared **per entity**,
because a spider is not a biped; `BIPED_SLOTS` is there to reuse for anything humanoid.

What stays global is the template palette, and therefore the whole skin and material pipeline — so a
material authored for the player's torso applies to any entity with a torso slot.

The step-by-step procedure, including how to read an import failure, is the
`delve-import-sprites` skill.

## What is not solved yet

- **Scale.** The pack's figure is 29px tall on a 48px canvas, about 1.8 tiles. DELVE committed to
  Terraria's 2×3 tiles. Drawing the sprite at 2× makes the character ~58px, which is not 3 tiles
  either. This needs a decision, and it is the same tension that made the procedural attempt hard.
- **The head is one part, so there is no helmet.** The miner's orange helmet cannot be expressed by
  re-skinning: the pack's head layer is a single silhouette including hair. A helmet needs an
  authored equipment layer drawn over the head, which is what the `weapon` slot's shape shows is
  possible.
- **Ramp tuning.** The shipped miner skin reads correctly but runs dark on the far side, and the
  steel material runs light. Both are lab jobs rather than code changes — `sprite-lab.html` edits
  every part's ramp live and switches between the flat and material modes.
- **The world light field does not reach the material.** Characters already darken correctly in unlit
  space, because `lighting.render` composites over the whole frame after they are drawn — the same
  post-pass the rock gets. What a material cannot see is the per-tile light field, so it cannot pick
  a darker BAND in a dim pool, only be scrimmed darker afterwards. The rock has exactly the same
  limitation (its own brightness is geometric, from distance to the nearest open edge), so fixing
  this is one change to both or neither.
- **Nothing reads the light position from the game yet.** `PLAYER_LAMP` is the carried lamp expressed
  in sprite space, but the game still draws the placeholder miner; wiring it up comes with the
  player-scale change.
- **Animations the pack flattened.** Slide, Dash, Katana Walk, side Climb and running Shoot have no
  per-part layers and cannot be imported into this format as-is.
