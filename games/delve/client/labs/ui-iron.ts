// ui-iron.ts — iterations WITHIN the riveted-iron direction (#28).
//
// The direction is settled: a cool, flat steel plate, a hard outline, a bright top rim, brass as the
// single warm accent. What is not settled is how the plate is BUILT, and that is what varies here.
//
// The palette is held CONSTANT across every iteration on purpose. If the accent moved too, a
// comparison would be of two things at once and would answer neither. Brass everywhere; only the
// construction changes.
//
// Rivets are drawn at 3x3 with a lit top-left pixel, not 2x2. A 2x2 rivet was tried in the earlier
// panel bench and read as a speck rather than as intent — at two art pixels there is no room for a
// rivet to have a lit side, and a dot with no lighting is a dot, not a fastener.
import { patternUrl, type Pattern } from '../src/ui/surface';
import { defineSlot } from '../src/ui/slot';
import { buildInventoryGrid } from '../src/ui/inventory';
import { T, setStrata, composeBand, UPSCALE } from '../src/render/cave-render';
import { WIDTH, STRATA, ORE_BY_ID, oreAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

// The iron palette, fixed for every iteration below.
const DARK = '#2e222f'; // outline and shadow: R64's darkest
const PLATE = '#313638'; // the plate's face — cool, neutral, flat
const GROOVE = '#3e3546'; // a machined channel, one step off the face
const EDGE = '#625565'; // mid rim
const LIT = '#9babb2'; // the lit top rim
const BRIGHT = '#c7dcd0'; // a rivet's catch-light
const BRASS = '#fbb954'; // the one warm accent

type Px = string | null;

/** Build a size×size nine-slice source from a per-pixel function. */
function build(size: number, paint: (x: number, y: number, ring: number, lit: boolean) => Px): Pattern {
  const last = size - 1;
  const rows: Px[][] = [];
  for (let y = 0; y < size; y++) {
    const row: Px[] = [];
    for (let x = 0; x < size; x++) {
      const ring = Math.min(x, y, last - x, last - y);
      // Top and left are lit; where lit and shade meet, shade wins. Same rule as the shipping frame.
      const lit = !(x === last - ring || y === last - ring);
      row.push(paint(x, y, ring, lit));
    }
    rows.push(row);
  }
  return rows;
}

/** A 3x3 bolt head, lit from the top-left, at the corner inset `at` pixels from each edge. */
const rivetAt = (x: number, y: number, size: number, at: number): Px => {
  const nx = Math.min(x, size - 1 - x);
  const ny = Math.min(y, size - 1 - y);
  if (nx < at || nx > at + 2 || ny < at || ny > at + 2) return null;
  if (nx === at && ny === at) return BRIGHT; // catch-light
  if (nx === at + 2 || ny === at + 2) return DARK; // its own shadow
  return EDGE;
};

interface Iteration {
  readonly id: string;
  readonly name: string;
  readonly pitch: string;
  readonly slice: number;
  readonly pixels: Pattern;
  readonly css?: string;
}

const ITERATIONS: readonly Iteration[] = [
  {
    id: 'plain',
    name: 'B1 · Plain plate',
    pitch:
      'The baseline from the concept bench: hard outline, bright top rim, flat face. Nothing but the rim says "metal".',
    slice: 3,
    pixels: build(7, (x, y, ring, lit) =>
      ring === 0 ? DARK : ring === 1 ? (lit ? LIT : DARK) : PLATE,
    ),
  },
  {
    id: 'riveted',
    name: 'B2 · Plate + bolt heads',
    pitch:
      'B1 with a 3x3 bolt in each corner, lit from the top-left like everything else. Texture from a placed detail rather than from noise — the lesson of the rejected textured version.',
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      const rivet = rivetAt(x, y, 11, 2);
      if (rivet) return rivet;
      return ring === 0 ? DARK : ring === 1 ? (lit ? LIT : DARK) : PLATE;
    }),
  },
  {
    id: 'grooved',
    name: 'B3 · Machined groove',
    pitch:
      'A channel cut between two rims: outline, lit lip, dark groove, second lip, face. Reads as a thicker plate that was milled rather than cast.',
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      if (ring === 0) return DARK;
      if (ring === 1) return lit ? LIT : DARK;
      if (ring === 2) return GROOVE;
      if (ring === 3) return lit ? EDGE : GROOVE;
      return PLATE;
    }),
  },
  {
    id: 'notched',
    name: 'B4 · Cut corners',
    pitch:
      'The corners chamfered, so the plate reads as cut steel rather than as a rectangle. Costs the corner: a chamfer means the outline no longer closes at 90 degrees.',
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      const nx = Math.min(x, 10 - x);
      const ny = Math.min(y, 10 - y);
      if (nx + ny < 2) return null; // the chamfer itself — cut away
      if (nx + ny === 2) return DARK; // the cut edge
      const rivet = rivetAt(x, y, 11, 3);
      if (rivet) return rivet;
      return ring === 0 ? DARK : ring === 1 ? (lit ? LIT : DARK) : PLATE;
    }),
  },
  {
    id: 'brackets',
    name: 'B5 · Corner brackets only',
    pitch:
      'No continuous frame — the edge slices are empty, so only the corners draw. The sparsest of the five, and the only one that does not box the content in.',
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      const nx = Math.min(x, 10 - x);
      const ny = Math.min(y, 10 - y);
      const inCorner = nx < 5 && ny < 5;
      if (!inCorner) return ring <= 1 ? null : PLATE; // edges: nothing but the face
      if (ring === 0) return DARK;
      if (ring === 1) return lit ? LIT : DARK;
      return PLATE;
    }),
  },
  {
    id: 'titlebar',
    name: 'B6 · Plate + title bar',
    pitch:
      'B2 with the heading moved into a recessed strip across the top, ruled off from the body. The most equipment-like of the six: a label plate on a machine.',
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      const rivet = rivetAt(x, y, 11, 2);
      if (rivet) return rivet;
      return ring === 0 ? DARK : ring === 1 ? (lit ? LIT : DARK) : PLATE;
    }),
    css: `
      .panel h2 {
        margin: calc(var(--s4) * -1) calc(var(--s4) * -1) var(--s3);
        padding: var(--s2) var(--s4);
        background: ${DARK};
        border-bottom: var(--px) solid ${LIT};
        color: ${BRIGHT};
      }
    `,
  },
  {
    id: 'groovebar',
    name: 'B7 · Groove + title strip',
    pitch:
      "B3's machined frame with B6's heading strip in it. The two strongest constructions combined, and the frame stays five pixels so the panel does not get heavier as well as busier.",
    slice: 5,
    pixels: build(11, (x, y, ring, lit) => {
      if (ring === 0) return DARK;
      if (ring === 1) return lit ? LIT : DARK;
      if (ring === 2) return GROOVE;
      if (ring === 3) return lit ? EDGE : GROOVE;
      return PLATE;
    }),
    css: `
      .panel h2 {
        margin: calc(var(--s4) * -1) calc(var(--s4) * -1) var(--s3);
        padding: var(--s2) var(--s4);
        background: ${DARK};
        border-bottom: var(--px) solid ${LIT};
        color: ${BRIGHT};
      }
    `,
  },
  {
    id: 'grooveboltbar',
    name: 'B8 · Groove + bolts + title strip',
    pitch:
      'All three, on a seven-pixel frame so the bolts have somewhere to sit that is not the groove. The heaviest option here: a thick milled plate, fastened, with a label on it.',
    slice: 7,
    pixels: build(15, (x, y, ring, lit) => {
      // The bolt sits INSIDE the frame's rings, on the plate margin — at slice 5 there is no room
      // for it that does not collide with the groove, which is why this one is thicker.
      const bolt = rivetAt(x, y, 15, 4);
      if (bolt) return bolt;
      if (ring === 0) return DARK;
      if (ring === 1) return lit ? LIT : DARK;
      if (ring === 2) return GROOVE;
      if (ring === 3) return lit ? EDGE : GROOVE;
      return PLATE;
    }),
    css: `
      .panel h2 {
        margin: calc(var(--s4) * -1) calc(var(--s4) * -1) var(--s3);
        padding: var(--s2) var(--s4);
        background: ${DARK};
        border-bottom: var(--px) solid ${LIT};
        color: ${BRIGHT};
      }
    `,
  },
];

