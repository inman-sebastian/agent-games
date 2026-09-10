// style-lab.ts — the art style lab. Every panel renders through the EXACT shared modules the game
// uses (cave-render / ore-art / sprites / lighting), so what you tune here is what ships. Pure dev
// tool; not part of the game bundle. See style-lab.html for the surrounding chrome.
import { T, setStrata, composeBand, hexRgb, mulberry } from './scripts/cave-render';
import { ORE_ART, SHAPES, drawOreBlock } from './scripts/ore-art';
import { drawMiner } from './scripts/sprites';
import { create as createLighting, LAMP_COLOR } from './scripts/lighting';
import { STRATA } from './scripts/blocks';

// Depth strata come from the resource registry (blocks.STRATA); the lab only adds display names.
// Hand them to the renderer, then the selector picks a representative world row so composeBand's
// rampAt() paints that stratum's palette.
setStrata(STRATA);
const STRATA_NAMES = ['Topsoil', 'Clay', 'Stone', 'Deep Stone', 'Basalt'];
const DEMO_ORES = [2, 3, 4, 5, 6, 7, 8, 9]; // Copper..Mythril (skip Dirt, a dim clod)
const ORE_NAMES: Record<number, string> = {
  2: 'Copper',
  3: 'Iron',
  4: 'Silver',
  5: 'Gold',
  6: 'Emerald',
  7: 'Ruby',
  8: 'Diamond',
  9: 'Mythril',
};

// one scratch buffer at logical resolution; present() upscales it with pixelated nearest-neighbour
const lbuf = document.createElement('canvas');
const lb = lbuf.getContext('2d')!;
function present(
  dst: HTMLCanvasElement,
  dctx: CanvasRenderingContext2D,
  PW: number,
  PH: number,
  S: number,
): void {
  dst.width = PW * S;
  dst.height = PH * S;
  dctx.imageSmoothingEnabled = false;
  dctx.clearRect(0, 0, dst.width, dst.height);
  dctx.drawImage(lbuf, 0, 0, PW, PH, 0, 0, dst.width, dst.height);
}

// ---- controls ----
const matSel = document.getElementById('mat') as HTMLSelectElement;
STRATA_NAMES.forEach((name, i) => {
  const option = document.createElement('option');
  option.value = String(i);
  option.textContent = name;
  matSel.appendChild(option);
});
matSel.value = '0';
const chk = (id: string): boolean => (document.getElementById(id) as HTMLInputElement).checked;
const opts = () => ({ ore: chk('ore'), lamp: chk('lamp'), grid: chk('grid') });
const bandTop = (): number => STRATA[+matSel.value].top + 3; // representative row for the selected stratum

// ---- sample cave (shared with the game via a solidTile predicate) ----
const scene = document.getElementById('scene') as HTMLCanvasElement;
const sctx = scene.getContext('2d')!;
const COLS = 22;
const ROWS = 15;
let seed = 1234;
let grid: boolean[][] = [];
let oreGrid: number[][] = [];
let dmgGrid: number[][] = [];
let miner = { px: COLS >> 1, py: ROWS >> 1 };
const lighting = createLighting();

function genCave(): void {
  grid = [];
  oreGrid = [];
  dmgGrid = [];
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    oreGrid[y] = [];
    dmgGrid[y] = [];
    for (let x = 0; x < COLS; x++) {
      grid[y][x] = true;
      oreGrid[y][x] = 0;
      dmgGrid[y][x] = 0;
    }
  }
  const rnd = mulberry(seed * 99 + 7);
  const inBounds = (x: number, y: number): boolean =>
    x > 0 && x < COLS - 1 && y >= 0 && y < ROWS - 1;
  const carve = (x: number, y: number): void => {
    if (inBounds(x, y)) grid[y][x] = false;
  };
  const px = COLS >> 1;
  const py = ROWS >> 1;
  for (let yy = py - 2; yy <= py + 1; yy++) for (let xx = px - 3; xx <= px + 3; xx++) carve(xx, yy);
  // a few random drunkard-walk tunnels
  for (let t = 0; t < 5; t++) {
    let cx = 1 + Math.floor(rnd() * (COLS - 2));
    let cy = 1 + Math.floor(rnd() * (ROWS - 2));
    const steps = 18 + Math.floor(rnd() * 26);
    for (let step = 0; step < steps; step++) {
      carve(cx, cy);
      if (rnd() < 0.6) carve(cx, cy + 1);
      if (rnd() < 0.25) carve(cx + 1, cy);
      const d = rnd();
      if (d < 0.42) cx++;
      else if (d < 0.62) cx--;
      else if (d < 0.82) cy++;
      else cy--;
      cx = Math.max(1, Math.min(COLS - 2, cx));
      cy = Math.max(1, Math.min(ROWS - 2, cy));
    }
  }
  for (let xx = px - 3; xx <= px + 3; xx++) if (grid[py + 2]) grid[py + 2][xx] = true; // a floor to stand on
  // scatter a handful of ore NODES — each a grown blob of a single ore, so the sample previews
  // clustered ore blocks (the same idea as the game's noise-node placement).
  for (let t = 0; t < 14; t++) {
    let cx = 1 + Math.floor(rnd() * (COLS - 2));
    let cy = 1 + Math.floor(rnd() * (ROWS - 2));
    if (!grid[cy][cx]) continue;
    const id = DEMO_ORES[Math.floor(rnd() * DEMO_ORES.length)];
    const n = 3 + Math.floor(rnd() * 8);
    for (let k = 0; k < n; k++) {
      if (grid[cy] && grid[cy][cx]) {
        oreGrid[cy][cx] = id;
        dmgGrid[cy][cx] = rnd() < 0.3 ? 0.3 + rnd() * 0.6 : 0;
      }
      const d = rnd();
      if (d < 0.25) cx++;
      else if (d < 0.5) cx--;
      else if (d < 0.75) cy++;
      else cy--;
      cx = Math.max(1, Math.min(COLS - 2, cx));
      cy = Math.max(1, Math.min(ROWS - 2, cy));
    }
  }
  miner = { px, py };
}

