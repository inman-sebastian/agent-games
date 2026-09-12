// index.ts — the DELVE authoritative server. Plain Node `http` + a `ws` endpoint that imports the
// SAME shared engine as the client (one ruleset, both sides) and is the single source of truth:
//   join    → load-or-create the player's session, reply `hello` with the full snapshot
//   input   → QUEUE one tick of intent; the server's own clock decides when it is spent
//   command → newGame, applied server-side
// Clients send inputs only, so out-of-reach mining is impossible by construction.
// The server broadcasts authoritative `state` deltas (player + newly-dug tiles) at a fixed rate;
// the client reconciles its own prediction against them. In dev, Vite serves the client and
// proxies /ws here; in production, pass `--serve-static` to serve the built client too.
//
// THE SERVER OWNS TIME (#45). It used to step physics on RECEIPT of an input message, which meant
// the simulation only advanced while somebody was pressing a key, and advanced as fast as they
// chose to press. Two consequences, both fixed here:
//
//   • Nothing could happen on its own. A day/night cycle, a lava pocket draining, an enemy taking
//     a swing, a player falling down the shaft they just dug — all of it requires time to pass
//     without input, and none of it was possible. It also meant the client could pause the world
//     simply by stopping: "nothing pauses, ever" (docs/UI.md) was unenforceable from the client.
//   • Input rate WAS simulation rate, so flooding inputs ran the world faster. A measured 300-input
//     burst bought 29.8 tiles of travel in 300ms of wall clock. No modified client needed.
//
// Now one clock drives every connected session, and an input buys a place in a queue rather than a
// physics step. The loop does nothing when no one is connected, which is the hook world hibernation
// will hang on.
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import { newSession, physicsStep, TICK_DT } from '@delve/shared';
import { WS_PATH, PROTOCOL_VERSION } from '@delve/shared';
import type { ClientMessage, ServerMessage, Input, Session, PlayerState } from '@delve/shared';
import { loadSave, persistSave } from './store';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const CLIENT_DIST = join(HERE, '..', '..', 'client', 'dist'); // built client, for prod static serving
const SERVE_STATIC = process.argv.includes('--serve-static'); // prod serves the build; dev leaves it to Vite
const SNAPSHOT_MS = 50; // authoritative state broadcast rate (20 Hz)
const PERSIST_MS = 2500; // how often to flush a player's session to disk

const TICK_MS = TICK_DT * 1000; // the shared sim rate, in the units setInterval wants
const MAX_CATCHUP_TICKS = 8; // per timer firing; beyond this the backlog is dropped, not chased
const MAX_TIMER_LAG = 0.25; // seconds of real time a single late firing may bank

/**
 * Inputs a client may spend per tick, and how many it may bank.
 *
 * One credit per tick is what makes input rate stop being simulation rate: over any stretch of time
 * a client gets exactly as many physics steps as the clock gave it, no matter how many messages it
 * sent. The burst allowance exists for network jitter — real inputs arrive in small clumps rather
 * than one neatly per tick — and is small enough that draining it is invisible.
 */
const INPUT_CREDITS_PER_TICK = 1;
const INPUT_BURST = 8;

/**
 * How long the server keeps repeating a client's last input when nothing new has arrived.
 *
 * Bridging a jitter gap with the previous input is what keeps the server agreeing with a client
 * that is still predicting — dropping straight to neutral would stutter every dropped packet. The
 * window is deliberately short: past it the player goes limp and only gravity acts on them, so a
 * client that closed its menu, backgrounded its tab or died on the network does not keep walking.
 */
const INPUT_GRACE_TICKS = 6; // 100ms at 60Hz

/** Inputs a client may have waiting. A flood guard, not a rate limit — the credits do that. */
const MAX_QUEUED_INPUTS = 512;

const NEUTRAL: Input = { left: false, right: false, jump: false };

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

/** One connected player: their authoritative session, plus the intent waiting to be spent on it. */
interface Client {
  readonly ws: WebSocket;
  playerId: string | null;
  session: Session | null;
  /** Intent received but not yet stepped. The clock drains this, one entry per credit. */
  readonly queue: { seq: number; input: Input }[];
  credits: number;
  /** The last input actually stepped, repeated across a short jitter gap. */
  lastInput: Input;
  starvedTicks: number;
  lastSeq: number; // last input seq applied
  sentSeq: number; // last seq reflected in a broadcast
  dirty: boolean; // a command (newGame) mutated state since the last broadcast
  /** The player state as last broadcast, so an idle session stays silent. */
  sentPlayer: string;
  readonly sentDug: Set<string>; // world.dug keys already streamed to this client
}

const clients = new Set<Client>();

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

/** Advance one client by exactly one tick, spending queued intent if they have the credit for it. */
function stepClient(client: Client): void {
  if (!client.session) return;
  client.credits = Math.min(INPUT_BURST, client.credits + INPUT_CREDITS_PER_TICK);

  if (client.queue.length > 0 && client.credits >= 1) {
    const next = client.queue.shift()!;
    client.credits -= 1;
    client.lastInput = next.input;
    client.lastSeq = next.seq;
    client.starvedTicks = 0;
    physicsStep(client.session, next.input, TICK_DT); // authoritative; events discarded server-side
    return;
  }

  // Nothing to spend. Time passes anyway — that is the whole point — but the player's intent goes
  // stale, so it is repeated only briefly and then dropped.
  client.starvedTicks++;
  const intent = client.starvedTicks <= INPUT_GRACE_TICKS ? client.lastInput : NEUTRAL;
  physicsStep(client.session, intent, TICK_DT);
}

