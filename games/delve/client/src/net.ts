// net.ts — the client side of the P3 authoritative boundary. Owns the WebSocket to the DELVE
// server: it hydrates from the server snapshot on join, streams the local player's INPUTS (and
// discrete commands), and hands authoritative `state` deltas back for the game to reconcile its
// prediction against. It never sends game state — the server is the source of truth. The game
// still runs its local sim for prediction, so it plays offline too; the network is additive.
import type { Input, Session, ClientCommand } from '@delve/shared';
import { WS_PATH, PROTOCOL_VERSION } from '@delve/shared';
import type { ClientMessage, ServerMessage, StateMessage } from '@delve/shared';

const PLAYER_ID_KEY = 'delve.playerId';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type NetStatus = 'offline' | 'connecting' | 'online';

export interface NetHandlers {
  /** Proposed seed for the join (used only if the server has no world for this player yet). */
  getSeed: () => number;
  /** Hydrate the game to the authoritative snapshot (join, reconnect, or server new-game). */
  onHello: (snapshot: Session, fresh: boolean) => void;
  /** Reconcile the local prediction against an authoritative delta. */
  onState: (msg: StateMessage) => void;
}

/** Stable per-player id, generated once and kept in localStorage. */
function playerId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(PLAYER_ID_KEY);
  } catch {
    /* storage unavailable — fall through to an ephemeral id */
  }
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      localStorage.setItem(PLAYER_ID_KEY, id);
    } catch {
      /* ignore — an ephemeral id is fine for this session */
    }
  }
  return id;
}

function wsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${WS_PATH}`;
}

let socket: WebSocket | null = null;
let handlers: NetHandlers | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: number | null = null;
let status: NetStatus = 'offline';
let lastAckSeq = 0;

const isOpen = (): boolean => socket !== null && socket.readyState === WebSocket.OPEN;

function post(msg: ClientMessage): void {
  if (isOpen()) socket!.send(JSON.stringify(msg));
}

/** Gameplay traffic: only once the server has accepted the join — before that it is discarded anyway. */
function postWhenOnline(msg: ClientMessage): void {
  if (status === 'online') post(msg);
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    open();
  }, reconnectDelay);
  reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2); // exponential backoff
}

function open(): void {
  if (!handlers) return;
  status = 'connecting';
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    status = 'offline';
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    // Connected, not yet ONLINE: online means the server accepted the join, which the hello says.
    // This used to be 'online' already, and a server that REJECTS the join (a protocol bump after a
    // deploy) only replies with an error — so the client sat online forever, streaming inputs nobody
    // applied and never reconciling.
    status = 'connecting';
    reconnectDelay = RECONNECT_MIN_MS; // reset backoff on a good connection
    post({
      t: 'join',
      protocol: PROTOCOL_VERSION,
      playerId: playerId(),
      seed: handlers!.getSeed(),
    });
  };

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      status = 'online';
      handlers!.onHello(msg.snapshot, msg.fresh);
    } else if (msg.t === 'state') {
      lastAckSeq = msg.ackSeq;
      handlers!.onState(msg);
    } else if (msg.t === 'error') {
      // Non-fatal — the game keeps running on its local prediction — but never silent. Before the
      // join is accepted, an error means it WASN'T, so this client is offline and must not predict
      // against a server that will never answer.
      console.warn(`[delve] server: ${msg.message}`);
      if (status !== 'online') status = 'offline';
    }
  };

  ws.onclose = () => {
    status = 'offline';
    socket = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose will follow and drive the reconnect; nothing to do here.
  };
}

/** Start the connection (idempotent). Safe to call once at boot. */
export function connect(h: NetHandlers): void {
  handlers = h;
  open();
}

/** Stream one tick of input to the server. No-op until online (the client predicts locally). */
export function sendInput(seq: number, input: Input): void {
  postWhenOnline({ t: 'input', seq, input });
}

/** Send a discrete command (today only `newGame`) for the server to apply authoritatively. */
export function sendCommand(command: ClientCommand): void {
  postWhenOnline({ t: 'command', command });
}

/** True once the server has ACCEPTED the join (a hello arrived), so the game predicts-and-reconciles. */
export const isOnline = (): boolean => status === 'online';

/** Current connection status + last acknowledged input seq, for the debug overlay. */
export function netStatus(): { status: NetStatus; ackSeq: number } {
  return { status, ackSeq: lastAckSeq };
}
