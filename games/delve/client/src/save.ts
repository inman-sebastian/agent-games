// save.ts — the client's localStorage cache of a session: the OFFLINE fallback, read before the
// first server hello or when the server is unreachable. Only the I/O lives here. Turning a saved
// object back into a valid Session is `hydrate` in @delve/shared, because the server has to apply
// exactly the same rule to its save of record.
import * as engine from '@delve/shared';
import { hydrate, toSave } from '@delve/shared';
import type { Session } from '@delve/shared';

export const SAVE_KEY = 'delve.save.v1';

/** A brand-new session on a random seed. */
export function fresh(): Session {
  return engine.newSession((Math.random() * 2 ** 31) >>> 0);
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
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave(session)));
  } catch {
    /* storage full or unavailable — the game stays playable, just not persisted */
  }
}
