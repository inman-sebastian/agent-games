// net.test.ts — the client's view of whether it is really connected. A fake WebSocket stands in for
// the server, so this runs under happy-dom with no network.
//
// "Online" gates prediction-and-reconcile in the game loop: while online, every tick's input is sent
// and buffered for the next authoritative snapshot. So online has to mean "the server accepted my
// join", not "a socket opened". It used to flip on open — and a server that rejects the join (a
// protocol bump after a deploy) replies with an `error` the client ignored, leaving it "online"
// forever, streaming inputs nobody applied and never reconciling.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PROTOCOL_VERSION, newSession } from '@delve/shared';

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  // test controls
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

let net: typeof import('./net');

beforeEach(async () => {
  vi.resetModules(); // net.ts keeps module-level connection state
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.last = null;
  net = await import('./net');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const handlers = () => ({ getSeed: () => 1, onHello: vi.fn(), onState: vi.fn() });

describe('online means the server accepted the join', () => {
  it('is not online when the socket opens, only once the hello arrives', () => {
    const h = handlers();
    net.connect(h);
    const socket = FakeSocket.last!;
    socket.open();

    expect(socket.sent[0]).toMatchObject({ t: 'join', protocol: PROTOCOL_VERSION });
    expect(net.isOnline()).toBe(false); // opened, joined, not yet accepted

    socket.receive({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      fresh: true,
      snapshot: newSession(1),
    });
    expect(net.isOnline()).toBe(true);
    expect(h.onHello).toHaveBeenCalledOnce();
  });

  it('stays offline when the server rejects the join, and says why', () => {
    const errors = vi.spyOn(console, 'warn').mockImplementation(() => {});
    net.connect(handlers());
    const socket = FakeSocket.last!;
    socket.open();
    socket.receive({ t: 'error', message: 'protocol mismatch (server speaks v99)' });

    expect(net.isOnline()).toBe(false);
    expect(net.netStatus().status).not.toBe('online');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('sends no input before it is online', () => {
    net.connect(handlers());
    const socket = FakeSocket.last!;
    socket.open();
    const beforeHello = socket.sent.length;
    net.sendInput(1, { left: true, right: false, jump: false });
    expect(socket.sent.length).toBe(beforeHello);
  });
});
