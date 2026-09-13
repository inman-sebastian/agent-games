// ui/inventory.ts — the Inventory panel's grid of slots (#41).
//
// This built descriptive ROWS — icon, name, description, count — which is a list of materials rather
// than an inventory. An inventory is a grid you read at a glance, and it is one of the four surfaces
// made out of `<delve-slot>` (the others being the action bar, equipment, and a recipe's
// ingredients). The flavour text moved to where it belongs: the Collection panel is the codex, and
// a codex is the thing that exists to tell you what a material IS.
//
// Pure DOM construction — no game state, no side effects, reads nothing global but `document` — so
// it stays testable under happy-dom. The slot element is registered by the caller; a slot that has
// not been upgraded yet is still a `<delve-slot>` with the right attributes on it, which is what
// these assertions read.
import type { DelveSlot, SlotState } from './slot';

/** The bits of a material the inventory needs. Names are shown on hover and to a screen reader. */
export interface InvOreInfo {
  name: string;
  desc: string;
}

/**
 * Empty slots padded out after the held ones, so the grid reads as a container with room in it
 * rather than as a list that happens to be short.
 *
 * The empty state is a visible PROMISE — see the note in slot.ts. A new player's inventory should
 * look like somewhere things go, which a completely blank panel does not.
 */
export const MIN_SLOTS = 12;

/**
 * Build the inventory grid: one filled slot per held material, sorted by ore id, padded with empty
 * slots to at least `MIN_SLOTS`.
 *
 * Sorted by id rather than by count, so a material never moves as you mine — an inventory that
 * reshuffles under the cursor is one you cannot build muscle memory for.
 */
export function buildInventoryGrid(
  inv: Record<number, number>,
  oreById: Record<number, InvOreInfo>,
  selected: number | null = null,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.setAttribute('role', 'list');

  const ids = Object.keys(inv)
    .map(Number)
    .filter((id) => inv[id] > 0)
    .sort((a, b) => a - b);

  for (const id of ids) {
    const state: SlotState = id === selected ? 'selected' : 'filled';
    grid.append(slot({ ore: id, count: inv[id], state, title: oreById[id]?.name }));
  }
  for (let i = ids.length; i < MIN_SLOTS; i++) grid.append(slot({ state: 'empty' }));
  return grid;
}

function slot(spec: {
  ore?: number;
  count?: number;
  state: SlotState;
  title?: string;
}): DelveSlot {
  const el = document.createElement('delve-slot') as DelveSlot;
  el.setAttribute('state', spec.state);
  el.setAttribute('role', 'listitem');
  if (spec.ore !== undefined) el.setAttribute('ore', String(spec.ore));
  if (spec.count !== undefined) el.setAttribute('count', String(spec.count));
  if (spec.title) el.title = spec.title;
  return el;
}
