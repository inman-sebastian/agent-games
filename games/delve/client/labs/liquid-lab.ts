// liquid-lab.ts — the cell-pipe liquid (#90) in a carved screen of the real world. The sim runs on the dig
// cells (shared/src/liquid.ts) and is drawn at art resolution over the real rock
// (client/src/fluid/liquid-render.ts). The scenes are the cases the earlier models' reviews found broken.
// The plan is in docs/FLUIDS.md.
//
// Mouse: right-drag digs · shift-drag builds · hold W to pour water at the cursor.
// Keys: N next scene · R reset · space pause · T teal water · L lighting
//       S Terraria's liquid or the cell pipes · 1–9 jump to a scene. `?sim=pipes` starts on the pipes.
// `window.liquidLab` exposes controls and stats for `pnpm probe`.
import {
  STRATA,
  FULL,
  OPEN,
  shapeAt,
  solidAt,
  surfaceAt,
  SUB,
  createLiquid,
  UNIT,
  WATER_PARAMS,
  LAVA_PARAMS,
  createTerrariaLiquid,
  LIQUID_WATER,
  LIQUID_LAVA,
  TERRARIA_LIQUID_UPDATES_PER_SECOND,
  type TerrariaLiquid,
  type Liquid,
} from '@delve/shared';
import {
  setStrata,
  composeBand,
  buildMask,
  T,
  SHADE_INFLUENCE_CELLS,
} from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { drawLiquid, WATER_STYLE, TEAL_WATER_STYLE, LAVA_STYLE } from '../src/fluid/liquid-render';
import {
  animationFrame,
  drawTerrariaLiquid,
  liquidLights,
  planLiquid,
  LAVA_LIGHT,
} from '../src/fluid/terraria-liquid-render';
import { createLiquidGpu } from '../src/render/gpu/liquid';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

/** Lava's idle surface moves at this fraction of water's speed. */
const LAVA_IDLE = 0.3;

setStrata(STRATA);

/** Units of water poured per second while W is held: a steady hose. */
const POUR_UNITS_PER_SECOND = 4 * UNIT;
/** At most this many substeps per frame, so a slow frame doesn't spiral. */
const MAX_SUBSTEPS_PER_FRAME = 16;

// ---- the band ---------------------------------------------------------------------------------------------

const cols = Math.max(24, Math.floor(innerWidth / (T * UPSCALE)));
const rows = Math.max(16, Math.floor(innerHeight / (T * UPSCALE)));
const width = cols * T;
const height = rows * T;
const bandLeft = 2400 * SUB - (cols >> 1);
/** Deep enough that there's no sky; the stratum here is Stone. `?top=` moves it (Deep Stone from 190). */
const bandTop = Number(new URLSearchParams(location.search).get('top') ?? 120);
const SEED = 12345;
const dug = new Set<string>();
const built = new Set<string>();
/** Slopes a scene builds (#95), by cell; a built cell without one is full. */
const sloped = new Map<string, number>();
const key = (column: number, row: number): string => `${column},${row}`;
const isSolid = (column: number, row: number): boolean =>
  built.has(key(column, row)) || (solidAt(SEED, column, row) && !dug.has(key(column, row)));
const shapeOf = (column: number, row: number): number => {
  if (!isSolid(column, row)) return OPEN;
  const cell = key(column, row);
  return built.has(cell) ? (sloped.get(cell) ?? FULL) : shapeAt(SEED, column, row);
};
const carve = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      dug.add(key(bandLeft + c, bandTop + r));
      built.delete(key(bandLeft + c, bandTop + r));
    }
  }
};
const build = (c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r < r1; r++)
    for (let c = c0; c < c1; c++) built.add(key(bandLeft + c, bandTop + r));
};
/**
 * Slope the built cells' corners, as world smoothing would: a floor cell open on one side becomes the floor slope
 * falling that way, a ceiling cell open on one side the ceiling slope.
 */
