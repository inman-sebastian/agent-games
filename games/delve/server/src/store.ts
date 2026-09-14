// store.ts — server-side persistence for player saves. P2's "store of record": one JSON file per
// player under DATA_DIR. Deliberately simple (a file per player, whole-state writes) — fine for
// single-player; a real DB is a later concern. The one thing that MUST stay is the id sanitizing:
// playerId comes from the client (a trust boundary), so it can never be allowed to escape DATA_DIR.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrate, toSave } from '@delve/shared';
import type { Session } from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DELVE_DATA_DIR || join(HERE, '..', 'data');

/** Reduce a client-supplied id to a safe bare filename — no separators, no traversal, bounded. */
const safeId = (playerId: string): string =>
  playerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';

const saveFile = (playerId: string): string => join(DATA_DIR, `${safeId(playerId)}.json`);

/**
 * The player's saved state, HYDRATED into a valid Session — or null if none exists (or the file is
 * unreadable/corrupt).
 *
 * Hydrated here rather than trusted: this used to return `JSON.parse(...) as Session`, and the
 * server simulated whatever an older build had written. A save from before `tech` existed crashed
 * the clock on the first dig, and a player wedged in rock by the #47 body change stayed wedged.
 */
export function loadSave(playerId: string): Session | null {
  const file = saveFile(playerId);
  if (!existsSync(file)) return null;
  try {
    return hydrate(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null; // corrupt save → treat as none; the caller will create a fresh one
  }
}

/** Persist the player's state (whole-file write). Creates DATA_DIR on first use. */
export function persistSave(playerId: string, state: Session): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(saveFile(playerId), JSON.stringify(toSave(state)));
}
