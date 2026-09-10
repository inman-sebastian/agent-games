// engine.ts — the mining SIM: player state, platformer physics (gravity / run / jump), dig
// resolution, economy, upgrades. Pure and DOM-free, so it runs identically in the browser, the
// dev tools (via tsx), and the future authoritative server. The static world lives in
// blocks.ts (re-exported here so callers have a single "engine" surface); dynamic state is the
// SaveState this file mutates.
import { blockAt, solidAt, rockHp, rarityOf, ORE_BY_ID, WIDTH, SURFACE } from './blocks';
import { tileRand } from './rng';
import type { Input, SaveState, SimEvent, TileCoord, UpgradeLevels, TechOwned, Block } from './types';

export * from './blocks';

interface Upgrade {
  readonly name: string;
  readonly base: number;
  readonly mult: number;
  readonly max: number;
  readonly desc: string;
}

// Leveled upgrade tracks (geometric cost).
export const UPGRADES: Record<keyof UpgradeLevels, Upgrade> = {
  pick: { name: 'Pickaxe', base: 25, mult: 1.6, max: 40, desc: 'Damage per hit' },
  speed: { name: 'Agility', base: 40, mult: 1.7, max: 18, desc: 'Move / dig speed' },
  refine: { name: 'Refinery', base: 90, mult: 1.7, max: 24, desc: 'Ore is worth more' },
  fortune: { name: 'Fortune', base: 70, mult: 1.8, max: 15, desc: 'Chance of a rich vein (3× value)' },
};

// One-time tech unlocks that change the sim.
export const TECH: Record<keyof TechOwned, { name: string; cost: number; desc: string }> = {
  scanner: { name: 'Ore Scanner', cost: 200, desc: 'See ore through rock' },
  lantern: { name: 'Deep Lantern', cost: 850, desc: 'Widen your vision underground' },
};

// --- platformer physics constants (tile units; time in seconds) ---
const HALF_WIDTH = 0.36; // player AABB half-extents (fit a 1×1 dug cell)
const HALF_HEIGHT = 0.46;
const GRAVITY = 46;
const MAX_FALL = 30;
const RUN_SPEED = 6;
const RUN_ACCEL = 85;
const AIR_ACCEL = 46;
const FRICTION = 60;
const JUMP_VELOCITY = 10.7; // ~1.25-tile jump (v²/2g, g=46)
const REACH = 1; // base mining reach in tiles (Chebyshev): adjacent only. Upgradable later.
const COYOTE_TIME = 0.08; // jump just after leaving a ledge
const JUMP_BUFFER = 0.1; // jump requested just before landing
const MAX_STEP_DT = 1 / 30; // clamp per-step dt so fast motion can't tunnel a tile

export const PHYS = { HW: HALF_WIDTH, HH: HALF_HEIGHT, GRAVITY, MAX_FALL, RUN_SPEED, JUMP_VEL: JUMP_VELOCITY, REACH } as const;

// --- economy & derived-stat tuning ---
const FORTUNE_SALT = 0x9e3779b9; // golden-ratio hash constant; decorrelates the rich-vein roll from placement
const RICH_ORE_MULTIPLIER = 3; // a rich vein yields 3× the ore
const MS_PER_SECOND = 1000;
const BASE_DIG_INTERVAL_MS = 200; // ms between dig hits at Agility 0
const DIG_INTERVAL_FALLOFF = 0.9; // each Agility level multiplies the interval by this (faster digging)
const REFINE_VALUE_PER_LEVEL = 0.4; // +40% ore sale value per Refinery level
const FORTUNE_PER_LEVEL = 0.045; // +4.5% rich-vein chance per Fortune level
const FORTUNE_CAP = 0.6; // maximum rich-vein chance
const BASE_VISION = 3.4; // lamp reach in tiles with no lantern
const LANTERN_VISION_BONUS = 3; // extra lamp reach from the Deep Lantern

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

/** Whether a mined cell hit a rich vein (3× value). Deterministic per cell so the balance gate
 * sees the same luck the player does. */