/**
 * The clock. One loop for every session, driven by real elapsed time rather than by the timer's
 * nominal period, because Node timers fire late under load and a sim that trusted the period would
 * quietly run slow.
 *
 * The same fixed-step accumulator shape the client's frame loop uses, for the same reason: both
 * sides must step the identical dt or a replayed input stops reproducing the server's result.
 */
let lastTickAt = Date.now();
let accumulator = 0;

setInterval(() => {
  const now = Date.now();
  accumulator += Math.min((now - lastTickAt) / 1000, MAX_TIMER_LAG);
  lastTickAt = now;
  if (clients.size === 0) {
    accumulator = 0; // nobody home: no time owed. The hook world hibernation will hang on.
    return;
  }
  let steps = 0;
  while (accumulator >= TICK_DT && steps < MAX_CATCHUP_TICKS) {
    accumulator -= TICK_DT;
    steps++;
    for (const client of clients) stepClient(client);
  }
  if (steps === MAX_CATCHUP_TICKS) accumulator = 0; // fell far behind → drop the backlog
}, TICK_MS);

/**
 * Broadcast an authoritative delta to each client whose state actually changed.
 *
 * Now that the sim runs on a clock, "changed" has to be asked rather than inferred from an input
 * arriving. Comparing the serialised player is blunt but exactly right, and a resting session still
 * sends nothing.
 */
// ponytail: JSON compare per client per broadcast — fine at 20Hz for a small player object; a
// dirty flag set by the sim would be the upgrade if the player state ever grows.
function broadcast(client: Client): void {
  if (!client.session) return;
  const dugAdded: string[] = [];
  for (const cellKey in client.session.world.dug) {
    if (!client.sentDug.has(cellKey)) {
      client.sentDug.add(cellKey);
      dugAdded.push(cellKey);
    }
  }
  const player: PlayerState = client.session.player;
  const encoded = JSON.stringify(player);
  const changed = encoded !== client.sentPlayer;
  if (!changed && client.lastSeq === client.sentSeq && dugAdded.length === 0 && !client.dirty) {
    return;
  }
  client.sentPlayer = encoded;
  client.sentSeq = client.lastSeq;
  client.dirty = false;
  send(client.ws, {
    t: 'state',
    ackSeq: client.lastSeq,
    player,
    dugAdded,
    dmg: client.session.world.dmg,
  });
}

setInterval(() => {
  for (const client of clients) broadcast(client);
}, SNAPSHOT_MS);

setInterval(() => {
  for (const client of clients) {
    if (client.playerId && client.session) persistSave(client.playerId, client.session);
  }
}, PERSIST_MS);

wss.on('connection', (ws) => {
  const client: Client = {
    ws,
    playerId: null,
    session: null,
    queue: [],
    credits: INPUT_BURST,
    lastInput: NEUTRAL,
    starvedTicks: 0,
    lastSeq: 0,
    sentSeq: 0,
    dirty: false,
    sentPlayer: '',
    sentDug: new Set(),
  };
  clients.add(client);

  /** Point a connection at a session, fresh or loaded, and clear everything derived from the old one. */
  const hydrate = (session: Session, fresh: boolean): void => {
    client.session = session;
    client.queue.length = 0;
    client.credits = INPUT_BURST;
    client.lastInput = NEUTRAL;
    client.starvedTicks = 0;
    client.lastSeq = 0;
    client.sentSeq = 0;
    client.sentPlayer = JSON.stringify(session.player); // hello carries it; no delta owed yet
    client.sentDug.clear();
    for (const cellKey in session.world.dug) client.sentDug.add(cellKey); // deltas are new-only
    send(ws, { t: 'hello', protocol: PROTOCOL_VERSION, fresh, snapshot: session });
  };

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
      client.playerId = msg.playerId;
      const loaded = loadSave(client.playerId);
      const fresh = !loaded;
      const session = loaded ?? newSession(msg.seed ?? (Math.random() * 2 ** 31) >>> 0);
      if (fresh) persistSave(client.playerId, session);
      hydrate(session, fresh);
      return;
    }

    if (!client.session || !client.playerId) {
      send(ws, { t: 'error', message: 'send `join` before anything else' });
      return;
    }

    if (msg.t === 'input') {
      // Queued, not applied. The clock spends it.
      if (client.queue.length >= MAX_QUEUED_INPUTS) client.queue.shift();
      client.queue.push({ seq: msg.seq, input: sanitizeInput(msg.input) });
      return;
    }

    if (msg.t === 'command') {
      const command = msg.command;
      client.dirty = true; // ensure the resulting state change is broadcast even with no inputs in flight
      if (command.kind === 'newGame') {
        hydrate(newSession(command.seed), true); // client re-hydrates from the hello
        persistSave(client.playerId, client.session!);
      }
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(client);
    if (client.playerId && client.session) persistSave(client.playerId, client.session);
  });
});

httpServer.listen(PORT, () => {
  const mode = serveStatic ? `serving client/dist + ws ${WS_PATH}` : `ws ${WS_PATH} only (dev)`;
  console.log(`delve server listening on :${PORT} — ${mode} — sim ${Math.round(1 / TICK_DT)}Hz`);
});