function renderScene(): void {
  const S = parseInt((document.getElementById('zoom') as HTMLInputElement).value, 10);
  const o = opts();
  const top = bandTop();
  const PW = COLS * T;
  const PH = ROWS * T;
  lbuf.width = PW;
  lbuf.height = PH;
  lb.imageSmoothingEnabled = false;
  // solidTile in world coords (row = top + local y) so the shared renderers see the sample cave
  const solidTile = (c: number, r: number): boolean => {
    const y = r - top;
    return c < 0 || c >= COLS || y < 0 || y >= ROWS ? true : grid[y][c];
  };
  // rock + background + sky + stalactites — the exact game renderer, at this stratum's depth
  composeBand(lb, solidTile, 0, top, COLS, ROWS, COLS, -1);
  // ore veins — the exact game vein renderer
  if (o.ore) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const id = oreGrid[y][x];
        if (!grid[y][x] || !id) continue;
        const sameOre = (dc: number, dr: number): boolean => {
          const nx = x + dc;
          const ny = y + dr;
          return (
            nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] && oreGrid[ny][nx] === id
          );
        };
        drawOreBlock(lb, ORE_ART[id], x * T, y * T, x, top + y, dmgGrid[y][x], sameOre);
      }
    }
  }
  drawMiner(lb, miner.px * T, miner.py * T, 'right', 0);
  // lighting — the exact game system: lamp + ore emitters, occlusion, fog, vignette. Emitters take
  // WORLD pixels; camX=0 / camY=top*T window the field over this sample.
  if (o.lamp) {
    const camX = 0;
    const camY = top * T;
    lighting.addLight(miner.px * T + 8, (top + miner.py) * T + 7, 0, LAMP_COLOR, 1.3);
    if (o.ore) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const id = oreGrid[y][x];
          const art = ORE_ART[id];
          if (!grid[y][x] || !art || art.dim) continue;
          // seed at the exposed open face, dimming with distance from the lamp — mirrors index.ts
          let nx = x;
          let ny = y;
          if (!solidTile(x, top + y - 1)) ny = y - 1;
          else if (!solidTile(x, top + y + 1)) ny = y + 1;
          else if (!solidTile(x - 1, top + y)) nx = x - 1;
          else if (!solidTile(x + 1, top + y)) nx = x + 1;
          if (nx === x && ny === y) continue;
          const dist = Math.hypot(x - miner.px, y - miner.py);
          const li = Math.max(0, 1 - dist / 7);
          if (li <= 0.05 && dmgGrid[y][x] <= 0.05) continue;
          const [rr, gg, bb] = hexRgb(art.c[2]);
          lighting.addLight(
            nx * T + (T >> 1),
            (top + ny) * T + (T >> 1),
            1,
            [rr / 255, gg / 255, bb / 255],
            0.9 * li * (0.5 + 0.85 * dmgGrid[y][x]),
          );
        }
      }
    }
    lighting.render({ g: lb, LW: PW, LH: PH, T, camX, camY, SURFACE: -1, solidTile });
  }
  present(scene, sctx, PW, PH, S);
  if (o.grid) {
    sctx.strokeStyle = '#ffffff22';
    sctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      sctx.beginPath();
      sctx.moveTo(x * T * S + 0.5, 0);
      sctx.lineTo(x * T * S + 0.5, PH * S);
      sctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      sctx.beginPath();
      sctx.moveTo(0, y * T * S + 0.5);
      sctx.lineTo(PW * S, y * T * S + 0.5);
      sctx.stroke();
    }
  }
}