const slopeCorners = (): void => {
  const solid = (c: number, r: number): boolean => isSolid(bandLeft + c, bandTop + r);
  for (const cell of built) {
    const [column, row] = cell.split(',').map(Number);
    const c = column - bandLeft;
    const r = row - bandTop;
    const left = solid(c - 1, r);
    const right = solid(c + 1, r);
    if (left === right) continue;
    if (!solid(c, r - 1) && solid(c, r + 1)) sloped.set(cell, left ? 1 : 2);
    else if (!solid(c, r + 1) && solid(c, r - 1)) sloped.set(cell, left ? 3 : 4);
  }
};

// ---- scenes ------------------------------------------------------------------------------------------------------

interface Scene {
  name: string;
  hint: string;
  /** Carve and build; return the cells to fill with water, and cells to dig once it's settled a moment. */
  setup(): {
    water: [number, number, number, number][];
    breach?: [number, number, number, number][];
    /** Lava instead of water. */
    lava?: boolean;
  };
}

const wallColumn = (): number => Math.floor(cols * 0.42);

const SCENES: Scene[] = [
  {
    name: 'reservoir',
    hint: 'a reservoir behind a one-cell wall — right-drag through it however you like',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      return { water: [[3, 6, wall, rows - 3]] };
    },
  },
  {
    name: 'full breach',
    hint: 'a reservoir whose wall is dug away top to bottom',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      return { water: [[3, 8, wall, rows - 3]], breach: [[wall, 3, wall + 1, rows - 3]] };
    },
  },
  {
    name: 'partial breach',
    hint: 'the top half of the wall dug away: it pours over what is left',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      const half = Math.floor(rows / 2);
      return { water: [[3, 6, wall, rows - 3]], breach: [[wall, 3, wall + 1, half]] };
    },
  },
  {
    name: 'three gaps',
    hint: 'three one-cell gaps dug through the wall below the waterline',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      const gaps = [0.4, 0.6, 0.8].map((f) => Math.floor(rows * f));
      return {
        water: [[3, 6, wall, rows - 3]],
        breach: gaps.map((r) => [wall, r, wall + 1, r + 1]),
      };
    },
  },
  {
    name: 'gap under water',
    hint: 'one gap low in the wall: a jet',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      const low = rows - 6;
      return { water: [[3, 6, wall, rows - 3]], breach: [[wall, low, wall + 1, low + 1]] };
    },
  },
  {
    name: 'pool over a cave',
    hint: 'a hole dug through a pool floor into the cave below',
    setup() {
      const mid = cols >> 1;
      carve(mid - 10, 4, mid + 10, 11);
      carve(4, rows - 12, cols - 4, rows - 3);
      return { water: [[mid - 10, 6, mid + 10, 11]], breach: [[mid, 11, mid + 1, rows - 12]] };
    },
  },
  {
    name: 'lava breach',
    hint: 'the partial breach in lava: the same model, thick and slow',
    setup() {
      const wall = wallColumn();
      carve(3, 3, cols - 3, rows - 3);
      build(wall, 3, wall + 1, rows - 3);
      const half = Math.floor(rows / 2);
      return { water: [[3, 6, wall, rows - 3]], breach: [[wall, 3, wall + 1, half]], lava: true };
    },
  },
  {
    name: 'u-bend',
    hint: 'two shafts joined at the bottom; the left one starts full',
    setup() {
      const mid = cols >> 1;
      carve(mid - 8, 4, mid - 5, rows - 4);
      carve(mid + 5, 4, mid + 8, rows - 4);
      carve(mid - 8, rows - 7, mid + 8, rows - 4);
      return {
        water: [
          [mid - 8, 6, mid - 5, rows - 4],
          [mid - 5, rows - 7, mid + 8, rows - 4],
        ],
      };
    },
  },
  {
    name: 'slopes',
    hint: 'a basin with sloped banks and a shelf with a sloped underside: the water shows through their open halves',
    setup() {
      carve(3, 3, cols - 3, rows - 3);
      const mid = cols >> 1;
      const bottom = rows - 4;
      for (let c = 3; c < cols - 3; c++) {
        const bank = Math.max(0, Math.abs(c - mid) - 6);
        const top = Math.max(7, bottom - bank);
        build(c, top, c + 1, rows - 3);
      }
      build(mid + 3, 10, cols - 3, 12);
      slopeCorners();
      return { water: [[3, 5, cols - 3, rows - 3]] };
    },
  },
  {
    name: 'terraces',
    hint: 'hold W over the top basin: it fills and spills down each step',
    setup() {
      carve(3, 3, cols - 3, rows - 3);
      const steps = 4;
      const stepWidth = Math.floor((cols - 6) / steps);
      const rise = Math.floor((rows - 10) / steps);
      for (let n = 0; n < steps; n++) {
        const floor = 8 + n * rise;
        const left = 3 + n * stepWidth;
        build(left, floor, left + stepWidth + 2, floor + 1);
        build(left + stepWidth + 1, floor - 3, left + stepWidth + 2, floor);
        if (n > 0) build(left, floor - 3, left + 1, floor);
      }
      return { water: [] };
    },
  },
];

