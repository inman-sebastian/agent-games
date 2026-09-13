// ui-concepts.ts — four UI DIRECTIONS, not four tweaks (#28).
//
// The interface had been refined along one direction for long enough that the refining stopped being
// the question. This renders genuinely different answers to "what is a DELVE panel made of", each
// complete enough to judge — top bar, buttons, an inventory grid and a description row — over the
// same real rock, so the comparison is of DIRECTIONS rather than of details.
//
// What is actually varying, in order of how much it changes:
//
//   1. THE VALUE STRUCTURE. Dark panel with light text, or light panel with dark ink. This is the
//      biggest fork and the one that is hardest to see from a description: a warm ledger reads as a
//      different GAME, not a different skin.
//   2. WHAT THE PANEL IS MADE OF. Cut stone, riveted iron, paper, or nothing at all.
//   3. HOW MUCH CHROME THERE IS. A framed modal, or text lit by your own lamp with the world still
//      visible behind it — which is the shape "nothing pauses" (docs/UI.md) actually wants.
//
// Every colour is Resurrect 64 or a strata ramp already in the game (docs/PALETTE.md). Nothing here
// invents a palette; the point is that the SAME palette supports very different interfaces.
import { framePixels, patternUrl, type FrameRoles } from '../src/ui/surface';
import { defineSlot } from '../src/ui/slot';
import { buildInventoryGrid } from '../src/ui/inventory';
import { T, setStrata, composeBand, UPSCALE } from '../src/render/cave-render';
import { WIDTH, STRATA, ORE_BY_ID, oreAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

interface Concept {
  readonly id: string;
  readonly name: string;
  readonly pitch: string;
  /** The trade being made, stated plainly — every one of these costs something. */
  readonly cost: string;
  /** Role overrides, applied to the concept's own container. */
  readonly tokens: Record<string, string>;
  /** Frame roles, or null for a concept with no panel at all. */
  readonly frame: FrameRoles | null;
  /** A control's face. Derived from the bevel highlight it turned every button the highlight colour. */
  readonly control?: string;
  /**
   * Ink for text that sits on the WORLD rather than on a panel — the top bar and HUD.
   *
   * A light-panel direction needs two ink values, which is not obvious until you try one: dark ink is
   * correct on paper and invisible over a dark cave. Only the inverted concept sets this.
   */
  readonly worldInk?: string;
  /** Extra rules scoped to this concept. */
  readonly css?: string;
}

// The Stone ramp (what ships) and the Clay ramp, both already in the game.
const STONE = ['#2e222f', '#3e3546', '#625565', '#7f708a', '#9babb2', '#c7dcd0'];
const CLAY = ['#2a2018', '#48371f', '#6d5230', '#8f6b3c', '#b28a4e', '#d0aa66'];

const CONCEPTS: readonly Concept[] = [
  {
    id: 'stone',
    name: 'A · Cut stone',
    pitch:
      'What ships. The Stone ramp, a bevelled frame with an inner well, dark panel and light text. The interface is made of the same rock the player is looking at.',
    cost: 'Reads as a dark box on a dark world. Panel and background are close in value, so the frame does all the separating.',
    tokens: {
      '--c-void': STONE[0],
      '--c-panel': STONE[1],
      '--c-edge': STONE[2],
      '--c-dim': STONE[3],
      '--c-mute': STONE[4],
      '--c-ink': STONE[5],
    },
    frame: { outline: STONE[0], light: STONE[3], shade: STONE[0], fill: STONE[1], well: true },
  },
  {
    id: 'iron',
    name: 'B · Riveted iron',
    pitch:
      'Harder and more industrial: a cooler, flatter plate, a heavier outline, and a warm brass accent instead of gold. The interface is equipment rather than geology.',
    cost: 'Colder than the game around it. Brass is the only warmth on screen, so it has to carry every highlight.',
    tokens: {
      '--c-void': '#2e222f',
      '--c-panel': '#313638',
      '--c-edge': '#625565',
      '--c-dim': '#7f708a',
      '--c-mute': '#9babb2',
      '--c-ink': '#c7dcd0',
      '--c-gold': '#fbb954',
    },
    frame: { outline: '#2e222f', light: '#9babb2', shade: '#2e222f', fill: '#313638' },
    control: '#625565',
    css: `
      .panel { box-shadow: var(--s1) var(--s1) 0 #2e222fcc; }
      /* rivets, placed rather than generated — four corners of the panel */
      .panel { position: relative; }
      .panel::before, .panel::after {
        content: ''; position: absolute; width: var(--s1); height: var(--s1);
        background: var(--c-mute); box-shadow: 0 var(--px) 0 var(--c-void);
      }
      .panel::before { left: var(--s2); top: var(--s2); }
      .panel::after { right: var(--s2); top: var(--s2); }
    `,
  },
  {
    id: 'ledger',
    name: "C · Miner's ledger",
    pitch:
      'The value structure inverted: a warm paper panel with dark ink, on the Clay ramp. Your notebook, not a window — the one direction here that does not look like every other pixel game.',
    cost: 'A bright panel over a dark world is a hole punched in the screen. Wants to be smaller and to appear less often than a dark one.',
    tokens: {
      '--c-void': CLAY[0],
      '--c-panel': CLAY[4],
      '--c-edge': CLAY[2],
      '--c-dim': CLAY[1],
      '--c-mute': CLAY[1],
      '--c-ink': CLAY[0],
      '--c-gold': '#9e4539',
    },
    frame: { outline: CLAY[0], light: CLAY[5], shade: CLAY[2], fill: CLAY[4] },
    control: CLAY[5],
    worldInk: CLAY[5],
    css: `
      /* ruled lines, like a ledger. Hard 1px rules on the art grid, not a texture. */
      .row { background: ${CLAY[3]}; border-color: ${CLAY[2]}; }
      .panel h2 { border-bottom: var(--px) solid ${CLAY[2]}; padding-bottom: var(--s1); }
      delve-slot { --slot-edge-w: var(--px); }
    `,
  },
  {
    id: 'lamp',
    name: 'D · Lamp-lit, no panel',
    pitch:
      'Almost no chrome. Content sits directly on a dithered scrim with a lamp-coloured rule under each heading, and the world stays visible behind it. This is the shape "nothing pauses" actually wants.',
    cost: 'Nothing separates content from world except the scrim, so a busy background can eat it. Hardest of the four to keep readable.',
    tokens: {
      '--c-void': '#2e222f',
      '--c-panel': '#2e222f',
      '--c-edge': '#625565',
      '--c-dim': '#7f708a',
      '--c-mute': '#9babb2',
      '--c-ink': '#c7dcd0',
      '--c-gold': '#8ff8e2',
    },
    frame: null,
    css: `
      .panel {
        background: #2e222fd9; border: 0; border-image: none; box-shadow: none;
        padding: var(--s4) var(--s3);
      }
      .panel h2 {
        border-bottom: var(--px) solid var(--c-gold);
        padding-bottom: var(--s1); margin-bottom: var(--s3);
      }
      .row { background: none; border: 0; border-image: none; padding-left: 0; }
      delve-slot { --slot-edge-w: var(--px); }
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

for (const concept of CONCEPTS) {
  const section = el('section', 'concept');
  section.id = concept.id;
  for (const [k, v] of Object.entries(concept.tokens)) section.style.setProperty(k, v);
  if (concept.frame) {
    section.style.setProperty(
      '--frame-raised',
      `url("${patternUrl(framePixels('raised', concept.frame))}")`,
    );
    section.style.setProperty(
      '--frame-inset',
      `url("${patternUrl(framePixels('inset', { ...concept.frame, well: false }))}")`,
    );
    section.style.setProperty(
      '--frame-control',
      `url("${patternUrl(framePixels('raised', { ...concept.frame, fill: concept.control ?? concept.frame.light, well: false }))}")`,
    );
  }
  if (concept.css) {
    const style = el('style');
    style.textContent = concept.css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, brace, sel) =>
      `${brace} #${concept.id} ${sel.trim()} {`,
    );
    section.append(style);
  }

  const head = el('div', 'head');
  head.append(el('div', 'nm', concept.name));
  head.append(el('div', 'note', concept.pitch));
  head.append(el('div', 'cost', 'Trade: ' + concept.cost));
  section.append(head);

  const stage = el('div', 'stage');

  const bar = el('div', 'topbar');
  // Text over the world, not over a panel — see `worldInk`.
  if (concept.worldInk) bar.style.setProperty('--c-ink', concept.worldInk);
  const header = el('header');
  const h1 = el('h1');
  h1.append(document.createTextNode('DE'), el('b', undefined, 'L'), document.createTextNode('VE'));
  const btns = el('div', 'btns');
  for (const t of ['Inventory', 'Collection']) btns.append(el('button', undefined, t));
  header.append(h1, btns);
  const hud = el('div', 'hud');
  for (const [k, v] of [
    ['DEPTH', '184'],
    ['HELD', '37'],
  ]) {
    const stat = el('div', 'stat');
    stat.append(document.createTextNode(k + ' '), el('b', undefined, v));
    hud.append(stat);
  }
  bar.append(header, hud);
  stage.append(bar);

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
  stage.append(panel);

  section.append(stage);
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
  for (let row = CENTER_ROW - 10; row <= CENTER_ROW + 10; row++) {
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
