// index.ts — the DELVE server (P2). A plain Node `http` server + a `ws` WebSocket endpoint that
// imports the SAME shared engine the client uses (one ruleset, both sides). It draws the
// client/server boundary and owns persistence:
//   • join   → load-or-create the player's save, reply `hello` with the snapshot
//   • sync   → persist the client's state (the server is the store of record)
//   • intent → reserved for P3 (authoritative sim); logged and ignored in P2
// In dev, Vite serves the client and proxies /ws here (run WS-only). In production, pass
// `--serve-static` so this process also serves the built client from dist/.
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import { newGame } from '@delve/shared';
import { WS_PATH, PROTOCOL_VERSION } from '@delve/shared';
import type { ClientMessage, ServerMessage } from '@delve/shared';
import { loadSave, persistSave } from './store';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = join(HERE, '..', '..', 'client', 'dist');
const SERVE_STATIC = process.argv.includes('--serve-static'); // prod serves the build; dev leaves it to Vite

// Static file serving (production only). `single: true` falls back to index.html for unknown
// routes; the built labs live at /labs/*.html and are served directly.
const serveStatic = SERVE_STATIC ? sirv(DIST_DIR, { single: true, dev: false }) : null;

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

wss.on('connection', (ws) => {
  let playerId: string | null = null; // set by `join`; gates every later message

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
      let state = loadSave(playerId);
      const fresh = !state;
      if (!state) {
        // no server save yet: seed one from the client's proposed seed (keeps local continuity)
        state = newGame(msg.seed ?? (Math.random() * 2 ** 31) >>> 0);
        persistSave(playerId, state);
      }
      send(ws, { t: 'hello', protocol: PROTOCOL_VERSION, state, fresh });
      return;
    }

    // every message after join requires an established player
    if (!playerId) {
      send(ws, { t: 'error', message: 'send `join` before anything else' });
      return;
    }

    if (msg.t === 'sync') {
      persistSave(playerId, msg.state);
      send(ws, { t: 'synced', at: Date.now() });
      return;
    }

    if (msg.t === 'intent') {
      // Reserved for P3 (server-authoritative sim). In P2 the client is authoritative and syncs
      // whole state, so intents are accepted-but-ignored rather than rejected.
      return;
    }
  });
});

httpServer.listen(PORT, () => {
  const mode = serveStatic ? `serving dist/ + ws ${WS_PATH}` : `ws ${WS_PATH} only (dev)`;
  console.log(`delve server listening on :${PORT} — ${mode}`);
});
