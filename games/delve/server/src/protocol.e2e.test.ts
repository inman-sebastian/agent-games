// protocol.e2e.test.ts — end-to-end gate for the P3 authoritative boundary. Spawns the REAL
// server against a throwaway data dir and drives the WebSocket protocol the way client/src/net.ts
// does, asserting the authority guarantees: fresh-world join, determinism/authority (server state
// == the client's local prediction of the same inputs), anti-cheat (out-of-reach mine rejected),
// reconnect hydration, and protocol-version rejection. Migrated from the old tools/server-check.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { newSession, physicsStep, TICK_DT } from '@delve/shared';
import { PROTOCOL_VERSION, WS_PATH } from '@delve/shared';
import type { ClientMessage, ServerMessage, StateMessage, HelloMessage, Input } from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8799; // isolated from the dev server's 8787
const SERVER = join(HERE, 'index.ts');
const WS_URL = `ws://localhost:${PORT}${WS_PATH}`;

let child: ChildProcess;
let dataDir: string;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error('server did not start within 8s');
}

// An event-driven test connection that accumulates the authoritative state it receives.
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

async function waitUntil(pred: () => boolean, ms: number, label: string): Promise<void> {
  for (let waited = 0; waited < ms; waited += 20) {
    if (pred()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const waitForAck = (conn: Conn, seq: number): Promise<void> =>
  waitUntil(() => (lastState(conn)?.ackSeq ?? -1) >= seq, 5000, `ackSeq>=${seq}`);

const setsEqual = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'delve-srv-'));
  child = spawn('tsx', [SERVER], {
    env: { ...process.env, PORT: String(PORT), DELVE_DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitForServer();
}, 20000);

afterAll(() => {
  child?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// One sequential scenario: reconnect depends on the first session's persisted state, so this can't
// be split into independent `it`s without re-establishing the same world each time.
describe('P3 authoritative server', () => {
  it('enforces the authority guarantees end-to-end', async () => {
    const playerId = 'e2e-tester';
    const seed = 4242;

    // 1) join → fresh world seeded from our proposal
    const c1 = await connect();
    sendMsg(c1, { t: 'join', protocol: PROTOCOL_VERSION, playerId, seed });
    await waitUntil(() => c1.hello !== null, 4000, 'hello');
    expect(c1.hello!.fresh, 'first join creates a fresh world').toBe(true);
    expect(c1.hello!.snapshot.world.seed, 'fresh world uses the proposed seed').toBe(seed);

    // 2) DETERMINISM/AUTHORITY: drive a scripted descent over the wire AND locally; the server's
    //    authoritative state must equal the client's local prediction of the same inputs.
    const local = newSession(seed); // matches the server's fresh session (same seed)
    const STEPS = 400;
    for (let seq = 1; seq <= STEPS; seq++) {
      const input: Input = {
        mine: { column: Math.floor(local.player.x), row: Math.floor(local.player.y) + 1 },
      };
      sendMsg(c1, { t: 'input', seq, input });
      physicsStep(local, input, TICK_DT); // identical logic + dt
    }
    await waitForAck(c1, STEPS);
    const snap = lastState(c1)!;
    expect(snap.ackSeq, 'server applied all inputs').toBe(STEPS);
    expect(snap.player.x, 'server x == prediction').toBe(local.player.x);
    expect(snap.player.y, 'server y == prediction').toBe(local.player.y);
    expect(snap.player.depth, 'server depth == prediction').toBe(local.player.depth);
    expect(
      setsEqual(c1.serverDug, new Set(Object.keys(local.world.dug))),
      'server dug tiles == prediction',
    ).toBe(true);

    // 3) ANTI-CHEAT: an out-of-reach mine target is rejected server-side (never dug).
    const farKey = `${Math.floor(local.player.x) + 50},${Math.floor(local.player.y)}`;
    sendMsg(c1, {
      t: 'input',
      seq: STEPS + 1,
      input: { mine: { column: Math.floor(local.player.x) + 50, row: Math.floor(local.player.y) } },
    });
    await waitForAck(c1, STEPS + 1);
    expect(c1.serverDug.has(farKey), 'out-of-reach mine rejected').toBe(false);

    const minedTiles = c1.serverDug.size;
    c1.ws.close();
    await delay(400); // let the server process the close + persist

    // 4) reconnect → the persisted progress is hydrated
    const c2 = await connect();
    sendMsg(c2, { t: 'join', protocol: PROTOCOL_VERSION, playerId });
    await waitUntil(() => c2.hello !== null, 4000, 'hello (reconnect)');
    expect(c2.hello!.fresh, 'reconnect finds the existing save').toBe(false);
    expect(c2.hello!.snapshot.player.depth, 'reconnect hydrates progress').toBe(local.player.depth);
    expect(
      Object.keys(c2.hello!.snapshot.world.dug).length,
      'reconnect hydrates the dug world',
    ).toBe(minedTiles);
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
    expect(await errored, 'protocol mismatch is rejected').toBe(true);
    c3.ws.close();
  }, 30000);
});