// ---- canvas and rock ----------------------------------------------------------------------------------------

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
canvas.width = width;
canvas.height = height;
canvas.style.width = `${width * UPSCALE}px`;
canvas.style.height = `${height * UPSCALE}px`;
const context = canvas.getContext('2d')!;
const rockCanvas = Object.assign(document.createElement('canvas'), { width, height });
const rock = rockCanvas.getContext('2d', { willReadFrequently: true })!;
let rockPixels = new Uint8ClampedArray(width * height * 4);
let open = new Uint8Array(width * height);
const image = context.createImageData(width, height);
// lava is emissive: it's drawn into its own layer, over the lighting
const lavaCanvas = Object.assign(document.createElement('canvas'), { width, height });
const lavaContext = lavaCanvas.getContext('2d')!;
const lavaImage = lavaContext.createImageData(width, height);
const lighting = createLighting();
/** DELVE's lighting: lamp-only darkness, the lamp on the pointer, and lava's light. L toggles; `?light=0` starts off. */
let lit = new URLSearchParams(location.search).get('light') !== '0';
/** The lamp's intensity, as the style lab's miner carries it. */
const LAMP_INTENSITY = 1.3;
/** Each lava tile open to the air lights the cave at this intensity (lamp-field, max-propagated). */
const LAVA_INTENSITY = 1.1;

function refreshRock(): void {
  composeBand(
    rock,
    isSolid,
    bandLeft,
    bandTop,
    cols,
    rows,
    (column) => surfaceAt(SEED, column),
    undefined,
    shapeOf,
  );
  rockPixels = rock.getImageData(0, 0, width, height).data.slice();
  const mask = buildMask(isSolid, width, height, bandLeft, bandTop, shapeOf);
  open = new Uint8Array(width * height);
  for (let i = 0; i < open.length; i++) open[i] = mask[i] ? 0 : 1;
}

/** Re-render only what a change to one cell can affect (see docs/FLUIDS.md, "Lab: digging patches the rock"). */
function refreshRockAround(column: number, row: number): void {
  const reach = SHADE_INFLUENCE_CELLS + 1;
  const margin = reach + 2;
  const s0 = Math.max(0, column - margin);
  const s1 = Math.min(cols, column + margin + 1);
  const k0 = Math.max(0, column - reach);
  const k1 = Math.min(cols, column + reach + 1);
  const strip = Object.assign(document.createElement('canvas'), { width: (s1 - s0) * T, height });
  composeBand(
    strip.getContext('2d')!,
    isSolid,
    bandLeft + s0,
    bandTop,
    s1 - s0,
    rows,
    (c) => surfaceAt(SEED, c),
    undefined,
    shapeOf,
  );
  rock.clearRect(k0 * T, 0, (k1 - k0) * T, height);
  rock.drawImage(strip, (k0 - s0) * T, 0, (k1 - k0) * T, height, k0 * T, 0, (k1 - k0) * T, height);
  const patched = rock.getImageData(k0 * T, 0, (k1 - k0) * T, height).data;
  const stripWidth = (k1 - k0) * T;
  for (let y = 0; y < height; y++) {
    rockPixels.set(
      patched.subarray(y * stripWidth * 4, (y + 1) * stripWidth * 4),
      (y * width + k0 * T) * 4,
    );
  }
  const m0 = Math.max(0, column - 2);
  const m1 = Math.min(cols, column + 3);
  const r0 = Math.max(0, row - 2);
  const r1 = Math.min(rows, row + 3);
  const w = (m1 - m0) * T;
  const h = (r1 - r0) * T;
  const mask = buildMask(isSolid, w, h, bandLeft + m0, bandTop + r0, shapeOf);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) open[(r0 * T + y) * width + m0 * T + x] = mask[y * w + x] ? 0 : 1;
  }
}

