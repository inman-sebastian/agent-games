// font-lab.ts — try pixel type on DELVE's actual chrome (#43 typography).
//
// The stylesheet work removed every soft material from the interface, which made the ONE remaining
// soft thing obvious: the type. A system sans inside hard-edged boxes is now the loudest tell that
// the UI is not part of the game.
//
// This lab exists because a font cannot be judged from a specimen sheet. What matters is whether it
// survives the four jobs DELVE actually asks of it — a wordmark, a button label, a tabular HUD
// number, and a FULL SENTENCE of ore description — at the sizes those appear. Most pixel fonts pass
// the first three and fail the fourth, which is the whole decision.
//
// Candidates are loaded from Google Fonts for the trial only. Whichever wins gets self-hosted, so
// the game keeps working offline and does not depend on a third party at boot.
import { R64 } from '../src/render/palette';

/** A candidate, with the sizes it is actually designed to be drawn at. */
interface Candidate {
  readonly name: string;
  /** The Google Fonts family + weights query fragment. */
  readonly query: string;
  /** The pixel grid the glyphs were drawn on — legible sizes are whole multiples of it. */
  readonly grid: number;
  /** Size for body prose, then for UI labels, then for the wordmark. */
  readonly sizes: readonly [number, number, number];
  readonly note: string;
}

const CANDIDATES: readonly Candidate[] = [
  {
    name: 'Silkscreen',
    query: 'Silkscreen:wght@400;700',
    grid: 8,
    sizes: [16, 16, 40],
    note: 'The classic 8px UI face. Crisp and compact; all-caps energy even in lowercase.',
  },
  {
    name: 'Pixelify Sans',
    query: 'Pixelify+Sans:wght@400..700',
    grid: 5,
    sizes: [20, 20, 44],
    note: 'Variable weight, true lowercase, the most prose-capable of the set.',
  },
  {
    name: 'Press Start 2P',
    query: 'Press+Start+2P',
    grid: 8,
    sizes: [14, 14, 32],
    note: 'The NES face. Enormously wide — one weight, and a sentence costs three lines.',
  },
  {
    name: 'VT323',
    query: 'VT323',
    grid: 8,
    sizes: [20, 20, 48],
    note: 'A CRT terminal. Monospaced, so numbers align for free; reads as a machine, not stone.',
  },
  {
    name: 'Jersey 10',
    query: 'Jersey+10',
    grid: 10,
    sizes: [20, 20, 50],
    note: 'Tall and narrow on a 10px grid. Fits a lot of text; the condensed one.',
  },
  {
    name: 'Jersey 15',
    query: 'Jersey+15',
    grid: 15,
    sizes: [20, 20, 45],
    note: 'The same family at a coarser grid — blockier, more weight on screen.',
  },
  {
    name: 'Handjet',
    query: 'Handjet:wght@400;700',
    grid: 8,
    sizes: [20, 20, 44],
    note: 'Variable dot-matrix. Distinctive, and the only candidate that looks machine-stamped.',
  },
  {
    name: 'Micro 5',
    query: 'Micro+5',
    grid: 5,
    sizes: [20, 20, 45],
    note: 'A 5px grid — the smallest legible pixel type. Extreme, included for the range.',
  },
];

// The four jobs, with the real strings. The description is a genuine ore blurb, because a sentence
// is where pixel type either holds up or falls apart.
const SAMPLE = {
  wordmark: 'DELVE',
  buttons: ['Inventory', 'Collection', 'Descend'],
  hud: [
    ['DEPTH', '184'],
    ['HELD', '37'],
  ],
  ore: 'Mythril',
  desc: 'The legendary violet ore of the abyss. Cut and laid by some earlier hand.',
  count: '×19',
};

const params = new URLSearchParams(location.search);
const slug = (name: string): string => name.toLowerCase().replace(/\W/g, '');
/** `?only=silkscreen,vt323` — a subset, because eight rows in one screenshot is unreadable. */
const only = (params.get('only') ?? '').split(',').filter(Boolean).map(slug);
const shown = only.length ? CANDIDATES.filter((c) => only.includes(slug(c.name))) : CANDIDATES;

// One stylesheet request for every family shown, which is also how the real game would load them.
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href =
  'https://fonts.googleapis.com/css2?' +
  shown.map((c) => `family=${c.query}`).join('&') +
  '&display=block';
document.head.append(link);

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

/** One candidate's row: the label, then DELVE's chrome rendered entirely in that face. */
function row(c: Candidate): HTMLElement {
  const [body, label, display] = c.sizes;
  const section = el('section', 'cand');
  section.style.setProperty('--f', `'${c.name}'`);
  section.style.setProperty('--body', `${body}px`);
  section.style.setProperty('--label', `${label}px`);
  section.style.setProperty('--display', `${display}px`);

  const head = el('div', 'head');
  head.append(el('span', 'nm', c.name));
  head.append(el('span', 'meta', `${c.grid}px grid · body ${body}px · display ${display}px`));
  head.append(el('span', 'note', c.note));
  section.append(head);

  const demo = el('div', 'demo');

  const mark = el('div', 'wordmark');
  mark.append(document.createTextNode(SAMPLE.wordmark.slice(0, 2)));
  mark.append(el('b', undefined, SAMPLE.wordmark[2]));
  mark.append(document.createTextNode(SAMPLE.wordmark.slice(3)));
  demo.append(mark);

  const btns = el('div', 'btns');
  for (const text of SAMPLE.buttons) btns.append(el('button', undefined, text));
  demo.append(btns);

  const hud = el('div', 'hud');
  for (const [name, value] of SAMPLE.hud) {
    const stat = el('div', 'stat');
    stat.append(document.createTextNode(name + ' '));
    stat.append(el('b', undefined, value));
    hud.append(stat);
  }
  demo.append(hud);

  // The prose test, in the panel it actually appears in.
  const panel = el('div', 'panel');
  const rowEl = el('div', 'row');
  const info = el('div', 'info');
  info.append(el('div', 'nm', SAMPLE.ore));
  info.append(el('div', 'ds', SAMPLE.desc));
  rowEl.append(info);
  rowEl.append(el('div', 'lv', SAMPLE.count));
  panel.append(rowEl);
  demo.append(panel);

  section.append(demo);
  return section;
}

const board = document.getElementById('board')!;
for (const c of shown) board.append(row(c));

// The palette strip, so the type is judged against the colours it will sit on rather than in the
// abstract. Same list the stylesheet draws from.
const strip = el('div', 'strip');
for (const hex of R64.slice(0, 10)) {
  const chip = el('i');
  chip.style.background = hex;
  strip.append(chip);
}
document.getElementById('foot')!.append(strip);

// Wait for the faces themselves, not just the stylesheet: capturing on `load` would shoot the
// fallback sans for every row and the whole comparison would be of one font.
void (async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = 'ready'; // signal for headless capture (tools/shot.sh)
})();
