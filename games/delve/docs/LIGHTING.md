# DELVE — lighting

Lighting is **its own independent, geometry-aware system**, not a set of per-effect
hacks. It lives in `client/src/render/lighting.ts` (`create` / `LAMP_COLOR`) and is shared by the game
and the style lab's cave sample so the two light identically. It knows nothing about
game state.

**Every** light source — the miner's lamp, anything added later — is an _emitter_ pushed via
`addLight()` and obeys the **same** rules. That generality is the system's main asset, and the
design leans on it (see [What the design gets for free](#what-the-design-gets-for-free)).

> **One change is decided and not yet built:** above-ground ambient becomes **time-varying** with
> the [day/night cycle](#daylight-and-the-daynight-cycle), where today it's simply switched off.
> Everything else below is current.

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

### Lamp-only visibility (the void)

> **Terminology: "vision" is retired.** It implies *revealing tiles*, and there is **no fog of war
> and no seen-memory** here — only per-pixel illumination. The player's own light source is the
> **lamp** (`stats().lamp` — reach in tiles); what's actually lit is **illumination**.

Underground, **you see only what light currently reaches** — exploration and discovery are core, so
unexplored space is a true **void**, not a dimly-previewed map. This falls out of the same field:
the ambient floor is **zero** (`AMB = [0,0,0]`) and the scrim reaches **full** on a wholly-unlit
pixel (`MAX_DARKNESS = 1`), so a tile no light touches fades all the way to the near-black `SCRIM`
colour — ore included. Above the surface the scrim is currently forced off (`aboveSky`), so daylight
is unaffected — see [below](#daylight-and-the-daynight-cycle), which changes that.

**Crucially, the light isn't the player's — it's the world's.** A player walking in pitch darkness
still *sees* the moment they stumble into a lit area, because any emitter lights them regardless of
their own lamp. This is the difference between an illumination model and a reveal radius, and the
design depends on it.

There is **no persistent explored/"seen" memory** — walk away from a tunnel and it returns to the
void. So a **map is a memory system**, not a rendering of where you've been (a remembered-map fog
would be a separate feature layered on top).

## Coloured emitters (the ore-glow field)

> **Nothing uses this today.** The **only emitter in the game is the miner's lamp.** Ore emission
> was deliberately removed — veins read purely by their baked surface plus sparkle/twinkle, lit like
> any other rock, so with lamp-only visibility unlit ore stays hidden in the void and never washes
> the dark. The coloured-emitter path below is **built, proven and idle**, waiting for the first
> world light source. That's a *feature*: the hook the design needs already exists.

Coloured light obeys the same occlusion rules as the lamp, in its **own colour field**
(`ogR/ogG/ogB`) so the lamp doesn't swamp it. Ore only emits when **exposed**
(bordering an open tile), so its colour has somewhere to flood: the caller seeds it at
the exposed face, and the field spills through into the shaft and dies in rock, exactly
like the lamp — rather than the old geometry-blind screen-space halo that read as a
standalone ring of light. Because the field is max-propagated, several same-colour
sources don't sum (the brightest dominates), and the bilinear sample is **capped per
channel** (`GLOW_CAP`) on top of that — so no blown-out sunspot. The **total** additive
(lamp warm + ore colour) is also capped together (`ADD_MAX`), so their overlap can't
blow to a white sunspot.

Historical note: this field was built for **ore** glow, and ore no longer uses it (see the callout
above). The mechanism is unchanged and material-agnostic.

## Daylight and the day/night cycle

> **Decided, not built.** See [DESIGN.md](DESIGN.md#the-world).

Today above-ground is a **special case**: the scrim is forced off entirely (`aboveSky`), so daylight
is simply "no darkness". With a **day/night cycle** that stops working — above-ground dark becomes a
real state.

**The fix simplifies the model rather than complicating it.** Make the sun an **ambient term that
varies with time** and reaches **zero at night**:

| | Ambient |
| --- | --- |
| **Above ground** | Time-varying — full at midday, zero at night |
| **Below ground** | Always zero |

Then there is **one model everywhere**, and the special case disappears. `AMB` stops being a
constant and becomes a function of time and depth. The lamp matters on the surface at night by
exactly the same rule it matters underground, with no extra code path — which is the property worth
protecting if this gets implemented differently.

## The light floor

> **Decided, not built.** See [DESIGN.md](DESIGN.md#light).

Light is the game's atmosphere *and* its only real exploration cue, so it gets a **floor the player
can never trade away**: always enough lamp to not be lost in the dark. Everything above the floor is
**earned and riskable** — it comes from equipment, and equipment occupies scarce slots.

**Environmental suppression is a property of the place, not a debuff on the player.** A biome that
eats light (the Nullshade — see [BIOMES.md](BIOMES.md)) does it by **absorbing** light, i.e. a
higher local attenuation, not by reducing the player's lamp stat. The first composes with this
system's existing propagation; the second is a number applied elsewhere that this system would know
nothing about.

## What the design gets for free

The generality of the emitter model is doing real design work, so it's worth naming what falls out
of it rather than discovering it twice. **All of this needs world light sources to exist** — today
the lamp is the only emitter — but none of it needs new lighting code:

- **Emissive content announces itself through rock.** Light bleeds ~2–3 tiles into solid rock
  (`ROCK_ATTEN`), so a glowing cavern **blooms on the rock face before you break through**. That is
  the "there's something here" cue exploration needs, with no HUD marker and no map.
- **Lava telegraphs itself.** A molten pocket is an emitter, so its glow shows through the rock
  before it's breached — which turns *"don't dig into lava"* from a gotcha into a **learnable rule**.
  Any hazard that emits gets this property automatically.
- **The dropped bag is findable.** On death the inventory drops as a light-emitting, bobbing object,
  so it blooms on the rock face from outside line of sight — recovery without a marker, in a game
  with no seen-memory.

**Consequence for implementers:** anything the design wants the player to *notice from a distance*
should be an emitter. That's the cheapest signalling layer available here, and it's already built.

## Tuning knobs

All constants live at the top of `client/src/render/lighting.ts`:

| Knob                        | Meaning                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `LAMP_COLOR`                | Warm lantern colour — a lantern reads **warm**, not a cool flashlight-from-above. |
| `OPEN_ATTEN` / `ROCK_ATTEN` | Per-step conduction: how far light runs down tunnels vs into rock.                |
| `ADD`                       | How strongly the light field shows as additive glow.                              |
| `ADD_MAX`                   | Ceiling on total additive per channel (lamp+ore) — anti-sunspot.                  |
| `AMB`                       | Ambient floor — `[0,0,0]` for lamp-only visibility (unlit → the void). Raise to preview the map. _Becomes time-and-depth-varying with [day/night](#daylight-and-the-daynight-cycle)._ |
| `MAX_DARKNESS`              | How fully the scrim hides a wholly-unlit pixel — `1` = true void; lower reveals more.        |
| `SCRIM`                     | The deep cool colour the darkness fades toward (the void's tint).                 |
| `ORE_GLOW` / `GLOW_CAP`     | Coloured-emitter seed strength and its per-channel anti-bloom ceiling. _(Idle — nothing emits yet.)_ |
| `DSTEP`                     | Dither steps for the darkness scrim + vignette (high → fine grain).               |

The lamp's seed brightness scales gently with `stats().lamp` (`LAMP_REACH_GAIN` per tile of
reach), so the **Deep Lantern** unlock reaches further down the tunnel. The same stat widens the
lamp falloff used for tile shading, and the `render` lab exposes it as the `lamp` query param (see
[tools/README.md](../tools/README.md)).

## Grounding

Grounded in the reference miners (SteamWorld Dig 2, Terraria, Super Motherload,
studied from real screenshots): warm colour temperature; many small local sources;
deep dark beyond reach; light that respects the carved geometry; baked directional
tile shading carrying much of the depth (see [RENDERING.md](RENDERING.md)). _Possible
future enhancement:_ an explicit (not just emergent) warm edge highlight on exposed
rock faces if the rim needs more punch.
