import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { StateMachine, type Transitions } from './fsm';

// A small turnstile — the textbook FSM — exercises the table-driven `send` path.
type Gate = 'locked' | 'open';
type Coin = 'coin' | 'push';
const TURNSTILE: Transitions<Gate, Coin> = {
  locked: { coin: 'open' },
  open: { push: 'locked' },
};

describe('StateMachine — table transitions (send)', () => {
  it('starts in the initial state and does not fire onEnter at construction', () => {
    const seen: string[] = [];
    const m = new StateMachine<Gate, Coin>('locked', TURNSTILE, {
      onEnter: (s) => seen.push(s),
    });
    expect(m.state).toBe('locked');
    expect(m.previous).toBeNull();
    expect(seen).toEqual([]); // construction is side-effect free
  });

  it('takes legal transitions and reports the change', () => {
    const m = new StateMachine<Gate, Coin>('locked', TURNSTILE);
    expect(m.can('coin')).toBe(true);
    expect(m.send('coin')).toBe(true);
    expect(m.state).toBe('open');
    expect(m.previous).toBe('locked');
  });

  // Teeth: this is the whole point of the table. If `send` ever stops consulting the table and
  // just applies any event, this goes red — an undefined edge must change nothing.
  it('rejects an event with no edge from the current state', () => {
    const m = new StateMachine<Gate, Coin>('locked', TURNSTILE);
    expect(m.can('push')).toBe(false);
    expect(m.send('push')).toBe(false);
    expect(m.state).toBe('locked');
    expect(m.previous).toBeNull(); // never moved
  });

  it('fires onExit(old) before onEnter(new) with the driving event', () => {
    const log: string[] = [];
    const m = new StateMachine<Gate, Coin>('locked', TURNSTILE, {
      onExit: (s, d) => log.push(`exit ${s}->${d.to} via ${d.event}`),
      onEnter: (s, d) => log.push(`enter ${s} from ${d.from} via ${d.event}`),
    });
    m.send('coin');
    expect(log).toEqual(['exit locked->open via coin', 'enter open from locked via coin']);
  });
});

describe('StateMachine — direct set', () => {
  it('jumps to any state ignoring the table, with a null event in hooks', () => {
    const detail: unknown[] = [];
    const m = new StateMachine<Gate, Coin>('locked', TURNSTILE, {
      onEnter: (_s, d) => detail.push(d.event),
    });
    expect(m.set('open')).toBe(true); // no 'coin'/'push' table edge needed
    expect(m.state).toBe('open');
    expect(detail).toEqual([null]);
  });

  it('treats setting the current state as a no-op — no change, no hooks', () => {
    let enters = 0;
    const m = new StateMachine<Gate, Coin>('open', TURNSTILE, { onEnter: () => enters++ });
    expect(m.set('open')).toBe(false);
    expect(enters).toBe(0);
    expect(m.previous).toBeNull();
  });
});

describe('StateMachine — invariants over random drives', () => {
  const STATES: Gate[] = ['locked', 'open'];

  it('state is always a declared state and onEnter count matches real changes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant<Coin>('coin'), fc.constant<Coin>('push'))),
        (events) => {
          let changes = 0;
          const m = new StateMachine<Gate, Coin>('locked', TURNSTILE, { onEnter: () => changes++ });
          let expectedChanges = 0;
          for (const e of events) {
            const before = m.state;
            const moved = m.send(e);
            expect(STATES).toContain(m.state); // never a bogus state
            expect(moved).toBe(m.state !== before);
            if (moved) expectedChanges++;
          }
          expect(changes).toBe(expectedChanges); // hooks fire exactly on real transitions
        },
      ),
    );
  });

  it('previous is always the state held immediately before the last change', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Gate>('locked', 'open'), { minLength: 1 }),
        (targets) => {
          const m = new StateMachine<Gate, Coin>('locked', TURNSTILE);
          let lastDistinct: Gate | null = null;
          for (const t of targets) {
            const before = m.state;
            if (m.set(t)) lastDistinct = before;
            expect(m.previous).toBe(lastDistinct);
          }
        },
      ),
    );
  });
});
