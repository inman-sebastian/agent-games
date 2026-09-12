// protocol.ts — the typed client/server wire protocol (P3, authoritative server). Both the browser
// client (client/src/net.ts) and the Node server (server/) import this, so the boundary speaks one
// vocabulary and the message shapes can never drift. Messages are JSON objects discriminated by `t`.
//
// P3 model — the SERVER is authoritative:
//   • Clients send INPUTS ONLY (per-tick movement/mining) + discrete COMMANDS (newGame).
//     They never send state, so out-of-reach mining is impossible by construction.
//   • The server owns the shared world + each player, steps the sim, and streams authoritative
//     snapshots. The client predicts its OWN avatar and reconciles against the server (it does not
//     depend on cross-machine determinism — a misprediction is a small self-correcting nudge).
import type { Input, PlayerState, Session } from './types';

/** Bumped on any breaking wire change; a join with a mismatched version is rejected. */
export const PROTOCOL_VERSION = 3;

/** The WebSocket endpoint path (Vite proxies this to the Node server in dev). */
export const WS_PATH = '/ws';

// ---- client → server --------------------------------------------------------------------

/** First message on every connection: announce who we are and propose a seed for a new world. */
export interface JoinMessage {
  t: 'join';
  protocol: number;
  /** Stable per-player id (client-generated, persisted in localStorage). */
  playerId: string;
  /** Seed to use if the server has NO save for this player yet; ignored otherwise. */
  seed?: number;
}

/** One tick of player intent. `seq` is a monotonic per-connection counter; the server applies
 * inputs in order and echoes the last-applied `seq` as `ackSeq` so the client can reconcile. */
export interface InputMessage {
  t: 'input';
  seq: number;
  input: Input;
}

/** A discrete, non-realtime action the server applies authoritatively (validated server-side). */
export type ClientCommand = { kind: 'newGame'; seed: number };

export interface CommandMessage {
  t: 'command';
  command: ClientCommand;
}

export type ClientMessage = JoinMessage | InputMessage | CommandMessage;

// ---- server → client --------------------------------------------------------------------

/** Response to `join`: the full authoritative snapshot to hydrate from. */
export interface HelloMessage {
  t: 'hello';
  protocol: number;
  /** true when the server had no save and just created one from the proposed seed. */
  fresh: boolean;
  snapshot: Session;
}

/** An authoritative delta the client reconciles against. `player` is the full authoritative
 * PlayerState (small); `dugAdded` are world tiles excavated since the last state message; `dmg`
 * is the current shared tile-break progress. `ackSeq` is the last input the server applied. */
export interface StateMessage {
  t: 'state';
  ackSeq: number;
  player: PlayerState;
  dugAdded: string[];
  dmg: Record<string, number>;
}

/** A protocol/handshake error the client should surface or recover from. */
export interface ErrorMessage {
  t: 'error';
  message: string;
}

export type ServerMessage = HelloMessage | StateMessage | ErrorMessage;