export function isRich(seed: number, column: number, row: number, fortune: number): boolean {
  return tileRand(seed ^ FORTUNE_SALT, column, row) < fortune;
}

/** Back-compat static-tile view over blockAt, for callers not yet using the richer descriptor. */
export function tileInfo(seed: number, column: number, row: number): { wall?: boolean; empty?: boolean; ore?: number; maxHp?: number } {
  const block: Block = blockAt(seed, column, row);
  if (block.kind === 'open') return { empty: true, ore: 0, maxHp: 0 };
  return { ore: block.ore, maxHp: block.hp };
}

export function newGame(seed: number): SaveState {
  const startColumn = (WIDTH - 1) >> 1;
  return {
    seed: (seed >>> 0) || 1,
    x: startColumn + 0.5, // player CENTRE (tile units); starts on the surface
    y: SURFACE + 0.5,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 'right',
    digKey: null,
    digTime: 0,
    jumpBuffer: 0,
    coyote: 0,
    jumpLatch: false,
    dug: {},
    dmg: {},
    coins: 0,
    earned: 0,
    inv: {},
    log: {},
    depth: 0,
    best: 0,
    up: { pick: 0, speed: 0, refine: 0, fortune: 0 },
    tech: { scanner: false, lantern: false },
  };
}

export const key = (column: number, row: number): string => `${column},${row}`;
export const isDug = (state: SaveState, column: number, row: number): boolean =>
  row <= SURFACE || !!state.dug[key(column, row)];
/** A cell blocks the player when it's static-solid and not yet dug. */
export const solidCell = (state: SaveState, column: number, row: number): boolean =>
  solidAt(state.seed, column, row) && !isDug(state, column, row);

interface Stats {
  power: number;
  interval: number;
  valueMult: number;
  fortune: number;
  vision: number;
}

export function stats(state: SaveState): Stats {
  return {
    power: 1 + state.up.pick, // damage per hit
    interval: BASE_DIG_INTERVAL_MS * Math.pow(DIG_INTERVAL_FALLOFF, state.up.speed), // ms between dig hits
    valueMult: 1 + REFINE_VALUE_PER_LEVEL * state.up.refine,
    fortune: Math.min(FORTUNE_CAP, FORTUNE_PER_LEVEL * state.up.fortune),
    vision: BASE_VISION + (state.tech.lantern ? LANTERN_VISION_BONUS : 0),
  };
}

export function upgradeCost(kind: keyof UpgradeLevels, level: number): number {
  const upgrade = UPGRADES[kind];
  return Math.floor(upgrade.base * Math.pow(upgrade.mult, level));
}

export function buyUpgrade(state: SaveState, kind: keyof UpgradeLevels): boolean {
  const upgrade = UPGRADES[kind];
  if (state.up[kind] >= upgrade.max) return false;
  const cost = upgradeCost(kind, state.up[kind]);
  if (state.coins < cost) return false;
  state.coins -= cost;
  state.up[kind]++;
  return true;
}

export function buyTech(state: SaveState, kind: keyof TechOwned): boolean {
  const tech = TECH[kind];
  if (state.tech[kind] || state.coins < tech.cost) return false;
  state.coins -= tech.cost;
  state.tech[kind] = true;
  return true;
}

// --- inventory / selling ---
export const invCount = (state: SaveState): number =>
  Object.values(state.inv).reduce((sum, count) => sum + count, 0);

/** Total coins the current inventory would sell for (base value × refinery multiplier). */
export const invValue = (state: SaveState): number => {
  let value = 0;
  for (const oreId in state.inv) {
    const ore = ORE_BY_ID[Number(oreId)];
    if (ore) value += state.inv[oreId] * ore.value;
  }
  return Math.floor(value * stats(state).valueMult);
};

/** Sell everything → coins. Available anytime (no hauling), so the loop can't soft-lock. */
export function sellAll(state: SaveState): number {
  const amount = invValue(state);
  if (amount > 0) {
    state.coins += amount;
    state.earned += amount;
  }
  state.inv = {};
  return amount;
}

