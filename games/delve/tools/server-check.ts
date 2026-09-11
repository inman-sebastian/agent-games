// server-check.ts — headless gate for the P3 authoritative boundary (no browser). Spawns the real
// server against a throwaway data dir, then drives the WebSocket protocol the way client/src/net.ts
// does and asserts the authority guarantees:
//   • join → hello with a fresh world seeded from our proposal
//   • DETERMINISM/AUTHORITY: a scripted input stream produces the SAME state on the server as the
//     client's local prediction of those inputs (same seed + inputs → same result) — AC3
//   • ANTI-CHEAT: an out-of-reach mine target is rejected server-side (never dug, no spoils) — AC2
//   • reconnect hydrates the persisted progress
//   • a protocol-version mismatch is rejected
// Run with `pnpm server:check`. Exits non-zero on any failed assertion.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { newSession, physicsStep, TICK_DT } from '@delve/shared';
import { PROTOCOL_VERSION, WS_PATH } from '@delve/shared';
import type {
  ClientMessage,
  ServerMessage,
  StateMessage,
  HelloMessage,
  Input,
} from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8799; // isolated from the dev server's 8787
const SERVER = join(HERE, '..', 'server', 'src', 'index.ts');
const DATA_DIR = mkdtempSync(join(tmpdir(), 'delve-srv-'));
const WS_URL = `ws://localhost:${PORT}${WS_PATH}`;

let passed = 0;
let failed = 0;
function check(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log('  OK  ', label);
  } else {
    failed++;
    console.log('  FAIL', label);
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error('server did not start within 5s');
}

/** An event-driven test connection that accumulates the authoritative state it receives. */
interface Conn {
  ws: WebSocket;
  hello: HelloMessage | null;
  states: StateMessage[];
  serverDug: Set<string>; // union of every dugAdded delta the server has sent
}

function connect(): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const conn: Conn = { ws, hello: null, states: [], serverDug: new Set() };
    const timer = setTimeout(() => reject(new Error('connect timed out')), 4000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(conn);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.t === 'hello') conn.hello = msg;
      else if (msg.t === 'state') {
        conn.states.push(msg);
        for (const cellKey of msg.dugAdded) conn.serverDug.add(cellKey);
      }
    });
    ws.on('error', reject);
  });
}

const sendMsg = (conn: Conn, msg: ClientMessage): void => conn.ws.send(JSON.stringify(msg));
const lastState = (conn: Conn): StateMessage | undefined => conn.states[conn.states.length - 1];

/** Poll until `pred()` holds, or throw after `ms`. */
async function waitUntil(pred: () => boolean, ms: number, label: string): Promise<void> {
  for (let waited = 0; waited < ms; waited += 20) {
    if (pred()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Wait for the server to have applied and broadcast at least input `seq`. */
async function waitForAck(conn: Conn, seq: number): Promise<void> {
  await waitUntil(() => (lastState(conn)?.ackSeq ?? -1) >= seq, 5000, `ackSeq>=${seq}`);
}

const setsEqual = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

async function main(): Promise<void> {
  const child = spawn('tsx', [SERVER], {
    env: { ...process.env, PORT: String(PORT), DELVE_DATA_DIR: DATA_DIR },
    stdio: 'ignore',
  });
  try {
    await waitForServer();
    const playerId = 'smoke-tester';
    const seed = 4242;

    // 1) join → fresh world seeded from our proposal
    const c1 = await connect();
    sendMsg(c1, { t: 'join', protocol: PROTOCOL_VERSION, playerId, seed });
    await waitUntil(() => c1.hello !== null, 4000, 'hello');
    check(c1.hello!.fresh === true, 'first join creates a fresh world');
    check(c1.hello!.snapshot.world.seed === seed, 'fresh world uses the proposed seed');

    // 2) DETERMINISM / AUTHORITY: drive a scripted descent both over the wire and locally; the
    //    server's authoritative state must equal the client's local prediction of the same inputs.
    const local = newSession(seed); // matches the server's fresh session (same seed)
    const STEPS = 400;
    for (let seq = 1; seq <= STEPS; seq++) {
      const input: Input = {
        mine: { column: Math.floor(local.player.x), row: Math.floor(local.player.y) + 1 },
      };
      sendMsg(c1, { t: 'input', seq, input });
      physicsStep(local, input, TICK_DT); // local prediction: identical logic + dt
    }
    await waitForAck(c1, STEPS);
    const snap = lastState(c1)!;
    check(snap.ackSeq === STEPS, `server applied all ${STEPS} inputs (ackSeq ${snap.ackSeq})`);
    check(
      snap.player.x === local.player.x && snap.player.y === local.player.y,
      'server position == client prediction (deterministic)',
    );
    check(snap.player.depth === local.player.depth, 'server depth == client prediction');
    check(snap.player.best === local.player.best, 'server best-ore == client prediction');
    check(
      setsEqual(c1.serverDug, new Set(Object.keys(local.world.dug))),
      'server dug tiles == client prediction',
    );

    // 3) ANTI-CHEAT: an out-of-reach mine target is rejected server-side (never dug).
    const farColumn = Math.floor(local.player.x) + 50;
    const farRow = Math.floor(local.player.y);
    const farKey = `${farColumn},${farRow}`;
    sendMsg(c1, {
      t: 'input',
      seq: STEPS + 1,
      input: { mine: { column: farColumn, row: farRow } },
    });
    await waitForAck(c1, STEPS + 1);
    check(!c1.serverDug.has(farKey), 'out-of-reach mine is rejected (tile never dug)');

    const minedTiles = c1.serverDug.size;
    c1.ws.close();
    await delay(400); // let the server process the close + persist

    // 4) reconnect → the persisted progress is hydrated
    const c2 = await connect();
    sendMsg(c2, { t: 'join', protocol: PROTOCOL_VERSION, playerId });
    await waitUntil(() => c2.hello !== null, 4000, 'hello (reconnect)');
    check(c2.hello!.fresh === false, 'reconnect finds the existing save');
    check(
      c2.hello!.snapshot.player.depth === local.player.depth,
      'reconnect hydrates the descent progress',
    );
    check(
      Object.keys(c2.hello!.snapshot.world.dug).length === minedTiles,
      'reconnect hydrates the dug world',
    );
    c2.ws.close();

    // 5) a protocol-version mismatch is rejected
    const c3 = await connect();
    const errored = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      c3.ws.on('message', (raw) => {
        if ((JSON.parse(raw.toString()) as ServerMessage).t === 'error') {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    sendMsg(c3, { t: 'join', protocol: PROTOCOL_VERSION + 999, playerId });
    check(await errored, 'protocol mismatch is rejected');
    c3.ws.close();
  } finally {
    child.kill();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL GOOD (${passed} checks)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
