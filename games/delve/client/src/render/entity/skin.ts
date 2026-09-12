// skin.ts — what the imported sprites are actually COLOURED with. This part is authored, not imported.
//
// The reference pack ships a colour-coded TEMPLATE, not finished art: its pixels are flat code
// colours that identify which body part a pixel belongs to. So the pack gives DELVE silhouettes and
// motion, and everything you see is decided here, on the Resurrect-64 palette (docs/PALETTE.md).
//
// A skin is one lookup table over `TEMPLATE_PALETTE` — the pixel-mapping idea from the UV-encoding
// devlog, applied to a 2D sprite. That it is GLOBAL rather than per-layer is what makes it robust:
// the pack's own layering is loose, and some animations paint a stray head-coloured pixel onto an arm
// layer. Mapped by colour, those pixels come out the right colour anyway. Mapped per layer, they
// would not.
//
// Better than expected, and it corrected an assumption: each body part carries 2-5 SHADES in the
// template, not one flat colour, so a substituted ramp can be properly shaded rather than flat.
import { clamp01, colorsFor, quantize, type Rgb } from '../palette';
import { bandsOf, type PartCtx } from './surface';
import { TEMPLATE_PALETTE } from './sprites/palette';
import { vnoise } from '@delve/shared';
import type { SpriteLight, SpriteMaterial, SpriteSkin } from './sprite';

/**
 * Which body part each template colour identifies, and how light it is within that part.
 *
 * Measured off every imported animation by counting which slot each colour actually lands on. The
 * percentages were decisive: `#5fcde4` is 99% head, `#d1cc60` is 99% near leg, and the handful of
 * colours that stray onto a neighbouring layer do so on 1-4% of their pixels — the pack's own slop,
 * which a global mapping absorbs.
 *
 * `shade` runs 0 (darkest) upward within the part, so a replacement ramp is written light-to-dark
 * once and reused for any part.
 */
export const TEMPLATE_PARTS: readonly {
  readonly color: string;
  readonly part: SkinPart;
  readonly shade: number;
}[] = [
  { color: '#d95763', part: 'legFar', shade: 2 },
  { color: '#ce5050', part: 'legFar', shade: 3 },
  { color: '#ac3232', part: 'legFar', shade: 1 },
  { color: '#9c304d', part: 'legFar', shade: 0 },

  { color: '#fbf236', part: 'legNear', shade: 1 },
  { color: '#d1cc60', part: 'legNear', shade: 0 },

  { color: '#df7126', part: 'torso', shade: 2 },
  { color: '#c46423', part: 'torso', shade: 1 },
  { color: '#b35b20', part: 'torso', shade: 0 },

  { color: '#99e550', part: 'armNear', shade: 2 },
  { color: '#6abe30', part: 'armNear', shade: 1 },
  { color: '#69ad31', part: 'armNear', shade: 0 },

  { color: '#af1ab2', part: 'armFar', shade: 3 },
  { color: '#951799', part: 'armFar', shade: 2 },
  { color: '#76428a', part: 'armFar', shade: 1 },
  { color: '#674085', part: 'armFar', shade: 0 },
  { color: '#962d2d', part: 'armFar', shade: 2 },

  { color: '#5fcde4', part: 'head', shade: 1 },
  { color: '#5fb4d9', part: 'head', shade: 0 },

  { color: '#ffffff', part: 'flash', shade: 0 },
  // Unused by any imported frame — it was a stray mark on the walk's far arm, outside the artist's
  // own export, and the importer drops those. Kept in the table so the palette stays 1:1 with the
  // generated file and an index never silently shifts.
  { color: '#6e8b99', part: 'unused', shade: 0 },
];

export type SkinPart =
  'head' | 'torso' | 'armNear' | 'armFar' | 'legNear' | 'legFar' | 'flash' | 'unused';

/** A ramp per part, DARKEST FIRST, long enough to cover that part's shade count. */
export type SkinRamps = Readonly<Record<SkinPart, readonly string[]>>;

/**
 * Turn per-part ramps into the flat lookup table `drawSprite` wants.
 *
 * A ramp shorter than the part's shade range clamps to its last entry rather than leaving a hole —
 * an unmapped index draws nothing, and a missing pixel is far harder to spot than a flat one.
 */
