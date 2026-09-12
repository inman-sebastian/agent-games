# DELVE — palette

Every colour in DELVE is drawn from **Resurrect 64** by Kerrie Lake — a curated
64-colour Lospec palette (<https://lospec.com/palette-list/resurrect-64>). Staying
within it is what keeps the whole game cohesive; new art must pick from this list
(or a `mix()`/`desat()` of these) rather than introducing fresh colours.

R64 is the **source** palette, not a hard 64-colour quantisation: shading blends
these toward black and toward the background tone, so on-screen pixels include
intermediate values.

**One saturated element per context.** Underground, that element is **ore** — it pops against
deliberately muted rock. Above ground it's the **sky** (see
[Surface & daylight](#surface--daylight)). The rule holds everywhere; only what fills the role
changes.

## The full 64

Regenerate the swatch image by drawing the list below to a canvas — see the palette
panel in `client/labs/style-lab.html`.

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
so **depth reads by colour**. Each stratum is its own resource file under `shared/src/resources/*.ts`
(type `strata`); the rock renderer reads the ramps from the registry (see
[ARCHITECTURE.md](ARCHITECTURE.md#entity-resources)).

| Stratum    | Top row | Identity       | Ramp                                              | Notes                                                        |
| ---------- | ------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Topsoil    | 2       | red-brown      | `#2e222f #45293f #7a3045 #9e4539 #cd683d #e6904e` | all R64                                                      |
| Clay       | 24      | warm ochre/tan | `#2a2018 #48371f #6d5230 #8f6b3c #b28a4e #d0aa66` | R64-_spirit_ derivation — R64 has no clean warm-tan mid-ramp |
| Stone      | 84      | cool gray      | `#2e222f #3e3546 #625565 #7f708a #9babb2 #c7dcd0` | all R64                                                      |
| Deep Stone | 190     | blue           | `#2e222f #323353 #484a77 #4d65b4 #4d9be6 #8fd3ff` | all R64                                                      |
| Basalt     | 370     | violet         | `#2e222f #45293f #6b3e75 #905ea9 #a884f3 #eaaded` | all R64                                                      |

Ramps use `#2e222f` (R64's darkest) as the shadow step. The background wall is
derived per-stratum: `desat(mix(ramp[1], '#4a4864', .64), .52)` — a lighter, cooler,
desaturated version, **always lighter than the rock body** (see [RENDERING.md](RENDERING.md)).

## Surface & daylight

> **Decided, not built.** The surface is [real content](DESIGN.md#the-world) with a day/night
> cycle, and that's a different colour register from the mine. This section is the spec; the art
> comes after it, per the rule that the style guide changes first.

### The sky is the surface's saturated element

**Surface terrain stays muted**, in the same register as rock — and the **sky carries all the
colour.** This is why the one-saturated-element rule survives above ground instead of being
suspended there, and it buys three things:

- **Coming up out of the mine is an emotional event**, not just a scene change.
- **The day/night cycle becomes the primary colour event** above ground, rather than a lighting
  tweak layered over a colourful scene.
- **Ore keeps its job.** If the surface were vivid, the one vivid thing underground would stop
  reading as special by contrast.

### Daylight is cool; the lamp stays warm

The lamp is **warm** and the void is **cool** ([LIGHTING.md](LIGHTING.md)). So **daylight is cool
and neutral** — otherwise the surface and the mine light alike and the contrast that makes lamplight
feel like *your* light disappears.

The payoff: at night the surface goes cool and dark, and the warm lamp matters up there by exactly
the same rule it matters underground. One visual language, two places.

### Sky ramps

The sky is a **two-stop vertical gradient, dithered like everything else** (see
[RENDERING.md](RENDERING.md) — it is currently smooth, which is a bug). Keyframed per phase and
interpolated between them, zenith → horizon:

| Phase | Zenith | Horizon |
| ----- | ------ | ------- |
| **Day** | `#4d9be6` | `#8fd3ff` |
| **Dusk / dawn** | `#753c54` | `#f57d4a` |
| **Night** | `#2e222f` | `#323353` |

All six are R64. Night's zenith is R64's darkest, which is the same shadow step the strata ramps
use — so the night sky and the deepest rock share a floor.

> **Known violation to fix:** the shipped sky uses `#0e1830` → `#6a86b4`
> (`cave-render.ts`), **neither of which is in R64**. It predates this section and is the one place
> above ground that breaks the palette rule.

### Surface biomes use the strata mechanism

Each surface biome (see [BIOMES.md](BIOMES.md)) gets a **6-step ramp, shadow → rim**, exactly like a
stratum. No new machinery, and it means Woodland and Crags differ from each other the way Stone and
Basalt already do.

Ramps to author: **The Mine Head** · **Woodland** · **Crags** · **Ocean**.

## Ore triads & shapes

Each ore has a `[dark, mid, highlight]` triad and a **crystal shape**, defined in
`client/src/render/ore-art.ts` (`ORE_ART`, keyed by engine ore id). Every shape is drawn
symmetric about its centre within the same `±(r+1)` box, so any ore icon centres
cleanly in a square and they all read at roughly the same size. Metals are lumpy,
misshapen **nuggets** (a per-ore seeded angular wobble, never perfect spheres); gems
are faceted/airier by design.

| Ore     | Triad                     | Shape          | Band (rows) |
| ------- | ------------------------- | -------------- | ----------- |
| Dirt    | `#48371f #6d5230 #8f6b3c` | nugget (`dim`) | 2–8         |
| Copper  | `#7a3045 #cd683d #f79617` | nugget         | 4–24        |
| Iron    | `#3e3546 #7f708a #c7dcd0` | nugget         | 16–52       |
| Silver  | `#625565 #9babb2 #e8eef5` | nugget         | 40–92       |
| Gold    | `#4c3e24 #f9c22b #fbff86` | nugget         | 76–156      |
| Emerald | `#165a4c #1ebc73 #91db69` | prism          | 132–240     |
| Ruby    | `#831c5d #f04f78 #f68181` | cluster        | 216–370     |
| Diamond | `#0b8a8f #30e1b9 #8ff8e2` | gem            | 330–530     |
| Mythril | `#484a77 #905ea9 #a884f3` | shard          | 480+        |
| Quartz  | `#6f6d78 #c9c7d0 #ffffff` | prism          | 95–210      |
| Platinum| `#5f6b7e #bcc9d6 #f0f6ff` | nugget         | 210–360     |
| Obsidian| `#17151f #33304a #8a86b0` | shard          | 430–650     |
| Stone Bricks | `#3e3546 #6f708a #9babb2` | nugget    | 20–90       |

Metals (Dirt/Copper/Iron/Silver/Gold) all use the lumpy `nugget`; the four gems
keep their distinct crystal shapes. **Dirt** is a `dim` ore — a plain clod with no
glow, rendered as ordinary rock in the world (its shape is only the extracted icon).
The authoritative bands/weights/art live in the per-ore **resource files** under
`shared/src/resources/*.ts` — this table is a snapshot for art reference.

**Stone Bricks** is a constructed material rather than an ore; it's registered as one so it flows
through the whole pipeline, but it belongs in ruins rather than random veins (see
[BIOMES.md](BIOMES.md)). Several of the later additions are **R64-_spirit_ derivations** rather than
literal R64 entries — quartz, platinum and obsidian reach for near-white and near-black values the
64 don't carry cleanly, the same licence the Clay ramp takes.

Note the **depth order and the registry order disagree** (quartz sits between gold and emerald by
depth but was appended last-but-three), which is a real bug in how reward FX are scaled — see
[#46](https://github.com/inman-sebastian/agent-games/issues/46).