// ---- the liquid -------------------------------------------------------------------------------------------------

let liquid: Liquid = createLiquid(cols, rows, new Uint8Array(cols * rows));
/** Terraria's liquid, ported (terraria-liquid.ts), or the cell pipes (liquid.ts) for comparison. */
let terraria = new URLSearchParams(location.search).get('sim') !== 'pipes';
/** Steps per second of whichever sim is running. */
let stepsPerSecond = WATER_PARAMS.substepsPerSecond;
let sceneIndex = 0;
let lava = false;
let pendingBreach: [number, number, number, number][] = [];
let breachAt = 0;
let elapsed = 0;
/** Seconds after a scene loads before its breach is dug: long enough to see the still water first. */
const BREACH_DELAY = 1;

function cellSolidity(): Uint8Array {
  const solid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) solid[r * cols + c] = isSolid(bandLeft + c, bandTop + r) ? 1 : 0;
  return solid;
}

function loadScene(index: number): void {
  sceneIndex = (index + SCENES.length) % SCENES.length;
  dug.clear();
  built.clear();
  sloped.clear();
  const setup = SCENES[sceneIndex].setup();
  refreshRock();
  lava = setup.lava === true;
  if (terraria) {
    liquid = createTerrariaLiquid(cols, rows, cellSolidity(), lava ? LIQUID_LAVA : LIQUID_WATER);
    stepsPerSecond = TERRARIA_LIQUID_UPDATES_PER_SECOND;
  } else {
    const params = lava ? LAVA_PARAMS : WATER_PARAMS;
    liquid = createLiquid(cols, rows, cellSolidity(), params);
    stepsPerSecond = params.substepsPerSecond;
  }
  if (terraria) {
    // as the oracle starts a scene: the tiles filled, then every wet tile on the list, column by column
    const tiles = liquid as TerrariaLiquid;
    for (const [c0, r0, c1, r1] of setup.water) {
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++)
          if (!tiles.isSolid(r * cols + c)) tiles.level[r * cols + c] = 255;
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++)
        if (tiles.level[r * cols + c] > 0) tiles.addWater(r * cols + c);
    }
  } else {
    for (const [c0, r0, c1, r1] of setup.water) {
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) liquid.add(r * cols + c, UNIT);
    }
  }
  pendingBreach = setup.breach ?? [];
  breachAt = elapsed + BREACH_DELAY;
}

function dig(column: number, row: number, building: boolean): void {
  if (column < 0 || row < 0 || column >= cols || row >= rows) return;
  const cell = key(bandLeft + column, bandTop + row);
  const solidNow = isSolid(bandLeft + column, bandTop + row);
  if (building ? solidNow : !solidNow) return;
  sloped.delete(cell);
  if (building) built.add(cell);
  else {
    built.delete(cell);
    dug.add(cell);
  }
  refreshRockAround(column, row);
  liquid.setSolid(row * cols + column, building);
}

function breachNow(): void {
  for (const [c0, r0, c1, r1] of pendingBreach) {
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) dig(c, r, false);
  }
  pendingBreach = [];
}

// ---- input ---------------------------------------------------------------------------------------------------------

