// engine.ts — the mining SIM: player physics (gravity / run / jump), dig resolution, and material
// collection. Pure and DOM-free, so it runs identically in the browser, the dev tools (via tsx),
// and the authoritative server. The static world lives in blocks.ts (re-exported here so callers
// have a single "engine" surface); the DYNAMIC state is split in two (see types.ts):
//   • WorldState  — shared terrain mutations (dug tiles, tile damage). One per world; in
//                   multiplayer every player digs the SAME WorldState.
//   • PlayerState — one player's body + inventory (position/velocity, collected materials, upgrade
//                   levels). There is NO money/selling: everything mined goes into the inventory.
// A `Session` bundles one world + one player; the sim steps a Session (its `.world` may be shared
// across many players). Each function below takes exactly what it touches — world, player, or both.
//
// Attributes (dig power/speed, rich-vein fortune, lantern reach) still drive derived stats via
// `stats()`, but there is currently no way to RAISE them — the coin shop that used to has been
// removed. A future progression pass will wire new (non-monetary) ways to level them up; the
// plumbing is kept in place for that.
import { blockAt, solidAt, rockHp, WIDTH, SURFACE_BASE, surfaceAt, SUB } from './blocks';
import { tileRand } from './rng';
import type { Input, SimEvent, WorldState, PlayerState, Session, Block } from './types';

export * from './blocks';

// --- platformer physics constants (tile units; time in seconds) ---
// Player AABB half-extents, in tiles. The body is 0.9 x 1.82 tiles — TALLER THAN ONE TILE, which is
// the whole point: a one-tile gap no longer fits, so a tunnel has to be dug two tiles tall. That
// added digging cost was the reason for adopting these proportions (#47).
//
// Sized to the character art rather than chosen: the imported sprite's figure is 18 x 29 art px on a
// 16px tile, so 1.12 x 1.81 tiles. The hitbox is the figure's height exactly and a little narrower
// than its width, so shoulders and swinging limbs overhang rather than snagging on corners.
const HALF_WIDTH = 0.45 * SUB;
const HALF_HEIGHT = 0.91 * SUB;
const GRAVITY = 46 * SUB;
const MAX_FALL = 30 * SUB;
const RUN_SPEED = 6 * SUB;
const RUN_ACCEL = 85;
const AIR_ACCEL = 46;
const FRICTION = 60;
// ~1.25 tiles of rise (v²/2g, g=46), UNCHANGED by the size change: jump height in tiles is a
// property of this and gravity, not of the body, so the player still clears a one-tile step exactly
// as before. What did change is headroom — a 1.82-tall body in a 2-tall tunnel has 0.18 tiles above
// its head, so jumping indoors needs a three-tall tunnel.
const JUMP_VELOCITY = 10.7 * SUB;
const REACH = 1 * SUB; // base mining reach in tiles (Chebyshev): adjacent only. Upgradable later.
// One CELL, which after the 2x2 split is HALF A BLOCK — and that is the whole point of the split
// (#44). A mined staircase now has half-block risers, so walking up one is a small correction rather
// than the character hopping a whole block. It was 1 block before, 55% of body height; it is now 27%.
const STEP_UP_TILES = 1;
const COYOTE_TIME = 0.08; // jump just after leaving a ledge
const JUMP_BUFFER = 0.1; // jump requested just before landing
const MAX_STEP_DT = 1 / (30 * SUB); // clamp per-step dt so fast motion can't tunnel a tile

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

// --- derived-stat tuning ---
void SURFACE_BASE;

const FORTUNE_SALT = 0x9e3779b9; // golden-ratio hash constant; decorrelates the rich-vein roll from placement
const RICH_ORE_MULTIPLIER = 3; // a rich vein yields 3× the ore into the inventory
const MS_PER_SECOND = 1000;
const BASE_DIG_INTERVAL_MS = 200; // ms between dig hits at Agility 0
const DIG_INTERVAL_FALLOFF = 0.9; // each Agility level multiplies the interval by this (faster digging)
const FORTUNE_PER_LEVEL = 0.045; // +4.5% rich-vein chance per Fortune level
const FORTUNE_CAP = 0.6; // maximum rich-vein chance
const BASE_LAMP = 3.4; // lamp reach in tiles with no lantern
const LANTERN_LAMP_BONUS = 3; // extra lamp reach from the Deep Lantern

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

/**
 * A fresh player, standing on the surface at the centre column.
 *
 * Takes the seed because the surface is a heightmap: where the ground is depends on the world.
 */
/** The row the feet rest on at `x`: one below the highest surface the body spans. */
function groundUnder(seed: number, x: number, hw: number): number {
  const left = Math.floor(x - hw + EPSILON);
  const right = Math.floor(x + hw - EPSILON);
  let highest = Infinity;
  for (let column = left; column <= right; column++) {
    highest = Math.min(highest, surfaceAt(seed, column));
  }
  return highest + 1;
}

