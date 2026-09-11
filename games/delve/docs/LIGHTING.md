# DELVE — lighting

Lighting is **its own independent, geometry-aware system**, not a set of per-effect
hacks. It lives in `client/src/render/lighting.ts` (`create` / `LAMP_COLOR`) and is shared by the game
and the style lab's cave sample so the two light identically. It knows nothing about
game state.

**Every** light source — the miner's lamp, glowing ore, anything added later — is an
_emitter_ pushed via `addLight()` and obeys the **same** rules.

## API

```ts
import { create, LAMP_COLOR } from './render/lighting';
const L = create(); // one instance, reused every frame
L.addLight(x, y, r, colour, intensity); // x,y in SCREEN pixels; colour = [r,g,b] 0..1
//   r === 0  → seeds the LAMP field  (warm, drives the darkness scrim / visibility)
//   r  >  0  → seeds the ORE-GLOW field (its own colour, kept separate so the lamp can't swamp it)
L.render({ g, LW, LH, T, camY, SURFACE, W, solidTile }); // consumes + clears the emitters
```

`LAMP_COLOR` is exported for the caller to pass as the lamp's colour.
`render(cfg)` needs the 2D context `g`, the logical size `LW`×`LH`, tile size `T`, the
camera's world-Y `camY`, the `SURFACE` row, field width `W`, and a
`solidTile(c, r)` predicate (which must fold in the dug overlay:
`solidAt(...) && !isDug(...)`).

## How it works (per frame)

Light is **occluded by rock** — Terraria's technique:

1. Emitters seed a **world-space per-tile colour field** at their tile (lamp emitters
   → the lamp field; ore emitters → the ore-glow field).
2. The field is **propagated** across the visible tile window with four corner sweeps
   (max-with-attenuation). Attenuation is the _destination tile's_ opacity:
   **open/dug tiles conduct** light (`OPEN_ATTEN`), **solid rock absorbs** it fast
   (`ROCK_ATTEN`). So light pools down the tunnels you've carved and fades ~3 tiles into
   rock — the lit region takes the **shape of the dug space, not a circle**, and it bends
   around corners (an L-shaped tunnel lights as an L). One round converges because each
   sweep chains through already-updated neighbours in its direction.
3. The tile field is **bilinear-sampled per pixel** (smooth across tiles, no grid) and
   composited in two passes: a **smooth additive colour glow** (warm lamp + coloured
   ore, drawn with `'lighter'`) + a **dithered darkness scrim** derived from the _same
   field's_ brightness (the pixel-art fog, 4×4 Bayer dither at high `DSTEP` so the
   grain matches the rock). A shared, cached **dithered vignette** frames the screen.

Because the scrim is derived from the light field, **a source lights its own
surroundings out of the dark** by the identical rule, and the **first rock layer
around a lit tunnel catches a warm rim for free** (one attenuated step of warm light)
— the SteamWorld dug-edge signature, emergent rather than special-cased.

### Exposed-rock transition band

Exposed rock reads as a **broad, softly-fading lit band** ~2–3 tiles deep (SteamWorld/Core
Keeper), not a thin bright rim snapping to black. Two knobs set it together: the lamp's
`ROCK_ATTEN` (how far light reaches into rock) and the **baked** geometric light `range` in
`cave-render` (`shadeRock`), which fades brightness over ~1–1.5 tiles from the nearest open
edge. The wide band both looks better and gives surface-level FX (e.g. mining **damage**) a
real canvas — damage FX lives in `client/src/render/materials/fx.ts` (`drawDamage`).

### Lamp-only vision (the void)

Underground, **you see only what your lamp currently reaches** — exploration and
discovery are core, so unexplored space is a true **void**, not a dimly-previewed map.
This falls out of the same field: the ambient floor is **zero** (`AMB = [0,0,0]`) and the
scrim reaches **full** on a wholly-unlit pixel (`MAX_DARKNESS = 1`), so a tile no light
touches fades all the way to the near-black `SCRIM` colour — ore included. Above the
surface the scrim is forced off (`aboveSky`), so daylight is unaffected. There is **no
persistent explored/“seen” memory** — walk away from a tunnel and it returns to the void
(a remembered-map fog would be a separate feature layered on top).

## Gem glow

Ore light obeys the same occlusion rules as the lamp, in its **own colour field**
(`ogR/ogG/ogB`) so the lamp doesn't swamp it. Ore only emits when **exposed**
(bordering an open tile), so its colour has somewhere to flood: the caller seeds it at
the exposed face, and the field spills through into the shaft and dies in rock, exactly
like the lamp — rather than the old geometry-blind screen-space halo that read as a
standalone ring of light. Because the field is max-propagated, several same-colour
sources don't sum (the brightest dominates), and the bilinear sample is **capped per
channel** (`GLOW_CAP`) on top of that — so no blown-out sunspot. The **total** additive
(lamp warm + ore colour) is also capped together (`ADD_MAX`), so their overlap can't
blow to a white sunspot.

Distant **Ore-Scanner**-revealed ore shows its fleck art but does **not** emit light
(gated on lamp reach / being mined), so it neither washes the dark nor floods the
emitter list.

## Tuning knobs

All constants live at the top of `client/src/render/lighting.ts`:

| Knob                        | Meaning                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `LAMP_COLOR`                | Warm lantern colour — a lantern reads **warm**, not a cool flashlight-from-above. |
| `OPEN_ATTEN` / `ROCK_ATTEN` | Per-step conduction: how far light runs down tunnels vs into rock.                |
| `ADD`                       | How strongly the light field shows as additive glow.                              |
| `ADD_MAX`                   | Ceiling on total additive per channel (lamp+ore) — anti-sunspot.                  |
| `AMB`                       | Ambient floor — `[0,0,0]` for lamp-only vision (unlit → the void). Raise to preview the map. |
| `MAX_DARKNESS`              | How fully the scrim hides a wholly-unlit pixel — `1` = true void; lower reveals more.        |
| `SCRIM`                     | The deep cool colour the darkness fades toward (the void's tint).                 |
| `ORE_GLOW` / `GLOW_CAP`     | Gem halo seed strength and its per-channel anti-bloom ceiling.                    |
| `DSTEP`                     | Dither steps for the darkness scrim + vignette (high → fine grain).               |

The lamp's seed brightness scales gently with the player's `vision` stat, so the
**Deep Lantern** reaches further down the tunnel.

## Grounding

Grounded in the reference miners (SteamWorld Dig 2, Terraria, Super Motherload,
studied from real screenshots): warm colour temperature; many small local sources;
deep dark beyond reach; light that respects the carved geometry; baked directional
tile shading carrying much of the depth (see [RENDERING.md](RENDERING.md)). _Possible
future enhancement:_ an explicit (not just emergent) warm edge highlight on exposed
rock faces if the rim needs more punch.
