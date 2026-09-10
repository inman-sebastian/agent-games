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
  /** Coins per unit when sold. */
  readonly value: number;
  /** Toughness on top of the rock hp. */
  readonly hp: number;
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
  readonly value: number;
  readonly dim: boolean;
}

// ---- sim / save state -------------------------------------------------------------------

export type Facing = 'left' | 'right';

export interface UpgradeLevels {
  pick: number;
  speed: number;
  refine: number;
  fortune: number;
}

export interface TechOwned {
  scanner: boolean;
  lantern: boolean;
}

/** The dynamic game state (the save). The static world is a pure function of `seed`. */
export interface SaveState {
  seed: number;
  /** Continuous player centre, in tile units. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: Facing;
  /** Current mining target key + accumulated sub-hit time. */
  digKey: string | null;
  digTime: number;
  jumpBuffer: number;
  coyote: number;
  jumpLatch: boolean;
  /** `"column,row"` → excavated. */
  dug: Record<string, boolean>;
  /** `"column,row"` → hp already dealt to a not-yet-broken cell. */
  dmg: Record<string, number>;
  coins: number;
  earned: number;
  /** oreId → count held. */
  inv: Record<number, number>;
  /** oreId → lifetime { mined, deepest } (the codex). */
  log: Record<number, { mined: number; deepest: number }>;
  depth: number;
  best: number;
  up: UpgradeLevels;
  tech: TechOwned;
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