// ---- render -------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

defineSlot();
const board = document.getElementById('board')!;

for (const it of ITERATIONS) {
  const section = el('section', 'iter');
  section.id = it.id;
  // the fixed iron palette
  for (const [k, v] of Object.entries({
    '--c-void': DARK,
    '--c-panel': PLATE,
    '--c-edge': EDGE,
    '--c-dim': EDGE,
    '--c-mute': LIT,
    '--c-ink': BRIGHT,
    '--c-gold': BRASS,
  })) {
    section.style.setProperty(k, v);
  }
  const url = `url("${patternUrl(it.pixels)}")`;
  section.style.setProperty('--panel-frame', url);
  section.style.setProperty('--panel-slice', String(it.slice));
  section.style.setProperty('--panel-fw', `calc(var(--px) * ${it.slice})`);
  if (it.css) {
    const style = el('style');
    style.textContent = it.css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, brace, sel) =>
      `${brace} #${it.id} ${sel.trim()} {`,
    );
    section.append(style);
  }

  const head = el('div', 'head');
  head.append(el('div', 'nm', it.name));
  head.append(el('div', 'note', it.pitch));
  section.append(head);

  const panel = el('div', 'panel');
  panel.append(el('h2', undefined, 'Inventory'));
  const sub = el('div', 'sub');
  sub.append(document.createTextNode("Materials you've mined — "), el('b', undefined, '37'));
  sub.append(document.createTextNode(' held'));
  panel.append(sub);
  panel.append(buildInventoryGrid({ 2: 1, 3: 19, 5: 4, 9: 2, 12: 340 }, ORE_BY_ID, 9));
  const row = el('div', 'row');
  const info = el('div', 'info');
  info.append(el('div', 'nm', 'Mythril'));
  info.append(el('div', 'ds', 'The legendary violet ore of the abyss.'));
  row.append(info, el('div', 'lv', '×2'));
  panel.append(row);
  panel.append(el('button', 'close', 'Back to the mine'));
  section.append(panel);
  board.append(section);
}

// ---- the same real cave every other lab draws ---------------------------------------------------

const SEED = 12345;
const CENTER_ROW = 96;
setStrata(STRATA);
const canvas = document.getElementById('ground') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;

function drawGround(): void {
  const cols = Math.ceil(window.innerWidth / (T * UPSCALE)) + 1;
  const rows = Math.ceil(document.body.scrollHeight / (T * UPSCALE)) + 1;
  const bandLeft = (WIDTH >> 1) - (cols >> 1);
  const bandTop = CENTER_ROW - (rows >> 1);
  const dug = new Set<string>();
  for (let row = CENTER_ROW - 12; row <= CENTER_ROW + 12; row++) {
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
