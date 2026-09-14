// collision.test.ts — where DELVE's world differs from Terraria's under the collision port (#93). The port itself is
// checked against Terraria's code in tools/terraria-oracle/collision.test.ts.
import { describe, it, expect } from 'vitest';
import { FULL, OPEN, tileCollision, walkDownSlope, SLOPE_DOWN_RIGHT } from '@delve/shared';

describe('collision above row 0, where Terraria has no tiles', () => {
  it('a wall in row -1 stops a body moving into it', () => {
    // Terraria marks "no wall yet" with row -1, which was once this wall's row: the body walked into it.
    const shapeAt = (column: number, row: number): number =>
      column === 10 && row === -1 ? FULL : OPEN;
    const body = { x: 176.5, y: -60, vx: -2, vy: -4 };
    const hit = tileCollision(shapeAt, body, 29, 58);
    expect(hit.vx).toBe(176 - 176.5);
  });

  it('a slope in column -1 is walked down', () => {
    const shapeAt = (column: number, row: number): number =>
      column === -1 && row === 3 ? SLOPE_DOWN_RIGHT : row >= 4 ? FULL : OPEN;
    const body = { x: -12, y: 48 + 4 - 20, vx: 2, vy: 0.375 };
    expect(walkDownSlope(shapeAt, body, 16, 20, 0.375)).toBe(0.375 + 2);
  });
});