const pointer = { down: false, button: 0, shift: false, x: width / 2, y: height / 3 };
const toArt = (event: PointerEvent): { x: number; y: number } => {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * width,
    y: ((event.clientY - box.top) / box.height) * height,
  };
};
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  Object.assign(pointer, {
    down: true,
    button: event.button,
    shift: event.shiftKey,
    ...toArt(event),
  });
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => Object.assign(pointer, toArt(event)));
canvas.addEventListener('pointerup', () => (pointer.down = false));

const held = new Set<string>();
let paused = false;
let teal = false;
addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'KeyW') held.add(event.code);
  else if (event.code === 'KeyN') loadScene(sceneIndex + 1);
  else if (event.code === 'KeyR') loadScene(sceneIndex);
  else if (event.code === 'Space') paused = !paused;
  else if (event.code === 'KeyT') teal = !teal;
  else if (event.code === 'KeyL') lit = !lit;
  else if (event.code === 'KeyS') {
    terraria = !terraria;
    loadScene(sceneIndex);
  } else if (/^Digit[1-9]$/.test(event.code)) loadScene(Number(event.code.slice(5)) - 1);
  else return;
  event.preventDefault();
});
addEventListener('keyup', (event: KeyboardEvent) => held.delete(event.code));

function applyInput(dt: number): void {
  if (pointer.down && (pointer.button === 2 || pointer.shift)) {
    dig(
      Math.floor(pointer.x / T),
      Math.floor(pointer.y / T),
      pointer.shift && pointer.button === 0,
    );
  }
  if (held.has('KeyW')) {
    const column = Math.floor(pointer.x / T);
    const row = Math.floor(pointer.y / T);
    if (column >= 0 && row >= 0 && column < cols && row < rows)
      liquid.add(row * cols + column, Math.round(POUR_UNITS_PER_SECOND * dt));
  }
}

// ---- the loop ---------------------------------------------------------------------------------------------------------

let last = performance.now();
let owedSubsteps = 0;
let simMs = 0;
let drawMs = 0;

/** Set while the render gate runs: the lab stops drawing, so the gate's GPU timings are the GPU's. */
let gating = false;

function frame(now: number): void {
  if (gating) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(1 / 20, (now - last) / 1000);
  last = now;
  if (!paused) {
    elapsed += dt;
    if (pendingBreach.length > 0 && elapsed >= breachAt) breachNow();
    applyInput(dt);
    owedSubsteps += dt * stepsPerSecond;
    const substeps = Math.min(MAX_SUBSTEPS_PER_FRAME, Math.floor(owedSubsteps));
    owedSubsteps -= substeps;
    const simStart = performance.now();
    for (let k = 0; k < substeps; k++) liquid.step();
    simMs = performance.now() - simStart;
  }
  const drawStart = performance.now();
  image.data.set(rockPixels);
  const style = lava ? LAVA_STYLE : teal ? TEAL_WATER_STYLE : WATER_STYLE;
  const view = {
    cell: T,
    open,
    width,
    height,
    originX: bandLeft * T,
    originY: bandTop * T,
    time: elapsed,
    shapeAt: (column: number, row: number) => shapeOf(bandLeft + column, bandTop + row),
  };
  if (terraria) {
    if (!lava) drawTerrariaLiquid({ ...view, liquid: liquid as TerrariaLiquid }, image.data, style);
  } else
    drawLiquid(
      {
        liquid,
        cell: T,
        open,
        width,
        height,
        originX: bandLeft * T,
        originY: bandTop * T,
        time: elapsed,
        idle: lava ? LAVA_IDLE : 1,
      },
      image.data,
      style,
    );
  context.putImageData(image, 0, 0);
  if (lit) {
    lighting.addLight(
      bandLeft * T + pointer.x,
      bandTop * T + pointer.y,
      0,
      LAMP_COLOR,
      LAMP_INTENSITY,
    );
    if (terraria) {
      for (const light of liquidLights(liquid as TerrariaLiquid)) {
        const x = (bandLeft + light.column) * T + (T >> 1);
        const y = (bandTop + light.row) * T + (T >> 1);
        lighting.addLight(x, y, 0, LAVA_LIGHT, LAVA_INTENSITY);
      }
    }
    lighting.render({
      g: context,
      LW: width,
      LH: height,
      T,
      camX: bandLeft * T,
      camY: bandTop * T,
      surfaceAt: () => -1,
      solidTile: isSolid,
    });
  }
  if (terraria && lava) {
    lavaImage.data.fill(0);
    drawTerrariaLiquid({ ...view, liquid: liquid as TerrariaLiquid }, lavaImage.data, style);
    lavaContext.putImageData(lavaImage, 0, 0);
    context.drawImage(lavaCanvas, 0, 0);
  }
  drawMs = performance.now() - drawStart;
  hud.innerHTML =
    `<b>DELVE · liquid lab</b> — ${sceneIndex + 1}. ${SCENES[sceneIndex].name}: ${SCENES[sceneIndex].hint}\n` +
    `water ${(liquid.total() / UNIT).toFixed(2)} cells   sim ${simMs.toFixed(1)} ms   draw ${drawMs.toFixed(1)} ms\n` +
    `right-drag dig · shift-drag build · hold W pour · N scene · R reset · space pause · T ${teal ? '<b>teal</b>' : 'blue'} · L ${lit ? '<b>lit</b>' : 'unlit'} · S ${terraria ? '<b>terraria</b>' : 'pipes'}`;
  requestAnimationFrame(frame);
}

