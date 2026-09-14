// fluid-lab.ts — a sandbox for the cellular-automaton fluid (#30). It runs the REAL step from
// @delve/shared over a hand-built rock field, draws the rock through the real rock renderer, and
// reports the numbers the netcode question turns on: how many cells are awake, how many change per
// tick, and what sending those changes would cost. The model and what the lab is for: docs/FLUIDS.md.
// Colours: docs/PALETTE.md#fluids. Pure dev tool.
import {
  STRATA,
  vnoise,
  newFluidField,
  pourFluid,
  stepFluid,
  wakeAround,
  fluidAt,
  fluidMass,
  fluidKey,
  columnOfKey,
  rowOfKey,
  MAX_LEVEL,
  type FluidField,
  type FluidKind,
} from '@delve/shared';
import { T, setStrata, composeBand, NO_SKY } from '../src/render/cave-render';

setStrata(STRATA);

// ---- tuning -------------------------------------------------------------------------------------

const SCALE = 2; // screen px per art px, the game's own zoom
const WALL = 1; // rock border around the field, in cells
const POUR_PER_TICK = MAX_LEVEL; // a held pour adds one full cell per tick
const BRUSH_RADIUS = 1; // cells either side of the cursor that a dig or a build touches
const REGION_RADIUS = 18; // cells — the active region, when it follows the cursor
const TICK_RATES = [5, 10, 20, 30, 60, 120]; // fluid ticks per second, cycled with [ and ]
const BROADCAST_HZ = 20; // the server's state broadcast rate (ARCHITECTURE.md)
const BYTES_PER_CHANGE = 5; // a packed cell key plus a level — see FLUIDS.md
const COST_SMOOTHING = 0.1; // exponential average weight for the per-tick numbers

const WATER = { deep: '#323353', body: '#4d65b4', surface: '#8fd3ff', alpha: 0.7 };
const LAVA = { deep: '#6e2727', body: '#ea4f36', surface: '#f9c22b', alpha: 1 };

// ---- canvas -------------------------------------------------------------------------------------

const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const hud = document.getElementById('hud') as HTMLElement;
const rockLayer = document.createElement('canvas');
const rockContext = rockLayer.getContext('2d')!;

let cols = 0;
let rows = 0;

// ---- scenes -------------------------------------------------------------------------------------

const rock = new Set<number>();
let field: FluidField = newFluidField();

const isSolid = (column: number, row: number): boolean =>
  column < WALL ||
  row < WALL ||
  column >= cols - WALL ||
  row >= rows - WALL ||
  rock.has(fluidKey(column, row));

interface Scene {
  readonly name: string;
  readonly build: () => void;
}

const fillRect = (left: number, top: number, width: number, height: number): void => {
  for (let column = left; column < left + width; column++) {
    for (let row = top; row < top + height; row++) rock.add(fluidKey(column, row));
  }
};

const pourRect = (
  kind: FluidKind,
  left: number,
  top: number,
  width: number,
  height: number,
): void => {
  for (let column = left; column < left + width; column++) {
    for (let row = top; row < top + height; row++) {
      pourFluid(field, column, row, kind, MAX_LEVEL, isSolid);
    }
  }
};

