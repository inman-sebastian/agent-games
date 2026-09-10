# DELVE — palette

Every colour in DELVE is drawn from **Resurrect 64** by Kerrie Lake — a curated
64-colour Lospec palette (<https://lospec.com/palette-list/resurrect-64>). Staying
within it is what keeps the whole game cohesive; new art must pick from this list
(or a `mix()`/`desat()` of these) rather than introducing fresh colours.

R64 is the **source** palette, not a hard 64-colour quantisation: shading blends
these toward black and toward the background tone, so on-screen pixels include
intermediate values. Ore is the only saturated element, so it pops against the
muted rock.

## The full 64

Regenerate the swatch image by drawing the list below to a canvas — see the palette
panel in `style-lab.html`.

![Resurrect 64 palette](images/resurrect-64.png)

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

## Strata ramps

Each depth stratum is a 6-step ramp, `shadow[0] → rim[5]`, with a distinct identity
so **depth reads by colour**. Each stratum is its own resource file under `resources/*.js`
(type `strata`); the rock renderer reads the ramps from the registry (see
[ARCHITECTURE.md](ARCHITECTURE.md#entity-resources)).

| Stratum | Top row | Identity | Ramp | Notes |
| --- | --- | --- | --- | --- |
| Topsoil | 2 | red-brown | `#2e222f #45293f #7a3045 #9e4539 #cd683d #e6904e` | all R64 |
| Clay | 24 | warm ochre/tan | `#2a2018 #48371f #6d5230 #8f6b3c #b28a4e #d0aa66` | R64-*spirit* derivation — R64 has no clean warm-tan mid-ramp |
| Stone | 84 | cool gray | `#2e222f #3e3546 #625565 #7f708a #9babb2 #c7dcd0` | all R64 |
| Deep Stone | 190 | blue | `#2e222f #323353 #484a77 #4d65b4 #4d9be6 #8fd3ff` | all R64 |
| Basalt | 370 | violet | `#2e222f #45293f #6b3e75 #905ea9 #a884f3 #eaaded` | all R64 |

Ramps use `#2e222f` (R64's darkest) as the shadow step. The background wall is
derived per-stratum: `desat(mix(ramp[1], '#4a4864', .64), .52)` — a lighter, cooler,
desaturated version, **always lighter than the rock body** (see [RENDERING.md](RENDERING.md)).

## Ore triads & shapes

Each ore has a `[dark, mid, highlight]` triad and a **crystal shape**, defined in
`scripts/ore-art.ts` (`ORE_ART`, keyed by engine ore id). Every shape is drawn
symmetric about its centre within the same `±(r+1)` box, so any ore icon centres
cleanly in a square and they all read at roughly the same size. Metals are lumpy,
misshapen **nuggets** (a per-ore seeded angular wobble, never perfect spheres); gems
are faceted/airier by design.

| Ore | Triad | Shape | Band (rows) | Value |
| --- | --- | --- | --- | --- |
| Dirt | `#48371f #6d5230 #8f6b3c` | nugget (`dim`) | 2–8 | 1 |
| Copper | `#7a3045 #cd683d #f79617` | nugget | 4–24 | 5 |
| Iron | `#3e3546 #7f708a #c7dcd0` | nugget | 16–52 | 12 |
| Silver | `#625565 #9babb2 #e8eef5` | nugget | 40–92 | 34 |
| Gold | `#4c3e24 #f9c22b #fbff86` | nugget | 76–156 | 95 |
| Emerald | `#165a4c #1ebc73 #91db69` | prism | 132–240 | 260 |
| Ruby | `#831c5d #f04f78 #f68181` | cluster | 216–370 | 720 |
| Diamond | `#0b8a8f #30e1b9 #8ff8e2` | gem | 330–530 | 2100 |
| Mythril | `#484a77 #905ea9 #a884f3` | shard | 480+ | 6200 |

Metals (Dirt/Copper/Iron/Silver/Gold) all use the lumpy `nugget`; the four gems
keep their distinct crystal shapes. **Dirt** is a `dim` ore — a plain clod with no
glow, rendered as ordinary rock in the world (its shape is only the extracted icon).
The authoritative bands/values/weights/art live in the per-ore **resource files** under
`resources/*.js` — this table is a snapshot for art reference.
