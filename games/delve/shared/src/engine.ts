// engine.ts — the mining SIM: player physics (gravity / run / jump), dig resolution, economy,
// upgrades. Pure and DOM-free, so it runs identically in the browser, the dev tools (via tsx),
// and the authoritative server. The static world lives in blocks.ts (re-exported here so callers
// have a single "engine" surface); the DYNAMIC state is split in two (see types.ts):
//   • WorldState  — shared terrain mutations (dug tiles, tile damage). One per world; in
//                   multiplayer every player digs the SAME WorldState.
//   • PlayerState — one player's body + wallet (position/velocity, coins, inventory, upgrades).
// A `Session` bundles one world + one player; the sim steps a Session (its `.world` may be shared
// across many players). Each function below takes exactly what it touches — world, player, or both.
import { blockAt, solidAt, rockHp, rarityOf, ORE_BY_ID, WIDTH, SURFACE } from './blocks';
import { tileRand } from './rng';
import type {
  Input,
  SimEvent,
  WorldState,
  PlayerState,
  Session,
  UpgradeLevels,
  TechOwned,
  Block,
} from './types';

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
  fortune: {
    name: 'Fortune',
    base: 70,
    mult: 1.8,
    max: 15,
    desc: 'Chance of a rich vein (3× value)',
  },
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

// Fixed simulation rate. The authoritative server and each client's prediction step at this exact
// dt, so a replayed input on the client reproduces the server's result (no lockstep needed — the
// client only predicts its own avatar and reconciles). 60 Hz keeps a safe margin under MAX_STEP_DT.
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

export const PHYS = {
  HW: HALF_WIDTH,
  HH: HALF_HEIGHT,
  GRAVITY,
  MAX_FALL,
  RUN_SPEED,
  JUMP_VEL: JUMP_VELOCITY,
  REACH,
} as const;

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

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Whether a mined cell hit a rich vein (3× value). Deterministic per cell so the balance gate
 * sees the same luck the player does. */
export function isRich(seed: number, column: number, row: number, fortune: number): boolean {
  return tileRand(seed ^ FORTUNE_SALT, column, row) < fortune;
}

/** Back-compat static-tile view over blockAt, for callers not yet using the richer descriptor. */
export function tileInfo(
  seed: number,
  column: number,
  row: number,
): { wall?: boolean; empty?: boolean; ore?: number; maxHp?: number } {
  const block: Block = blockAt(seed, column, row);
  if (block.kind === 'open') return { empty: true, ore: 0, maxHp: 0 };
  return { ore: block.ore, maxHp: block.hp };
}

/** A fresh shared world for `seed`. */
export function newWorld(seed: number): WorldState {
  return { seed: seed >>> 0 || 1, dug: {}, dmg: {} };
}

