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
import { TEMPLATE_PALETTE } from './sprites/palette';
import type { SpriteSkin } from './sprite';

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

const OVERALLS = ['#2e222f', '#323353', '#484a77', '#4d65b4'];
const OVERALLS_FAR = ['#2e222f', '#2e222f', '#323353', '#484a77'];
const SKIN = ['#7a3045', '#a2653e', '#c7955f', '#e6b98e'];
const SKIN_FAR = ['#4d2b32', '#7a3045', '#a2653e', '#c7955f'];

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

export const MINER_SKIN = buildSkin(MINER_RAMPS);

/** The miner with the pack's baked damage flash suppressed — DELVE renders its own hit feedback. */
export const MINER_SKIN_NO_FLASH: SpriteSkin = { ...MINER_SKIN, hide: ['fx.damage'] };