const SCENES: readonly Scene[] = [
  {
    // The classic: a full reservoir behind a wall. Dig the wall (right-drag) to breach it.
    name: 'dam break',
    build: () => {
      const damColumn = Math.floor(cols * 0.35);
      fillRect(damColumn, Math.floor(rows * 0.3), 2, rows);
      pourRect('water', WALL, Math.floor(rows * 0.35), damColumn - WALL, rows);
    },
  },
  {
    // Noise caves with water perched in the upper pockets and lava in the lower — a stand-in for a
    // Flooded Warren you mine into from below.
    name: 'caves',
    build: () => {
      const seed = 7;
      for (let column = 0; column < cols; column++) {
        for (let row = 0; row < rows; row++) {
          const open =
            vnoise(column * 0.11, row * 0.16, seed) +
            0.35 * vnoise(column * 0.3, row * 0.3, seed + 1);
          if (open < 0.62) rock.add(fluidKey(column, row));
        }
      }
      for (let column = 0; column < cols; column++) {
        for (let row = 0; row < rows; row++) {
          if (isSolid(column, row)) continue;
          const kind: FluidKind = row < rows * 0.45 ? 'water' : 'lava';
          if (vnoise(column * 0.2, row * 0.2, seed + 2) > 0.7)
            pourFluid(field, column, row, kind, MAX_LEVEL, isSolid);
        }
      }
    },
  },
  {
    // The pressure question (FLUIDS.md): with no pressure term, water poured down the left arm does
    // NOT climb the right arm to the same height.
    name: 'U-bend',
    build: () => {
      const middle = cols >> 1;
      fillRect(WALL, WALL, middle - 6, rows);
      fillRect(middle + 6, WALL, cols, rows);
      // The divider leaves a three-row channel under it, and the left arm is poured full — far more
      // water than the channel holds, so the question is where the rest ends up.
      fillRect(middle - 2, WALL, 4, rows - WALL - 4);
      pourRect('water', middle - 5, WALL, 3, rows);
    },
  },
  {
    // Lava above a shelf with one hole in it, a pool of water below. Kinds don't mix yet — the lava
    // settles on the water instead of making obsidian (FLUIDS.md).
    name: 'lava over water',
    build: () => {
      const shelf = Math.floor(rows * 0.45);
      fillRect(WALL, shelf, cols, 2);
      rock.delete(fluidKey(cols >> 1, shelf)); // the hole goes through BOTH rows of the shelf
      rock.delete(fluidKey(cols >> 1, shelf + 1));
      pourRect('lava', Math.floor(cols * 0.3), WALL, Math.floor(cols * 0.4), shelf - WALL - 4);
      pourRect('water', WALL, rows - 6, cols, 4);
    },
  },
];

// `?scene=N` opens a scene directly, so `tools/shot.sh` can capture any of them without a key press.
let sceneIndex = Number(new URLSearchParams(location.search).get('scene') ?? 0) || 0;
let rockDirty = true;

function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  rock.clear();
  field = newFluidField();
  poured = { water: 0, lava: 0 };
  SCENES[sceneIndex].build();
  poured = { water: fluidMass(field, 'water'), lava: fluidMass(field, 'lava') };
  rockDirty = true;
}

// ---- sizing -------------------------------------------------------------------------------------

function fit(): void {
  const tilePx = T * SCALE;
  cols = Math.max(24, Math.floor(innerWidth / tilePx));
  rows = Math.max(16, Math.floor(innerHeight / tilePx));
  for (const target of [canvas, rockLayer]) {
    target.width = cols * T;
    target.height = rows * T;
  }
  canvas.style.width = `${cols * tilePx}px`;
  canvas.style.height = `${rows * tilePx}px`;
  g.imageSmoothingEnabled = false;
  loadScene(sceneIndex);
}

// ---- input --------------------------------------------------------------------------------------

let kind: FluidKind = 'water';
let paused = false;
let stepOnce = false;
let rateIndex = 3;
let regionFollows = false;
let showActive = false;
let poured: Record<FluidKind, number> = { water: 0, lava: 0 };

const pointer = { column: -1, row: -1, buttons: 0, shift: false };

function cellUnder(event: PointerEvent): void {
  const bounds = canvas.getBoundingClientRect();
  pointer.column = Math.floor(((event.clientX - bounds.left) / bounds.width) * cols);
  pointer.row = Math.floor(((event.clientY - bounds.top) / bounds.height) * rows);
  pointer.buttons = event.buttons;
  pointer.shift = event.shiftKey;
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  cellUnder(event);
});
canvas.addEventListener('pointermove', cellUnder);
canvas.addEventListener('pointerup', cellUnder);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