// ---- the render gate (#96) --------------------------------------------------------------------------------------

/** A gate view: a scene, run this many liquid updates (its breach dug at `breachAt`), drawn at `time`. */
interface GateView {
  scene: string;
  updates: number;
  breachAt?: number;
  time: number;
}

const GATE_VIEWS: GateView[] = [
  { scene: 'reservoir', updates: 0, time: 0.4 },
  { scene: 'partial breach', updates: 70, breachAt: 4, time: 1.7 },
  { scene: 'full breach', updates: 24, breachAt: 4, time: 0.2 },
  { scene: 'full breach', updates: 46, breachAt: 4, time: 2.9 },
  { scene: 'u-bend', updates: 36, time: 1.1 },
  { scene: 'three gaps', updates: 120, breachAt: 4, time: 2.3 },
  { scene: 'pool over a cave', updates: 90, breachAt: 4, time: 5.1 },
  { scene: 'slopes', updates: 30, time: 0.9 },
  { scene: 'lava breach', updates: 60, breachAt: 4, time: 3.3 },
  { scene: 'lava breach', updates: 200, breachAt: 4, time: 11.8 },
];
/** The bars, as the rock's render gate has them: few pixels past 3 levels, and nearly all identical. */
const GATE_MAX_OFF = 0.001;
const GATE_MIN_IDENTICAL = 0.999;
/**
 * Water is integer logic end to end but for one brightness threshold, and measures identical; its rarest
 * features (the shimmer, a gap filled inside a moving body) are a handful of pixels a frame, which the fractions
 * can't see. So a water view may differ in this many pixels at all.
 */
const GATE_WATER_MAX_DIFFERENT = 2;

/**
 * The liquid picture on the GPU against the TypeScript renderer: each view's scene is stepped to its update, then
 * drawn both ways and diffed. Sets `document.title` to PASS or FAIL (`pnpm render-gate` runs it).
 */
