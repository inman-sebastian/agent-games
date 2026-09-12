// sprite-manifest.ts — exactly which files of the reference pack DELVE imports, and how.
//
// A manifest rather than per-file invocations, for two reasons. It records provenance: this is the
// definitive list of what the game takes from the pack. And the import has to be a BATCH, because
// all animations share one template palette — see `TEMPLATE_PALETTE` in the generated
// `sprites/palette.ts`. Importing files one at a time gave each animation its own palette, so index
// 1 meant a different colour in every animation and any equipment override keyed on it was wrong
// depending on which animation was playing.
//
// `root` is wherever the purchased pack is unzipped locally. The pack is not committed.

/**
 * The canvas row the character's feet stand on, shared by every animation.
 *
 * ONE value, not per animation. It is a property of the pack's canvas, not of a pose: every file
 * draws on the same 48px canvas with the same ground line, and the pack's grounded animations —
 * idle, walk, run, land, death, hurt — all bottom out on row 39, so contact is row 40.
 *
 * Deriving it per animation instead, as the modal lowest row, gave 44 for jump and 38 for push:
 * a mostly-airborne animation's typical bottom row is not where its feet stand, so the character
 * would have jumped DOWNWARD and floated 2px while pushing. The importer asserts the grounded
 * animations agree with this number, which is the part worth checking automatically.
 */
export const GROUND_ROW = 40;

export interface SpriteSource {
  /** Path within the pack. */
  readonly file: string;
  /** Exported const name; the module name is derived from it. */
  readonly name: string;
  /** Extra layer names to skip for this file, beyond the shared list. */
  readonly skip?: readonly string[];
  /**
   * Accept the `.aseprite` layers over the sibling PNG export. Only for files where the export is
   * demonstrably stale or blended — the reason is recorded per entry, never assumed.
   */
  readonly trustSource?: string;
  /**
   * True where the character is definitionally standing on the ground for most of the animation, so
   * its own contact row must equal `GROUND_ROW`. Airborne and crouched animations are exempt.
   */
  readonly grounded?: boolean;
}

export const SPRITE_SOURCES: readonly SpriteSource[] = [
  { file: 'Idle/Player Idle 48x48.aseprite', name: 'PLAYER_IDLE', grounded: true },
  { file: 'Walk/PlayerWalk 48x48.aseprite', name: 'PLAYER_WALK', grounded: true },
  { file: 'Run/player run 48x48.aseprite', name: 'PLAYER_RUN', grounded: true },
  { file: 'Jump/player new jump 48x48.aseprite', name: 'PLAYER_JUMP' },
  { file: 'Land/player land 48x48.aseprite', name: 'PLAYER_LAND', grounded: true },
  { file: 'Crouch-Idle/Player Crouch-Idle 48x48.aseprite', name: 'PLAYER_CROUCH_IDLE' },
  { file: 'Crouch-Walk/player crouch-walk 48x48.aseprite', name: 'PLAYER_CROUCH_WALK' },
  { file: 'Roll/Player Roll 48x48.aseprite', name: 'PLAYER_ROLL' },
  {
    file: 'Hurt-Damaged/Player Hurt 48x48.aseprite',
    name: 'PLAYER_HURT',
    grounded: true,
    // Geometry matches the export exactly; only colours differ, which is the damage flash composited
    // at reduced opacity. Keeping the flash as an unblended fx.damage layer is more useful than a
    // baked blend, since DELVE renders its own hit feedback.
    trustSource: 'damage flash is blended in the export; we keep the layer unblended',
  },
  { file: 'Death/Player Death 64x64.aseprite', name: 'PLAYER_DEATH', grounded: true },
  { file: 'Push/player push 48x48.aseprite', name: 'PLAYER_PUSH' },
  { file: 'Pull/player pull 48x48.aseprite', name: 'PLAYER_PULL' },
  { file: 'PushPull (idle state)/player push idle 48x48.aseprite', name: 'PLAYER_PUSH_IDLE' },
  { file: 'Ledge Grab-Climb/player ledge climb 48x48.aseprite', name: 'PLAYER_LEDGE_CLIMB' },
  {
    file: 'Air Spin/player air spin 48x48.aseprite',
    name: 'PLAYER_AIR_SPIN',
    // Differs from the export in BOTH directions, spread evenly across every layer, which is the
    // signature of an export taken before the layers were last edited.
    trustSource: 'PNG export predates the layer edits',
  },
];

/**
 * Pack animations deliberately NOT imported, with the reason — so the gap is a decision on record
 * rather than an oversight someone re-discovers.
 */
export const SPRITE_OMISSIONS: readonly { readonly file: string; readonly why: string }[] = [
  { file: 'Slide', why: 'flattened to Body + Dust; no per-part layers' },
  { file: 'Dash', why: 'flattened to a single layer' },
  { file: 'Katana walk', why: 'flattened' },
  { file: 'Climb (facing side of player)', why: 'flattened' },
  { file: 'Shooting (running and aiming)', why: 'split into upper/lower halves, not body parts' },
  { file: 'Katana Run Attack', why: 'split into upper/lower halves' },
  { file: 'Katana Air Attack', why: 'upper body only' },
  { file: 'Wall Slide / Wall Land', why: 'part layers hidden in favour of a flat composite' },
  { file: 'Climb (facing back of player)', why: 'a back view; DELVE is side-on only' },
  {
    file: 'Punch / Punch Cross / Punch Jab',
    why: 'no melee design yet — import when there is one',
  },
  { file: 'Sword * / Katana *', why: 'no weapon design yet — the weapon slot is ready for them' },
];
