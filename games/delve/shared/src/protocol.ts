// protocol.ts — the typed client/server wire protocol (P2). Both the browser client (src/net.ts)
// and the Node server (server/) import this, so the boundary speaks one vocabulary and the message
// shapes can never drift. Messages are JSON objects discriminated by a `t` tag.
//
// P2 model: the client still runs the sim locally for rendering; the SERVER is the store of
// record — it persists whatever the client syncs and replays it on reconnect. Authoritative
// simulation / anti-cheat (the server applying intents itself) is P3 — the `intent` message and
// `ClientIntent` type below define that vocabulary now so both sides already share it.
import type { Session, TileCoord } from './types';

/** Bumped on any breaking wire change; a join with a mismatched version is rejected. */
export const PROTOCOL_VERSION = 1;

/** The WebSocket endpoint path (Vite proxies this to the Node server in dev). */
export const WS_PATH = '/ws';

// ---- client → server --------------------------------------------------------------------

/** First message on every connection: announce who we are and propose a seed for a new save. */
export interface JoinMessage {
  t: 'join';
  protocol: number;
  /** Stable per-player id (client-generated, persisted in localStorage). */
  playerId: string;
  /** Seed to use if the server has NO save for this player yet; ignored otherwise. */
  seed?: number;
}

/** Push the client's current authoritative state; the server persists it (store of record). */
export interface SyncMessage {
  t: 'sync';
  state: Session;
}

/** A single player action. Reserved for P3 (the server will validate + apply these itself);
 * P2 defines the type so the boundary vocabulary is shared, but does not route them. */
export type ClientIntent =
  | { kind: 'mine'; target: TileCoord }
  | { kind: 'move'; left: boolean; right: boolean; jump: boolean }
  | { kind: 'buy'; what: 'upgrade' | 'tech'; key: string }
  | { kind: 'sell' };

/** Wrapper for a `ClientIntent` (reserved for P3). */
export interface IntentMessage {
  t: 'intent';
  intent: ClientIntent;
}

export type ClientMessage = JoinMessage | SyncMessage | IntentMessage;

// ---- server → client --------------------------------------------------------------------

/** Response to `join`: the snapshot to hydrate from (loaded, or freshly created server-side). */
export interface HelloMessage {
  t: 'hello';
  protocol: number;
  state: Session;
  /** true when the server had no save and just created one — the client keeps its local state
   * and syncs it up (so existing local progress is adopted rather than overwritten). */
  fresh: boolean;
}

/** Acknowledges that a `sync` was persisted (epoch ms); handy for a debug/last-saved readout. */
export interface SyncedMessage {
  t: 'synced';
  at: number;
}

/** A protocol/handshake error the client should surface or recover from. */
export interface ErrorMessage {
  t: 'error';
  message: string;
}

export type ServerMessage = HelloMessage | SyncedMessage | ErrorMessage;