export function newPlayer(seed = 1, body?: { hw: number; hh: number }): PlayerState {
  const startColumn = (WIDTH - 1) >> 1;
  return {
    x: startColumn + 0.5, // player CENTRE (tile units); starts on the surface
    // Feet resting exactly on the first solid row, DERIVED from the body height rather than picked.
    // `SURFACE + 0.5` was right while the body fitted inside one tile; at 1.82 tiles it put the feet
    // inside the first solid row and the player spawned overlapping rock, to be ejected upward over
    // the next few frames. Self-correcting, but it is a pop at best and an ejection in the wrong
    // direction in a tighter spot.
    //
    // The surface is a heightmap now (#44), so this reads the actual ground under the spawn column
    // rather than a constant — on a hill or in a valley the old expression would have buried or
    // dropped the player.
    // The HIGHEST ground under the body, not the ground under its centre column.
    //
    // The body is wider than one cell, so it straddles columns whose surface rows differ — and
    // resting the feet on the centre column's ground buries them in the neighbour's when the
    // neighbour is a step higher. It spawned inside rock and was ejected upward over the next few
    // frames. Latent before the 2x2 split and certain after it, since the body now spans more cells.
    y: groundUnder(seed, startColumn + 0.5, body?.hw ?? HALF_WIDTH) - (body?.hh ?? HALF_HEIGHT),
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 'right',
    digKey: null,
    digTime: 0,
    jumpBuffer: 0,
    coyote: 0,
    jumpLatch: false,
    inv: {},
    log: {},
    depth: 0,
    up: { pick: 0, speed: 0, fortune: 0 },
    tech: { lantern: false },
  };
}

/**
 * Lift a player out of rock they are overlapping, or return false if there is nowhere to go.
 *
 * Needed because the body grew (#47): a save written when the player was 0.92 tiles tall can put a
 * 1.82-tall body inside the ceiling of its own tunnel, and a player wedged in rock cannot move,
 * jump or dig its way out. Searches upward first — a dug tunnel's headroom is the likeliest space —
 * then downward, then gives up so the caller can fall back to a fresh spawn rather than teleporting
 * someone across the map.
 */
/** Whether the player's body would be clear of rock centred at `(x, y)`. */
export function bodyFits(
  world: WorldState,
  x: number,
  y: number,
  body?: { hw?: number; hh?: number },
): boolean {
  const hw = body?.hw ?? HALF_WIDTH;
  const hh = body?.hh ?? HALF_HEIGHT;
  const left = Math.floor(x - hw + EPSILON);
  const right = Math.floor(x + hw - EPSILON);
  const top = Math.floor(y - hh + EPSILON);
  const bottom = Math.floor(y + hh - EPSILON);
  for (let row = top; row <= bottom; row++) {
    if (anySolidInRow(world, left, right, row)) return false;
  }
  return true;
}

export function unstick(world: WorldState, player: PlayerState, maxTiles = 6): boolean {
  const fits = (y: number): boolean => bodyFits(world, player.x, y, player);
  if (fits(player.y)) return true;
  for (let step = 1; step <= maxTiles; step++) {
    for (const y of [player.y - step, player.y + step]) {
      if (!fits(y)) continue;
      player.y = y;
      player.vy = 0;
      player.grounded = false;
      return true;
    }
  }
  return false;
}

/** A fresh single-player session (world + player) for `seed`. */
export function newSession(seed: number): Session {
  return { world: newWorld(seed), player: newPlayer(seed) };
}

export const key = (column: number, row: number): string => `${column},${row}`;

export const isDug = (world: WorldState, column: number, row: number): boolean =>
  row <= surfaceAt(world.seed, column) || !!world.dug[key(column, row)];

/** A cell blocks the player when it's static-solid and not yet dug. */
export const solidCell = (world: WorldState, column: number, row: number): boolean =>
  solidAt(world.seed, column, row) && !isDug(world, column, row);

interface Stats {
  power: number;
  interval: number;
  fortune: number;
  /** Lamp reach in tiles. (Not a reveal radius — see docs/LIGHTING.md.) */
  lamp: number;
}

export function stats(player: PlayerState): Stats {
  return {
    power: 1 + player.up.pick, // damage per hit
    interval: BASE_DIG_INTERVAL_MS * Math.pow(DIG_INTERVAL_FALLOFF, player.up.speed), // ms between dig hits
    fortune: Math.min(FORTUNE_CAP, FORTUNE_PER_LEVEL * player.up.fortune),
    lamp: BASE_LAMP + (player.tech.lantern ? LANTERN_LAMP_BONUS : 0),
  };
}

// --- inventory ---
export const invCount = (player: PlayerState): number =>
  Object.values(player.inv).reduce((sum, count) => sum + count, 0);

