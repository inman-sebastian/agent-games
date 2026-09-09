# DELVE — style guide

Classic 2D pixel-art miner. The single source of truth for every asset. All art
is drawn in code (canvas rects on a low-res logical buffer scaled up with
`image-rendering: pixelated`). No emoji, no images, no fonts-as-art.

## Rendering model
- **Logical buffer:** `WIDTH(9) × 24px` cols by `13 × 24px` rows = **216×312** logical
  pixels, scaled to fit the viewport with nearest-neighbour. The buffer is finer
  than the tile grid so pixels read crisp, not blocky.
- **Unit:** the sprite pixel is **2 logical px** (`u=2`). Characters/props are
  designed on an 8×8 grid of these units, sitting smaller inside the 24px tile so
  the scene breathes.
- **Camera** follows the miner vertically only (the mine is exactly 9 tiles wide).
- **Rock is a mass, not a grid.** Tiles are drawn as a flat depth-tinted fill with
  gentle mottling; there is **no per-tile bevel**. Definition comes only from a
  soft shadow lip on rock faces that touch open tunnels, so excavated space reads
  as carved-out negative space rather than a wall of boxes.

## Palette
Earthy, low-saturation strata that darken with depth; ore is the only saturated
colour, so it reads instantly against rock.

- Surface sky: `#243a5e` → `#4d6b9a` (dusk gradient), sun `#f5d98c`.
- Grass/yard line: `#5a8f4a`, soil `#6b4a2f`.
- Rock strata (lerped by depth): dirt `#6b4a2f` → stone `#4a4a52` →
  slate `#343446` → deep `#1c1c2a` → bedrock `#141420`.
- Cave void (dug space): `#0d0d15`.
- Cracks / shading: multiply-dark `#000` at low alpha.
- Ore (saturated, from `engine.js` ORES): Dirt `#8a5a34`, Copper `#c9703b`,
  Iron `#b7c0cc`, Silver `#e8eef5`, Gold `#f2c14e`, Emerald `#3fbf6f`,
  Ruby `#e2445c`, Diamond `#5fd6e2`, Mythril `#b06cf0`.
- Miner: helmet `#f2a03b`, lamp `#fff6c0`, face `#e8b58c`, overalls `#3b6ea5`.
- UI chrome (HTML): bg `#0b0e13`, panel `#141922`, ink `#e8eef5`, dim `#7c8899`,
  gold accent `#f2c14e`.

## Lighting
Underground is dark; a stepped (quantised) light falloff around the miner's lamp
lights nearby tiles. Ambient floor ~`0.12`. The **Ore Scanner** tech draws a
faint additive ore glow that shows *through* rock even in darkness; the **Deep
Lantern** widens the lit radius. Surface is fully daylit.

## Shape language
- Chunky, flat-shaded blocks with a 1px darker bottom/right edge and 1px lighter
  top/left edge for a beveled tile look. Ore = a small speckle cluster of gem
  colour with one bright highlight pixel.
- Cracks accumulate as damage rises (more dark pixels toward break).

## Motion & juice
- Nothing teleports: the miner lerps between tiles; the lamp glow pulses; the
  surface has drifting clouds; dust motes drift in the lit area (idle life); a
  vignette frames the view for depth.
- Chipping rock: small chip particles + a tiny directional shake.
- Breaking rock: chip burst + shake scaled to ore rarity. **Ore sells the instant
  it breaks, in place** — a rising `+N` coin floaty in the ore's colour, no travel.
- Rich vein (Fortune crit, 3× value): a gold `+N!` floaty, extra sparkle burst,
  bigger shake, and a bright chime — the reward beat, overspent on purpose.
- No cargo, no hauling: the loop never asks the player to stop digging.

## Sound (Web Audio, synthesized)
Rising pitch = good, falling = bad; brighter = rarer. Dig = short filtered noise
thud (pitch drops with depth); break = noise crack; ore = a chime that rises with
rarity; sell = gold arpeggio; buy = confirming blip; full = low buzz. One mute
switch gates everything; the `AudioContext` unlocks on first input.
