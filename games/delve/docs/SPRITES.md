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

## Why this instead of a procedural rig

A procedural character rig was built first and is **deleted** as of this change (its ~10 commits stay
reachable in history, and `git log --grep '#47'` finds the reasoning). It had a real skeleton with
two-bone IK, authored width-profile strokes and three independent measurements against the pack. It
reached 1.20 reference px of per-part shape error, 1.54 on the walk, and 73% silhouette overlap —
and still did not read as the same character.

Each round fixed one measured quantity and moved another, because a parametric skeleton
approximating hand-placed pixels is a large coupled search with no exact solution in it. Imported
frames are exact by definition, so the frames won.

Its measurement tools went with it: they existed to compare a generated figure against the pack, and
with no generated figure they have nothing to measure. The importer's own pixel-for-pixel diff is a
strictly better check anyway. What survives is the part that was never about the rig — `PartCtx` and
the band ladder, now in [`surface.ts`](../client/src/render/entity/surface.ts), so a shader authored
against one path reads identically on the other.

The lesson worth keeping, because it cost the most: a metric can agree while the art is visibly
wrong. Per-part extents matched within a pixel while the figure was a mannequin, because a bounding
box cannot tell a tapered diagonal stroke from a vertical slab. Measuring shape row by row found it;
measuring per-pixel overlap found more still.

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

## Equipment: three kinds, and the rules for each

Equipment does **not** have to fit inside the character's silhouette, and that requirement split the
model into three kinds. Naming them matters, because the kind decides what an item is allowed to do.

| kind           | its art                     | may change the silhouette | examples                                        |
| -------------- | --------------------------- | ------------------------- | ----------------------------------------------- |
| **Re-skin**    | none — recolours the body   | never                     | dyed cloth, skin tone, a steel sheen            |
| **Overlay**    | its own, clipped to a part  | never                     | a helmet on the head, a pauldron                |
| **Attachment** | its own, anchored to a part | **yes**                   | a backpack, a cape, a sheathed sword, a lantern |

Re-skins and overlays keep the imported shape and change what is inside it. An **attachment** hangs
its own art on the body and is free to stick out, which is the only way to get a backpack.

### An attachment names a place on the body, never a pixel or a frame

This is what makes it tractable, and it is the same trick that made materials work. An attachment's
anchor is a **surface coordinate** — `along` down a part, `around` across it — resolved per frame
from that frame's own derived surface map:

```ts
anchor: { slot: 'torso', along: 0.35, around: -1 }   // high on the torso's back edge
pivot:  [1, 0.4]                                      // which part of the ITEM touches the body
behind: 'arm.far'                                     // where it sits in the paint order
```

"High on the torso's back edge" is authored **once** and lands correctly in all fifteen animations,
following the body as it bobs, leans and turns. A new animation needs no attachment work at all.

### Rules

- **Author against coordinates, never frames.** Anything authored per frame stops working the moment
  an animation is added, and there are fifteen already.
- **Resolve the anchor axis by axis**, height then edge. A single nearest-neighbour search in
  `(along, around)` is wrong: the axes have different ranges, so it slides down the part to satisfy
  `around` — which put the backpack on the character's chest for two frames of the walk.
- **Declare the paint order.** A back-mounted item goes behind everything; a chest lamp in front.
  This is the most visible way an attachment can look pasted on.
- **Clear the silhouette by design.** An attachment that sits inside the body's footprint gets
  occluded by a swinging limb and vanishes. Do not fix that with paint order — the occlusion is
  correct — fix it with art that hangs far enough out.
- **The figure must read without it.** Equipment adds to a silhouette; it may not be the thing that
  makes one legible.
- **Attachment art is ours.** The imported pack supplies bodies only, so every item follows
  [PALETTE.md](PALETTE.md) and carries its own rim in the same darkest step the body uses.

### Known limitation

On the two walk frames where the torso leans hardest, its own back edge sits further inboard than the
near arm, so the backpack lands underneath that arm and disappears. The anchor is right and the
occlusion is right — a near-side arm really is in front of something on the back. What is wrong is
expecting one part's extent to know about another's. Fixing it means either art that clears the arm's
full swing, or resolving the anchor against the whole figure's silhouette rather than one part's.
Both are decisions rather than tweaks.

