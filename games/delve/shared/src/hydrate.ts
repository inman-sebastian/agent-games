// hydrate.ts — turn a saved object back into a valid, playable Session.
//
// This is a RULE, not client plumbing, so it lives in the shared ruleset: the client applies it to
// its localStorage cache and the SERVER applies it to the save of record. It used to live only in
// the client, which put the migration on the side that isn't authoritative — the server simulated
// the raw JSON it loaded. So a save from before `tech`/`log` existed crashed the server's clock on
// the first dig (`player.tech.lantern` of undefined), and the #47 rescue of a player wedged in rock
// only ever ran on the client: the server kept the wedged player and the next snapshot yanked the
// client straight back into the rock.
import { newSession, newPlayer, unstick, isWorldSize, DEFAULT_WORLD_SIZE } from './engine';
import type { Session } from './types';

/**
 * The save format this build writes. Bump it whenever the MEANING of saved data changes — units,
 * coordinates, key schemes — and branch on it in `hydrate`.
 *
 * Saves carried no version before this, which is why the 2x2 block split (#44) could not be
 * migrated: it halved the unit of every saved position and dug-cell key, and a save written before
 * the split is byte-for-byte indistinguishable from one written after. An unversioned save reads as
 * format 1 here, and its units are genuinely unknown. The next change of meaning will not have that
 * problem.
 */
export const SAVE_FORMAT = 2;

/** A Session stamped with the format it was written in, ready to serialise. */
export function toSave(session: Session): Session & { format: number } {
  return { format: SAVE_FORMAT, ...session };
}

/**
 * Reconstruct a Session from a saved object over a fresh one — filling in fields added since it was
 * written — and reset transient physics. Handles the current `{ world, player }` save, the earlier
 * flat save, and the pre-physics grid save. `saved` is deserialised external data, so it is
 * genuinely untyped; anything that isn't an object loads as a fresh session.
 */
export function hydrate(raw: unknown): Session {
  // eslint-free `any`: external data, and every read below tolerates a missing field
  const saved: any = typeof raw === 'object' && raw !== null ? raw : {};
  const seed = saved.world?.seed ?? saved.seed;
  // The size preset is fixed at creation (#63). A save from before presets has none, and a save is
  // untrusted data, so anything that isn't a real preset loads as the default.
  const size = isWorldSize(saved.world?.size) ? saved.world.size : DEFAULT_WORLD_SIZE;
  const base = newSession(seed, size);
  const s: Session =
    saved.world && saved.player
      ? {
          world: { ...base.world, ...saved.world, size },
          player: {
            ...base.player,
            ...saved.player,
            up: { ...base.player.up, ...saved.player.up },
            tech: { ...base.player.tech, ...saved.player.tech },
          },
        }
      : {
          // the earlier flat save: peel the world fields off, the rest is the player
          world: { ...base.world, dug: saved.dug ?? {}, dmg: saved.dmg ?? {} },
          player: {
            ...base.player,
            x: saved.x ?? base.player.x,
            y: saved.y ?? base.player.y,
            facing: saved.facing ?? base.player.facing,
            inv: saved.inv ?? {},
            log: saved.log ?? {},
            depth: saved.depth ?? 0,
            up: { ...base.player.up, ...(saved.up ?? {}) },
            tech: { ...base.player.tech, ...(saved.tech ?? {}) },
          },
        };
  if (saved.world === undefined && saved.x === undefined && saved.c !== undefined) {
    s.player.x = saved.c + 0.5; // pre-physics grid save
    s.player.y = saved.r + 0.5;
  }
  s.player.vx = 0; // reset transient physics fields
  s.player.vy = 0;
  s.player.grounded = false;
  s.player.digKey = null;
  s.player.digTime = 0;
  // The body grew from 0.92 to 1.82 blocks (#47), so a save written before that can put it inside
  // the ceiling of its own one-block tunnel — and a player wedged in rock cannot move, jump or dig
  // out. Lift it into the nearest gap that fits; failing that, a fresh spawn beats a save that
  // cannot be played. On THIS world's ground: `newPlayer()` with no seed used to spawn on seed 1's
  // heightmap, which is a different world's surface — mid-air or inside rock.
  //
  // The same rescue brings back a player the infinite world (#1) let wander past what is now the edge
  // (#58): past it every cell blocks the body, so there is nothing to lift into and they go to spawn.
  if (!unstick(s.world, s.player)) {
    const spawn = newPlayer(s.world);
    s.player.x = spawn.x;
    s.player.y = spawn.y;
  }
  return s;
}
