// inventory.test.ts — the Inventory panel row builder (happy-dom). The icon factory is stubbed so
// the test never touches canvas; we assert the DOM structure, sorting, counts, and empty state.
import { describe, it, expect, vi } from 'vitest';
import { buildInventoryRows, type InvOreInfo } from './inventory';

const ORES: Record<number, InvOreInfo> = {
  2: { name: 'Copper', desc: 'A ruddy metal.' },
  5: { name: 'Gold', desc: 'Heavy and radiant.' },
  8: { name: 'Diamond', desc: 'Flawless.' },
};
const stubIcon = () => document.createElement('span');

describe('buildInventoryRows', () => {
  it('renders the empty state when nothing is held', () => {
    const rows = buildInventoryRows({}, ORES, stubIcon);
    expect(rows).toHaveLength(1);
    expect(rows[0].className).toBe('sub');
    expect(rows[0].textContent).toMatch(/dig to collect/i);
  });

  it('renders one row per held material, sorted by id, with names + counts', () => {
    const rows = buildInventoryRows({ 5: 3, 2: 40, 8: 1 }, ORES, stubIcon);
    expect(rows).toHaveLength(3);
    // sorted by ore id → Copper(2), Gold(5), Diamond(8)
    expect(rows.map((r) => r.querySelector('.nm')!.textContent)).toEqual(['Copper', 'Gold', 'Diamond']);
    expect(rows.map((r) => r.querySelector('.lv')!.textContent)).toEqual(['×40', '×3', '×1']);
    expect(rows[0].querySelector('.ds')!.textContent).toBe('A ruddy metal.');
  });

  it('omits materials with a zero/negative count', () => {
    const rows = buildInventoryRows({ 2: 0, 5: 7, 8: -1 }, ORES, stubIcon);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.nm')!.textContent).toBe('Gold');
  });

  it('formats large counts with locale separators', () => {
    const rows = buildInventoryRows({ 2: 1234 }, ORES, stubIcon);
    expect(rows[0].querySelector('.lv')!.textContent).toBe(`×${(1234).toLocaleString()}`);
  });

  it('asks the icon factory for each held material at the panel size', () => {
    const makeIcon = vi.fn(() => document.createElement('span'));
    buildInventoryRows({ 2: 1, 5: 1 }, ORES, makeIcon);
    expect(makeIcon).toHaveBeenCalledTimes(2);
    expect(makeIcon).toHaveBeenCalledWith(2, 22);
    expect(makeIcon).toHaveBeenCalledWith(5, 22);
  });
});
