// lighting.ts — the geometry-aware lighting system, shared by the game and the style lab so the
// two light identically. It knows nothing about game state: the caller creates an instance,
// pushes emitters via addLight(), then calls render(cfg) with the viewport + a solidTile()
// predicate.
//
// One independent system: every light source — the miner's lamp, glowing ore, anything later —
// is an emitter and obeys the SAME rules. Light is OCCLUDED BY ROCK: emitters seed a world-space
// per-tile colour field, propagated across the visible tile window (Terraria's technique) —
// open/dug cells conduct light (OPEN_ATTEN per step), solid rock absorbs it fast (ROCK_ATTEN) —
// both authored per BLOCK and rooted to the per-cell step, so the reach is a world distance.
// So light pools down carved tunnels and dies a couple tiles into rock; the lit region takes the
// SHAPE of the dug space, not a circle. The field is compdd per tile then composited as a
// GPU-upscaled additive colour glow + a per-pixel DITHERED darkness scrim (pixel-art fog).
//
// Emitters: addLight(x, y, r, colour, intensity), positions in WORLD pixels (camX/camY window
// the field around the view, so the grid stays small in an unbounded world).
//   r === 0  → lamp field (warm, drives the darkness scrim / visibility).
//   r  >  0  → ore-glow field (its own colour, kept separate so the lamp can't swamp it).
import { SUB } from '@delve/shared';
import type { LightColor } from '@delve/shared';

export const DITHER_STEPS = 10; // brightness quantisation levels for the darkness scrim + vignette
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4×4 ordered dither, matches the rock
const BAYER_LEVELS = 16; // 4×4 matrix range, to normalise a Bayer value to [0, 1)
const AMBIENT: LightColor = [0, 0, 0]; // no floor — lamp-only visibility: unlit space is the void
export const SCRIM: LightColor = [6, 7, 14]; // colour (0-255) the darkness fades toward (deep, cool)
const ADD = 0.26; // how strongly the light field shows as additive glow
const ADD_MAX = 0.5; // ceiling on total additive per channel (lamp+ore) — no blown sunspot on overlap
// Conduction is authored PER BLOCK and converted to the per-cell step the sweeps actually take.
// These were tuned when one step was one block; the 2x2 split (#44) made a step half a block, which
// silently halved the distance light travels — the lamp lit only the cells nearest the miner and a
// carved tunnel went dark a block or two out. Taking the SUB-th root makes SUB cell-steps decay
// exactly as one block-step used to, so the reach is restored rather than re-tuned by eye.
const perCell = (perBlock: number): number => perBlock ** (1 / SUB);
const OPEN_ATTEN = perCell(0.7); // light conduction down an open tunnel, per block
const ROCK_ATTEN = perCell(0.68); // conduction into solid rock — light bleeds a couple of BLOCKS into
// the undug walls around a tunnel (a subtle Terraria-style lit-wall look), not just a thin rim
const DIAGONAL_ATTEN = perCell(0.9); // extra factor on diagonal propagation steps
const LMARGIN = 2; // extra tile rows/cols around the view for clean edges
const ORE_GLOW = 1.6; // ore-glow seed strength (r>0 emitters flood their colour into open space)
const GLOW_CAP = 0.42; // per-channel ceiling on ore glow (safety on top of max-propagation)
export const MAX_DARKNESS = 1; // lamp-only visibility: a fully-unlit pixel fades all the way to the void
// Faint-light floor: lamp brightness below this reads as full dark; above it, remaps 0→1. So distant,
// barely-lit tiles stay uniformly dark (no muddy ore-colour blobs leaking through the fog) while tiles
// the lamp reaches meaningfully still read — the "hint of neighbouring tiles" near dug/lit areas.
export const LIGHT_FLOOR = 0.08;
// The value at which propagation is cut off — a quarter of LIGHT_FLOOR, so the cut lands well
// inside the range the scrim already crushes to black and can't show as an edge in the glow.
const PROPAGATION_EPS = LIGHT_FLOOR / 4;
export const VIGNETTE_INNER = 0.34; // vignette starts this fraction of the half-height from center
export const VIGNETTE_SPAN = 0.48; // and reaches full over this fraction of the half-height
export const VIGNETTE_MAX = 0.5; // max vignette darkness at the corners

export const LAMP_COLOR: LightColor = [1.0, 0.72, 0.42]; // warm lantern

