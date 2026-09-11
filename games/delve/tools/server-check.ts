// server-check.ts — a cheap headless smoke test of the P2 client/server boundary (no browser).
// It spawns the real server against a throwaway data dir, then drives the WebSocket protocol the
// way the client does and asserts the store-of-record behaviour:
//   join (new)     → hello{fresh:true} seeded from our proposal
//   sync(mutated)  → persisted, acked
//   reconnect      → hello{fresh:false} hydrates the synced progress
//   bad protocol   → rejected with an error
// Run with `pnpm server:check`. Exits non-zero on any failed assertion.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { newSession } from '@delve/shared';
import { PROTOCOL_VERSION, WS_PATH } from '@delve/shared';
import type { ClientMessage, ServerMessage } from '@delve/shared';

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

/** Resolve once the server answers /healthz, or reject after ~5s. */
async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start within 5s');
}

/** Open a socket, send `join`, resolve with the socket + the `hello` reply. */
function joinAs(
  playerId: string,
  seed?: number,
): Promise<{ ws: WebSocket; hello: Extract<ServerMessage, { t: 'hello' }> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error('join timed out')), 4000);
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          t: 'join',
          protocol: PROTOCOL_VERSION,
          playerId,
          seed,
        } satisfies ClientMessage),
      ),
    );
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.t === 'hello') {
        clearTimeout(timer);
        resolve({ ws, hello: msg });
      }
    });
    ws.on('error', reject);
  });
}

/** Resolve with the next server message matching tag `t`. */
function nextMessage<T extends ServerMessage['t']>(
  ws: WebSocket,
  t: T,
): Promise<Extract<ServerMessage, { t: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${t}'`)), 4000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (msg.t === t) {
        clearTimeout(timer);
        resolve(msg as Extract<ServerMessage, { t: T }>);
      }
    });
  });
}

async function main(): Promise<void> {
  const child = spawn('tsx', [SERVER], {
    env: { ...process.env, PORT: String(PORT), DELVE_DATA_DIR: DATA_DIR },
    stdio: 'ignore',
  });
  try {
    await waitForServer();
    const playerId = 'smoke-tester';
    const seed = 4242;

    // 1) first join → a fresh save seeded from our proposal
    const first = await joinAs(playerId, seed);
    check(first.hello.fresh === true, 'first join creates a fresh save');
    check(first.hello.state.world.seed === seed, 'fresh save uses the proposed seed');

    // 2) sync a mutated state → persisted + acked
    const mutated = newSession(seed);
    mutated.player.coins = 999;
    mutated.player.depth = 50;
    mutated.player.earned = 999;
    const ack = nextMessage(first.ws, 'synced');
    first.ws.send(JSON.stringify({ t: 'sync', state: mutated } satisfies ClientMessage));
    await ack;
    check(true, 'sync is acknowledged');
    first.ws.close();

    // 3) reconnect → the persisted progress is hydrated (server is the store of record)
    const second = await joinAs(playerId, seed);
    check(second.hello.fresh === false, 'reconnect finds the existing save');
    check(
      second.hello.state.player.coins === 999 && second.hello.state.player.depth === 50,
      'reconnect hydrates the synced progress',
    );
    second.ws.close();

    // 4) a protocol-version mismatch is rejected
    const stale = new WebSocket(WS_URL);
    const errored = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      stale.on('open', () =>
        stale.send(
          JSON.stringify({
            t: 'join',
            protocol: PROTOCOL_VERSION + 999,
            playerId,
          } satisfies ClientMessage),
        ),
      );
      stale.on('message', (raw) => {
        if ((JSON.parse(raw.toString()) as ServerMessage).t === 'error') {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    check(await errored, 'protocol mismatch is rejected');
    stale.close();
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