addEventListener('keydown', (event: KeyboardEvent) => {
  const actions: Record<string, () => void> = {
    Digit1: () => (kind = 'water'),
    Digit2: () => (kind = 'lava'),
    Space: () => (paused = !paused),
    Period: () => (stepOnce = true),
    BracketLeft: () => (rateIndex = Math.max(0, rateIndex - 1)),
    BracketRight: () => (rateIndex = Math.min(TICK_RATES.length - 1, rateIndex + 1)),
    KeyA: () => (regionFollows = !regionFollows),
    KeyV: () => (showActive = !showActive),
    KeyR: () => loadScene(sceneIndex),
    KeyN: () => loadScene(sceneIndex + 1),
  };
  const action = actions[event.code];
  if (!action) return;
  event.preventDefault();
  action();
});

/** Apply the held pointer once per tick: pour, dig (right button) or build (shift). */
function applyBrush(): void {
  if (!pointer.buttons) return;
  const { column, row } = pointer;
  const digging = (pointer.buttons & 2) !== 0;
  if (!digging && !pointer.shift) {
    poured[kind] += pourFluid(field, column, row, kind, POUR_PER_TICK, isSolid);
    return;
  }
  for (let dc = -BRUSH_RADIUS; dc <= BRUSH_RADIUS; dc++) {
    for (let dr = -BRUSH_RADIUS; dr <= BRUSH_RADIUS; dr++) {
      const key = fluidKey(column + dc, row + dr);
      if (digging) {
        if (!rock.delete(key)) continue;
        wakeAround(field, column + dc, row + dr);
        rockDirty = true;
      } else if (!field.cells.has(key)) {
        // Never build over fluid: that would delete mass, and the mass readout would be lying.
        rock.add(key);
        rockDirty = true;
      }
    }
  }
}

// ---- the loop -----------------------------------------------------------------------------------

// Step time is summed over a one-second window rather than timed per tick: browsers coarsen
// performance.now() (to 100µs without cross-origin isolation), so a single fast tick reads as zero.
const COST_WINDOW_MS = 1000;
const cost = { msPerSecond: 0, stepped: 0, changed: 0, active: 0 };
let windowStart = performance.now();
let windowStepMs = 0;
let lastChanged: ReadonlySet<number> = new Set();
let accumulator = 0;
let lastNow = performance.now();

const smooth = (previous: number, sample: number): number =>
  previous + (sample - previous) * COST_SMOOTHING;

function tick(): void {
  applyBrush();
  const region = regionFollows
    ? (column: number, row: number): boolean =>
        Math.abs(column - pointer.column) <= REGION_RADIUS &&
        Math.abs(row - pointer.row) <= REGION_RADIUS
    : undefined;
  const started = performance.now();
  const result = stepFluid(field, isSolid, region);
  const finished = performance.now();
  windowStepMs += finished - started;
  if (finished - windowStart >= COST_WINDOW_MS) {
    cost.msPerSecond = (windowStepMs * COST_WINDOW_MS) / (finished - windowStart);
    windowStart = finished;
    windowStepMs = 0;
  }
  cost.stepped = smooth(cost.stepped, result.stepped);
  cost.changed = smooth(cost.changed, result.changed.size);
  cost.active = field.active.size;
  lastChanged = result.changed;
}

function frame(now: number): void {
  const tickSeconds = 1 / TICK_RATES[rateIndex];
  accumulator = Math.min(accumulator + (now - lastNow) / 1000, tickSeconds * 8);
  lastNow = now;
  if (paused) {
    accumulator = 0;
    if (stepOnce) tick();
  } else {
    while (accumulator >= tickSeconds) {
      accumulator -= tickSeconds;
      tick();
    }
  }
  stepOnce = false;
  draw();
  requestAnimationFrame(frame);
}

// ---- drawing ------------------------------------------------------------------------------------

function draw(): void {
  if (rockDirty) {
    composeBand(rockContext, isSolid, 0, 0, cols, rows, NO_SKY);
    rockDirty = false;
  }
  g.drawImage(rockLayer, 0, 0);
  drawFluid();
  drawOverlays();
  drawHud();
}

