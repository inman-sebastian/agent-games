// index.ts — the DELVE authoritative server (P3). Plain Node `http` + a `ws` endpoint that imports
// the SAME shared engine as the client (one ruleset, both sides) and is the single source of truth:
//   join    → load-or-create the player's session, reply `hello` with the full snapshot
//   input   → apply ONE authoritative physics step (server owns every mutation); track ackSeq
//   command → buy / sell / newGame, validated server-side (can't afford → no-op)
// Clients send inputs only, so forged coins / out-of-reach mining are impossible by construction.
// The server broadcasts authoritative `state` deltas (player + newly-dug tiles) at a fixed rate;
// the client reconciles its own prediction against them. In dev, Vite serves the client and
// proxies /ws here; in production, pass `--serve-static` to serve the built client too.
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import { newSession, physicsStep, buyUpgrade, buyTech, sellAll, TICK_DT } from '@delve/shared';
import { WS_PATH, PROTOCOL_VERSION } from '@delve/shared';
import type { ClientMessage, ServerMessage, Input, Session } from '@delve/shared';
import { loadSave, persistSave } from './store';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const CLIENT_DIST = join(HERE, '..', '..', 'client', 'dist'); // built client, for prod static serving
const SERVE_STATIC = process.argv.includes('--serve-static'); // prod serves the build; dev leaves it to Vite
const SNAPSHOT_MS = 50; // authoritative state broadcast rate (20 Hz)
const PERSIST_MS = 2500; // how often to flush a player's session to disk

// Static file serving (production only). `single: true` falls back to index.html for unknown
// routes; the built labs live at /labs/*.html and are served directly.
const serveStatic = SERVE_STATIC ? sirv(CLIENT_DIST, { single: true, dev: false }) : null;

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (serveStatic) {
    serveStatic(req, res, () => {
      res.writeHead(404);
      res.end('not found');
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
const send = (ws: WebSocket, msg: ServerMessage): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

// Clamp a client-supplied input to a safe shape. Reach + solidity are still enforced by the sim
// (physicsStep only mines a tile within REACH that's actually solid), so this just guards types.
function sanitizeInput(raw: unknown): Input {
  const r = (raw ?? {}) as Record<string, unknown>;
  const input: Input = { left: !!r.left, right: !!r.right, jump: !!r.jump };
  const mine = r.mine as { column?: unknown; row?: unknown } | null | undefined;
  if (mine && Number.isInteger(mine.column) && Number.isInteger(mine.row)) {
    input.mine = { column: mine.column as number, row: mine.row as number };
  }
  return input;
}

wss.on('connection', (ws) => {
  let playerId: string | null = null;
  let session: Session | null = null; // this connection's authoritative world + player
  let lastSeq = 0; // last input seq applied
  let sentSeq = 0; // last seq reflected in a broadcast
  let dirty = false; // a command (buy/sell) mutated state since the last broadcast
  const sentDug = new Set<string>(); // world.dug keys already streamed to this client

  // Broadcast an authoritative delta whenever something changed (inputs applied or tiles dug).
  // Idle connections (no inputs) send nothing — the client isn't predicting, so there's nothing
  // to reconcile against.
  const snapshotTimer = setInterval(() => {
    if (!session) return;
    const dugAdded: string[] = [];
    for (const cellKey in session.world.dug) {
      if (!sentDug.has(cellKey)) {
        sentDug.add(cellKey);
        dugAdded.push(cellKey);
      }
    }
    if (lastSeq === sentSeq && dugAdded.length === 0 && !dirty) return;
    sentSeq = lastSeq;
    dirty = false;
    send(ws, {
      t: 'state',
      ackSeq: lastSeq,
      player: session.player,
      dugAdded,
      dmg: session.world.dmg,
    });
  }, SNAPSHOT_MS);

  const persistTimer = setInterval(() => {
    if (playerId && session) persistSave(playerId, session);
  }, PERSIST_MS);

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { t: 'error', message: 'malformed message (not JSON)' });
      return;
    }

    if (msg.t === 'join') {
      if (msg.protocol !== PROTOCOL_VERSION) {
        send(ws, { t: 'error', message: `protocol mismatch (server speaks v${PROTOCOL_VERSION})` });
        return;
      }
      playerId = msg.playerId;
      const loaded = loadSave(playerId);
      const fresh = !loaded;
      session = loaded ?? newSession(msg.seed ?? (Math.random() * 2 ** 31) >>> 0);
      if (fresh) persistSave(playerId, session);
      sentDug.clear();
      for (const cellKey in session.world.dug) sentDug.add(cellKey); // hello carries full dug; deltas are new-only
      lastSeq = 0;
      sentSeq = 0;
      send(ws, { t: 'hello', protocol: PROTOCOL_VERSION, fresh, snapshot: session });
      return;
    }

    if (!session || !playerId) {
      send(ws, { t: 'error', message: 'send `join` before anything else' });
      return;
    }

    if (msg.t === 'input') {
      physicsStep(session, sanitizeInput(msg.input), TICK_DT); // authoritative; events discarded server-side
      lastSeq = msg.seq;
      return;
    }

    if (msg.t === 'command') {
      const command = msg.command;
      dirty = true; // ensure the resulting economy change is broadcast even with no inputs in flight
      if (command.kind === 'buyUpgrade') buyUpgrade(session.player, command.key);
      else if (command.kind === 'buyTech') buyTech(session.player, command.key);
      else if (command.kind === 'sellAll') sellAll(session.player);
      else if (command.kind === 'newGame') {
        session = newSession(command.seed);
        sentDug.clear();
        lastSeq = 0;
        sentSeq = 0;
        persistSave(playerId, session);
        send(ws, { t: 'hello', protocol: PROTOCOL_VERSION, fresh: true, snapshot: session }); // client re-hydrates
      }
      return;
    }
  });

  ws.on('close', () => {
    clearInterval(snapshotTimer);
    clearInterval(persistTimer);
    if (playerId && session) persistSave(playerId, session);
  });
});

httpServer.listen(PORT, () => {
  const mode = serveStatic ? `serving client/dist + ws ${WS_PATH}` : `ws ${WS_PATH} only (dev)`;
  console.log(`delve server listening on :${PORT} — ${mode}`);
});
