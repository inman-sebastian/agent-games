// Terraria's player collision (#93), ported from Collision.cs (1.4.0.5, decompiled) for gravity pointing down and a
// world of full cells and slopes: no half bricks, platforms, water walking or minecarts, so those branches are gone
// and every tile is solid rock. Statement for statement otherwise, and in Terraria's units — a cell is a 16 px
// tile, velocity is pixels per tick — so each function reads against its original. `(int)` of a coordinate is
// Math.floor here, and Terraria's -1 for "no tile yet" is NONE, which no row equals: the same for the non-negative
// coordinates Terraria has, and right above DELVE's row 0, where -1 is a row. Checked against Terraria's own code by
// tools/terraria-oracle (collision.test.ts). How physicsStep uses them: docs/SLOPES.md.
import { FULL, OPEN } from './slopes';

/** A cell's shape at (column, row): OPEN, FULL or a slope 1–4 (slopes.ts). */
export type ShapeLookup = (column: number, row: number) => number;

const TILE = 16;
const NONE = Number.NaN; // equal to nothing, itself included
/** Collision.TileCollision's head-bump nudge (`gravDir == 1 ? 0.00999999977648258 : 0.0`). */
const HEAD_NUDGE = 0.00999999977648258;
/** Collision.SlopeCollision's least downward speed under a ceiling slope. */
const CEILING_SPEED = 0.0101;
const CEILING_SPEED_TEST = 0.0100999996066093;

const tileOf = (pixel: number): number => Math.floor(pixel / TILE);
/** `height / 16 + (height % 16 == 0 ? 0 : 1)`: the body's height in whole tiles, rounded up. */
const tilesTall = (height: number): number =>
  Math.trunc(height / TILE) + (height % TILE === 0 ? 0 : 1);

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Collision.WalkDownSlope (Collision.cs:1187): a body resting on a floor slope and walking down it gets the
 * horizontal speed added to its fall, so it follows the slope instead of launching off. Returns the new vy.
 */
export function walkDownSlope(
  shapeAt: ShapeLookup,
  body: Body,
  width: number,
  height: number,
  gravity: number,
): number {
  const { x, y, vx } = body;
  let vy = body.vy;
  if (vy !== gravity) return vy;
  const left = tileOf(x);
  const right = tileOf(x + width);
  const row = tileOf(y + height + 4);
  let highest = (row + 3) * TILE;
  let bestColumn = NONE;
  let bestRow = NONE;
  const downhill = vx < 0 ? 2 : 1;
  const bodyX = Math.floor(x);
  const bodyY = Math.floor(y);
  for (let column = left; column <= right; column++) {
    for (let r = row; r <= row + 1; r++) {
      const shape = shapeAt(column, r);
      if (shape === OPEN) continue;
      const top = r * TILE;
      // new Rectangle(column * 16, r * 16 - 17, 16, 16).Intersects(the body)
      const above = r * TILE - 17;
      const intersects =
        bodyX < column * TILE + TILE &&
        column * TILE < bodyX + width &&
        bodyY < above + TILE &&
        above < bodyY + height;
      if (!intersects || top > highest) continue;
      if (top === highest) {
        if (shape === FULL) continue;
        if (!Number.isNaN(bestColumn) && shapeAt(bestColumn, bestRow) > FULL) {
          if (shape !== downhill) continue;
        }
      }
      highest = top;
      bestColumn = column;
      bestRow = r;
    }
  }
  if (Number.isNaN(bestColumn)) return vy;
  const slope = shapeAt(bestColumn, bestRow);
  const tileX = bestColumn * TILE;
  const tileY = bestRow * TILE;
  if (slope === 1) {
    const along = x - tileX;
    if (y + height >= tileY + along && vx > 0) vy += Math.abs(vx);
  } else if (slope === 2) {
    const along = tileX + TILE - (x + width);
    if (y + height >= tileY + along && vx < 0) vy += Math.abs(vx);
  }
  return vy;
}

export interface TileHit {
  vx: number;
  vy: number;
  /** Collision.up: the head hit a tile. */
  up: boolean;
  /** Collision.down: a tile is under the feet where the move ends. */
  down: boolean;
}

/**
 * Collision.TileCollision (Collision.cs:1566): the velocity clipped so the body, moved by it, doesn't enter a tile.
 * A slope entered from its open side is passed through (slopeCollision rides it), a floor slope never snaps a
 * landing, and the side wall of a cell beside a slope's low edge is skipped.
 */