/** A fresh player, spawned on the surface at the centre column. */
export function newPlayer(): PlayerState {
  const startColumn = (WIDTH - 1) >> 1;
  return {
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

/** A fresh single-player session (world + player) for `seed`. */
export function newSession(seed: number): Session {
  return { world: newWorld(seed), player: newPlayer() };
}

export const key = (column: number, row: number): string => `${column},${row}`;

export const isDug = (world: WorldState, column: number, row: number): boolean =>
  row <= SURFACE || !!world.dug[key(column, row)];

/** A cell blocks the player when it's static-solid and not yet dug. */
export const solidCell = (world: WorldState, column: number, row: number): boolean =>
  solidAt(world.seed, column, row) && !isDug(world, column, row);

interface Stats {
  power: number;
  interval: number;
  valueMult: number;
  fortune: number;
  vision: number;
}

export function stats(player: PlayerState): Stats {
  return {
    power: 1 + player.up.pick, // damage per hit
    interval: BASE_DIG_INTERVAL_MS * Math.pow(DIG_INTERVAL_FALLOFF, player.up.speed), // ms between dig hits
    valueMult: 1 + REFINE_VALUE_PER_LEVEL * player.up.refine,
    fortune: Math.min(FORTUNE_CAP, FORTUNE_PER_LEVEL * player.up.fortune),
    vision: BASE_VISION + (player.tech.lantern ? LANTERN_VISION_BONUS : 0),
  };
}

export function upgradeCost(kind: keyof UpgradeLevels, level: number): number {
  const upgrade = UPGRADES[kind];
  return Math.floor(upgrade.base * Math.pow(upgrade.mult, level));
}

export function buyUpgrade(player: PlayerState, kind: keyof UpgradeLevels): boolean {
  const upgrade = UPGRADES[kind];
  if (player.up[kind] >= upgrade.max) return false;
  const cost = upgradeCost(kind, player.up[kind]);
  if (player.coins < cost) return false;
  player.coins -= cost;
  player.up[kind]++;
  return true;
}

export function buyTech(player: PlayerState, kind: keyof TechOwned): boolean {
  const tech = TECH[kind];
  if (player.tech[kind] || player.coins < tech.cost) return false;
  player.coins -= tech.cost;
  player.tech[kind] = true;
  return true;
}

// --- inventory / selling ---
export const invCount = (player: PlayerState): number =>
  Object.values(player.inv).reduce((sum, count) => sum + count, 0);

/** Total coins the current inventory would sell for (base value × refinery multiplier). */
export const invValue = (player: PlayerState): number => {
  let value = 0;
  for (const oreId in player.inv) {
    const ore = ORE_BY_ID[Number(oreId)];
    if (ore) value += player.inv[oreId] * ore.value;
  }
  return Math.floor(value * stats(player).valueMult);
};

/** Sell everything → coins. Available anytime (no hauling), so the loop can't soft-lock. */
export function sellAll(player: PlayerState): number {
  const amount = invValue(player);
  if (amount > 0) {
    player.coins += amount;
    player.earned += amount;
  }
  player.inv = {};
  return amount;
}

// Chip/break one target cell over `dt` while the player pushes into it. Damage is dealt in
// discrete hits paced by dig speed, so it reads as chipping and the sound/juice stay punchy.
// Tile-break progress (`world.dmg`) lives on the shared world; the hit timer (`player.digKey/
// digTime`) and the spoils (inv/log/best) are the acting player's. Returns true if the cell broke.
export function mineTile(
  session: Session,
  column: number,
  row: number,
  dt: number,
  events: SimEvent[],
): boolean {
  if (row <= SURFACE) return false;
  const { world, player } = session;
  const block = blockAt(world.seed, column, row);
  const cellKey = key(column, row);
  if (player.digKey !== cellKey) {
    player.digKey = cellKey; // switched target → restart the hit timer
    player.digTime = 0;
  }
  player.digTime += dt;

  const { power, interval, fortune } = stats(player);
  const secondsPerHit = interval / MS_PER_SECOND;
  let broke = false;
  while (player.digTime >= secondsPerHit) {
    player.digTime -= secondsPerHit;
    const dealt = (world.dmg[cellKey] ?? 0) + power;
    if (dealt < block.hp) {
      world.dmg[cellKey] = dealt;
      events.push({
        type: 'chip',
        c: column,
        r: row,
        ore: block.ore,
        hp: block.hp - dealt,
        maxHp: block.hp,
      });
      continue;
    }
    // broke through
    delete world.dmg[cellKey];
    world.dug[cellKey] = true;
    let quantity = 0;
    let rich = false;
    if (block.ore) {
      // ore goes into the inventory (sold later); a rich vein yields 3× the ore
      rich = isRich(world.seed, column, row, fortune);
      quantity = rich ? RICH_ORE_MULTIPLIER : 1;
      player.inv[block.ore] = (player.inv[block.ore] ?? 0) + quantity;
      const record = (player.log[block.ore] ??= { mined: 0, deepest: 0 });
      record.mined += quantity;
      if (row > record.deepest) record.deepest = row;
      const rarity = rarityOf(block.ore);
      if (rarity > player.best) player.best = rarity;
    }
    events.push({
      type: 'break',
      c: column,
      r: row,
      ore: block.ore,
      qty: quantity,
      rich,
      maxHp: block.hp,
    });
    player.digKey = null;
    player.digTime = 0;
    broke = true;
    break;
  }
  return broke;
}

const EPSILON = 1e-4;

/**
 * Advance the session by `dt` seconds under `input`. Movement is continuous platformer physics
 * (run + gravity + jump) with axis-separated AABB tile collision against the shared world. Mining
 * is DECOUPLED from movement (#3): `input.mine` names a tile to mine this frame, dug only if it's
 * solid and within REACH. Returns the events the presentation layer turns into juice.
 */
export function physicsStep(
  session: Session,
  input: Input,
  dt: number,
): { events: SimEvent[]; grounded: boolean; jumped: boolean } {
  if (dt > MAX_STEP_DT) dt = MAX_STEP_DT; // never advance far enough to tunnel a tile
  const { world, player } = session;
  if (dt <= 0) return { events: [], grounded: player.grounded, jumped: false };

  const events: SimEvent[] = [];
  let minedThisFrame = false;
  const mine = (column: number, row: number): void => {
    minedThisFrame = true;
    mineTile(session, column, row, dt, events);
  };

  // --- jump input: buffer a fresh press, decay the buffer ---
  const jumpHeld = !!input.jump;
  if (jumpHeld && !player.jumpLatch) player.jumpBuffer = JUMP_BUFFER;
  player.jumpLatch = jumpHeld;
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

  // --- horizontal intent: accelerate toward run speed, or rub off with friction ---
  const direction = input.left ? -1 : input.right ? 1 : 0;
  if (direction) {
    player.facing = direction < 0 ? 'left' : 'right';
    player.vx += direction * (player.grounded ? RUN_ACCEL : AIR_ACCEL) * dt;
  } else {
    const friction = FRICTION * dt;
    player.vx =
      player.vx > 0 ? Math.max(0, player.vx - friction) : Math.min(0, player.vx + friction);
  }
  player.vx = clamp(player.vx, -RUN_SPEED, RUN_SPEED);

  // --- gravity ---
  player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);

  // --- integrate + resolve X (stop at walls; mining no longer happens here) ---
  let nextX = player.x + player.vx * dt;
  const rowTop = Math.floor(player.y - HALF_HEIGHT + EPSILON);
  const rowBottom = Math.floor(player.y + HALF_HEIGHT - EPSILON);
  if (player.vx > 0) {
    const column = Math.floor(nextX + HALF_WIDTH);
    if (anySolidInColumn(world, column, rowTop, rowBottom)) {
      nextX = column - HALF_WIDTH - EPSILON;
      player.vx = 0;
    }
  } else if (player.vx < 0) {
    const column = Math.floor(nextX - HALF_WIDTH);
    if (anySolidInColumn(world, column, rowTop, rowBottom)) {
      nextX = column + 1 + HALF_WIDTH + EPSILON;
      player.vx = 0;
    }
  }
  player.x = nextX;

  // --- integrate + resolve Y (land / bonk head) ---
  let nextY = player.y + player.vy * dt;
  const columnLeft = Math.floor(player.x - HALF_WIDTH + EPSILON);
  const columnRight = Math.floor(player.x + HALF_WIDTH - EPSILON);
  player.grounded = false;
  if (player.vy > 0) {
    const row = Math.floor(nextY + HALF_HEIGHT); // falling → check the floor below the feet
    if (anySolidInRow(world, columnLeft, columnRight, row)) {
      nextY = row - HALF_HEIGHT - EPSILON;
      player.vy = 0;
      player.grounded = true;
    }
  } else if (player.vy < 0) {
    const row = Math.floor(nextY - HALF_HEIGHT); // rising → check the ceiling above the head
    if (anySolidInRow(world, columnLeft, columnRight, row)) {
      nextY = row + 1 + HALF_HEIGHT + EPSILON;
      player.vy = 0;
    }
  }
  player.y = nextY;

  // --- mining: a separate aim/target action, independent of movement (#3). Reach is a tile
  // ring (Chebyshev), so base REACH=1 = the eight adjacent tiles. ---
  if (input.mine) {
    const { column, row } = input.mine;
    const withinReach =
      Math.abs(column - Math.floor(player.x)) <= REACH &&
      Math.abs(row - Math.floor(player.y)) <= REACH;
    if (withinReach && solidCell(world, column, row)) mine(column, row);
  }

  // --- jump (after ground state is known this frame) ---
  let jumped = false;
  if (player.jumpBuffer > 0 && (player.grounded || player.coyote > 0)) {
    player.vy = -JUMP_VELOCITY;
    player.grounded = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    jumped = true;
    events.push({ type: 'jump', c: Math.floor(player.x), r: Math.floor(player.y) });
  }
  player.coyote = player.grounded ? COYOTE_TIME : Math.max(0, player.coyote - dt);

  // idle → forget the current dig target so re-engaging restarts the hit timer cleanly
  if (!minedThisFrame) {
    player.digKey = null;
    player.digTime = 0;
  }

  const reachedRow = Math.floor(player.y);
  if (reachedRow > player.depth) player.depth = reachedRow;
  return { events, grounded: player.grounded, jumped };
}

function anySolidInColumn(
  world: WorldState,
  column: number,
  rowTop: number,
  rowBottom: number,
): boolean {
  for (let row = rowTop; row <= rowBottom; row++) {
    if (solidCell(world, column, row)) return true;
  }
  return false;
}

function anySolidInRow(
  world: WorldState,
  columnLeft: number,
  columnRight: number,
  row: number,
): boolean {
  for (let column = columnLeft; column <= columnRight; column++) {
    if (solidCell(world, column, row)) return true;
  }
  return false;
}

export const atSurface = (player: PlayerState): boolean => player.y <= SURFACE + 1;
