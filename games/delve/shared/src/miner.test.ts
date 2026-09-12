import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  desiredMinerState,
  driveMiner,
  newMinerMachine,
  MOVE_EPSILON,
  type MinerState,
} from './miner';
import { newPlayer, newSession, physicsStep } from './engine';
import type { PlayerState } from './types';

const STATES: MinerState[] = ['idle', 'run', 'jump', 'fall', 'mine'];

// Build a physics snapshot with just the fields the derivation reads.
const snapshot = (over: Partial<PlayerState>): PlayerState => ({ ...newPlayer(), ...over });

describe('desiredMinerState — priority rules', () => {
  it('mine overrides everything while digging', () => {
    expect(desiredMinerState(snapshot({ grounded: false, vy: -5, vx: 6 }), true)).toBe('mine');
    expect(desiredMinerState(snapshot({ grounded: true, vx: 0 }), true)).toBe('mine');
  });

  it('airborne splits into jump (rising) and fall (descending) by vy sign', () => {
    expect(desiredMinerState(snapshot({ grounded: false, vy: -3 }), false)).toBe('jump');
    expect(desiredMinerState(snapshot({ grounded: false, vy: 3 }), false)).toBe('fall');
    expect(desiredMinerState(snapshot({ grounded: false, vy: 0 }), false)).toBe('fall'); // apex counts as falling
  });

  it('grounded splits into run and idle by horizontal speed', () => {
    expect(desiredMinerState(snapshot({ grounded: true, vx: MOVE_EPSILON + 0.1 }), false)).toBe(
      'run',
    );
    expect(desiredMinerState(snapshot({ grounded: true, vx: -(MOVE_EPSILON + 0.1) }), false)).toBe(
      'run',
    );
    expect(desiredMinerState(snapshot({ grounded: true, vx: MOVE_EPSILON - 0.1 }), false)).toBe(
      'idle',
    );
  });
});

describe('desiredMinerState — invariants over random snapshots', () => {
  it('always returns one of the five states', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (grounded, mining, vy, vx) => {
          const state = desiredMinerState(snapshot({ grounded, vy, vx }), mining);
          expect(STATES).toContain(state);
        },
      ),
    );
  });

  it('a grounded, still, non-digging miner is always idle; an airborne one is never idle/run', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (grounded, vy, vx) => {
          const state = desiredMinerState(snapshot({ grounded, vy, vx }), false);
          if (grounded && Math.abs(vx) <= MOVE_EPSILON) expect(state).toBe('idle');
          if (!grounded) expect(state === 'jump' || state === 'fall').toBe(true);
        },
      ),
    );
  });
});

describe('driveMiner over a real playthrough', () => {
  // Ties the state to the actual sim: fuzz inputs through physicsStep and assert the miner state
  // stays consistent with the physics every tick. Teeth: if the derivation ever lets 'idle'/'run'
  // leak into airborne frames (or 'jump'/'fall' into grounded ones), this goes red.
  it('never contradicts the physics snapshot it was driven from', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 30 }),
        fc.array(
          fc.record({
            left: fc.boolean(),
            right: fc.boolean(),
            jump: fc.boolean(),
            dig: fc.boolean(),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        (seed, script) => {
          const session = newSession(seed);
          const machine = newMinerMachine();
          for (const step of script) {
            // aim straight down so digging actually engages a solid tile below the feet
            const below = {
              column: Math.floor(session.player.x),
              row: Math.floor(session.player.y) + 1,
            };
            physicsStep(
              session,
              {
                left: step.left,
                right: step.right,
                jump: step.jump,
                mine: step.dig ? below : null,
              },
              1 / 60,
            );
            const mining = session.player.digKey !== null;
            driveMiner(machine, session.player, mining);
            const p = session.player;
            if (mining) {
              expect(machine.state).toBe('mine');
            } else if (p.grounded) {
              expect(machine.is('idle', 'run')).toBe(true);
            } else {
              expect(machine.is('jump', 'fall')).toBe(true);
            }
          }
        },
      ),
    );
  });
});
