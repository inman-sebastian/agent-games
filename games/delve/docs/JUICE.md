# DELVE — miner, juice & sound

The feedback layer: the sprite, the motion, the particles, and the synthesized audio
that make the same rules feel good. Juice attaches to **state transitions** (start,
impact, break, reward), not to steady state.

## Miner

The player is an **imported, layered sprite** coloured on the Resurrect-64 palette — drawn by
`drawPlayer` in `client/src/render/entity/player.ts`, with its animation picked from the miner state
and the distance actually walked. The art, the pipeline and the reasoning live in
[SPRITES.md](SPRITES.md); this file owns only the feedback around it. (It replaced a hand-drawn
placeholder — orange helmet, pickaxe over the shoulder — that some older notes still describe.)

## Motion & juice (game layer)

- **Nothing teleports:** the miner moves under continuous platformer physics (run,
  gravity, jump); the camera eases to keep it centred; the lamp glow pulses.
- **Chipping rock:** fine pixel debris (mostly 1px, shaded off the source colour toward
  a bright chip / dark fleck so it reads as chipped stone, not flat chunky squares).
- **Breaking rock:** a debris burst scaled to ore rarity. Ore drops into the inventory
  on break — a rising `+N <ore>` floaty in the ore's colour, no travel. There's no selling
  and no hauling, so the loop never asks you to stop digging.
- **Rich vein** (3× the material): a gold `+N!` floaty, extra sparkle, bigger
  shake, bright chime — the reward beat, overspent on purpose.
- **Ore shimmer:** exposed ore breathes — the per-tile pulse drives its actual emitted
  light (see [LIGHTING.md](LIGHTING.md)), plus an occasional bright twinkle glint, each
  phase-offset per tile.
- **Screen shake is currently OFF** (`SHAKE_ENABLED = false` in `client/src/index.ts`) — it read as
  constant jitter once the pick was upgraded and the player was deep. The shake
  magnitude still accumulates internally, so re-enabling is a one-line flip.

## Sound (Web Audio, synthesized)

All SFX are synthesized with the Web Audio API — no binary assets. Rising pitch =
good, falling = bad; brighter = rarer:

- **Dig** — short filtered-noise thud (pitch drops with depth).
- **Break** — a noise crack.
- **Ore** — a chime that rises with rarity.

One mute switch gates everything; the `AudioContext` unlocks on the first user input.

## Surface decoration (planned)

Moss/grass/flora belong to a future **procedural surface-decoration pass** layered on
top of the rock — applied _selectively_ (e.g. only on undisturbed surfaces), not baked
into the rim (freshly-mined rock shouldn't be mossy). Each stratum reserves an `accent`
colour as an input for this.