export function buildSkin(ramps: SkinRamps): SpriteSkin {
  const byColor = new Map(TEMPLATE_PARTS.map((e) => [e.color, e]));
  return {
    colors: TEMPLATE_PALETTE.map((color) => {
      const entry = byColor.get(color);
      if (!entry) return null;
      const ramp = ramps[entry.part];
      if (!ramp || ramp.length === 0) return null;
      return ramp[Math.min(entry.shade, ramp.length - 1)];
    }),
  };
}

// ---- the default miner --------------------------------------------------------------------------
//
// Deliberately the same colours as the placeholder miner it replaces (`render/sprites.ts`): blue
// overalls, warm skin, so the character reads as the same person and the swap is a change of art
// rather than a change of cast. All Resurrect-64.
//
// Near-side limbs are a step LIGHTER than far-side ones. That is the depth cue the pack encodes by
// giving each side its own colour code, and it is worth preserving — without it the two legs merge
// into one shape whenever they overlap.

// Pitched a step LIGHTER than the first attempt, and that came from putting the character in the
// world rather than from judging it on its own. Against lit rock — bright stone, brighter ore — a
// torso topping out at #4d65b4 simply vanished, and the skin-tone head was the only part of the
// figure that registered. A character has to hold its own value against the brightest thing it
// stands next to, not merely look correct on a dark background.
const OVERALLS = ['#323353', '#484a77', '#4d65b4', '#4d9be6'];
const OVERALLS_FAR = ['#2e222f', '#323353', '#484a77', '#4d65b4'];
const SKIN = ['#a2653e', '#c7955f', '#e6b98e', '#f5d1a5'];
const SKIN_FAR = ['#7a3045', '#a2653e', '#c7955f', '#e6b98e'];

export const MINER_RAMPS: SkinRamps = {
  head: SKIN,
  torso: OVERALLS,
  armNear: SKIN,
  armFar: SKIN_FAR,
  legNear: OVERALLS,
  legFar: OVERALLS_FAR,
  flash: ['#ffffff'],
  unused: [],
};

/**
 * R64's darkest, and the shadow step of every rock ramp (docs/PALETTE.md) — so the character's rim
 * is the same black the world is already built from rather than a second, competing dark.
 */
export const OUTLINE = '#2e222f';

export const MINER_SKIN: SpriteSkin = { ...buildSkin(MINER_RAMPS), outline: OUTLINE };

/** The miner with the pack's baked damage flash suppressed — DELVE renders its own hit feedback. */
export const MINER_SKIN_NO_FLASH: SpriteSkin = { ...MINER_SKIN, hide: ['fx.damage'] };

// ---- equipment as PROCEDURAL MATERIAL -----------------------------------------------------------
//
// The other half of the pipeline, and the reason the surface coordinates exist. A colour table can
// only ever show as many shades as the pack's template carries — two to five per part. A material is
// sampled at each pixel's `(along, around)` and shades itself, so the band count stops being a
// property of the imported art.
//
// These are the SAME shaders the procedural rig used, taking the same `PartCtx`, built from the same
// `colorsFor` swatches and Bayer dither as the rock. A steel pauldron is the metal material rather
// than an imitation of it, which is what keeps a character standing in front of a wall of ore
// looking like it belongs there.

/** Six-stop ramps, shadow → rim, exactly as a stratum declares one. All Resurrect-64. */
const STEEL = ['#2e222f', '#3e3546', '#4c4a4e', '#625565', '#7a7576', '#9babb2'];
const LEATHER = ['#25171c', '#2e222f', '#45293f', '#7a3045', '#a24b6f', '#cd683d'];
const CLOTH_BLUE = ['#1a1932', '#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6'];