// Chip/break one target cell over `dt` while the player pushes into it. Damage is dealt in
// discrete hits paced by dig speed, so it reads as chipping and the sound/juice stay punchy.
// Pushes 'chip'/'break' events; returns true if the cell broke.
export function mineTile(state: SaveState, column: number, row: number, dt: number, events: SimEvent[]): boolean {
  if (row <= SURFACE) return false;
  const block = blockAt(state.seed, column, row);
  const cellKey = key(column, row);
  if (state.digKey !== cellKey) {
    state.digKey = cellKey; // switched target → restart the hit timer
    state.digTime = 0;
  }
  state.digTime += dt;

  const { power, interval, fortune } = stats(state);
  const secondsPerHit = interval / MS_PER_SECOND;
  let broke = false;
  while (state.digTime >= secondsPerHit) {
    state.digTime -= secondsPerHit;
    const dealt = (state.dmg[cellKey] ?? 0) + power;
    if (dealt < block.hp) {
      state.dmg[cellKey] = dealt;
      events.push({ type: 'chip', c: column, r: row, ore: block.ore, hp: block.hp - dealt, maxHp: block.hp });
      continue;
    }
    // broke through
    delete state.dmg[cellKey];
    state.dug[cellKey] = true;
    let quantity = 0;
    let rich = false;
    if (block.ore) {
      // ore goes into the inventory (sold later); a rich vein yields 3× the ore
      rich = isRich(state.seed, column, row, fortune);
      quantity = rich ? RICH_ORE_MULTIPLIER : 1;
      state.inv[block.ore] = (state.inv[block.ore] ?? 0) + quantity;
      const record = (state.log[block.ore] ??= { mined: 0, deepest: 0 });
      record.mined += quantity;
      if (row > record.deepest) record.deepest = row;
      const rarity = rarityOf(block.ore);
      if (rarity > state.best) state.best = rarity;
    }
    events.push({ type: 'break', c: column, r: row, ore: block.ore, qty: quantity, rich, maxHp: block.hp });
    state.digKey = null;
    state.digTime = 0;
    broke = true;
    break;
  }
  return broke;
}

const EPSILON = 1e-4;

/**
 * Advance the sim by `dt` seconds under `input`. Movement is continuous platformer physics
 * (run + gravity + jump) with axis-separated AABB tile collision. Mining is DECOUPLED from
 * movement (#3): `input.mine` names a tile to mine this frame, dug only if it's solid and
 * within REACH. Returns the events the presentation layer turns into juice.
 */