## The outline

Entities carry a **one-pixel dark rim**; the world does not. Rock separates itself geometrically —
its brightness falls off from every open edge, so a tile boundary reads without a line. A character
has no such relationship to what it stands in front of, and in the game a dark torso against lit
stone simply disappeared.

Three decisions in it, each one arrived at by getting it wrong:

- **One SOURCE pixel, dilated before the upscale**, so the rim grows with the art instead of staying
  hairline at 2x.
- **Four-connected, not eight.** A diagonal rim reads as a fuzzy halo at this size; a cardinal one
  reads as a drawn line.
- **Never below the ground line.** A rim under the feet paints a dark row onto the floor the
  character is standing on, and at one pixel against lit stone that reads as a gap — the same
  hovering artefact the outline exists to avoid causing.

`#2e222f` is R64's darkest and the shadow step of every rock ramp, so the rim is the black the world
is already built from rather than a second competing dark. Toggle it in the lab, or with
`--no-outline` on the shot tool.

## Scale, and the player body

The character is drawn at **1x**, which makes the figure 18 x 29 art px — **1.12 x 1.81 tiles** on a
16px tile. The player hitbox is sized to it: `HW 0.45`, `HH 0.91`.

Terraria's exact three tiles is not reachable. Integer sprite scaling on a 16px tile gives 1.81 or
3.62 tiles and nothing between, so the earlier "keep Terraria's proportions" decision became a choice
between the two, and 1.81 won: it delivers the digging cost that motivated the whole change while
leaving the 16px material art untouched.

What that size change required in the sim, none of it optional:

- **A one-tile gap no longer fits**, so tunnels are two tiles tall. That is the point.
- **Reach is measured from the body's tile span**, not its centre tile. That distinction did not
  matter while the body fitted in one tile; measured from the centre, a 1.82-tall player could dig
  the tile its head occupies but not the one above it, so tunnelling straight up silently became
  impossible.
- **Jump height is unchanged** — it is a property of velocity and gravity, not of the body, so the
  player still clears a one-tile step. Headroom did change: a 1.82-tall body in a two-tall tunnel has
  0.18 tiles above its head, so jumping indoors wants a three-tall tunnel.
- **Saves are unstuck on load.** A save written at the old size can leave the body inside the ceiling
  of its own tunnel, and a wedged player cannot move, jump or dig out. `unstick` lifts it to the
  nearest gap that fits; with nowhere within a few tiles, a fresh spawn beats an unplayable save.

Collision needed no change, which was worth checking rather than assuming: the horizontal and
vertical sweeps already iterated the body's full tile span, using the extremes only as bounds.

## What the world told us that the lab did not

The shipped ramps are pitched a step lighter than the first version, and that came from putting the
character in the world rather than judging it alone. Against lit rock — bright stone, brighter ore — a
torso topping out at `#4d65b4` simply vanished, and the skin-tone head was the only part of the
figure that registered.

The general lesson, which cost most of this issue to learn: **a character has to hold its value
against the brightest thing it stands next to**, and nothing but the actual game will tell you
whether it does. Every metric in this pipeline agreed the figure was correct while it was invisible.

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
- **The game does not pass a light position yet.** `drawPlayer` defaults to `PLAYER_LAMP`, which is
  right for the player, but nothing yet feeds it the position of a nearby ore glow or lava pool.
- **Only five of the fifteen animations are reachable.** The sim has five miner states; crouch, roll,
  push, pull, ledge climb and air spin wait on mechanics that do not exist. `mine` borrows the idle,
  which is a placeholder — the honest fix is a mining animation, not a cleverer mapping.
- **`run` plays the WALK cycle.** The pack's run is a sprint with a long airborne stride and DELVE has
  one movement speed; swapping it belongs with a sprint mechanic.
- **Animations the pack flattened.** Slide, Dash, Katana Walk, side Climb and running Shoot have no
  per-part layers and cannot be imported into this format as-is.
