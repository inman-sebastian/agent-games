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
import { patternUrl, type Pattern } from '../src/ui/surface';
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

/** A treatment: its nine-slice source, how deep the slice is, and why it is on the bench. */
interface Treatment {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  readonly slice: number;
  readonly pixels: Pattern;
}

/** Build a size×size source from a per-pixel function. `ring` is distance from the edge. */
function build(size: number, paint: (ring: number, litSide: boolean, x: number, y: number) => string): Pattern {
  const last = size - 1;
  const rows: string[][] = [];
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < size; x++) {
      const ring = Math.min(x, y, last - x, last - y);
      // Which half of the mitre a pixel falls on — the diagonal split a bevel turns on.
      const litSide = x <= y ? x <= last - y : y <= last - x;
      row.push(paint(ring, litSide, x, y));
    }
    rows.push(row);
  }
  return rows;
}

const TREATMENTS: readonly Treatment[] = [
  {
    id: 'outline',
    name: 'A · Flat + outline',
    note: 'One dark line, flat face. The safe default every source names. Nothing to go wrong, and nothing to look at.',
    slice: 1,
    pixels: build(3, (ring) => (ring === 0 ? VOID : PANEL)),
  },
  {
    id: 'bevel',
    name: 'B · Two-tone bevel',
    note: 'Outline, then one pixel lit top-left and one shaded bottom-right. Flat face. The classic raised plate; reads at any size.',
    slice: 2,
    pixels: build(5, (ring, litSide) =>
      ring === 0 ? VOID : ring === 1 ? (litSide ? MUTE : VOID) : PANEL,
    ),
  },
  {
    id: 'carved',
    name: 'C · Bevel + inner well',
    note: 'A raised frame around a SUNKEN content area — two bevels, opposed. Gives the panel a rim without any texture.',
    slice: 3,
    pixels: build(7, (ring, litSide) => {
      if (ring === 0) return VOID;
      if (ring === 1) return litSide ? MUTE : VOID;
      if (ring === 2) return litSide ? VOID : EDGE; // the well's lip, inverted
      return PANEL;
    }),
  },
  {
    id: 'riveted',
    name: 'D · Bevel + corner rivets',
    note: 'B, plus a placed detail in each corner. Texture from intent rather than noise, and the corners never stretch because they sit inside the slice.',
    slice: 4,
    pixels: build(9, (ring, litSide, x, y) => {
      const last = 8;
      const nearX = Math.min(x, last - x);
      const nearY = Math.min(y, last - y);
      // a 2x2 rivet inset from each corner, lit like a tiny dome
      if (nearX >= 2 && nearX <= 3 && nearY >= 2 && nearY <= 3) {
        return nearX === 2 && nearY === 2 ? MUTE : DIM;
      }
      if (ring === 0) return VOID;
      if (ring === 1) return litSide ? MUTE : VOID;
      return PANEL;
    }),
  },
  {
    id: 'current',
    name: 'E · Noise + dithered ring (rejected)',
    note: 'What was shipped and reverted. Uniform hash-noise face and a dithered inner ring: noise under text, and a dither in a one-pixel run. Kept on the bench as the counter-example.',
    slice: 3,
    pixels: build(16, (ring, litSide, x, y) => {
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const t = (bayer[(x & 3) | ((y & 3) << 2)] + 0.5) / 16;
      if (ring === 0) return VOID;
      if (ring === 1) return litSide ? MUTE : VOID;
      if (ring === 2) return t < 0.5 ? (litSide ? MUTE : VOID) : PANEL;
      const n = (((x * 73856093) ^ (y * 19349663) ^ (0x5e17 * 83492791)) >>> 0) % 1000 / 1000;
      return n < 0.07 ? EDGE : n > 0.93 ? VOID : PANEL;
    }),
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
