// prediction.ts — the client's half of the authoritative-server contract: predict locally, then
// reconcile against the server without the avatar ever popping.
//
// Every tick the client steps its own copy of the sim for instant feel and buffers the input. When an
// authoritative snapshot arrives it adopts the server's player, applies the world deltas, drops the
// inputs the server has acknowledged, and REPLAYS the rest to re-predict "now". Whatever residual
// difference that leaves is absorbed into a render offset that decays to zero, so a correction reads
// as a nudge rather than a teleport. See docs/ARCHITECTURE.md, "Client / server boundary".
//
// Pure apart from the engine, so it is tested headlessly (prediction.test.ts). It used to be a
// handful of module-level variables in index.ts, interleaved with rendering and input, with no test.
import { physicsStep, TICK_DT } from '@delve/shared';
import type { Input, Session, StateMessage } from '@delve/shared';

/** Fraction of a correction still showing after one second. Fast enough to be invisible on a LAN. */
const CORRECTION_RETAIN_PER_SECOND = 0.0025;
/** Below this the offset snaps to zero, so a settled avatar is exactly where the sim says. */
const SETTLED = 1e-3;
/** How many un-acked inputs to keep before assuming the server has stopped answering. */
const MAX_PENDING = 256;

export function createPrediction() {
  let seq = 0;
  const pending: { seq: number; input: Input }[] = [];
  let offsetX = 0;
  let offsetY = 0;

  return {
    /** Buffer one tick's input for reconciliation; returns the sequence number to send with it. */
    record(input: Input): number {
      seq++;
      pending.push({ seq, input });
      if (pending.length > MAX_PENDING) pending.shift();
      return seq;
    },

    /**
     * Adopt an authoritative snapshot into `session` and re-predict the present.
     *
     * Returns the dug cells this snapshot added that the client hadn't predicted, so the caller can
     * refresh what depends on them (the rock chunks).
     *
     * One known seam, left as it is: replaying an un-acked input can't re-mine a cell the client
     * already dug locally (it is no longer solid), so ore from a break still in flight can drop out of
     * the predicted inventory until the server acknowledges the input that broke it.
     */
    reconcile(session: Session, msg: StateMessage): string[] {
      const shownX = session.player.x + offsetX; // where the avatar appears right now
      const shownY = session.player.y + offsetY;

      session.player = msg.player;
      const newlyDug: string[] = [];
      for (const cellKey of msg.dugAdded) {
        if (session.world.dug[cellKey]) continue;
        session.world.dug[cellKey] = true;
        newlyDug.push(cellKey);
      }
      session.world.dmg = msg.dmg;

      // drop what the server has applied, replay the rest (silently — its juice already played)
      while (pending.length && pending[0].seq <= msg.ackSeq) pending.shift();
      for (const entry of pending) physicsStep(session, entry.input, TICK_DT);

      offsetX = shownX - session.player.x;
      offsetY = shownY - session.player.y;
      return newlyDug;
    },

    /** Let the render offset fall toward zero. Framerate-independent. */
    decay(dt: number): void {
      const keep = Math.pow(CORRECTION_RETAIN_PER_SECOND, dt);
      offsetX *= keep;
      offsetY *= keep;
      if (Math.abs(offsetX) < SETTLED) offsetX = 0;
      if (Math.abs(offsetY) < SETTLED) offsetY = 0;
    },

    /** A new world: nothing pending, nothing to smooth, numbering starts again. */
    reset(): void {
      seq = 0;
      pending.length = 0;
      offsetX = 0;
      offsetY = 0;
    },

    get offsetX(): number {
      return offsetX;
    },
    get offsetY(): number {
      return offsetY;
    },
    get seq(): number {
      return seq;
    },
    get pendingCount(): number {
      return pending.length;
    },
  };
}

export type Prediction = ReturnType<typeof createPrediction>;