// ---- mining matrix: every demo ore × the 4 damage steps + the extracted crystal ----
const mine = document.getElementById('mine') as HTMLCanvasElement;
const mctx = mine.getContext('2d')!;
function renderMine(): void {
  const S = 5;
  const cell = T * S;
  const gx = 6;
  const gy = 12;
  const labelW = 68;
  const headH = 22;
  const colGap = 22;
  const steps = [0, 0.5, 0.78, 1.0];
  // a lone solid rock tile (row 1) with open space above (row 0) → top-lit, like the game
  const solidTile = (_c: number, r: number): boolean => r >= 1;
  mine.width = labelW + steps.length * (cell + gx) + colGap + cell;
  mine.height = headH + DEMO_ORES.length * (cell + gy);
  mctx.imageSmoothingEnabled = false;
  mctx.clearRect(0, 0, mine.width, mine.height);
  mctx.textBaseline = 'middle';
  mctx.fillStyle = '#8494a8';
  mctx.font = '600 11px ui-sans-serif';
  steps.forEach((_d, i) =>
    mctx.fillText('Step ' + (i + 1), labelW + i * (cell + gx) + 2, headH / 2),
  );
  mctx.fillText('Ore', labelW + steps.length * (cell + gx) + colGap + cell / 2 - 9, headH / 2);
  const blit = (cx: number, cy: number): void =>
    mctx.drawImage(lbuf, 0, 0, T, T, cx, cy, cell, cell);
  DEMO_ORES.forEach((id, r) => {
    const art = ORE_ART[id];
    const y = headH + r * (cell + gy);
    mctx.fillStyle = art.c[2];
    mctx.font = '600 11px ui-sans-serif';
    mctx.fillText(ORE_NAMES[id], 2, y + cell / 2);
    steps.forEach((d, i) => {
      lbuf.width = T;
      lbuf.height = T;
      lb.imageSmoothingEnabled = false;
      composeBand(lb, solidTile, 0, 1, 1, 1, 1, -1); // single lit rock tile
      drawOreBlock(lb, art, 0, 0, 0, 1, d, () => false); // isolated block, cracks by damage
      blit(labelW + i * (cell + gx), y);
    });
    // the extracted crystal only, centred on a neutral swatch
    lbuf.width = T;
    lbuf.height = T;
    lb.imageSmoothingEnabled = false;
    lb.fillStyle = '#0e0e16';
    lb.fillRect(0, 0, T, T);
    SHAPES[art.shape](
      (a, b, w, h, cc) => {
        lb.fillStyle = cc;
        lb.fillRect(a, b, w || 1, h || 1);
      },
      8,
      8,
      4,
      art.c,
    );
    blit(labelW + steps.length * (cell + gx) + colGap, y);
  });
}

// ---- atlas: each stratum's top-lit rock, via the shared renderer ----
const atlas = document.getElementById('atlas') as HTMLCanvasElement;
const actx = atlas.getContext('2d')!;
function renderAtlas(): void {
  const S = 5;
  const gap = 6;
  atlas.width = STRATA.length * (T * S + gap) - gap;
  atlas.height = T * S;
  actx.imageSmoothingEnabled = false;
  actx.clearRect(0, 0, atlas.width, atlas.height);
  STRATA.forEach((st, i) => {
    const top = st.top + 3;
    const solidTile = (_c: number, r: number): boolean => r >= top; // open above, solid at/below → top-lit surface
    lbuf.width = T;
    lbuf.height = T;
    lb.imageSmoothingEnabled = false;
    composeBand(lb, solidTile, 0, top, 1, 1, 1, -1);
    actx.drawImage(lbuf, 0, 0, T, T, i * (T * S + gap), 0, T * S, T * S);
  });
}

function renderAll(): void {
  renderScene();
  renderMine();
  renderAtlas();
}
for (const input of document.querySelectorAll('input,select')) {
  input.addEventListener('input', () => {
    (document.getElementById('zoomv') as HTMLElement).textContent =
      (document.getElementById('zoom') as HTMLInputElement).value + '×';
    renderAll();
  });
}
document.getElementById('regen')!.addEventListener('click', () => {
  seed = (Math.random() * 1e9) | 0;
  genCave();
  renderAll();
});
genCave();
renderAll();