/**
 * How far, in BLOCKS, a seed of `intensity` carries down an open tunnel before the scrim crushes it
 * to black. Exported to be asserted: the reach is a WORLD distance, and it has to stay one across a
 * change to the grid. Both times this system broke it was a length left in the old units after the
 * 2x2 split (#44) — first the lamp stat, then the per-step attenuation — and each time the symptom
 * was light hugging the miner while a carved tunnel went dark, which no test could see.
 */
export function lampReachBlocks(intensity: number): number {
  if (intensity <= LIGHT_FLOOR) return 0;
  return Math.log(LIGHT_FLOOR / intensity) / Math.log(OPEN_ATTEN) / SUB;
}

interface Emitter {
  x: number;
  y: number;
  r: number;
  cr: number;
  cg: number;
  cb: number;
  i: number;
}

export interface LightingConfig {
  g: CanvasRenderingContext2D;
  LW: number;
  LH: number;
  T: number;
  camX?: number;
  camY?: number;
  /**
   * The surface row at a column. A FUNCTION, because the surface is a heightmap (#44) — the sky
   * boundary follows the terrain rather than cutting straight across the screen.
   */
  surfaceAt?: (column: number) => number;
  solidTile: (column: number, row: number) => boolean;
  /** true (default): cap RGB together (keep hue); false: clamp per channel (washes to white). */
  hueCap?: boolean;
  /** false: skip the darkness scrim (the fog/void) but keep the lamp glow — a debug view. */
  scrim?: boolean;
}

/** What the field needs: the view and the world's solidity, but no canvas to draw into. */
export type LightFieldConfig = Omit<LightingConfig, 'g' | 'scrim'>;

/** The per-cell light field for one view, windowed around it. Valid until the next `field`/`render`. */
export interface LightField {
  /** World cell of the grid's top-left, and its size in cells. */
  tileLeft: number;
  tileTop: number;
  gridW: number;
  gridH: number;
  /** Additive glow per cell, RGBA bytes (alpha 255), sampled bilinearly between cell centres. */
  glow: Uint8ClampedArray<ArrayBuffer>;
  /** Scalar light per cell, 0..1, the darkness scrim reads. */
  bright: Float32Array<ArrayBuffer>;
}

interface LitBox {
  tileLeft: number;
  tileTop: number;
  litX0: number;
  litX1: number;
  litY0: number;
  litY1: number;
}

export interface LightingInstance {
  addLight(x: number, y: number, r: number, color: LightColor, intensity: number): void;
  render(cfg: LightingConfig): void;
  /** Build only the field and hand it back, consuming the emitters — for a renderer that composites it
   *  itself (the WebGPU spike, #69). */
  field(cfg: LightFieldConfig): LightField;
  readonly count: number;
  /** Last frame's cost split: the per-CELL propagation field vs the per-PIXEL darkness scrim. */
  readonly fieldMs: number;
  readonly scrimMs: number;
}

