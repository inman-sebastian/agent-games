// slot.test.ts — `<delve-slot>` (happy-dom).
//
// The icon module is mocked, because a real icon runs the world compositor over a canvas and
// happy-dom has no canvas. What is asserted is everything else, which is the part with decisions in
// it: the states, the count rule, the empty state, and the accessible name.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('./icon', () => ({
  ICON_PX: 32,
  materialIcon: (oreId: number, size: number) => {
    const stub = document.createElement('span');
    stub.dataset.ore = String(oreId);
    stub.dataset.size = String(size);
    return stub;
  },
  clearIconCache: () => {},
}));

import { compact, defineSlot, DelveSlot, type SlotState } from './slot';

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
    // ICON_PX, not a literal: an icon is one world tile at the size the world draws it. Asking for
    // "16" looks like 16 art pixels and means 16 CSS pixels, which is half the art scale.
    expect(icon.dataset.size).toBe('32');
    expect(inner(el, '.pip'), 'a filled slot has no pip').toBeNull();
  });

  it('never shows a wrong number, however large the stack', () => {
    // The failure this guards was the dangerous kind: four digits did not fit, `overflow: hidden`
    // clipped the LEADING one, and a stack of 1280 rendered as "280". A wrong number is worse than a
    // truncated one, because nothing about it looks wrong.
    expect(compact(999)).toBe('999');
    expect(compact(1000)).toBe('1k');
    expect(compact(1280)).toBe('1.2k');
    expect(compact(9999)).toBe('9.9k');
    expect(compact(12345)).toBe('12k');
    expect(compact(999999)).toBe('1000k');
    expect(compact(1_500_000)).toBe('1.5m');
    // Whatever the value, it stays short enough to fit the slot.
    for (const n of [1, 42, 999, 1000, 5678, 99999, 4_200_000]) {
      expect(compact(n).length, `${n} fits`).toBeLessThanOrEqual(5);
    }
  });

  it('gives a screen reader the EXACT count, not the compacted one', () => {
    // The compaction is a space constraint on the glyphs, not on the information.
    expect(slot({ ore: '2', count: '1280' }).getAttribute('aria-label')).toBe('1280 held');
  });

  it('hides a count of one, because a filled slot already says "one"', () => {
    expect(inner(slot({ ore: '2', count: '1' }), '.count')!.textContent).toBe('');
    expect(inner(slot({ ore: '2', count: '2' }), '.count')!.textContent).toBe('2');
    expect(inner(slot({ ore: '2', count: '340' }), '.count')!.textContent).toBe('340');
    expect(inner(slot({ ore: '2', count: '1280' }), '.count')!.textContent).toBe('1.2k');
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
