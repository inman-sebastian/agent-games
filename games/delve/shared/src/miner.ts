// miner.ts — the miner's animation/behaviour state, as a small state machine on top of the pure
// physics. The five states below are what the renderer draws and what juice hooks onto (a landing
// squash when we enter idle/run from the air, a puff when we enter jump, the pick-swing in mine).
//
// The state is DERIVED, not event-driven: it's a pure function of the physics snapshot each tick
// (grounded / vy / vx) plus whether we're actively digging. Locomotion is freely interruptible —
// you can go from any state to any other on the next tick (run off a ledge → fall, land mid-swing,
// jump out of idle) — so a transition *table* would be pure busywork. Instead we compute the state
// with `desiredMinerState` and `set()` the machine to it; the machine earns its keep by firing the
// enter/exit hooks exactly on real changes (see StateMachine.set), which is where the juice lives.
import { StateMachine } from './fsm';
import type { PlayerState } from './types';

export type MinerState = 'idle' | 'run' | 'jump' | 'fall' | 'mine';

/** No table events — the miner is driven purely by `set(desiredMinerState(...))`. */
export type MinerEvent = never;

/** Below this horizontal speed (tiles/s) the miner reads as standing still, not running. Shared so
 * the client and the derivation agree on one threshold. */
export const MOVE_EPSILON = 0.5;

/**
 * The state the miner should be in for this physics snapshot. Priority, highest first:
 *   • mine  — actively digging a tile (the pick-swing reads over everything else)
 *   • jump  — airborne and rising      (vy < 0 is upward; rows increase downward)
 *   • fall  — airborne and descending
 *   • run   — grounded and moving
 *   • idle  — grounded and still
 */
export function desiredMinerState(player: PlayerState, mining: boolean): MinerState {
  if (mining) return 'mine';
  if (!player.grounded) return player.vy < 0 ? 'jump' : 'fall';
  return Math.abs(player.vx) > MOVE_EPSILON ? 'run' : 'idle';
}

export type MinerMachine = StateMachine<MinerState, MinerEvent>;

/** A fresh miner machine starting at rest. Pass hooks to react to transitions (juice). */
export function newMinerMachine(
  hooks?: ConstructorParameters<typeof StateMachine<MinerState, MinerEvent>>[2],
): MinerMachine {
  return new StateMachine<MinerState, MinerEvent>('idle', {}, hooks);
}

/** Advance the miner machine to match the current physics. Returns true if the state changed this
 * tick (which is exactly when the enter/exit hooks fired). */
export function driveMiner(machine: MinerMachine, player: PlayerState, mining: boolean): boolean {
  return machine.set(desiredMinerState(player, mining));
}