export function tileCollision(
  shapeAt: ShapeLookup,
  body: Body,
  width: number,
  height: number,
): TileHit {
  const { x, y, vx, vy } = body;
  let up = false;
  let down = false;
  let resultX = vx;
  let resultY = vy;
  const nextX = x + vx;
  const nextY = y + vy;
  const firstColumn = tileOf(x) - 1;
  const endColumn = tileOf(x + width) + 2;
  const firstRow = tileOf(y) - 1;
  const endRow = tileOf(y + height) + 2;
  let wallColumn = NONE;
  let wallRow = NONE;
  let floorColumn = NONE;
  let floorRow = NONE;
  let floorTop = (endRow + 3) * TILE;
  const speed = Math.abs(vx);
  for (let column = firstColumn; column < endColumn; column++) {
    for (let row = firstRow; row < endRow; row++) {
      const shape = shapeAt(column, row);
      if (shape === OPEN) continue;
      const tileX = column * TILE;
      const tileY = row * TILE;
      const overlaps =
        nextX + width > tileX &&
        nextX < tileX + TILE &&
        nextY + height > tileY &&
        nextY < tileY + TILE;
      if (!overlaps) continue;
      let floorSlope = false;
      let passThrough = false;
      if (shape > 2) {
        if (shape === 3 && y + speed >= tileY && x >= tileX) passThrough = true;
        if (shape === 4 && y + speed >= tileY && x + width <= tileX + TILE) passThrough = true;
      } else if (shape > 0) {
        floorSlope = true;
        const feetWithin = y + height - speed <= tileY + TILE;
        if (shape === 1 && feetWithin && x >= tileX) passThrough = true;
        if (shape === 2 && feetWithin && x + width <= tileX + TILE) passThrough = true;
      }
      if (passThrough) continue;
      if (y + height <= tileY) {
        down = true;
        if (floorTop > tileY) {
          floorColumn = column;
          floorRow = row;
          if (floorColumn !== wallColumn && !floorSlope) {
            resultY = tileY - (y + height);
            floorTop = tileY;
          }
        }
      } else if (x + width <= tileX) {
        const leftShape = shapeAt(column - 1, row);
        if (leftShape !== 2 && leftShape !== 4) {
          wallColumn = column;
          wallRow = row;
          if (wallRow !== floorRow) resultX = tileX - (x + width);
          if (floorColumn === wallColumn) resultY = vy;
        }
      } else if (x >= tileX + TILE) {
        const rightShape = shapeAt(column + 1, row);
        if (rightShape !== 1 && rightShape !== 3) {
          wallColumn = column;
          wallRow = row;
          if (wallRow !== floorRow) resultX = tileX + TILE - x;
          if (floorColumn === wallColumn) resultY = vy;
        }
      } else if (y >= tileY + TILE) {
        up = true;
        floorColumn = column;
        floorRow = row;
        resultY = tileY + TILE - y + HEAD_NUDGE;
        if (floorRow === wallRow) resultX = vx;
      }
    }
  }
  return { vx: resultX, vy: resultY, up, down };
}

/**
 * Collision.SlopeCollision (Collision.cs:1284): after the move, the feet ride a floor slope's diagonal and the
 * head is pushed down by a ceiling slope's. A push the tiles won't allow becomes a sideways slide.
 */
export function slopeCollision(
  shapeAt: ShapeLookup,
  body: Body,
  width: number,
  height: number,
): Body {
  const { x, y, vx } = body;
  let vy = body.vy;
  let resultVx = vx;
  const riding = [false, false, false, false, false];
  let highestFeet = y; // y1
  let lowestHead = y; // y2
  let nextX = x;
  let nextY = y;
  const firstColumn = tileOf(x) - 1;
  const endColumn = tileOf(x + width) + 2;
  const firstRow = tileOf(y) - 1;
  const endRow = tileOf(y + height) + 2;
  for (let column = firstColumn; column < endColumn; column++) {
    for (let row = firstRow; row < endRow; row++) {
      const shape = shapeAt(column, row);
      if (shape === OPEN) continue;
      const tileX = column * TILE;
      const tileY = row * TILE;
      const overlaps =
        x + width > tileX && x < tileX + TILE && y + height > tileY && y < tileY + TILE;
      if (!overlaps) continue;
      if (shape === 3 || shape === 4) {
        const along = shape === 3 ? x - tileX : tileX + TILE - (x + width);
        if (along >= 0) {
          if (y <= tileY + TILE - along) {
            const push = tileY + TILE - y - along;
            if (y + push > lowestHead) {
              nextY = y + push;
              lowestHead = nextY;
              if (vy < CEILING_SPEED_TEST) vy = CEILING_SPEED;
              riding[shape] = true;
            }
          }
        } else if (y > tileY) {
          const bottom = tileY + TILE;
          if (nextY < bottom) {
            nextY = bottom;
            if (vy < CEILING_SPEED_TEST) vy = CEILING_SPEED;
          }
        }
      }
      if (shape === 1 || shape === 2) {
        const along = shape === 1 ? x - tileX : tileX + TILE - (x + width);
        if (along >= 0) {
          if (y + height >= tileY + along) {
            const lift = tileY - (y + height) + along;
            if (y + lift < highestFeet) {
              nextY = y + lift;
              highestFeet = nextY;
              if (vy > 0) vy = 0;
              riding[shape] = true;
            }
          }
        } else {
          const top = tileY - height;
          if (nextY > top) {
            nextY = top;
            if (vy > 0) vy = 0;
          }
        }
      }
    }
  }
  const moveY = nextY - y;
  const allowed = tileCollision(shapeAt, { x, y, vx: nextX - x, vy: moveY }, width, height);
  if (allowed.vy > moveY) {
    const blocked = moveY - allowed.vy;
    nextY = y + allowed.vy;
    if (riding[1]) nextX = x - blocked;
    if (riding[2]) nextX = x + blocked;
    resultVx = 0;
    vy = 0;
  } else if (allowed.vy < moveY) {
    const blocked = allowed.vy - moveY;
    nextY = y + allowed.vy;
    if (riding[3]) nextX = x - blocked;
    if (riding[4]) nextX = x + blocked;
    resultVx = 0;
    vy = 0;
  }
  return { x: nextX, y: nextY, vx: resultVx, vy };
}