// Chip/break one target cell over `dt` while the player pushes into it. Damage is dealt in
// discrete hits paced by dig speed, so it reads as chipping and the sound/juice stay punchy.
// Tile-break progress (`world.dmg`) lives on the shared world; the hit timer (`player.digKey/
// digTime`) and the collected materials (inv/log) are the acting player's. Returns true if
// the cell broke.
export function mineTile(
  session: Session,
  column: number,
  row: number,
  dt: number,
  events: SimEvent[],
): boolean {
  const { world, player } = session;
  // Above the ground in THIS column — the surface is a heightmap, so this is not one row any more.
  if (row <= surfaceAt(world.seed, column)) return false;
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
      // ore goes into the inventory; a rich vein yields 3× the ore
      rich = isRich(world.seed, column, row, fortune);
      quantity = rich ? RICH_ORE_MULTIPLIER : 1;
      player.inv[block.ore] = (player.inv[block.ore] ?? 0) + quantity;
      const record = (player.log[block.ore] ??= { mined: 0, deepest: 0 });
      record.mined += quantity;
      if (row > record.deepest) record.deepest = row;
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

  // The body, read from the player so a differently-sized character collides as itself. Defaults to
  // the constants above, so an existing save or snapshot needs no migration.
  const HW = player.hw ?? HALF_WIDTH;
  const HH = player.hh ?? HALF_HEIGHT;

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

  /**
   * STEP-UP: walk over a one-tile rise instead of being stopped by it.
   *
   * Required by the surface heightmap (#44), not a nicety. The terrain's slope is bounded to about
   * one tile per column, and one tile is a WALL to a walker with no assist — the regression test
   * that drives the player right stopped dead at the first hill. Terraria and every other tile
   * platformer does this for the same reason.
   *
   * Only while grounded, and only if the body actually fits up there, so it can never be used to
   * climb a shaft or phase into a low ceiling.
   */
  const stepUp = (x: number): boolean => {
    if (!player.grounded) return false;
    for (let step = 1; step <= STEP_UP_TILES; step++) {
      if (bodyFits(world, x, player.y - step, player)) {
        player.y -= step;
        // Emitted so the renderer can animate the rise. The sim's move is instant and stays
        // instant; what the player sees does not have to be.
        events.push({
          type: 'step',
          c: Math.floor(x),
          r: Math.floor(player.y + HH),
          tiles: step,
        });
        return true;
      }
    }
    return false;
  };

  // --- integrate + resolve X (stop at walls; mining no longer happens here) ---
  let nextX = player.x + player.vx * dt;
  const rowTop = Math.floor(player.y - HH + EPSILON);
  const rowBottom = Math.floor(player.y + HH - EPSILON);
  if (player.vx > 0) {
    const column = Math.floor(nextX + HW);
    if (anySolidInColumn(world, column, rowTop, rowBottom) && !stepUp(nextX)) {
      nextX = column - HW - EPSILON;
      player.vx = 0;
    }
  } else if (player.vx < 0) {
    const column = Math.floor(nextX - HW);
    if (anySolidInColumn(world, column, rowTop, rowBottom) && !stepUp(nextX)) {
      nextX = column + 1 + HW + EPSILON;
      player.vx = 0;
    }
  }
  player.x = nextX;

  // --- integrate + resolve Y (land / bonk head) ---
  let nextY = player.y + player.vy * dt;
  const columnLeft = Math.floor(player.x - HW + EPSILON);
  const columnRight = Math.floor(player.x + HW - EPSILON);
  player.grounded = false;
  if (player.vy > 0) {
    const row = Math.floor(nextY + HH); // falling → check the floor below the feet
    if (anySolidInRow(world, columnLeft, columnRight, row)) {
      nextY = row - HH - EPSILON;
      player.vy = 0;
      player.grounded = true;
    }
  } else if (player.vy < 0) {
    const row = Math.floor(nextY - HH); // rising → check the ceiling above the head
    if (anySolidInRow(world, columnLeft, columnRight, row)) {
      nextY = row + 1 + HH + EPSILON;
      player.vy = 0;
    }
  }
  player.y = nextY;

  // --- mining: a separate aim/target action, independent of movement (#3). Reach is a tile ring
  // (Chebyshev) around THE BODY, so base REACH=1 = every tile touching the player. ---
  //
  // Measured from the body's tile span, not from the centre tile. That distinction did not matter
  // while the body fitted inside one tile, and it matters a lot now that it spans two: measured from
  // the centre, a 1.82-tall player could dig the tile its head is in but not the one above it, so
  // tunnelling straight up became impossible. For a one-tile body this reduces to the old behaviour
  // exactly.
  if (input.mine) {
    const { column, row } = input.mine;
    const left = Math.floor(player.x - HW + EPSILON);
    const right = Math.floor(player.x + HW - EPSILON);
    const top = Math.floor(player.y - HH + EPSILON);
    const bottom = Math.floor(player.y + HH - EPSILON);
    const dx = Math.max(left - column, 0, column - right);
    const dy = Math.max(top - row, 0, row - bottom);
    if (Math.max(dx, dy) <= REACH && solidCell(world, column, row)) mine(column, row);
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

/** Whether the player is standing at ground level. Needs the world, since the surface undulates. */
export const atSurface = (world: WorldState, player: PlayerState): boolean =>
  player.y <= surfaceAt(world.seed, Math.floor(player.x)) + 1;
