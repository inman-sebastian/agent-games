// fsm.ts — a tiny, generic, table-driven finite state machine, shared by everything in DELVE that
// needs one (the app/screen flow, the miner's animation state, …). It is DOM-free and pure aside
// from the optional hooks, so it runs the same in the browser, the tools, and the tests.
//
// Two ways to drive it, because DELVE has two shapes of state:
//   • send(event) — the constrained kind. Only the transitions in the table are legal; an event
//     with no entry from the current state is rejected (send returns false, nothing changes). Use
//     this when illegal transitions are bugs to catch — e.g. you must never go loading → paused.
//   • set(state)  — the derived kind. Jump straight to a computed state, no table. Use this when
//     the "next state" is a pure function of some other state (the miner's idle/run/jump/fall is
//     derived from the physics each tick), so a transition table would only be busywork.
// Both fire the enter/exit hooks and both treat "already in that state" as a no-op (no re-fire),
// so a per-tick set(computed) or a redundant send() costs nothing.

/** A per-state map of `event → destination state`. A missing event means "no transition on that
 * event from this state" — send() rejects it. Partial by design: only legal edges are listed. */
export type Transitions<S extends string, E extends string> = {
  readonly [state in S]?: { readonly [event in E]?: S };
};

/** Optional side effects fired as the machine changes state. `onExit` runs before the change
 * (`machine.state` is still the old state); `onEnter` runs after (it's already the new state).
 * On a `set()` there is no event, so `event` is null. Neither fires on a no-op self-transition. */
export interface StateMachineHooks<S extends string, E extends string> {
  onEnter?(state: S, detail: { from: S | null; event: E | null }): void;
  onExit?(state: S, detail: { to: S; event: E | null }): void;
}

export class StateMachine<S extends string, E extends string> {
  private current: S;
  private prior: S | null = null;

  // The initial state's onEnter is NOT fired at construction — that keeps construction free of
  // side effects and init-order surprises. Do the initial state's setup explicitly if you need it.
  constructor(
    initial: S,
    private readonly transitions: Transitions<S, E> = {},
    private readonly hooks: StateMachineHooks<S, E> = {},
  ) {
    this.current = initial;
  }

  /** The state the machine is in right now. */
  get state(): S {
    return this.current;
  }

  /** The state the machine was in before the last change, or null if it has never changed. */
  get previous(): S | null {
    return this.prior;
  }

  /** True if the current state is any of `states`. */
  is(...states: readonly S[]): boolean {
    return states.includes(this.current);
  }

  /** The state `event` would lead to from the current state, or null if the table has no such edge. */
  private destination(event: E): S | null {
    return this.transitions[this.current]?.[event] ?? null;
  }

  /** Whether `event` is a legal transition from the current state. */
  can(event: E): boolean {
    return this.destination(event) !== null;
  }

  /** Apply a table transition. Returns true if the state changed. A rejected event (no edge) or a
   * self-transition (edge points back at the current state) changes nothing and returns false. */
  send(event: E): boolean {
    const next = this.destination(event);
    if (next === null) return false;
    return this.change(next, event);
  }

  /** Jump directly to `state`, ignoring the transition table. Returns true if the state changed;
   * setting the state it's already in is a no-op that returns false and fires no hooks. */
  set(state: S): boolean {
    return this.change(state, null);
  }

  private change(next: S, event: E | null): boolean {
    if (next === this.current) return false;
    this.hooks.onExit?.(this.current, { to: next, event });
    this.prior = this.current;
    this.current = next;
    this.hooks.onEnter?.(next, { from: this.prior, event });
    return true;
  }
}
