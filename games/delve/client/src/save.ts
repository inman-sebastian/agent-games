// save.ts — localStorage persistence + save-format migration, split out of index.ts so it's
// testable without the game's DOM/loop side effects. `hydrate` is pure (a fresh Session merged
// with saved fields); `load`/`save` are the localStorage I/O around it. Both the offline load
// and the server-snapshot adoption (index.ts onHello) go through `hydrate`, so old saves keep
// working — including saves written before the economy was removed (their coins/refine/scanner
// fields are simply not spread onto the current shape).
import * as engine from '@delve/shared';
import type { Session } from '@delve/shared';

export const SAVE_KEY = 'delve.save.v1';

/** A brand-new session on a random seed. */
export function fresh(): Session {
  return engine.newSession((Math.random() * 2 ** 31) >>> 0);
}

// Reconstruct a Session from a saved object over a fresh one (fills fields added since it was
// written) and reset transient physics. Handles three formats: the current split save
// ({ world, player }), the pre-split flat save, and the pre-physics grid save. `saved` is
// deserialized external data, so it's genuinely untyped here.
export function hydrate(saved: any): Session {
  const seed = saved.world?.seed ?? saved.seed;
  const base = engine.newSession(seed);
  const s: Session =
    saved.world && saved.player
      ? {
          world: { ...base.world, ...saved.world },
          player: {
            ...base.player,
            ...saved.player,
            up: { ...base.player.up, ...saved.player.up },
            tech: { ...base.player.tech, ...saved.player.tech },
          },
        }
      : {
          // migrate a pre-split flat save: peel world fields off, the rest is the player
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
  return s;
}

export function load(): Session | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !(saved.seed || saved.world?.seed)) return null;
    return hydrate(saved);
  } catch {
    return null;
  }
}

// Persist locally as the OFFLINE fallback. When online the server is authoritative and persists
// the session itself (the client streams inputs, never state), so this is just a local cache used
// before the first hello / when the server is unreachable.
export function save(session: Session): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(session));
  } catch {
    /* storage full or unavailable — the game stays playable, just not persisted */
  }
}