export function create(): LightingInstance {
  let emitters: Emitter[] = [];
  let lightCount = 0;
  let scrim32: Uint32Array = new Uint32Array(0);
  let voidWord = 0;
  let clearWord = 0;
  let glow32: Uint32Array = new Uint32Array(0);
  let glowDarkWord = 0;
  let fieldMs = 0;
  let scrimMs = 0;
  const addLight = (
    x: number,
    y: number,
    r: number,
    color: LightColor,
    intensity: number,
  ): void => {
    emitters.push({ x, y, r, cr: color[0], cg: color[1], cb: color[2], i: intensity });
  };

  const glowCanvas = document.createElement('canvas'); // small tile-res additive glow, GPU-upscaled
  const glowCtx = glowCanvas.getContext('2d')!;
  const scrimCanvas = document.createElement('canvas');
  const scrimCtx = scrimCanvas.getContext('2d')!;
  const vigCanvas = document.createElement('canvas');
  const vigCtx = vigCanvas.getContext('2d')!;

  let glowImg!: ImageData;
  let scrimImg!: ImageData;
  let screenW = 0;
  let screenH = 0;
  let vigW = 0;
  let vigH = 0;
  // per-x scrim bilinear setup, precomputed once per frame
  let colIndex!: Int32Array;
  let colWeight!: Float32Array;
  let colWeightInv!: Float32Array;
  // per-tile fields
  let lampR!: Float32Array;
  let lampG!: Float32Array;
  let lampB!: Float32Array;
  let oreR!: Float32Array;
  let oreG!: Float32Array;
  let oreB!: Float32Array;
  let bright!: Float32Array<ArrayBuffer>; // per-tile scalar brightness → the dithered scrim
  let gridW = 0;
  let gridH = 0;

  // shared vignette — dithered, screen-space, unchanging → build once per size, blit each frame
  function ensureVignette(width: number, height: number): void {
    if (vigW === width && vigH === height) return;
    vigW = width;
    vigH = height;
    vigCanvas.width = width;
    vigCanvas.height = height;
    vigCtx.imageSmoothingEnabled = false;
    const image = vigCtx.createImageData(width, height);
    const data = image.data;
    const centerX = width / 2;
    const centerY = height / 2;
    const innerRadius = height * VIGNETTE_INNER;
    const span = height * VIGNETTE_SPAN;
    for (let y = 0; y < height; y++) {
      const dy = y - centerY;
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const dither = (BAYER[(x & 3) | ((y & 3) << 2)] + 0.5) / BAYER_LEVELS;
        let t = (distance - innerRadius) / span;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        let strength = t * t * (3 - 2 * t) * VIGNETTE_MAX; // smoothstep
        const scaled = strength * DITHER_STEPS;
        const level = scaled | 0;
        strength = (level + (scaled - level > dither ? 1 : 0)) / DITHER_STEPS;
        const i = (y * width + x) * 4;
        data[i] = SCRIM[0];
        data[i + 1] = SCRIM[1];
        data[i + 2] = SCRIM[2];
        data[i + 3] = strength * 255;
      }
    }
    vigCtx.putImageData(image, 0, 0);
  }

  /**
   * The per-CELL light field for a view: seed every emitter, propagate through open space and rock, and
   * build the tile-resolution glow (RGBA bytes) and scalar brightness the per-pixel passes read.
   *
   * Split out of `render` so the Canvas 2D scrim and the WebGPU composite (#69) read ONE field — the
   * propagation is a rule about how light moves, and a second copy of it would drift.
   */
  function buildField(cfg: LightFieldConfig): LitBox {
    const tStart = performance.now();
    const { LW, LH, T } = cfg;
    const camX = cfg.camX ?? 0;
    const camY = cfg.camY ?? 0;
    const solidTile = cfg.solidTile;
    const hueCap = cfg.hueCap !== false;

    // ---- world-space per-tile light fields (windowed around the view) ----
    const tileLeft = Math.floor(camX / T) - LMARGIN;
    const tileTop = Math.floor(camY / T) - LMARGIN;
    const cols = Math.ceil(LW / T) + 2 * LMARGIN;
    const rows = Math.ceil(LH / T) + 2 * LMARGIN;
    if (cols !== gridW || rows !== gridH) {
      gridW = cols;
      gridH = rows;
      const size = gridW * gridH;
      lampR = new Float32Array(size);
      lampG = new Float32Array(size);
      lampB = new Float32Array(size);
      oreR = new Float32Array(size);
      oreG = new Float32Array(size);
      oreB = new Float32Array(size);
      bright = new Float32Array(size);
      glowCanvas.width = gridW;
      glowCanvas.height = gridH;
      glowCtx.imageSmoothingEnabled = false;
      glowImg = glowCtx.createImageData(gridW, gridH);
      glow32 = new Uint32Array(glowImg.data.buffer);
      glowImg.data[0] = 0;
      glowImg.data[1] = 0;
      glowImg.data[2] = 0;
      glowImg.data[3] = 255;
      glowDarkWord = glow32[0];
    }
    lampR.fill(0);
    lampG.fill(0);
    lampB.fill(0);
    oreR.fill(0);
    oreG.fill(0);
    oreB.fill(0);

    // seed: lamp (r=0) → lamp field; ore (r>0) → ore-glow field, at their own tile
    let seedX0 = gridW;
    let seedX1 = -1;
    let seedY0 = gridH;
    let seedY1 = -1;
    let strongestSeed = 0;
    for (const light of emitters) {
      const column = Math.floor(light.x / T) - tileLeft;
      const row = Math.floor(light.y / T) - tileTop;
      if (column < 0 || column >= gridW || row < 0 || row >= gridH) continue;
      if (column < seedX0) seedX0 = column;
      if (column > seedX1) seedX1 = column;
      if (row < seedY0) seedY0 = row;
      if (row > seedY1) seedY1 = row;
      const channelPeak =
        light.i * (light.r > 0 ? ORE_GLOW : 1) * Math.max(light.cr, light.cg, light.cb);
      if (channelPeak > strongestSeed) strongestSeed = channelPeak;
      const index = row * gridW + column;
      if (light.r > 0) {
        oreR[index] += light.cr * light.i * ORE_GLOW;
        oreG[index] += light.cg * light.i * ORE_GLOW;
        oreB[index] += light.cb * light.i * ORE_GLOW;
      } else {
        lampR[index] += light.cr * light.i;
        lampG[index] += light.cg * light.i;
        lampB[index] += light.cb * light.i;
      }
    }

    // Sweep only the cells light can actually reach. Each step multiplies by at most OPEN_ATTEN, so
    // after n steps the strongest seed is down to seed * OPEN_ATTEN^n — solve for the n at which
    // that falls under PROPAGATION_EPS and everything beyond is provably invisible (the scrim
    // crushes anything under LIGHT_FLOOR to black, and EPS is well under it, so the additive glow
    // can't show a step at the boundary either). The cells outside stay at the 0 they were filled
    // with, which is what the propagation would have produced anyway. This is the whole reason the
    // field is affordable at cell granularity after the 2x2 split (#44) quadrupled the grid: the
    // work now tracks the lamp's reach instead of the size of the screen.
    const reach =
      strongestSeed <= PROPAGATION_EPS
        ? 0
        : Math.ceil(Math.log(PROPAGATION_EPS / strongestSeed) / Math.log(OPEN_ATTEN));
    const sweepX0 = Math.max(0, seedX0 - reach);
    const sweepX1 = Math.min(gridW - 1, seedX1 + reach);
    const sweepY0 = Math.max(0, seedY0 - reach);
    const sweepY1 = Math.min(gridH - 1, seedY1 + reach);

    // propagate — 4 corner sweeps, max-with-attenuation (attenuation = the DESTINATION tile's
    // opacity, so light dims hard the moment it enters rock). One round converges because each
    // sweep chains through already-updated neighbours in its direction.
    const attenAt = (x: number, gy: number): number =>
      solidTile(x + tileLeft, gy + tileTop) ? ROCK_ATTEN : OPEN_ATTEN;
    const relax = (into: number, from: number, atten: number): void => {
      let v = lampR[from] * atten;
      if (v > lampR[into]) lampR[into] = v;
      v = lampG[from] * atten;
      if (v > lampG[into]) lampG[into] = v;
      v = lampB[from] * atten;
      if (v > lampB[into]) lampB[into] = v;
      v = oreR[from] * atten;
      if (v > oreR[into]) oreR[into] = v;
      v = oreG[from] * atten;
      if (v > oreG[into]) oreG[into] = v;
      v = oreB[from] * atten;
      if (v > oreB[into]) oreB[into] = v;
    };
    for (let y = sweepY0; y <= sweepY1; y++)
      for (let x = sweepX0; x <= sweepX1; x++) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // TL→BR
        if (x > sweepX0) relax(i, i - 1, a);
        if (y > sweepY0) relax(i, i - gridW, a);
        if (x > sweepX0 && y > sweepY0) relax(i, i - gridW - 1, diag);
      }
    for (let y = sweepY0; y <= sweepY1; y++)
      for (let x = sweepX1; x >= sweepX0; x--) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // TR→BL
        if (x < sweepX1) relax(i, i + 1, a);
        if (y > sweepY0) relax(i, i - gridW, a);
        if (x < sweepX1 && y > sweepY0) relax(i, i - gridW + 1, diag);
      }
    for (let y = sweepY1; y >= sweepY0; y--)
      for (let x = sweepX1; x >= sweepX0; x--) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // BR→TL
        if (x < sweepX1) relax(i, i + 1, a);
        if (y < sweepY1) relax(i, i + gridW, a);
        if (x < sweepX1 && y < sweepY1) relax(i, i + gridW + 1, diag);
      }
    for (let y = sweepY1; y >= sweepY0; y--)
      for (let x = sweepX0; x <= sweepX1; x++) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // BL→TR
        if (x > sweepX0) relax(i, i - 1, a);
        if (y < sweepY1) relax(i, i + gridW, a);
        if (x > sweepX0 && y < sweepY1) relax(i, i + gridW - 1, diag);
      }

    fieldMs = performance.now() - tStart;

    // ---- build the tile-res buffers (compute per tile, upscale on the GPU) ----
    // glow = additive colour (warm lamp + ore hue), GPU-interpolated on upscale — the expensive
    // per-pixel bilinear moves off the CPU. bright = a scalar the per-pixel scrim reads (1 channel)
    // so the dithered pixel-art fog is preserved cheaply.
    const glow = glowImg.data;
    // Bounding box of cells that carry ANY light. The lamp reaches a handful of cells, so on a big
    // screen the overwhelming majority of the field is exactly zero — and a zero-light pixel has
    // one answer (see voidWord). Tracked here because this loop already visits every cell.
    let litX0 = gridW;
    let litX1 = -1;
    let litY0 = gridH;
    let litY1 = -1;
    glow32.fill(glowDarkWord); // unlit texels: opaque black, contributing nothing to 'lighter'
    bright.fill(0);
    for (let by = sweepY0; by <= sweepY1; by++)
      for (let bx = sweepX0, i = by * gridW + sweepX0; bx <= sweepX1; bx++, i++) {
        const lr = lampR[i] + AMBIENT[0];
        const lg = lampG[i] + AMBIENT[1];
        const lb = lampB[i] + AMBIENT[2];
        let cr = oreR[i];
        if (cr > GLOW_CAP) cr = GLOW_CAP;
        let cg = oreG[i];
        if (cg > GLOW_CAP) cg = GLOW_CAP;
        let cb = oreB[i];
        if (cb > GLOW_CAP) cb = GLOW_CAP;
        // cap the additive so many/overlapping lights can't blow past ADD_MAX. hueCap scales RGB
        // together by the brightest channel (keeps the colour); else clamp per channel (washes white).
        let sr = lr * ADD + cr;
        let sg = lg * ADD + cg;
        let sb = lb * ADD + cb;
        if (hueCap) {
          const maxChannel = sr > sg ? (sr > sb ? sr : sb) : sg > sb ? sg : sb;
          if (maxChannel > ADD_MAX) {
            const scale = ADD_MAX / maxChannel;
            sr *= scale;
            sg *= scale;
            sb *= scale;
          }
        } else {
          if (sr > ADD_MAX) sr = ADD_MAX;
          if (sg > ADD_MAX) sg = ADD_MAX;
          if (sb > ADD_MAX) sb = ADD_MAX;
        }
        const j = i * 4;
        glow[j] = sr * 255;
        glow[j + 1] = sg * 255;
        glow[j + 2] = sb * 255;
        glow[j + 3] = 255;
        let b = lr > lg ? (lr > lb ? lr : lb) : lg > lb ? lg : lb;
        if (cr > b) b = cr;
        if (cg > b) b = cg;
        if (cb > b) b = cb;
        if (b > 1) b = 1;
        bright[i] = b;
        // LIGHT_FLOOR, not zero: attenuation is multiplicative, so `bright` stays a hair above zero
        // for a hundred cells out and a `> 0` test would call the whole screen lit. The scrim crushes
        // anything at or under the floor to black, and bilinear interpolation of values under the
        // floor stays under it, so this is the true boundary of "could look like anything but void".
        if (b > LIGHT_FLOOR) {
          const x = i % gridW;
          const y = (i - x) / gridW;
          if (x < litX0) litX0 = x;
          if (x > litX1) litX1 = x;
          if (y < litY0) litY0 = y;
          if (y > litY1) litY1 = y;
        }
      }
    glowCtx.putImageData(glowImg, 0, 0);
    return { tileLeft, tileTop, litX0, litX1, litY0, litY1 };
  }

  function render(cfg: LightingConfig): void {
    const g = cfg.g;
    const { LW, LH, T } = cfg;
    const camX = cfg.camX ?? 0;
    const camY = cfg.camY ?? 0;
    const surfaceAt = cfg.surfaceAt ?? ((): number => -1);

    ensureVignette(LW, LH);
    if (screenW !== LW || screenH !== LH) {
      screenW = LW;
      screenH = LH;
      scrimCanvas.width = LW;
      scrimCanvas.height = LH;
      scrimCtx.imageSmoothingEnabled = false;
      scrimImg = scrimCtx.createImageData(LW, LH);
      scrim32 = new Uint32Array(scrimImg.data.buffer);
      // The word an unreachable pixel resolves to. Derived by writing the bytes rather than
      // packing them by hand, so it stays correct on a big-endian machine.
      scrimImg.data[0] = SCRIM[0];
      scrimImg.data[1] = SCRIM[1];
      scrimImg.data[2] = SCRIM[2];
      scrimImg.data[3] = MAX_DARKNESS * 255;
      voidWord = scrim32[0];
      scrimImg.data[3] = 0;
      clearWord = scrim32[0];
      colIndex = new Int32Array(LW);
      colWeight = new Float32Array(LW);
      colWeightInv = new Float32Array(LW);
    }

    const { tileLeft, tileTop, litX0, litX1, litY0, litY1 } = buildField(cfg);
    const tField = performance.now();

    // ---- scrim: per-pixel dithered darkness from the 1-channel brightness field ----
    const scrim = scrimImg.data;
    // Sky boundary PER SCREEN COLUMN, precomputed once per frame. It used to be one number, which
    // was fine when the surface was a constant row; with a heightmap (#44) the boundary follows the
    // terrain, and recomputing it inside the pixel loop would call the noise field a million times.
    const skyY = new Float32Array(LW);
    let deepestSky = -Infinity;
    let shallowestSky = Infinity;
    for (let x = 0; x < LW; x++) {
      const sky = (surfaceAt(Math.floor((x + camX) / T)) + 1) * T;
      skyY[x] = sky;
      if (sky > deepestSky) deepestSky = sky;
      if (sky < shallowestSky) shallowestSky = sky;
    }

    // Start every pixel at full, undithered darkness: that is EXACTLY what the loop below computes
    // wherever no light reaches (b = 0 → darkness = 1 → scaled = DITHER_STEPS, so the dither term
    // drops out and the result is x/y-independent). A typed-array fill is memset-speed, which
    // leaves the real per-pixel work to run only where the answer can actually differ — inside the
    // lit box, and in the sky band. On a 1280x960 screen with a lamp reaching a few cells that is a
    // few percent of the pixels instead of all 1.23 million of them.
    scrim32.fill(voidWord);
    // Grid cell gx holds its centre at fx = gx + 0.5, so the pixel of that centre is
    // (gx + 0.5 + tileLeft) * T - camX. Widened a cell each way to cover bilinear reach.
    const pixelOfCol = (gx: number): number => (gx + 0.5 + tileLeft) * T - camX;
    const pixelOfRow = (gy: number): number => (gy + 0.5 + tileTop) * T - camY;
    const litPixelX0 = litX1 < 0 ? 0 : Math.max(0, Math.floor(pixelOfCol(litX0 - 1)));
    const litPixelX1 = litX1 < 0 ? -1 : Math.min(LW - 1, Math.ceil(pixelOfCol(litX1 + 1)));
    const litPixelY0 = litY1 < 0 ? 0 : Math.max(0, Math.floor(pixelOfRow(litY0 - 1)));
    const litPixelY1 = litY1 < 0 ? -1 : Math.min(LH - 1, Math.ceil(pixelOfRow(litY1 + 1)));
    // Open sky is the OTHER constant: above the boundary the scrim clears to nothing whatever the
    // light does. So only the band between the shallowest and the deepest column boundary — the
    // height of the terrain itself — actually varies across a row.
    const skyRowsEnd = Math.min(LH, Math.ceil(shallowestSky - camY));
    const terrainRowsEnd = Math.min(LH, Math.ceil(deepestSky - camY) + 1);
    for (let y = 0; y < skyRowsEnd; y++) scrim32.fill(clearWord, y * LW, y * LW + LW);
    for (let x = 0; x < LW; x++) {
      const fx = (x + camX) / T - tileLeft - 0.5;
      let gx = fx | 0;
      if (gx < 0) gx = 0;
      else if (gx > gridW - 2) gx = gridW - 2;
      const tx = fx - gx < 0 ? 0 : fx - gx > 1 ? 1 : fx - gx;
      colIndex[x] = gx;
      colWeight[x] = tx;
      colWeightInv[x] = 1 - tx;
    }
    for (let y = 0; y < LH; y++) {
      const inTerrain = y >= skyRowsEnd && y < terrainRowsEnd;
      const inLit = y >= litPixelY0 && y <= litPixelY1;
      if (!inTerrain && !inLit) continue; // already exactly right from the fills above
      // a row crossing the terrain boundary varies across the whole width; a merely-lit row below
      // it only differs inside the lamp's box.
      const xStart = inTerrain ? 0 : litPixelX0;
      const xEnd = inTerrain ? LW - 1 : litPixelX1;
      const fy = (y + camY) / T - tileTop - 0.5; // tile-space (values live at tile centres)
      let gy = fy | 0;
      if (gy < 0) gy = 0;
      else if (gy > gridH - 2) gy = gridH - 2;
      const ty = fy - gy < 0 ? 0 : fy - gy > 1 ? 1 : fy - gy;
      const ty1 = 1 - ty;
      const rowTop = gy * gridW;
      const rowBottom = rowTop + gridW;
      const rowByteBase = y * LW * 4;
      for (let x = xStart; x <= xEnd; x++) {
        const aboveSky = y + camY <= skyY[x];
        const gx = colIndex[x];
        const tx = colWeight[x];
        const tx1 = colWeightInv[x];
        let b =
          (bright[rowTop + gx] * tx1 + bright[rowTop + gx + 1] * tx) * ty1 +
          (bright[rowBottom + gx] * tx1 + bright[rowBottom + gx + 1] * tx) * ty;
        if (b > 1) b = 1;
        // crush faint light to black (so distant barely-lit tiles read as uniform void), remapping
        // the rest 0→1 so meaningfully-lit tiles still read — see LIGHT_FLOOR.
        b = b <= LIGHT_FLOOR ? 0 : (b - LIGHT_FLOOR) / (1 - LIGHT_FLOOR);
        const dither = (BAYER[(x & 3) | ((y & 3) << 2)] + 0.5) / BAYER_LEVELS;
        let darkness = aboveSky ? 0 : (1 - b) * MAX_DARKNESS;
        const scaled = darkness * DITHER_STEPS;
        const level = scaled | 0;
        darkness = (level + (scaled - level > dither ? 1 : 0)) / DITHER_STEPS;
        const j = rowByteBase + x * 4;
        scrim[j] = SCRIM[0];
        scrim[j + 1] = SCRIM[1];
        scrim[j + 2] = SCRIM[2];
        scrim[j + 3] = darkness * 255;
      }
    }
    scrimCtx.putImageData(scrimImg, 0, 0);
    scrimMs = performance.now() - tField;

    // ---- composite: GPU-upscaled additive glow (smooth) + dithered scrim + vignette ----
    // The small glow texel gx holds tile (tileLeft+gx)'s centre value; drawing it scaled by T at
    // (tileLeft*T - camX) lands each texel centre on its tile centre, so the GPU's bilinear
    // matches the scrim's sampling convention.
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.imageSmoothingEnabled = true;
    g.drawImage(
      glowCanvas,
      0,
      0,
      gridW,
      gridH,
      tileLeft * T - camX,
      tileTop * T - camY,
      gridW * T,
      gridH * T,
    );
    g.restore(); // reverts composite op + smoothing (back to nearest)
    if (cfg.scrim !== false) g.drawImage(scrimCanvas, 0, 0); // dithered darkness (fog / void)
    g.drawImage(vigCanvas, 0, 0); // shared vignette frame

    lightCount = emitters.length;
    emitters.length = 0; // reset for next frame
  }

  function field(cfg: LightFieldConfig): LightField {
    const { tileLeft, tileTop } = buildField(cfg);
    scrimMs = 0; // the per-pixel scrim is the caller's now; don't leave a stale figure in the debug panel
    lightCount = emitters.length;
    emitters.length = 0;
    return { tileLeft, tileTop, gridW, gridH, glow: glowImg.data, bright };
  }

  return {
    addLight,
    render,
    field,
    get count() {
      return lightCount;
    },
    /** Last frame's split between the per-CELL propagation field and the per-PIXEL scrim. The 2x2
     *  split (#44) quadrupled the first and left the second alone, so the two have to be read
     *  separately to know which one to attack. */
    get fieldMs() {
      return fieldMs;
    },
    get scrimMs() {
      return scrimMs;
    },
  };
}
