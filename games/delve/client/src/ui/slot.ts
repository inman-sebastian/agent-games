// ui/slot.ts — `<delve-slot>`, the one widget four surfaces are made of (#41).
//
// The action bar, the inventory, the equipment screen and a crafting recipe's ingredients are all
// the same thing: a square holding an item icon, a count, and a STATE. Build it once and four
// surfaces come nearly free, which is why #28 calls this the highest-leverage piece of the whole
// interface and why it is the piece blocked on nothing.
//
// A CUSTOM ELEMENT, per #28 — native, no dependency, and the component vocabulary maps one-to-one
// onto the design vocabulary. This is also the case where Shadow DOM earns itself rather than being
// applied on principle: a slot appears dozens of times on a screen, so encapsulating its internals
// keeps the page's stylesheet from having to know about them, and the boundary makes the
// palette-via-custom-properties discipline MANDATORY rather than merely encouraged. Custom
// properties are the one thing that pierces a shadow root, so the slot is themed by the same
// `--c-*` and `--px` roles as everything else and cannot invent a colour even by accident.
//
// THE EMPTY STATE IS A REQUIREMENT, NOT POLISH. The action bar starts empty for a new player, and an
// empty slot has to read as a visible PROMISE — a deliberate, inviting hole — rather than as a
// missing icon or a rendering failure. It is the state the player sees most before they see any
// other, so it gets the inset frame and a centred pip rather than nothing at all.
import { materialIcon } from './icon';

/**
 * What a slot is showing.
 *
 * `locked` and `unaffordable` both mean "you cannot have this right now" and are deliberately
 * distinct: locked is a slot that progression has not opened yet, unaffordable is a recipe you lack
 * the materials for. They read differently because they are answered differently — one by playing
 * on, one by going and mining.
 */
export type SlotState = 'empty' | 'filled' | 'selected' | 'locked' | 'unaffordable';

const STATES: readonly SlotState[] = ['empty', 'filled', 'selected', 'locked', 'unaffordable'];

/**
 * The slot's own styles, inside the shadow root.
 *
 * Every value that is not structural comes through a custom property, so this sheet can be read as
 * the complete list of what a slot is allowed to decide for itself: its layout. Colour, spacing, the
 * pixel unit and the frames all arrive from the page.
 */
const SHEET = `
  :host {
    /* How big a slot is, in art pixels. 24 with a one-pixel edge leaves a 22px interior: a 16px
       tile with air around it, AND room for the count chip along the bottom without it running out
       of the slot. At 20 a three-digit count overflowed the square. */
    --slot-size: calc(var(--px, 2px) * 24);
    display: inline-block;
    width: var(--slot-size);
    height: var(--slot-size);
    position: relative;
    box-sizing: border-box;
    /* HOW A SLOT IS EDGED IS A THEME DECISION, not the widget's, so it comes through properties the
       page sets: --slot-edge-w and --slot-edge. The default is the quiet one: a single dark
       outline and a flat darker fill. A slot is repeated a dozen times in a grid, so whatever it
       spends on furniture it spends twelve times over, and a full bevelled recess per square turned
       out to be far too much of it. Compare the alternatives in client/labs/panel-lab.html. */
    background: var(--c-void, #2e222f);
    border: var(--slot-edge-w, var(--px, 2px)) solid var(--c-void, #2e222f);
    border-image: var(--slot-edge, none) 3 fill / var(--slot-edge-w, var(--px, 2px)) / 0 repeat;
    image-rendering: pixelated;
    cursor: default;
    /* A guard, not a layout tool: a count is bounded in practice, but nothing in the slot should
       ever be able to draw outside the square. */
    overflow: hidden;
  }
  :host([state='filled']),
  :host([state='selected']),
  :host([interactive]) {
    cursor: pointer;
  }
  /* SELECTED lights its outline rather than changing its shape. With a one-pixel edge there is no
     bevel to flip, and a lit border is how every inventory since the 16-bit era has said "this one"
     — it also survives whatever edge treatment the page picks. */
  :host([state='selected']) {
    border-color: var(--c-gold, #f9c22b);
    border-image: none;
    background: var(--c-panel, #3e3546);
  }
  :host([state='locked']) { opacity: 0.45; }
  :host([state='unaffordable']) .icon { opacity: 0.4; }

  .icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon ::slotted(canvas),
  .icon canvas {
    image-rendering: pixelated;
    display: block;
  }
  /* The empty state's pip: a small inset square, centred. A hole that was DRAWN reads as a place
     something goes; an actually empty box reads as a bug. */
  .pip {
    position: absolute;
    left: 50%;
    top: 50%;
    width: calc(var(--px, 2px) * 4);
    height: calc(var(--px, 2px) * 4);
    margin: calc(var(--px, 2px) * -2) 0 0 calc(var(--px, 2px) * -2);
    background: var(--c-panel, #3e3546);
  }
  .count {
    position: absolute;
    right: 0;
    bottom: 0;
    line-height: 1;
    font-family: var(--font-display, monospace);
    /* ON THE ART GRID. This was Silkscreen's native 8px, which sounds right and is not: at 8px one
       glyph pixel is one CSS pixel, and everything else on screen draws one art pixel as TWO. The
       count was the only thing in the interface rendering at half scale. 16px is 2x native, so a
       glyph pixel is an art pixel like everything else. */
    font-size: var(--t-label, 16px);
    color: var(--c-ink, #c7dcd0);
    /* A SOLID CHIP, not an outline. The outline was four offset copies of the glyph, which leaves
       the diagonals unfilled — so it never closed around a letter and read as a detached blocky
       halo rather than as a shadow. A chip is one hard rectangle: nothing to disconnect, and it is
       how a count has been drawn over an item since inventories had items. */
    background: var(--c-void, #2e222f);
    padding: 0 var(--px, 2px);
    pointer-events: none;
  }
  :host([state='unaffordable']) .count { color: var(--c-gold, #f9c22b); }
`;