function drawFluid(): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < cols; column++) {
      const cell = fluidAt(field, column, row);
      if (!cell) continue;
      const colours = cell.kind === 'water' ? WATER : LAVA;
      const above = fluidAt(field, column, row - 1);
      const submerged = above !== null && above.kind === cell.kind;
      const deep = submerged && above.level === MAX_LEVEL;
      // Whole art pixels, never zero — a sliver of water must still be visible.
      const height = submerged ? T : Math.max(1, Math.round((cell.level / MAX_LEVEL) * T));
      const top = row * T + (T - height);
      g.globalAlpha = colours.alpha;
      g.fillStyle = deep ? colours.deep : colours.body;
      g.fillRect(column * T, top, T, height);
      if (!submerged) {
        g.fillStyle = colours.surface;
        g.fillRect(column * T, top, T, 1);
      }
    }
  }
  g.globalAlpha = 1;
}

function drawOverlays(): void {
  if (showActive) {
    g.fillStyle = 'rgba(242, 193, 78, 0.35)';
    for (const key of field.active) {
      g.fillRect(columnOfKey(key) * T + 3, rowOfKey(key) * T + 3, 2, 2);
    }
    g.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (const key of lastChanged) {
      g.fillRect(columnOfKey(key) * T + 3, rowOfKey(key) * T + 4, 2, 1);
    }
  }
  if (regionFollows && pointer.column >= 0) {
    g.strokeStyle = 'rgba(242, 193, 78, 0.6)';
    const side = (REGION_RADIUS * 2 + 1) * T;
    g.strokeRect(
      (pointer.column - REGION_RADIUS) * T + 0.5,
      (pointer.row - REGION_RADIUS) * T + 0.5,
      side,
      side,
    );
  }
  if (pointer.column >= 0) {
    g.strokeStyle = 'rgba(253, 243, 212, 0.7)';
    g.strokeRect(pointer.column * T + 0.5, pointer.row * T + 0.5, T - 1, T - 1);
  }
}

function drawHud(): void {
  const rate = TICK_RATES[rateIndex];
  // An UPPER bound: a broadcast sends the union of the ticks' changes since the last one, which is at
  // most their sum — a cell that ripples every tick is sent once per broadcast, not once per tick.
  const changesPerSecond = cost.changed * rate;
  const bytesPerSecond = changesPerSecond * BYTES_PER_CHANGE;
  const cellsPerBroadcast = changesPerSecond / BROADCAST_HZ;
  const waterMass = fluidMass(field, 'water');
  const lavaMass = fluidMass(field, 'lava');
  const drift = waterMass !== poured.water || lavaMass !== poured.lava;
  hud.innerHTML =
    `<b>DELVE · fluid lab</b> — ${SCENES[sceneIndex].name}   [N] next scene · [R] reset\n` +
    `pour <b>${kind}</b> [1 water · 2 lava] · left-drag pour · right-drag dig · shift-drag build\n` +
    `${paused ? '<b>PAUSED</b> [Space] · [.] step' : '[Space] pause'} · ${rate} ticks/s [ [ ] ] · ` +
    `active region ${regionFollows ? '<b>follows cursor</b>' : 'everywhere'} [A] · overlay [V]\n\n` +
    `sim      ${cost.msPerSecond.toFixed(1)} ms of stepping per second\n` +
    `active   ${cost.active} cells   stepped ${cost.stepped.toFixed(0)}/tick\n` +
    `changed  ${cost.changed.toFixed(0)}/tick  ≤ ${cellsPerBroadcast.toFixed(0)} cells per ${BROADCAST_HZ} Hz broadcast  ≤ ${(bytesPerSecond / 1024).toFixed(1)} KB/s\n` +
    `mass     water ${(waterMass / MAX_LEVEL).toFixed(1)} · lava ${(lavaMass / MAX_LEVEL).toFixed(1)} cells` +
    (drift ? '   <b>DRIFT — conservation broken</b>' : '');
}

// Exposed for `pnpm probe --eval`, which reads the lab as text instead of a screenshot.
Object.assign(window, {
  fluidLab: { field: () => field, fluidAt, cols: () => cols, rows: () => rows },
});

addEventListener('resize', fit);
fit();
requestAnimationFrame(frame);
