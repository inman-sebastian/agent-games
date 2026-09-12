// sprite-manifest.ts — every imported sprite ENTITY, which files it comes from, and how.
//
// A manifest rather than per-file invocations, for two reasons. It records provenance: this is the
// definitive list of what the game takes from the pack. And the import has to be a BATCH, because
// all animations share one template palette — see `TEMPLATE_PALETTE` in the generated
// `sprites/palette.ts`. Importing files one at a time gave each animation its own palette, so index
// 1 meant a different colour in every animation and any equipment override keyed on it was wrong
// depending on which animation was playing.
//
// Adding an entity — an enemy, an NPC, a prop — is an entry in `ENTITIES` below and a re-run of the
// importer. Nothing else. The source packs are not committed; the generated modules are.
//
// Slots are declared PER ENTITY, because a spider is not a biped. What stays global is the template
// palette and therefore the skin pipeline: equipment and materials authored once apply to any entity
// whose slots they name.

/**
 * One imported entity: where its art comes from, what its parts are called, and where its feet are.
 */
export interface SpriteEntity {
  /** Directory name under `client/src/render/entity/sprites/`, and the export prefix. */
  readonly name: string;
  /** Pack subdirectory, relative to the pack root passed on the command line. */
  readonly root: string;
  /**
   * The canvas row this entity's feet stand on, shared by all its animations.
   *
   * ONE value per entity, not per animation: it is a property of the canvas the artist drew on, not
   * of a pose. Deriving it per animation as the modal lowest row gave 44 for the player's jump and
   * 38 for its push, which would have made the character jump DOWNWARD and float while pushing. The
   * importer asserts that the animations marked `grounded` agree with it.
   */
  readonly ground: number;
  /**
   * Layer-name patterns → slot names, tried in order. Declared per entity because the parts differ:
   * a biped has arms and legs, a spider has eight of something else.
   *
   * Overrides key on the slot name, so a chest piece that fits the idle has to fit the walk too —
   * and this pack calls one body part "Back Arm", "Back Hand" and "Left Arm" in three files.
   */
  readonly slots: readonly (readonly [RegExp, string])[];
  /** Paint order for this entity's slots, bottom to top. The canonical SET, not a sort key. */
  readonly order: readonly string[];
  readonly sources: readonly SpriteSource[];
}

export interface SpriteSource {
  /** Path within the entity's `root`. */
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
   * True where the entity is definitionally standing on the ground for most of the animation, so its
   * own contact row must equal the entity's `ground`. Airborne and crouched animations are exempt.
   */
  readonly grounded?: boolean;
}

/** The biped slot vocabulary. Shared by the player and by any humanoid enemy or NPC imported later. */
export const BIPED_SLOTS: readonly (readonly [RegExp, string])[] = [
  [/^head$/i, 'head'],
  [/^torso$/i, 'torso'],
  [/^(back|left)\s*(arm|hand)$/i, 'arm.far'],
  [/^(front|lead|right)\s*(arm|hand)$/i, 'arm.near'],
  [/^(back|left)\s*leg$/i, 'leg.far'],
  [/^((front|lead|right)\s*leg|new legs)$/i, 'leg.near'],
  // The pack already separates weapons onto their own layer, which is the equipment slot for free.
  [/^(sword(\/sheathe)?|gun|katana)$/i, 'weapon'],
  // Baked FX kept rather than skipped: keeping it makes the import exact, and a caller that renders
  // its own hit feedback simply does not draw this slot.
  [/^damage indicator$/i, 'fx.damage'],
];

export const BIPED_ORDER = [
  'arm.far',
  'leg.far',
  'torso',
  'leg.near',
  'arm.near',
  'head',
  'weapon',
  'fx.damage',
] as const;

export const ENTITIES: readonly SpriteEntity[] = [
  {
    name: 'player',
    root: '2D-Pixel-Art-Character-Template',
    ground: 40,
    slots: BIPED_SLOTS,
    order: [...BIPED_ORDER],
    sources: [
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
        // Geometry matches the export exactly; only colours differ, which is the damage flash
        // composited at reduced opacity. Keeping the flash as an unblended fx.damage layer is more
        // useful than a baked blend, since DELVE renders its own hit feedback.
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
    ],
  },
];

/**
 * Source animations deliberately NOT imported, with the reason — so a gap is a decision on record
 * rather than an oversight someone re-discovers and re-litigates.
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