export interface Step {
  y: number;
  /** Terraria's stepSpeed and gfxOffY: how fast the drawn body catches up, and how far behind it is drawn. */
  speed: number;
  offset: number;
}

/**
 * Collision.StepDown (Collision.cs:2398): a body walking off a ledge between 7 and 17 px down is put on the lower
 * floor instead of falling to it. Returns the body's y, unchanged if it didn't step.
 */
export function stepDown(
  shapeAt: ShapeLookup,
  body: Body,
  width: number,
  height: number,
): Step {
  const { x, y, vx } = body;
  const aheadX = x + vx;
  const aheadY = Math.floor((y + height) / TILE) * TILE - height;
  const left = tileOf(aheadX);
  const right = tileOf(aheadX + width);
  const row = tileOf(aheadY + height + 4);
  let floor = (row + tilesTall(height)) * TILE;
  for (let column = left; column <= right; column++) {
    for (let r = row; r <= row + 1; r++) {
      if (shapeAt(column, r) === OPEN) continue;
      const top = r * TILE;
      // Utils.FloatIntersect(column * 16, r * 16 - 17, 16, 16, the body): inclusive edges
      const above = r * TILE - 17;
      const intersects =
        column * TILE <= x + width &&
        above <= y + height &&
        column * TILE + TILE >= x &&
        above + TILE >= y;
      if (intersects && top < floor) floor = top;
    }
  }
  const drop = floor - (y + height);
  if (drop <= 7 || drop >= 17) return { y, speed: 0, offset: 0 };
  return { y: floor - height, speed: drop > 9 ? 2.5 : 1.5, offset: y + height - floor };
}

/**
 * Collision.StepUp (Collision.cs:2456): a body walking into a rise of up to 16.1 px is put on top of it, if there
 * is room above. A floor slope's low side is no rise — the body walks up the slope instead.
 */
export function stepUp(shapeAt: ShapeLookup, body: Body, width: number, height: number): Step {
  const { x, y, vx } = body;
  const direction = vx < 0 ? -1 : vx > 0 ? 1 : 0;
  const aheadX = x + vx;
  const aheadY = y;
  const halfWidth = Math.trunc(width / 2);
  const column = tileOf(aheadX + halfWidth + (halfWidth + 1) * direction);
  const row = tileOf(aheadY + height - 1);
  const tall = tilesTall(height);
  const solid = (c: number, r: number): boolean => shapeAt(c, r) !== OPEN;
  const unchanged: Step = { y, speed: 0, offset: 0 };

  let headroom = true; // flag1
  for (let i = 2; i < tall + 1; i++) headroom = headroom && !solid(column, row - i);
  const behindClear = !solid(column - direction, row - tall); // flag3
  const centre = x + halfWidth;
  const aboveShape = shapeAt(column, row - 1);
  const aboveClear = // flag7
    aboveShape === OPEN ||
    (aboveShape === 1 && centre > column * TILE) ||
    (aboveShape === 2 && centre < column * TILE + TILE);
  const riseShape = shapeAt(column, row);
  const topSlope = riseShape === 1 || riseShape === 2;
  const noRise =
    riseShape === OPEN ||
    (topSlope &&
      (riseShape !== 1 || centre >= column * TILE) &&
      (riseShape !== 2 || centre <= column * TILE + TILE)) ||
    (topSlope && y + height <= row * TILE);
  const rise = !noRise; // flag8

  if (column * TILE >= aheadX + width || column * TILE + TILE <= aheadX) return unchanged;
  if (!(rise && aboveClear && headroom && behindClear)) return unchanged;
  const top = row * TILE;
  if (top >= aheadY + height) return unchanged;
  const climb = aheadY + height - top;
  if (climb > 16.1) return unchanged;
  return { y: top - height, speed: climb < 9 ? 1 : 2, offset: y + height - top };
}