let sheet: CSSStyleSheet | null = null;

/** One constructed stylesheet shared by every instance, rather than a <style> per slot. */
function styles(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(SHEET);
  }
  return sheet;
}

export class DelveSlot extends HTMLElement {
  static observedAttributes = ['state', 'count', 'ore'];

  #icon!: HTMLElement;
  #count!: HTMLElement;

  connectedCallback(): void {
    if (this.shadowRoot) return; // already built; attribute changes re-render in place
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [styles()];
    this.#icon = document.createElement('div');
    this.#icon.className = 'icon';
    this.#count = document.createElement('div');
    this.#count.className = 'count';
    root.append(this.#icon, this.#count);
    if (!this.getAttribute('state')) this.setAttribute('state', 'empty');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.shadowRoot) this.#render();
  }

  /** The material this slot holds, or null for an empty one. */
  get ore(): number | null {
    const raw = this.getAttribute('ore');
    return raw === null || raw === '' ? null : Number(raw);
  }
  set ore(id: number | null) {
    if (id === null) this.removeAttribute('ore');
    else this.setAttribute('ore', String(id));
  }

  get state(): SlotState {
    const raw = this.getAttribute('state') as SlotState | null;
    return raw && STATES.includes(raw) ? raw : 'empty';
  }
  set state(value: SlotState) {
    this.setAttribute('state', value);
  }

  get count(): number {
    return Number(this.getAttribute('count') ?? 0);
  }
  set count(value: number) {
    this.setAttribute('count', String(value));
  }

  #render(): void {
    const ore = this.ore;
    this.#icon.replaceChildren();
    if (ore === null) {
      // the drawn hole — see the note on the empty state
      const pip = document.createElement('div');
      pip.className = 'pip';
      this.#icon.append(pip);
    } else {
      // A whole 16px tile, drawn 1:1 into the slot's 18px interior. Any other size would resample
      // the very texture the icon exists to show.
      this.#icon.append(materialIcon(ore, 16));
    }
    // A count of 1 is noise: a slot holding one of something already says so by being filled.
    const count = this.count;
    this.#count.textContent = ore !== null && count > 1 ? String(count) : '';
    this.setAttribute('aria-label', describe(this.state, ore, count));
  }
}

/** What a screen reader is told. The state is part of it, because the state is the information. */
function describe(state: SlotState, ore: number | null, count: number): string {
  if (state === 'locked') return 'Locked slot';
  if (ore === null) return 'Empty slot';
  const held = count > 1 ? `${count} held` : '1 held';
  if (state === 'unaffordable') return `${held}, not enough`;
  if (state === 'selected') return `${held}, selected`;
  return held;
}

/** Register the element. Idempotent, so a lab and the game can both call it. */
export function defineSlot(): void {
  if (!customElements.get('delve-slot')) customElements.define('delve-slot', DelveSlot);
}

declare global {
  interface HTMLElementTagNameMap {
    'delve-slot': DelveSlot;
  }
}
