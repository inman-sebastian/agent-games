// net.ts — the client side of the P2 boundary. Owns the WebSocket to the DELVE server: it
// hydrates the game from the server snapshot on join, pushes local state up (debounced) so the
// server stays the store of record, and reconnects with backoff. The game keeps running entirely
// on its local sim + localStorage if the server is unreachable — the network is additive, never a
// hard dependency (offline/dev must still play).
import type { SaveState } from '@delve/shared';
import { WS_PATH, PROTOCOL_VERSION } from '@delve/shared';
import type { ClientMessage, ServerMessage } from '@delve/shared';

const PLAYER_ID_KEY = 'delve.playerId';
const SYNC_DEBOUNCE_MS = 1200; // coalesce rapid saves into one push
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type NetStatus = 'offline' | 'connecting' | 'online';

export interface NetHandlers {
  /** Current authoritative client state (for the join seed + adopt-on-fresh + reconnect re-sync). */
  getState: () => SaveState;
  /** Called with the server snapshot to hydrate from on the FIRST hello of a page load. */
  onHydrate: (state: SaveState) => void;
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
let hydratedOnce = false; // first hello hydrates; later reconnects keep the live local state
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: number | null = null;
let syncTimer: number | null = null;
let status: NetStatus = 'offline';
let lastSyncedAt = 0;

const isOpen = (): boolean => socket !== null && socket.readyState === WebSocket.OPEN;

function post(msg: ClientMessage): void {
  if (isOpen()) socket!.send(JSON.stringify(msg));
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
    status = 'online';
    reconnectDelay = RECONNECT_MIN_MS; // reset backoff on a good connection
    const state = handlers!.getState();
    post({ t: 'join', protocol: PROTOCOL_VERSION, playerId: playerId(), seed: state.seed });
  };

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      if (msg.fresh) {
        // server had no save — it adopted our proposed seed; push our local state so any local
        // progress becomes the server's record instead of being overwritten by a blank game.
        post({ t: 'sync', state: handlers!.getState() });
      } else if (!hydratedOnce) {
        // first hello of this page load: the server's save is the store of record — hydrate to it.
        handlers!.onHydrate(msg.state);
      } else {
        // a mid-session reconnect: keep the live local sim and re-assert it as the record.
        post({ t: 'sync', state: handlers!.getState() });
      }
      hydratedOnce = true;
    } else if (msg.t === 'synced') {
      lastSyncedAt = msg.at;
    }
    // 'error' messages are non-fatal here; the client keeps running on its local state.
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

/** Debounced push of the latest state to the server. No-op while offline (localStorage covers it). */
export function sync(state: SaveState): void {
  if (!isOpen()) return;
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    post({ t: 'sync', state });
  }, SYNC_DEBOUNCE_MS);
}

/** Current connection status + last-persisted timestamp, for the debug overlay. */
export function netStatus(): { status: NetStatus; lastSyncedAt: number } {
  return { status, lastSyncedAt };
}