/**
 * A part surface CALIBRATED FOR IMPORTED SPRITES, which is a different problem to the rock's.
 *
 * `clothSurface` and `plateSurface` were tuned against one big isolated limb on a 16px grid. Pointed
 * at these sprites they blew out: an imported limb is three to five pixels wide, so cloth's +-0.25
 * of brightness noise swings across most of the band ladder and the figure came out as white speckle
 * with its silhouette dissolved. Same failure the procedural rig hit with edge erosion — a treatment
 * sized for a tile is most of a small part.
 *
 * So: the same `bandsOf` ladder, the same Bayer `quantize`, a quarter of the amplitude, and relief
 * that leans on the surface coordinate rather than on noise. `along` gives a gentle top-to-bottom
 * fall so a limb reads as lit from above, `around` gives the cross-limb round, and the noise is just
 * enough to stop it looking extruded.
 */
export function armourSurface(ctx: PartCtx): Rgb {
  let b = 0.5 + (ctx.brightness - 0.5) * 0.55;
  // Round across the part: brightest just off the spine, falling to the silhouette on both sides.
  b += (ctx.depth - 0.5) * 0.3;
  // Lit from above, so the top of a part is brighter than its bottom.
  b += (0.5 - ctx.along) * 0.16;
  b += (vnoise(ctx.localX * 0.19, ctx.localY * 0.19, TEX_SKIN) - 0.5) * 0.1;
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

/** As `armourSurface`, plus a hard highlight just off the spine — reads as polished metal. */
export function plateArmourSurface(ctx: PartCtx): Rgb {
  const base = 0.5 + (ctx.brightness - 0.5) * 0.5;
  let b = base + (ctx.depth - 0.5) * 0.34 + (0.5 - ctx.along) * 0.14;
  if (ctx.depth > 0.78 && ctx.around > -0.2) b += 0.14;
  b += (vnoise(ctx.localX * 0.13, ctx.localY * 0.13, TEX_SKIN + 5) - 0.5) * 0.07;
  return quantize(bandsOf(ctx.colors), clamp01(b), ctx.px, ctx.py);
}

const TEX_SKIN = 8821; // fixed seed for character texture noise, distinct from the rock's

const material = (shade: (ctx: PartCtx) => Rgb, ramp: readonly string[]): SpriteMaterial => ({
  shade,
  // `colorsFor` wants a mutable array and is far too slow per pixel, so a material resolves its
  // swatches once, here, and the draw loop only ever reads them.
  colors: colorsFor([...ramp]),
});

/**
 * A worked example, and the proof the pipeline does what it claims: plate over the torso and far
 * arm, leather trousers, a cloth sleeve, bare skin for head and near arm.
 *
 * Note what is NOT here — any per-animation work. The coordinates are derived from each frame's own
 * silhouette, so this armour fits all fifteen animations without being authored against any of them.
 */
export const PLATE_ARMOUR: SpriteSkin = {
  ...MINER_SKIN,
  materials: {
    torso: material(plateArmourSurface, STEEL),
    'arm.far': material(armourSurface, STEEL),
    'arm.near': material(armourSurface, CLOTH_BLUE),
    'leg.near': material(armourSurface, LEATHER),
    'leg.far': material(armourSurface, LEATHER),
  },
};

/** Every slot as plate — the clearest view of what the derived surface coordinates look like. */
export const ALL_STEEL: SpriteSkin = {
  ...MINER_SKIN,
  materials: Object.fromEntries(
    ['head', 'torso', 'arm.near', 'arm.far', 'leg.near', 'leg.far'].map((slot) => [
      slot,
      material(plateArmourSurface, STEEL),
    ]),
  ),
};

// ---- where the light is -------------------------------------------------------------------------

/**
 * The player's own lamp, in sprite-local pixels.
 *
 * The game seeds its lamp emitter at the player's centre, slightly above (`py - 0.1` tiles), so the
 * light is ON the character rather than above the scene. In sprite space that is the chest: x at the
 * canvas centre, y a little above the figure's middle.
 *
 * `reach` is deliberately short — about a body's height. A lamp at chest height genuinely does leave
 * the boots dimmer than the shoulders, and that falloff is most of what makes a carried light read as
 * carried rather than as ambient.
 */
export const PLAYER_LAMP: SpriteLight = { x: 24, y: 24, reach: 34 };

/** An external light, for entities the player lights from outside: pass the lamp's offset from them. */
export function lampFrom(dx: number, dy: number, reach = 64): SpriteLight {
  return { x: 24 + dx, y: 24 + dy, reach };
}
