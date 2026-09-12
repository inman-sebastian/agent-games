// ui/inventory.ts — builds the Inventory panel's material rows (icon + name + desc + count).
// Extracted from index.ts so the DOM output is testable under happy-dom; the ore-icon factory
// is INJECTED so tests can stub it (the real icon draws to a canvas, which happy-dom can't).
// Pure DOM construction — no game state, no side effects, reads nothing global but `document`.

/** The bits of an ore an inventory row shows. */
export interface InvOreInfo {
  name: string;
  desc: string;
}
/** Produces an ore's icon node (real = the canvas from index.ts `oreIcon`; test = a stub). */
export type MakeIcon = (oreId: number, px: number) => Node;

/**
 * One row per held material (count > 0), sorted by ore id, or a single empty-state row when the
 * inventory is empty. Returns detached nodes; the caller clears the list and appends them.
 */
export function buildInventoryRows(
  inv: Record<number, number>,
  oreById: Record<number, InvOreInfo>,
  makeIcon: MakeIcon,
): HTMLElement[] {
  const ids = Object.keys(inv)
    .map(Number)
    .filter((id) => inv[id] > 0)
    .sort((a, b) => a - b);
  if (!ids.length) {
    const empty = document.createElement('div');
    empty.className = 'sub';
    empty.textContent = 'Nothing yet — dig to collect materials.';
    return [empty];
  }
  return ids.map((id) => {
    const ore = oreById[id];
    const row = document.createElement('div');
    row.className = 'row';
    const icon = document.createElement('div');
    icon.style.cssText = 'width:30px; text-align:center; flex:0 0 auto';
    icon.appendChild(makeIcon(id, 22));
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div class="nm">${ore.name}</div><div class="ds">${ore.desc}</div>`;
    const count = document.createElement('div');
    count.className = 'lv';
    count.textContent = `×${inv[id].toLocaleString()}`;
    row.append(icon, info, count);
    return row;
  });
}
