// slot.test.ts — `<delve-slot>` (happy-dom).
//
// The icon module is mocked, because a real icon runs the world compositor over a canvas and
// happy-dom has no canvas. What is asserted is everything else, which is the part with decisions in
// it: the states, the count rule, the empty state, and the accessible name.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('./icon', () => ({
  materialIcon: (oreId: number, size: number) => {
    const stub = document.createElement('span');
    stub.dataset.ore = String(oreId);
    stub.dataset.size = String(size);
    return stub;
  },
  clearIconCache: () => {},
}));

import { defineSlot, DelveSlot, type SlotState } from './slot';

beforeAll(() => defineSlot());

function slot(attrs: Record<string, string> = {}): DelveSlot {
  const el = document.createElement('delve-slot') as DelveSlot;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

const inner = (el: DelveSlot, sel: string): Element | null => el.shadowRoot!.querySelector(sel);

describe('delve-slot', () => {
  it('registers once, so a lab and the game can both define it', () => {
    defineSlot();
    defineSlot();
    expect(customElements.get('delve-slot')).toBe(DelveSlot);
  });

  it('defaults to empty, and draws a pip rather than nothing', () => {
    // The empty state is a requirement, not polish: it is what a new player sees most, and an
    // actually-blank box reads as a rendering failure rather than as a place something goes.
    const el = slot();
    expect(el.state).toBe('empty');
    expect(inner(el, '.pip'), 'the empty slot is drawn').not.toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Empty slot');
  });

  it('renders the material when it holds one', () => {
    const el = slot({ ore: '9', count: '4' });
    const icon = inner(el, '.icon span') as HTMLElement;
    expect(icon.dataset.ore).toBe('9');
    // 16 art px inside a 20 art px slot leaves the frame's inner lip clear
    expect(icon.dataset.size).toBe('16');
    expect(inner(el, '.pip'), 'a filled slot has no pip').toBeNull();
  });

  it('hides a count of one, because a filled slot already says "one"', () => {
    expect(inner(slot({ ore: '2', count: '1' }), '.count')!.textContent).toBe('');
    expect(inner(slot({ ore: '2', count: '2' }), '.count')!.textContent).toBe('2');
    expect(inner(slot({ ore: '2', count: '340' }), '.count')!.textContent).toBe('340');
  });

  it('shows no count at all when empty, whatever the attribute says', () => {
    // Guards a real ordering hazard: clearing `ore` without clearing `count` would otherwise leave a
    // number floating in an empty slot.
    expect(inner(slot({ count: '7' }), '.count')!.textContent).toBe('');
  });

  it('re-renders when its attributes change', () => {
    const el = slot({ ore: '3', count: '2' });
    el.setAttribute('count', '9');
    expect(inner(el, '.count')!.textContent).toBe('9');
    el.removeAttribute('ore');
    expect(inner(el, '.pip'), 'emptying a slot restores the pip').not.toBeNull();
  });

  it('names every state for a screen reader', () => {
    // The state IS the information here — a slot is a square, and without this a non-visual player
    // gets nothing at all from it.
    const named: [SlotState, string, string][] = [
      ['locked', '', 'Locked slot'],
      ['filled', '5', '3 held'],
      ['selected', '5', '3 held, selected'],
      ['unaffordable', '5', '3 held, not enough'],
    ];
    for (const [state, ore, label] of named) {
      const el = slot(ore ? { state, ore, count: '3' } : { state });
      expect(el.getAttribute('aria-label'), state).toBe(label);
    }
  });

  it('falls back to empty for a state it does not know', () => {
    // Attributes are strings and callers are fallible; an unknown state must not leave the slot in
    // an undefined visual condition.
    expect(slot({ state: 'exploded' }).state).toBe('empty');
  });

  it('exposes state, ore and count as properties as well as attributes', () => {
    const el = slot();
    el.ore = 7;
    el.count = 12;
    el.state = 'selected';
    expect(el.getAttribute('ore')).toBe('7');
    expect(inner(el, '.count')!.textContent).toBe('12');
    expect(el.state).toBe('selected');
    el.ore = null;
    expect(el.hasAttribute('ore')).toBe(false);
  });
});
