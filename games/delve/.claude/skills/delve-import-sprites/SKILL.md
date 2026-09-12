---
name: delve-import-sprites
description: Import a layered pixel-art entity (player, enemy, NPC, prop) into DELVE from .aseprite files, and skin it with flat colours or procedural materials. Trigger when asked to add a new character/enemy/NPC sprite set, import art from an asset pack or Aseprite file, or when the user runs /delve-import-sprites. Also the reference for authoring equipment, armour or a re-skin over existing imported sprites.
---

# DELVE — import and skin an entity's sprites

Add one entity's animations end to end: read the layered `.aseprite` files, emit committed
index-mapped frames, then decide every colour here on the Resurrect-64 palette.

Read [`docs/SPRITES.md`](../../../docs/SPRITES.md) first — it owns the format, the pipeline and the
reasoning. This skill is the procedure. All paths are under `games/delve/`.

**The core idea, and the reason this is not just "load a sprite sheet":** an imported pixel does not
store a colour. It stores an **index into a shared template palette**, and — where a material is
used — resolves to a **surface coordinate** on its body part. So the art gives silhouettes and
motion, and everything visible is authored: a skin is a lookup table, and a material is one of the
same shaders the rock uses. One import serves every skin tone, armour set and material.

## Before you start

The source art must be **layered per body part**. Check first:

```sh
pnpm --filter delve exec tsx -e "
import {readAseprite} from './tools/aseprite';
import {readFileSync} from 'node:fs';
const f = readAseprite(new Uint8Array(readFileSync(process.argv[1])));
console.log(f.width, f.height, f.frames, f.layers.map(l => (l.visible ? l.name : '('+l.name+')')));
" -- '<file.aseprite>'
```

A file whose only layers are `Flattened`, `Body` or `Layer 1` **cannot** be imported into this
format — there is nothing to slot. Record it in `SPRITE_OMISSIONS` with the reason rather than
forcing it; a gap on record beats one someone re-discovers. Source files are **never committed**.

## Step 1 — declare the entity (`tools/sprite-manifest.ts`)

Add an entry to `ENTITIES`:

- `name` — the directory and export prefix (`player` → `PLAYER_SPRITES`, `sprites/player/`).
- `root` — the pack subdirectory.
- `ground` — **the canvas row the feet stand on**, one value for the whole entity. Not the canvas
  bottom: packs pad the canvas for animation overshoot. Not per animation either; deriving it that
  way gave 44 for the player's jump and 38 for its push, which makes a character jump _downward_ and
  float while pushing.
- `slots` — layer-name patterns → slot names. Reuse `BIPED_SLOTS` for anything humanoid; write a new
  table for anything that is not (a spider has no arms).
- `order` — the slot set in paint order.
- `sources` — one entry per animation, with `grounded: true` on the ones that definitionally stand on
  the ground so the importer can check `ground` against them.

Slot names must be **consistent across animations**, which is what normalisation is for: a skin or a
piece of equipment keys on the slot name, and this pack alone calls one body part `Back Arm`,
`Back Hand` and `Left Arm` in three different files.

## Step 2 — import

```sh
pnpm --filter delve exec tsx tools/import-aseprite.ts <pack-root>
```

It is a **batch over every entity** because the template palette is shared — that is what lets a
material authored once apply to any entity whose slots it names.

**It verifies before it writes and refuses on a mismatch.** Each animation is decoded back,
composited, and diffed pixel for pixel against the file's own layers and its sibling PNG export. When
it refuses, read the direction of the difference:

| what it reports                      | what it means                                | what to do                                                   |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| pixels ours-only                     | stray marks on a layer the artist hid        | dropped automatically, and reported                          |
| same pixels, different colour        | layer opacity or a blend mode                | `trustSource` — keeping the layer unblended is usually right |
| differences both ways, spread evenly | the PNG export predates the layers           | `trustSource`, with that as the reason                       |
| a layer maps to no slot              | a name the patterns do not know              | add a pattern, or `skip` it                                  |
| a grounded animation misses `ground` | the manifest is wrong, or it is not grounded | fix the manifest                                             |

Never set `trustSource` without recording why in the entry. Never edit generated files by hand.

## Step 3 — skin it (`client/src/render/entity/skin.ts`)

The import gives code colours, so this step is where the art direction happens.

1. Find out which template colour is which part:
   ```sh
   pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> /tmp/t.png --scale 4 --template
   ```
2. Add each new code colour to `TEMPLATE_PARTS` with its part and its `shade` rank (0 = darkest).
   Every template colour must be mapped or a pixel using it becomes a hole; a test enforces this.
3. Write per-part ramps and `buildSkin` them. Keep **near-side limbs a step lighter than far-side**:
   that is the depth cue the source encodes by giving each side its own code, and without it the legs
   merge whenever they overlap.

## Step 4 — materials, for equipment and armour

A flat ramp can only ever show as many shades as the template carries (2-5 per part). A **material**
is sampled at each pixel's `(along, around)` and bands as finely as it likes:

```ts
export const MY_ARMOUR: SpriteSkin = {
  ...MINER_SKIN,
  materials: { torso: material(plateArmourSurface, STEEL) },
};
```

Use `armourSurface` / `plateArmourSurface` from `skin.ts`, **not** `clothSurface` / `plateSurface`
from `limb.ts`. The latter were tuned against a 16px tile; pointed at a 3-5px imported limb their
noise swings across most of the band ladder and the figure comes out as speckle with its silhouette
dissolved. Same lesson the procedural rig learned about edge erosion: a treatment sized for a tile is
most of a small part.

Features are placed by coordinate, not by colour — a trim at `along > 0.8`, a belt across the torso —
so they are authored once and fit every animation, because the coordinates are derived per frame from
that frame's own silhouette.

## Step 5 — verify

```sh
pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> /tmp/a.png --scale 4          # authored skin
pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> /tmp/b.png --scale 4 --plate  # materials
pnpm --filter delve test                                                               # the gate
```

No browser needed for either. `client/labs/sprite-lab.html` is the interactive view: every animation
playing, per-slot visibility, live ramp editing and the material modes.

`tools/sprites.test.ts` does not re-check fidelity — the importer already proved that. It guards what
rots afterwards: a module missing from the registry, an index outside the palette, a drifted slot
name, a cel outside the canvas, a coordinate outside its range, and that a material changes colour
without changing the silhouette.

## Gotchas that cost real time

- **Do not re-sort layers into a house paint order.** Source order wins. One file paints its torso
  above the near leg where every other paints it below, and re-sorting broke that frame.
- **Do not build a palette per animation.** Index 1 then means a different colour in each, and every
  override is wrong depending on what is playing. One shared table, always.
- **Integer scale only.** A sprite is never resampled; 1.5× gives soft edges no palette can fix.
- **Flip indices, not drawn pixels.** Mirroring while reading the source is exact.
- **Anchor on `ground`, not the canvas.** Anchoring on the canvas bottom floats the character by
  however much padding the artist left.