export function physicsStep(state: SaveState, input: Input, dt: number): { events: SimEvent[]; grounded: boolean; jumped: boolean } {
  if (dt > MAX_STEP_DT) dt = MAX_STEP_DT; // never advance far enough to tunnel a tile
  if (dt <= 0) return { events: [], grounded: state.grounded, jumped: false };

  const events: SimEvent[] = [];
  let minedThisFrame = false;
  const mine = (column: number, row: number): void => {
    minedThisFrame = true;
    mineTile(state, column, row, dt, events);
  };

  // --- jump input: buffer a fresh press, decay the buffer ---
  const jumpHeld = !!input.jump;
  if (jumpHeld && !state.jumpLatch) state.jumpBuffer = JUMP_BUFFER;
  state.jumpLatch = jumpHeld;
  state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);

  // --- horizontal intent: accelerate toward run speed, or rub off with friction ---
  const direction = input.left ? -1 : input.right ? 1 : 0;
  if (direction) {
    state.facing = direction < 0 ? 'left' : 'right';
    state.vx += direction * (state.grounded ? RUN_ACCEL : AIR_ACCEL) * dt;
  } else {
    const friction = FRICTION * dt;
    state.vx = state.vx > 0 ? Math.max(0, state.vx - friction) : Math.min(0, state.vx + friction);
  }
  state.vx = clamp(state.vx, -RUN_SPEED, RUN_SPEED);

  // --- gravity ---
  state.vy = Math.min(MAX_FALL, state.vy + GRAVITY * dt);

  // --- integrate + resolve X (stop at walls; mining no longer happens here) ---
  let nextX = state.x + state.vx * dt;
  const rowTop = Math.floor(state.y - HALF_HEIGHT + EPSILON);
  const rowBottom = Math.floor(state.y + HALF_HEIGHT - EPSILON);
  if (state.vx > 0) {
    const column = Math.floor(nextX + HALF_WIDTH);
    if (anySolidInColumn(state, column, rowTop, rowBottom)) {
      nextX = column - HALF_WIDTH - EPSILON;
      state.vx = 0;
    }
  } else if (state.vx < 0) {
    const column = Math.floor(nextX - HALF_WIDTH);
    if (anySolidInColumn(state, column, rowTop, rowBottom)) {
      nextX = column + 1 + HALF_WIDTH + EPSILON;
      state.vx = 0;
    }
  }
  state.x = nextX;

  // --- integrate + resolve Y (land / bonk head) ---
  let nextY = state.y + state.vy * dt;
  const columnLeft = Math.floor(state.x - HALF_WIDTH + EPSILON);
  const columnRight = Math.floor(state.x + HALF_WIDTH - EPSILON);
  state.grounded = false;
  if (state.vy > 0) {
    const row = Math.floor(nextY + HALF_HEIGHT); // falling → check the floor below the feet
    if (anySolidInRow(state, columnLeft, columnRight, row)) {
      nextY = row - HALF_HEIGHT - EPSILON;
      state.vy = 0;
      state.grounded = true;
    }
  } else if (state.vy < 0) {
    const row = Math.floor(nextY - HALF_HEIGHT); // rising → check the ceiling above the head
    if (anySolidInRow(state, columnLeft, columnRight, row)) {
      nextY = row + 1 + HALF_HEIGHT + EPSILON;
      state.vy = 0;
    }
  }
  state.y = nextY;

  // --- mining: a separate aim/target action, independent of movement (#3). Reach is a tile
  // ring (Chebyshev), so base REACH=1 = the eight adjacent tiles. ---
  if (input.mine) {
    const { column, row } = input.mine;
    const withinReach = Math.abs(column - Math.floor(state.x)) <= REACH && Math.abs(row - Math.floor(state.y)) <= REACH;
    if (withinReach && solidCell(state, column, row)) mine(column, row);
  }

  // --- jump (after ground state is known this frame) ---
  let jumped = false;
  if (state.jumpBuffer > 0 && (state.grounded || state.coyote > 0)) {
    state.vy = -JUMP_VELOCITY;
    state.grounded = false;
    state.coyote = 0;
    state.jumpBuffer = 0;
    jumped = true;
    events.push({ type: 'jump', c: Math.floor(state.x), r: Math.floor(state.y) });
  }
  state.coyote = state.grounded ? COYOTE_TIME : Math.max(0, state.coyote - dt);

  // idle → forget the current dig target so re-engaging restarts the hit timer cleanly
  if (!minedThisFrame) {
    state.digKey = null;
    state.digTime = 0;
  }

  const reachedRow = Math.floor(state.y);
  if (reachedRow > state.depth) state.depth = reachedRow;
  return { events, grounded: state.grounded, jumped };
}

function anySolidInColumn(state: SaveState, column: number, rowTop: number, rowBottom: number): boolean {
  for (let row = rowTop; row <= rowBottom; row++) {
    if (solidCell(state, column, row)) return true;
  }
  return false;
}

function anySolidInRow(state: SaveState, columnLeft: number, columnRight: number, row: number): boolean {
  for (let column = columnLeft; column <= columnRight; column++) {
    if (solidCell(state, column, row)) return true;
  }
  return false;
}

export const atSurface = (state: SaveState): boolean => state.y <= SURFACE + 1;

/** Types callers commonly need. */
export type { SaveState, Input, SimEvent, TileCoord } from './types';
