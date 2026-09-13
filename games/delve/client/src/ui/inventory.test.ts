// inventory.test.ts — the Inventory panel's slot grid (happy-dom).
//
// Asserts the ATTRIBUTES rather than the rendered slot: a `<delve-slot>` is an unupgraded element
// here (registering it would drag canvas in, which happy-dom has no answer for), and the attributes
// are the actual contract between the panel and the widget. slot.test.ts covers what the widget then
// does with them.
import { describe, it, expect } from 'vitest';
import { buildInventoryGrid, MIN_SLOTS, type InvOreInfo } from './inventory';

const ORES: Record<number, InvOreInfo> = {
  2: { name: 'Copper', desc: 'A ruddy metal.' },
  5: { name: 'Gold', desc: 'Heavy and radiant.' },
  8: { name: 'Diamond', desc: 'Flawless.' },
};

const slots = (grid: HTMLElement): HTMLElement[] => [...grid.querySelectorAll('delve-slot')];
const filled = (grid: HTMLElement): HTMLElement[] =>
  slots(grid).filter((s) => s.getAttribute('state') !== 'empty');

describe('buildInventoryGrid', () => {
  it('is all empty slots when nothing is held, never a blank panel', () => {
    // The empty state is a requirement rather than polish: a new player's inventory has to read as
    // somewhere things go.
    const grid = buildInventoryGrid({}, ORES);
    expect(slots(grid)).toHaveLength(MIN_SLOTS);
    expect(filled(grid)).toHaveLength(0);
    expect(slots(grid).every((s) => s.getAttribute('state') === 'empty')).toBe(true);
  });

  it('renders one filled slot per held material, sorted by id', () => {
    // Sorted by ID, not by count — an inventory that reshuffles as you mine is one you cannot build
    // muscle memory for.
    const grid = buildInventoryGrid({ 5: 3, 2: 40, 8: 1 }, ORES);
    expect(filled(grid).map((s) => s.getAttribute('ore'))).toEqual(['2', '5', '8']);
    expect(filled(grid).map((s) => s.getAttribute('count'))).toEqual(['40', '3', '1']);
  });

  it('pads to a full grid so the container keeps its shape', () => {
    const grid = buildInventoryGrid({ 2: 1 }, ORES);
    expect(slots(grid)).toHaveLength(MIN_SLOTS);
    expect(filled(grid)).toHaveLength(1);
  });

  it('grows past the minimum when more is held than fits', () => {
    const many: Record<number, number> = {};
    for (let id = 1; id <= MIN_SLOTS + 5; id++) many[id] = 1;
    const grid = buildInventoryGrid(many, ORES);
    expect(slots(grid)).toHaveLength(MIN_SLOTS + 5);
  });

  it('omits materials with a zero or negative count', () => {
    const grid = buildInventoryGrid({ 2: 0, 5: 7, 8: -1 }, ORES);
    expect(filled(grid).map((s) => s.getAttribute('ore'))).toEqual(['5']);
  });

  it('marks the selected material, and only it', () => {
    const grid = buildInventoryGrid({ 2: 1, 5: 1 }, ORES, 5);
    expect(filled(grid).map((s) => s.getAttribute('state'))).toEqual(['filled', 'selected']);
  });

  it('names each material for hover and for a screen reader', () => {
    const grid = buildInventoryGrid({ 2: 4 }, ORES);
    expect(filled(grid)[0].getAttribute('title')).toBe('Copper');
    expect(grid.getAttribute('role')).toBe('list');
    expect(filled(grid)[0].getAttribute('role')).toBe('listitem');
  });
});
