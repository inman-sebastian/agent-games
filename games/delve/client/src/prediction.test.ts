// prediction.test.ts — client prediction and reconciliation, against the real engine.
//
// The server side of this contract is covered end to end (server/src/protocol.e2e.test.ts); this is
// the client side, which had no test while it lived as module variables in index.ts. A "server" here
// is just a second session stepped with the inputs it has acknowledged.
import { describe, it, expect } from 'vitest';
import { newSession, physicsStep, TICK_DT, SUB } from '@delve/shared';
import type { Input, Session, StateMessage } from '@delve/shared';
import { createPrediction } from './prediction';

const RIGHT: Input = { left: false, right: true, jump: false };
const IDLE: Input = { left: false, right: false, jump: false };

/** Clone a session the way the wire does. */
const snapshotOf = (session: Session): Session => JSON.parse(JSON.stringify(session));

function stateFrom(server: Session, ackSeq: number, dugAdded: string[] = []): StateMessage {
  const copy = snapshotOf(server);
  return { t: 'state', ackSeq, player: copy.player, dugAdded, dmg: copy.world.dmg };
}

describe('client prediction', () => {
  it('leaves nothing to correct when the server applied exactly what the client predicted', () => {
    const client = newSession(4);
    const server = snapshotOf(client);
    const prediction = createPrediction();
    const inputs = [...Array(30)].map((_, i) => (i < 20 ? RIGHT : IDLE));

    for (const input of inputs) {
      prediction.record(input);
      physicsStep(client, input, TICK_DT);
    }
    // the server has applied the first 18
    for (const input of inputs.slice(0, 18)) physicsStep(server, input, TICK_DT);

    prediction.reconcile(client, stateFrom(server, 18));
    expect(prediction.pendingCount).toBe(12); // acked ones dropped, the rest kept for next time
    expect(prediction.offsetX).toBeCloseTo(0, 9); // replaying the 12 lands exactly on the prediction
    expect(prediction.offsetY).toBeCloseTo(0, 9);
  });

  it('never pops the avatar on a correction, and settles it quickly', () => {
    const client = newSession(4);
    const prediction = createPrediction();
    for (let i = 0; i < 10; i++) {
      prediction.record(RIGHT);
      physicsStep(client, RIGHT, TICK_DT);
    }
    const shownBefore = client.player.x + prediction.offsetX;

    // the server disagrees: it has the player a whole block further on
    const server = snapshotOf(client);
    server.player.x += SUB;
    prediction.reconcile(client, stateFrom(server, 10));

    expect(client.player.x).toBeCloseTo(shownBefore + SUB, 9); // the sim adopted the server...
    expect(client.player.x + prediction.offsetX).toBeCloseTo(shownBefore, 9); // ...the picture didn't jump
    // 99.75% of a correction is gone after a second (CORRECTION_RETAIN_PER_SECOND), and a whole-block
    // one has snapped exactly to zero by a second and a half
    for (let frame = 0; frame < 60; frame++) prediction.decay(1 / 60);
    expect(Math.abs(prediction.offsetX)).toBeLessThan(SUB * 0.01);
    for (let frame = 0; frame < 30; frame++) prediction.decay(1 / 60);
    expect(prediction.offsetX).toBe(0);
  });

  it('applies world deltas once, and reports only cells it had not already predicted', () => {
    const client = newSession(4);
    client.world.dug['5,20'] = true; // predicted locally already
    const prediction = createPrediction();
    const newlyDug = prediction.reconcile(client, {
      ...stateFrom(snapshotOf(client), 0, ['5,20', '6,20']),
    });
    expect(newlyDug).toEqual(['6,20']);
    expect(client.world.dug['6,20']).toBe(true);
  });

  it('bounds what it keeps for a server that has stopped answering, and forgets it all on reset', () => {
    const prediction = createPrediction();
    for (let i = 0; i < 1000; i++) prediction.record(IDLE);
    expect(prediction.pendingCount).toBe(256);
    expect(prediction.seq).toBe(1000);
    prediction.reset();
    expect(prediction.pendingCount).toBe(0);
    expect(prediction.seq).toBe(0);
    expect(prediction.record(IDLE)).toBe(1);
  });
});
