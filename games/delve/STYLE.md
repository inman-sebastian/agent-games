# DELVE — style guide

Classic 2D pixel-art miner, moody underground cave. The single source of truth
for the art. All art is drawn in code (canvas, no images/emoji/fonts-as-art) on
a **logical-resolution buffer that is upscaled with `image-rendering: pixelated`**,
so every effect — including gradients, glows and vignette — stays chunky pixels.

> **Status:** this direction is **live in the game** — `index.html` renders the
> layered cave (background + per-pixel top-lit rock + baked ore veins + per-frame
> glow/lamp/fog) described here. `style-lab.html` remains the standalone tuning
> sandbox where the look is iterated before changes land in the game; keep the
> three (lab, game, this file) in sync as the direction evolves.
>
> In the game the rock field is expensive, so it's cached as fixed-position
> vertical **chunks** (full field width, a few rows tall): each chunk is rendered
> once the first time it scrolls into view and kept, so scrolling back over
> explored ground is a cheap blit. Chunk generation runs **off the main thread**
> in a Web Worker (`chunk-worker.js`) that renders into an OffscreenCanvas and
> ships the result back as a transferable ImageBitmap, so descending into fresh
> depth never stalls the game loop (a not-yet-arrived chunk shows a flat bg
> placeholder for a frame or two). Digging re-renders only a small window around
> the changed tile and patches it into the affected chunk(s) — synchronously on
> the main thread (cheap, no dig latency). The lamp, ore veins+glow, fog-of-war,
> miner, particles and vignette draw per-frame on top.
>
> The rock renderer itself lives in **`cave-render.js`**, imported by BOTH the
> main thread and the Worker, so the look can never drift between them (the
> workspace's "one shared ruleset" rule applied to presentation). All world-space
> noise is anchored to world coordinates, so a chunk or a patch looks identical
> wherever it is rendered.
>
> The world is a **wide, bounded shaft** (WIDTH columns), infinite downward. The
> canvas **fills the whole viewport edge-to-edge**: its logical width is the full
> field width and its logical height is chosen to match the window aspect, so
> tiles stay square with no letterboxing. The HUD (title, depth, coins, deepest
> find, buttons) floats as an **overlay** on top of the game, not in a chrome bar.

## Grounding
Derived from studying real references the user vetted: **Dome Keeper**,
**SteamWorld Dig**, **Super Motherload**, Quintino "Deep Cave", BigManJD — on the
**Resurrect 64** Lospec palette. Hard-won principles:
- Blocky isn't the enemy; *flat, unlit* rock is. Tactile rock reads great.
- **Dark mass centers + a lighter background** are what separate foreground rock
  from open/dug space. This is the #1 lever.
- Edges must connect **globally** (a per-pixel field), not per-tile, or they
  misalign; AO/outline must hug the real pixel contour, not the tile box.
- Render all lighting at logical resolution, then upscale — never smooth gradients.

## Layers (composited bottom-to-top)
1. **Background** — a lighter, cooler, desaturated atmospheric wall (own palette),
   with a depth gradient + faint distant-rock silhouettes. Drawn first. Open/dug
   tunnels reveal it. Built to accept **parallax** layers later.
2. **Foreground rock** — the diggable solid, composited on top with transparency
   for open space, plus a subtle **contact shadow** where rock meets the bg.
3. **Overlays** — ore veins, stalactites/stalagmites, the miner, the lamp glow,
   and a vignette.

## Foreground rock model (per-pixel field)
- Rock solidity is a **per-pixel field**: a tile is solid, then its boundary with
  open space is eroded by world-space noise (gentle, ~0.4–1.8px) so edges are
  organic and **connect seamlessly** across tiles/corners.
- **Top-lit, dark-bodied.** Brightness falls off from *every* exposed edge (walls
  and undersides included) with a **top-light bias** (up-facing surfaces brightest).
  The interior of any large mass falls to near-black — **dark centers** — which
  both reads as depth and keeps the body calm. The dark body is left **empty**
  (no random grit — it read busy).
- The surface→center transition is **organic, not a color band**: multi-octave
  noise (lumps poke into light, crevices fall to dark) + ordered (Bayer) dithering,
  with sparse crack detail only in the transition band.
- **Rim** is desaturated and varied between the warm rock tone and a grayer rock
  tone — reads as stone, not molten orange. No moss/flora here (see below).

## Base palette — Resurrect 64
Every colour in DELVE is drawn from **Resurrect 64** by Kerrie Lake — a curated
64-colour Lospec palette (<https://lospec.com/palette-list/resurrect-64>). Staying
within it is what keeps the whole game cohesive; new art must pick from this list
(or a `mix()`/`desat()` of these) rather than introducing fresh colours.

The full 64, with swatches (regenerate the image by drawing the list below to a
canvas — see the palette panel in `style-lab.html`):

![Resurrect 64 palette](resurrect-64.png)

Hex list, in palette order (copy-paste friendly):
```
#2e222f #3e3546 #625565 #966c6c #ab947a #694f62 #7f708a #9babb2
#c7dcd0 #ffffff #6e2727 #b33831 #ea4f36 #f57d4a #ae2334 #e83b3b
#fb6b1d #f79617 #f9c22b #7a3045 #9e4539 #cd683d #e6904e #fbb954
#4c3e24 #676633 #a2a947 #d5e04b #fbff86 #165a4c #239063 #1ebc73
#91db69 #cddf6c #313638 #374e4a #547e64 #92a984 #b2ba90 #0b5e65
#0b8a8f #0eaf9b #30e1b9 #8ff8e2 #323353 #484a77 #4d65b4 #4d9be6
#8fd3ff #45293f #6b3e75 #905ea9 #a884f3 #eaaded #753c54 #a24b6f
#cf657f #ed8099 #831c5d #c32454 #f04f78 #f68181 #fca790 #fdcbb0
```

## Palette (Resurrect 64 based)
Each depth stratum is a 6-step ramp, `shadow[0] → rim[5]`, drawn from the base
palette above, with a distinct identity so depth reads by colour:
- **Topsoil** (red-brown): `#2e222f #45293f #7a3045 #9e4539 #cd683d #e6904e` — all R64
- **Clay** (warm ochre/tan): `#2a2018 #48371f #6d5230 #8f6b3c #b28a4e #d0aa66` — hand-tuned ochre; R64 has no clean warm-tan mid-ramp, so this stratum is an R64-*spirit* derivation
- **Stone** (cool gray): `#2e222f #3e3546 #625565 #7f708a #9babb2 #c7dcd0` — all R64
- **Deep Stone** (blue): `#2e222f #323353 #484a77 #4d65b4 #4d9be6 #8fd3ff` — all R64
- **Basalt** (violet): `#2e222f #45293f #6b3e75 #905ea9 #a884f3 #eaaded` — all R64

Ramps use `#2e222f` (R64's darkest) as the shadow step. Shading then blends these
toward black and toward the background tone via `mix()`/`desat()`, so on-screen
pixels include intermediate values — R64 is the *source* palette, not a hard
64-colour quantisation. Background wall is derived per-stratum:
`desat(mix(ramp[1], '#4a4864', .64), .52)` — a lighter, cooler, desaturated version,
always lighter than the rock body.

Ore is the only saturated element, so it pops against the muted rock. Each ore has
a `[dark, mid, highlight]` triad and a **crystal shape**. Every shape is drawn
symmetric about its centre within the same `±(r+1)` box, so any ore icon centres
cleanly in a square and they all read at roughly the same size (metals are lumpy,
misshapen nuggets — a per-ore seeded angular wobble, never perfect spheres; gems
are faceted/airier by design):
- Copper `#7a3045 #cd683d #f79617` — nugget · Iron `#3e3546 #7f708a #c7dcd0` — nugget
- Gold `#4c3e24 #f9c22b #fbff86` — nugget · Emerald `#165a4c #1ebc73 #91db69` — prism
- Ruby `#831c5d #f04f78 #f68181` — cluster · Diamond `#0b8a8f #30e1b9 #8ff8e2` — gem
- Mythril `#484a77 #905ea9 #a884f3` — shard

The engine has two more diggables the lab doesn't demo, mapped to nuggets in the
game (`ORE_ART` in `index.html`, keyed by engine ore id): **Dirt** `#48371f
#6d5230 #8f6b3c` — nugget, `dim` (a plain clod, no glow) · **Silver** `#625565
#9babb2 #e8eef5` — nugget. Metals (Dirt/Copper/Iron/Silver/Gold) all use the
lumpy `nugget`; the four gems keep their distinct crystal shapes.

## Ore veins (chip to reveal)
- Undamaged rock shows **embedded flecks** of the ore colour — a tight, centred
  cluster. Everything (flecks, cracks, socket, crystal) is clamped to within ~5px
  of the tile centre so it never overflows the tile.
- **Veins only render where the player can see them** — within lamp range, or
  anywhere once the **Ore Scanner** is owned. Unlit, unscanned rock hides its ore
  (no glinting flecks in the dark), so the scanner has real value. In the game
  they're drawn as a per-frame pass over the cached rock, faded by visibility;
  they are deliberately *not* baked into the rock cache.
- As the tile takes damage: cracks appear early; past ~⅓ damage a **socket** chips
  open and the **crystal grows** (its per-type shape). Fully mined → tile becomes
  open (reveals background). A soft additive glow scales with the reveal.

## Lighting
Lighting is **its own independent, geometry-aware system** (`drawLighting()` +
`addLight()` in `index.html`), not a set of per-effect hacks. **Every** light source
— the miner's lamp, glowing ore veins, anything added later — is an *emitter* pushed
via `addLight(x, y, _, colour, intensity)` and obeys the **same** rules.

**Light is occluded by rock** (Terraria's technique). Each frame:
1. Emitters seed a **world-space per-tile colour field** at their tile.
2. The field is **propagated** across the visible tile window with four corner sweeps
   (max-with-attenuation). Attenuation is the *destination tile's* opacity: **open/dug
   tiles conduct** light (`OPEN_ATTEN`), **solid rock absorbs** it fast (`ROCK_ATTEN`).
   So light pools down the tunnels you've carved and dies a couple tiles into rock —
   the lit region takes the **shape of the dug space, not a circle**, and it bends
   around corners (an L-shaped tunnel lights as an L).
3. The tile field is **bilinear-sampled per pixel** (smooth across tiles, no grid) and
   composited in two passes: a **smooth additive colour glow** (warm lamp, coloured
   ore) + a **dithered darkness scrim** derived from the *same field's* brightness (the
   pixel-art fog, 4×4 Bayer dither at high `DSTEP` so the grain matches the rock).

Because the scrim is derived from the light field, **a source lights its own
surroundings out of the dark** by the identical rule, and the **first rock layer round
a lit tunnel catches a warm rim for free** (one attenuated step of warm light) — the
SteamWorld dug-edge signature, emergent rather than special-cased. A shared, cached
**dithered vignette** frames the screen. Adding a light is one `addLight()` call.

**Gem glow.** Ore light obeys the same occlusion rules as the lamp, in its own colour
field (`ogR/ogG/ogB`) so the lamp doesn't swamp it. A vein only emits when **exposed**
(bordering an open tile), so its colour has somewhere to flood: seeded at the vein's
tile, the ore-glow field **spills through the exposed face into the shaft and dies in
rock**, exactly like the lamp — rather than the old geometry-blind screen-space halo
that read as a standalone ring of light. Because the field is max-propagated, several
same-colour veins don't sum (the brightest dominates), and the bilinear sample is
**capped per channel (`GLOW_CAP`)** on top of that — so no blown-out sunspot. Vein
brightness fades with lamp distance and rises as the vein is mined. The lamp (`r=0`)
seeds the lamp field; ore veins (`r>0`) seed the ore-glow field.

Tuning knobs (all in `index.html`): `LAMP_COLOR` (warm lantern — a lantern reads
**warm**, not a cool flashlight-from-above), `OPEN_ATTEN`/`ROCK_ATTEN` (how far light
runs down tunnels vs into rock), `ADD` (glow strength), `AMB` (ambient floor — unlit
rock stays dim, never pure black), `SCRIM` (the deep cool colour the dark fades
toward), `ORE_GLOW`/`GLOW_CAP` (gem halo strength and its anti-bloom ceiling). The
lamp's seed brightness scales gently with `vision`, so the **Deep Lantern** reaches
further down the tunnel. Distant **Ore-Scanner**-revealed veins show their fleck art
but **do not emit light** (gated on lamp reach / being mined), so they neither wash the
dark nor flood the emitter list.

**Grounded in the reference miners** (SteamWorld Dig 2, Terraria, Super Motherload,
studied from real screenshots): warm colour temperature; many small local sources;
deep dark beyond reach; light that respects the carved geometry; baked directional
tile shading carrying much of the depth (see the rock model). *Possible future
enhancement:* an explicit (not just emergent) warm edge highlight on exposed rock
faces if the rim needs more punch.

Ore also **shimmers**: the per-vein breathing pulse drives its actual emitted light,
plus an occasional bright twinkle glint, each phase-offset per tile.

## Miner
Small sprite with a dark cool outline: orange helmet + lamp, visor, blue overalls,
boots, and a pickaxe over the shoulder. Sits smaller inside the tile so the scene
breathes.

## Surface decoration (planned)
Moss/grass/flora belong to a future **procedural surface-decoration pass** layered
on top of the rock — applied *selectively* (e.g. only on undisturbed surfaces), not
baked into the rim (freshly-mined rock shouldn't be mossy). Each stratum's `accent`
colour is reserved as an input for this.

## Motion & juice (game layer)
- Nothing teleports: the miner lerps between tiles; the lamp glow pulses.
- Chipping rock: fine pixel debris (mostly 1px, shaded off the source colour toward
  a bright chip / dark fleck so it reads as chipped stone, not flat chunky squares).
- Breaking rock: debris burst scaled to ore rarity. **Ore sells the instant it
  breaks, in place** — a rising `+N` coin floaty in the ore's colour, no travel.
- **Screen shake is currently OFF** (`SHAKE=false` in `index.html`) — it read as
  constant jitter once the pick was upgraded and the player was deep. The shake
  magnitude still accumulates internally, so re-enabling is a one-line flip.
- Rich vein (Fortune crit, 3× value): a gold `+N!` floaty, extra sparkle, bigger
  shake, bright chime — the reward beat, overspent on purpose.
- No cargo, no hauling: the loop never asks the player to stop digging.

## Sound (Web Audio, synthesized)
Rising pitch = good, falling = bad; brighter = rarer. Dig = short filtered noise
thud (pitch drops with depth); break = noise crack; ore = a chime that rises with
rarity; sell = gold arpeggio; buy = confirming blip. One mute switch gates
everything; the `AudioContext` unlocks on first input.
