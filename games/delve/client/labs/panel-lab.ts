// panel-lab.ts — five panel treatments side by side, so the choice is made by looking (#42).
//
// WHY THIS EXISTS. The first attempt gave every surface a uniform hash-noise mottle and dithered the
// frame's inner ring. It read as a mistake, and the research says why — consistently, across every
// source:
//
//   • "Keep it off small sprites, moving regions, and UI" (Pixnote, dithering guide)
//   • Under roughly 8-10px of run, "skip the dithering and use a solid colour or a single-pixel
//     shade shift instead" (ibid) — the frame's transition ring is ONE pixel
//   • "There's no room for a pattern to read; it just looks noisy" at small sizes (Spearite)
//   • "Generally you want to avoid mechanical dithering and opt for a pattern based effect
//     instead" (alain.xyz)
//   • "A dark outline reads at any size and is the safe default" (Pixnote, game assets)
//
// The through-line: in pixel art UI, texture comes from DELIBERATE, PLACED detail — a corner rivet,
// an inner line, a header band — not from uniform noise. Noise is for large gradient areas, which a
// panel is not, because a panel has text on it. So every treatment below keeps flat fills and spends
// its detail where a human would have placed it by hand.
import { patternUrl, framePixels, FRAME_SLICE, type Pattern } from '../src/ui/surface';
import { defineSlot } from '../src/ui/slot';
import { T, setStrata, composeBand, UPSCALE } from '../src/render/cave-render';
import { WIDTH, STRATA, oreAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

/** The stylesheet's roles, read back rather than restated. */
const css = getComputedStyle(document.documentElement);
const role = (name: string): string => css.getPropertyValue(name).trim();
const VOID = role('--c-void');
const PANEL = role('--c-panel');
const EDGE = role('--c-edge');
const DIM = role('--c-dim');
const MUTE = role('--c-mute');

/** A treatment: its nine-slice source, how deep the slice is, why it is on the bench. */
interface Treatment {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly slice: number;
  readonly pixels: Pattern;
  /** Hard drop shadow offset, in art pixels. */
  readonly drop: number;
}

/** The shipping frame, varying ONLY the lit step — so the comparison is of one decision. */
const frame = (light: string): Pattern =>
  framePixels('raised', { outline: VOID, light, shade: VOID, fill: PANEL });

const TREATMENTS: readonly Treatment[] = [
  {
    id: 'one',
    name: 'A · lit one step up (#625565)',
    note: 'The quietest bevel that still exists. Reads as a rim rather than a highlight; at small sizes it nearly disappears against the face.',
    slice: FRAME_SLICE,
    pixels: frame(EDGE),
    drop: 4,
  },
  {
    id: 'two',
    name: 'B · lit two steps up (#7f708a) — current',
    note: 'What is live now. Clearly an edge catching light, without becoming the brightest thing on screen.',
    slice: FRAME_SLICE,
    pixels: frame(DIM),
    drop: 4,
  },
  {
    id: 'three',
    name: 'C · lit three steps up (#9babb2) — previous',
    note: 'What you called too extreme. It is the same value as the body text, so the frame competes with what the panel is for.',
    slice: FRAME_SLICE,
    pixels: frame(MUTE),
    drop: 4,
  },
  {
    id: 'tight',
    name: 'D · two steps up, tighter drop shadow',
    note: 'B with the hard drop shadow cut from four art pixels to two. The shadow is the other thing that reads as hanging off the panel.',
    slice: FRAME_SLICE,
    pixels: frame(DIM),
    drop: 2,
  },
  {
    id: 'noshadow',
    name: 'E · two steps up, no drop shadow',
    note: 'B with no shadow at all. The outline alone separates the panel from the rock; nothing extends past the frame.',
    slice: FRAME_SLICE,
    pixels: frame(DIM),
    drop: 0,
  },
];

// ---- render the board ---------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

const board = document.getElementById('board')!;

for (const t of TREATMENTS) {
  const section = el('section', 'treat');
  section.style.setProperty('--frame', `url("${patternUrl(t.pixels)}")`);
  section.style.setProperty('--slice', String(t.slice));
  section.style.setProperty('--fw', `calc(var(--px) * ${t.slice})`);
  section.style.setProperty(
    '--drop',
    t.drop === 0 ? 'none' : `calc(var(--px) * ${t.drop}) calc(var(--px) * ${t.drop}) 0 #2e222fcc`,
  );

  const head = el('div', 'head');
  head.append(el('div', 'nm', t.name));
  head.append(el('div', 'note', t.note));
  section.append(head);

  // The real panel content, so each treatment is judged with text on it rather than empty.
  const panel = el('div', 'panel demo');
  panel.append(el('h2', undefined, 'Inventory'));
  const sub = el('div', 'sub');
  sub.append(document.createTextNode("Materials you've mined — "));
  sub.append(el('b', undefined, '37'));
  sub.append(document.createTextNode(' held'));
  panel.append(sub);
  const row = el('div', 'row demo-row');
  const info = el('div', 'info');
  info.append(el('div', 'nm', 'Mythril'));
  info.append(el('div', 'ds', 'The legendary violet ore of the abyss.'));
  row.append(info);
  row.append(el('div', 'lv', '×2'));
  panel.append(row);
  const btn = el('button', 'close demo-btn', 'Back to the mine');
  panel.append(btn);
  section.append(panel);
  board.append(section);
}

// ---- slot edge treatments -----------------------------------------------------------------------
//
// A slot is repeated a dozen times in a grid, so whatever it spends on furniture it spends twelve
// times over. The full bevelled recess each square started with was far too much of it.

defineSlot();

const SLOT_EDGES: readonly { id: string; name: string; note: string; css: string }[] = [
  {
    id: 'outline',
    name: 'A · one-pixel outline (current)',
    note: 'A dark line and a darker fill. The grid reads as a grid; nothing competes with the materials in it.',
    css: '--slot-edge: none; --slot-edge-w: var(--px);',
  },
  {
    id: 'none',
    name: 'B · no edge at all',
    note: 'Just a darker square, separated by the gap. The quietest possible; the slots stop being objects and become holes.',
    css: '--slot-edge: none; --slot-edge-w: 0px; ',
  },
  {
    id: 'double',
    name: 'C · outline, two pixels',
    note: 'The same dark line, doubled. Reads heavier and more deliberate without adding a second colour.',
    css: '--slot-edge: none; --slot-edge-w: calc(var(--px) * 2);',
  },
  {
    id: 'inset',
    name: 'D · full inset frame (rejected)',
    note: 'What was shipped. Three pixels of bevelled recess per square, twelve times over — the frames end up louder than the contents.',
    css: '--slot-edge: var(--frame-inset); --slot-edge-w: var(--frame-w);',
  },
];

const slotBoard = document.getElementById('slots')!;
for (const edge of SLOT_EDGES) {
  const section = el('section', 'treat');
  const head = el('div', 'head');
  head.append(el('div', 'nm', edge.name));
  head.append(el('div', 'note', edge.note));
  section.append(head);

  const strip = el('div', 'slotrow');
  strip.setAttribute('style', edge.css);
  for (const [state, ore, count] of [
    ['filled', 3, 19],
    ['filled', 9, 2],
    ['selected', 12, 340],
    ['filled', 5, 1],
    ['empty', null, 0],
    ['empty', null, 0],
  ] as const) {
    const slot = document.createElement('delve-slot');
    slot.setAttribute('state', state);
    if (ore !== null) {
      slot.setAttribute('ore', String(ore));
      slot.setAttribute('count', String(count));
    }
    strip.append(slot);
  }
  section.append(strip);
  slotBoard.append(section);
}

// ---- count treatments --------------------------------------------------------------------------
//
// A count sits on an item's texture at five-ish pixels tall, which is the hardest place in the whole
// interface to make text readable. The variables are the FACE, the size, and the outline's unit —
// and the unit is not simply "one art pixel", because a font's em is not its glyph height. Micro 5's
// em is twice its glyph height, so at 10px one glyph pixel is one CSS pixel; Silkscreen at 16px puts
// one glyph pixel on two, which is an art pixel.

/**
 * Count faces that render CLEANLY at seven pixels tall.
 *
 * "Cleanly" is measured, not judged: every vertical stroke in a row of zeros comes out the same
 * width. A face scaled to a non-native size produces a mix — some strokes on one pixel, some on two
 * — which reads as inconsistent weight inside a single number and cannot be seen by eye at this
 * size. client/labs/font-metrics.html is the harness; it found that Jersey 10, which was live, has
 * NO clean render anywhere in the six-to-eight band.
 */
const COUNTS: readonly { name: string; note: string; css: string }[] = [
  {
    name: 'A · m5x7 16px',
    note: "Daniel Linssen's m5x7, CC0. Designed AT this size — its documentation recommends 16, 32, 48 — so seven pixels tall with a one-pixel stroke, and five pixels wide so a four-character count stays narrow.",
    css: "--count-face: 'm5x7'; --count-size: 16px; --count-outline: 1px;",
  },
  {
    name: 'B · Silkscreen 11px (current)',
    note: 'Stroke 2, seven pixels tall. Introduces no new family; heavier, which a number on a lit ore face can use.',
    css: "--count-face: 'Silkscreen'; --count-size: 11px; --count-outline: 1px;",
  },
  {
    name: 'C · m5x7 24px',
    note: 'The same face a full step up: eleven pixels tall, stroke 2. Included because m5x7 only renders cleanly at its recommended multiples.',
    css: "--count-face: 'm5x7'; --count-size: 24px; --count-outline: var(--px);",
  },
  {
    name: 'D · Tiny5 11px',
    note: 'The other purpose-built tiny face on the bench. Stroke 1, seven tall.',
    css: "--count-face: 'Tiny5'; --count-size: 11px; --count-outline: 1px;",
  },
];

const countBoard = document.getElementById('counts')!;
for (const variant of COUNTS) {
  const section = el('section', 'treat');
  const head = el('div', 'head');
  head.append(el('div', 'nm', variant.name));
  head.append(el('div', 'note', variant.note));
  section.append(head);
  const strip = el('div', 'slotrow');
  strip.setAttribute('style', variant.css);
  for (const [ore, count] of [
    [3, 7],
    [9, 19],
    [12, 340],
    [5, 1280],
  ] as const) {
    const slot = document.createElement('delve-slot');
    slot.setAttribute('state', 'filled');
    slot.setAttribute('ore', String(ore));
    slot.setAttribute('count', String(count));
    strip.append(slot);
  }
  section.append(strip);
  countBoard.append(section);
}

// ---- real rock behind it, same as the UI lab ----------------------------------------------------

const SEED = 12345;
const CENTER_ROW = 96;
setStrata(STRATA);
const canvas = document.getElementById('ground') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const dug = new Set<string>();

function drawGround(): void {
  const cols = Math.ceil(window.innerWidth / (T * UPSCALE)) + 1;
  const rows = Math.ceil(document.body.scrollHeight / (T * UPSCALE)) + 1;
  const bandLeft = (WIDTH >> 1) - (cols >> 1);
  const bandTop = CENTER_ROW - (rows >> 1);
  dug.clear();
  for (let row = CENTER_ROW - 8; row <= CENTER_ROW + 8; row++) {
    for (let column = bandLeft + 2; column < bandLeft + cols - 2; column++) {
      dug.add(`${column},${row}`);
    }
  }
  const solidTile = (column: number, row: number): boolean =>
    row > surfaceAt(SEED, column) && !dug.has(`${column},${row}`);
  canvas.width = cols * T;
  canvas.height = rows * T;
  canvas.style.width = `${cols * T * UPSCALE}px`;
  canvas.style.height = `${rows * T * UPSCALE}px`;
  g.imageSmoothingEnabled = false;
  composeBand(g, solidTile, bandLeft, bandTop, cols, rows, WIDTH, (c) => surfaceAt(SEED, c), (c, r) =>
    oreMaterial(oreAt(SEED, c, r)),
  );
  const lighting = createLighting();
  lighting.addLight((bandLeft + (cols >> 1)) * T + T / 2, CENTER_ROW * T + T / 2, 0, LAMP_COLOR, 2.6);
  lighting.render({
    g,
    LW: canvas.width,
    LH: canvas.height,
    T,
    camX: bandLeft * T,
    camY: bandTop * T,
    surfaceAt: (c) => surfaceAt(SEED, c),
    solidTile,
  });
}

drawGround();
addEventListener('resize', drawGround);

void (async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = 'ready';
})();