async function gate(): Promise<{ pass: boolean; failures: string[]; views: unknown[] }> {
  paused = true;
  terraria = true;
  gating = true;
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) throw new Error('liquid gate: no WebGPU');
  let gpuError: string | null = null;
  device.addEventListener('uncapturederror', (event) => {
    gpuError ??= (event as GPUUncapturedErrorEvent).error.message;
  });
  const gpu = createLiquidGpu(device);
  const failures: string[] = [];
  const views: unknown[] = [];
  for (const view of GATE_VIEWS) {
    loadScene(SCENES.findIndex((scene) => scene.name === view.scene));
    const breach = pendingBreach.splice(0);
    for (let update = 0; update < view.updates; update++) {
      if (update === view.breachAt) {
        pendingBreach = breach;
        breachNow();
      }
      liquid.step();
    }
    const tiles = liquid as TerrariaLiquid;
    const style = lava ? LAVA_STYLE : WATER_STYLE;
    const frame = {
      liquid: tiles,
      cell: T,
      open,
      width,
      height,
      originX: bandLeft * T,
      originY: bandTop * T,
      time: view.time,
      shapeAt: (column: number, row: number) => shapeOf(bandLeft + column, bandTop + row),
    };
    const scene = lava ? new Uint8ClampedArray(width * height * 4) : rockPixels.slice();
    const cpu = scene.slice();
    drawTerrariaLiquid(frame, cpu, style);
    const refreshStart = performance.now();
    gpu.refresh({
      plan: planLiquid(frame),
      open,
      width,
      height,
      cols,
      rows,
      cell: T,
      frame: animationFrame(view.time),
      lava,
    });
    await device.queue.onSubmittedWorkDone();
    const colourStart = performance.now();
    const refreshMs = colourStart - refreshStart;
    const gpuPixels = await gpu.colour({
      scene,
      originX: frame.originX,
      originY: frame.originY,
      time: view.time,
      style,
    });
    let identical = 0;
    let off = 0;
    let worst = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
      let difference = 0;
      for (let channel = 0; channel < 4; channel++) {
        const at = pixel * 4 + channel;
        difference = Math.max(difference, Math.abs(cpu[at] - gpuPixels[at]));
      }
      if (difference === 0) identical++;
      if (difference > 3) off++;
      worst = Math.max(worst, difference);
    }
    const count = width * height;
    const result = {
      view: `${view.scene} @${view.updates}`,
      identical: +((identical / count) * 100).toFixed(3),
      off: +((off / count) * 100).toFixed(3),
      worst,
      /** GPU milliseconds: a refresh (plan upload, kinds, heat), and a colour with its readback. */
      refreshMs: +refreshMs.toFixed(1),
      colourMs: +(performance.now() - colourStart).toFixed(1),
    };
    views.push(result);
    if (off / count > GATE_MAX_OFF) failures.push(`${result.view}: ${result.off}% past 3 levels`);
    if (!lava && count - identical > GATE_WATER_MAX_DIFFERENT) {
      failures.push(`${result.view}: ${count - identical} pixels differ`);
    }
    if (identical / count < GATE_MIN_IDENTICAL) {
      failures.push(`${result.view}: only ${result.identical}% identical`);
    }
  }
  if (gpuError) failures.push(`GPU error: ${gpuError}`);
  gating = false;
  const pass = failures.length === 0;
  document.title = pass ? 'PASS' : 'FAIL';
  return { pass, failures, views };
}

Object.assign(window, {
  liquidLab: {
    gate,
    scene: loadScene,
    digCell: (column: number, row: number) => dig(column, row, false),
    buildCell: (column: number, row: number) => dig(column, row, true),
    pour: (column: number, row: number, cells: number) =>
      liquid.add(row * cols + column, Math.round(cells * UNIT)),
    pause: (value: boolean) => (paused = value),
    teal: (value: boolean) => (teal = value),
    lit: (value: boolean) => (lit = value),
    terraria: (value: boolean) => {
      terraria = value;
      loadScene(sceneIndex);
    },
    /** Cells in a rectangle, for probes: [column, row, fill, down velocity, right velocity, solid]. */
    cells: (c0: number, r0: number, c1: number, r1: number) => {
      const out: (number | boolean)[][] = [];
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++) {
          const i = r * cols + c;
          out.push([
            c,
            r,
            +(liquid.volume[i] / UNIT).toFixed(3),
            +liquid.downVelocity[i].toFixed(1),
            +liquid.rightVelocity[i].toFixed(1),
            liquid.isSolid(i),
          ]);
        }
      return out;
    },
    stats: () => ({ cells: liquid.total() / UNIT, elapsed, simMs, drawMs, sceneIndex }),
    cols,
    rows,
    wall: wallColumn(),
  },
});

loadScene(Number(new URLSearchParams(location.search).get('scene') ?? 0));
requestAnimationFrame(frame);
