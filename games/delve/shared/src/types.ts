// types.ts — the shared domain types for DELVE, used by the client, the dev tools, and (in a
// later phase) the server. Defining the data shapes in one place keeps the world, the sim,
// the resources, and the eventual client/server protocol honest. Pure types; no runtime code.

/** A tile coordinate in world space (columns increase right, rows increase downward). */
export interface TileCoord {
  readonly column: number;
  readonly row: number;
}

/** An RGB colour as a numeric triple — 0..1 for light intensities, 0..255 for the scrim tint. */
export type LightColor = readonly [number, number, number];

// ---- entity resources (see resources/*.ts + the registry) ------------------------------

export type ResourceType = 'strata' | 'ore';

/** Which crystal shape an ore's icon/extract is drawn with (see the registry's art shapes). */
export type OreShape = 'gem' | 'nugget' | 'prism' | 'shard' | 'cluster';

/** An ore's authored art: a shape plus a `[dark, mid, highlight]` colour triad. */
export interface OreArt {
  readonly shape: OreShape;
  /** `[dark, mid, highlight]` hex colours. */
  readonly c: readonly [string, string, string];
  /** Dim ores (dirt) render as plain rock in the world and never glow. */
  readonly dim?: boolean;
}

/** A depth stratum: where it starts and its 6-stop Resurrect-64 palette ramp. */
export interface StrataResource {
  readonly type: 'strata';
  readonly id: string;
  /** First world row of this band. */
  readonly top: number;
  /** Six hex stops, shadow → rim. */
  readonly ramp: readonly string[];
}

/** An ore item definition — the single gameplay source of truth for a mineable ore. */
export interface OreResource {
  readonly type: 'ore';
  readonly id: number;
  readonly name: string;
  /** `[minRow, maxRow]` where this ore can appear. */
  readonly band: readonly [number, number];
  /** Spawn share within its band. */
  readonly weight: number;
  /** Toughness on top of the rock hp. */
  readonly hp: number;
  /**
   * How special a find this is, `0`..`RARITY_MAX`. The single input to every reward cue — break
   * pitch, particle count, screen shake, whether the pickup gets the big floaty.
   *
   * AUTHORED, deliberately. It used to be the ore's index in the registry, which made one number
   * carry both registry identity and reward tier, so appending an ore file re-tiered the ones
   * already there. Ties are allowed and expected: copper and iron really are equally unremarkable.
   * It is also independent of `band` on purpose — depth says where a material is, not how special
   * it is, and quartz is both deep and plentiful.
   */
  readonly rarity: number;
  /** Single colour for particles / HUD floaties. */
  readonly color: string;
  readonly dim?: boolean;
  /** Codex blurb. */
  readonly desc: string;
  readonly art: OreArt;
}

export type ResourceDef = StrataResource | OreResource;

// ---- world ------------------------------------------------------------------------------

/** The full static descriptor of a cell, from `blockAt(seed, column, row)`. */
export interface Block {
  readonly solid: boolean;
  readonly kind: 'open' | 'rock' | 'ore';
  /** Ore id, or 0 for none. */
  readonly ore: number;
  /** Strata index, or -1 for open/out-of-band. */
  readonly strata: number;
  readonly hp: number;
  readonly dim: boolean;
}

// ---- sim / save state -------------------------------------------------------------------

export type Facing = 'left' | 'right';

// Upgrade levels drive derived stats (see engine `stats()`). They persist on the player, but
// nothing raises them yet — the coin shop was removed; a future non-monetary progression pass will.
export interface UpgradeLevels {
  pick: number; // dig damage per hit
  speed: number; // dig / move speed
  fortune: number; // rich-vein chance (3× materials)
}

export interface TechOwned {
  lantern: boolean; // widened lamp reach
}

/** oreId → lifetime `{ mined, deepest }` (the discovery codex). */
export type OreLog = Record<number, { mined: number; deepest: number }>;

/**
 * The SHARED, mutable world — the part every player in a session digs together (Terraria-style).
 * The static world is a pure function of `seed`; this holds only the mutations. In multiplayer
 * one WorldState is shared across all players; the server owns it and streams deltas.
 */
export interface WorldState {
  seed: number;
  /** `"column,row"` → excavated. */
  dug: Record<string, boolean>;
  /** `"column,row"` → hp already dealt to a not-yet-broken cell (shared tile-break progress). */
  dmg: Record<string, number>;
}

/**
 * One player's PER-PLAYER state: kinematics + mining timing + collected materials + upgrade levels.
 * Distinct from the shared world, so each player has their own body and inventory against the
 * common terrain. There is no money — everything mined is stored in `inv`.
 */
export interface PlayerState {
  /** Continuous player centre, in tile units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: Facing;
  /** This player's current mining target key + accumulated sub-hit time. */
  digKey: string | null;
  digTime: number;
  jumpBuffer: number;
  coyote: number;
  jumpLatch: boolean;
  /** oreId → count held (collected materials). */
  inv: Record<number, number>;
  log: OreLog;
  depth: number;
  up: UpgradeLevels;
  tech: TechOwned;
}

/**
 * A world plus one player — the single-player save unit, and the object the sim steps. In
 * multiplayer, many Sessions share the SAME `world` reference (one shared world, many players).
 */
export interface Session {
  world: WorldState;
  player: PlayerState;
}

/** One frame of player intent handed to the physics step. */
export interface Input {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  /** The tile the player is aiming to mine this frame, or null. */
  mine?: TileCoord | null;
}

/** An event emitted by a sim step, for the presentation layer to react to (juice). */
export interface SimEvent {
  type: 'chip' | 'break' | 'jump';
  c: number;
  r: number;
  ore?: number;
  qty?: number;
  rich?: boolean;
  hp?: number;
  maxHp?: number;
}
