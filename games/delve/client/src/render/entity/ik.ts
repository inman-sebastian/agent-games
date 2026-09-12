// ik.ts — two-bone inverse kinematics. This is what makes a knee exist.
//
// The first walk cycle placed the knee halfway between hip and ankle, which makes the leg a
// straight rod that pivots at the hip — the "stiff legs" read. A knee isn't a midpoint: given a hip,
// a foot target and two fixed bone lengths, its position is DETERMINED (two solutions, mirrored
// about the hip→foot line), and picking the right one is what bends the leg.
//
// Same solver serves the other half of the plan: planting a foot on the DRAWN ground rather than
// the collision box. Set the ankle target to the surface height and the knee follows.
//
// PRESENTATION ONLY. Physics stays an AABB, shared with the authoritative server — the body rides
// the collision box, the feet plant on drawn geometry, and this absorbs the difference. Nothing
// here may feed back into the sim.
import { clamp01 } from '../palette';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Place the middle joint of a two-bone chain.
 *
 * `bend` picks which of the two mirror solutions to use: +1 and -1 bend opposite ways. A knee bends
 * backward and an elbow forward, so the sign is per-limb and per-facing, not global.
 *
 * If the target is out of reach the chain is straightened toward it rather than snapping or
 * refusing — a limb that can't reach should stretch out, not pop.
 */
export function solveTwoBone(
  root: Vec2,
  target: Vec2,
  lenA: number,
  lenB: number,
  bend: 1 | -1,
): Vec2 {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { x: root.x + lenA, y: root.y };

  const ux = dx / dist;
  const uy = dy / dist;

  // Out of reach (or folded past the inner limit): straighten along the line to the target.
  const reach = lenA + lenB;
  const inner = Math.abs(lenA - lenB);
  if (dist >= reach) return { x: root.x + ux * lenA, y: root.y + uy * lenA };
  if (dist <= inner) return { x: root.x + ux * lenA, y: root.y + uy * lenA };

  // Standard circle-circle intersection: `a` along the chord, `h` perpendicular to it.
  const a = (lenA * lenA - lenB * lenB + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, lenA * lenA - a * a));
  return {
    x: root.x + ux * a + -uy * h * bend,
    y: root.y + uy * a + ux * h * bend,
  };
}

/**
 * The ground-contact half of the same idea, for later: given a probe of the DRAWN surface height
 * under the foot, return an ankle target that sits on it rather than on the tile line.
 *
 * `blend` eases the correction in so a foot doesn't snap when the surface under it steps.
 */
export function plantFoot(ankle: Vec2, surfaceY: number, maxLift: number, blend = 1): Vec2 {
  const wanted = Math.max(ankle.y - maxLift, Math.min(ankle.y + maxLift, surfaceY));
  return { x: ankle.x, y: ankle.y + (wanted - ankle.y) * clamp01(blend) };
}
