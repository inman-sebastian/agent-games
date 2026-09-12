// lighting.ts — the geometry-aware lighting system, shared by the game and the style lab so the
// two light identically. It knows nothing about game state: the caller creates an instance,
// pushes emitters via addLight(), then calls render(cfg) with the viewport + a solidTile()
// predicate.
//
// One independent system: every light source — the miner's lamp, glowing ore, anything later —
// is an emitter and obeys the SAME rules. Light is OCCLUDED BY ROCK: emitters seed a world-space
// per-tile colour field, propagated across the visible tile window (Terraria's technique) —
// open/dug tiles conduct light (OPEN_ATTEN per step), solid rock absorbs it fast (ROCK_ATTEN).
// So light pools down carved tunnels and dies a couple tiles into rock; the lit region takes the
// SHAPE of the dug space, not a circle. The field is compdd per tile then composited as a
// GPU-upscaled additive colour glow + a per-pixel DITHERED darkness scrim (pixel-art fog).
//
// Emitters: addLight(x, y, r, colour, intensity), positions in WORLD pixels (camX/camY window
// the field around the view, so the grid stays small in an unbounded world).
//   r === 0  → lamp field (warm, drives the darkness scrim / visibility).
//   r  >  0  → ore-glow field (its own colour, kept separate so the lamp can't swamp it).
import type { LightColor } from '@delve/shared';

const DITHER_STEPS = 10; // brightness quantisation levels for the darkness scrim + vignette
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4×4 ordered dither, matches the rock
const BAYER_LEVELS = 16; // 4×4 matrix range, to normalise a Bayer value to [0, 1)
const AMBIENT: LightColor = [0, 0, 0]; // no floor — lamp-only visibility: unlit space is the void
const SCRIM: LightColor = [6, 7, 14]; // colour (0-255) the darkness fades toward (deep, cool)
const ADD = 0.26; // how strongly the light field shows as additive glow
const ADD_MAX = 0.5; // ceiling on total additive per channel (lamp+ore) — no blown sunspot on overlap
const OPEN_ATTEN = 0.7; // per-step light conduction down an open tunnel
const ROCK_ATTEN = 0.68; // per-step conduction into solid rock — light bleeds a couple tiles into the
// undug walls around a tunnel (a subtle Terraria-style lit-wall look), not just a thin rim
const DIAGONAL_ATTEN = 0.9; // extra factor on diagonal propagation steps
const LMARGIN = 2; // extra tile rows/cols around the view for clean edges
const ORE_GLOW = 1.6; // ore-glow seed strength (r>0 emitters flood their colour into open space)
const GLOW_CAP = 0.42; // per-channel ceiling on ore glow (safety on top of max-propagation)
const MAX_DARKNESS = 1; // lamp-only visibility: a fully-unlit pixel fades all the way to the void
// Faint-light floor: lamp brightness below this reads as full dark; above it, remaps 0→1. So distant,
// barely-lit tiles stay uniformly dark (no muddy ore-colour blobs leaking through the fog) while tiles
// the lamp reaches meaningfully still read — the "hint of neighbouring tiles" near dug/lit areas.
const LIGHT_FLOOR = 0.08;
const VIGNETTE_INNER = 0.34; // vignette starts this fraction of the half-height from center
const VIGNETTE_SPAN = 0.48; // and reaches full over this fraction of the half-height
const VIGNETTE_MAX = 0.5; // max vignette darkness at the corners

export const LAMP_COLOR: LightColor = [1.0, 0.72, 0.42]; // warm lantern

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
  SURFACE?: number;
  solidTile: (column: number, row: number) => boolean;
  /** true (default): cap RGB together (keep hue); false: clamp per channel (washes to white). */
  hueCap?: boolean;
  /** false: skip the darkness scrim (the fog/void) but keep the lamp glow — a debug view. */
  scrim?: boolean;
}

export interface LightingInstance {
  addLight(x: number, y: number, r: number, color: LightColor, intensity: number): void;
  render(cfg: LightingConfig): void;
  readonly count: number;
}

export function create(): LightingInstance {
  let emitters: Emitter[] = [];
  let lightCount = 0;
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
  let bright!: Float32Array; // per-tile scalar brightness → the dithered scrim
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

  function render(cfg: LightingConfig): void {
    const g = cfg.g;
    const { LW, LH, T } = cfg;
    const camX = cfg.camX ?? 0;
    const camY = cfg.camY ?? 0;
    const surface = cfg.SURFACE ?? -1;
    const solidTile = cfg.solidTile;
    const hueCap = cfg.hueCap !== false;

    ensureVignette(LW, LH);
    if (screenW !== LW || screenH !== LH) {
      screenW = LW;
      screenH = LH;
      scrimCanvas.width = LW;
      scrimCanvas.height = LH;
      scrimCtx.imageSmoothingEnabled = false;
      scrimImg = scrimCtx.createImageData(LW, LH);
      colIndex = new Int32Array(LW);
      colWeight = new Float32Array(LW);
      colWeightInv = new Float32Array(LW);
    }

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
    }
    lampR.fill(0);
    lampG.fill(0);
    lampB.fill(0);
    oreR.fill(0);
    oreG.fill(0);
    oreB.fill(0);

    // seed: lamp (r=0) → lamp field; ore (r>0) → ore-glow field, at their own tile
    for (const light of emitters) {
      const column = Math.floor(light.x / T) - tileLeft;
      const row = Math.floor(light.y / T) - tileTop;
      if (column < 0 || column >= gridW || row < 0 || row >= gridH) continue;
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
    for (let y = 0; y < gridH; y++)
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // TL→BR
        if (x > 0) relax(i, i - 1, a);
        if (y > 0) relax(i, i - gridW, a);
        if (x > 0 && y > 0) relax(i, i - gridW - 1, diag);
      }
    for (let y = 0; y < gridH; y++)
      for (let x = gridW - 1; x >= 0; x--) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // TR→BL
        if (x < gridW - 1) relax(i, i + 1, a);
        if (y > 0) relax(i, i - gridW, a);
        if (x < gridW - 1 && y > 0) relax(i, i - gridW + 1, diag);
      }
    for (let y = gridH - 1; y >= 0; y--)
      for (let x = gridW - 1; x >= 0; x--) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // BR→TL
        if (x < gridW - 1) relax(i, i + 1, a);
        if (y < gridH - 1) relax(i, i + gridW, a);
        if (x < gridW - 1 && y < gridH - 1) relax(i, i + gridW + 1, diag);
      }
    for (let y = gridH - 1; y >= 0; y--)
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x,
          a = attenAt(x, y),
          diag = a * DIAGONAL_ATTEN; // BL→TR
        if (x > 0) relax(i, i - 1, a);
        if (y < gridH - 1) relax(i, i + gridW, a);
        if (x > 0 && y < gridH - 1) relax(i, i + gridW - 1, diag);
      }

    // ---- build the tile-res buffers (compute per tile, upscale on the GPU) ----
    // glow = additive colour (warm lamp + ore hue), GPU-interpolated on upscale — the expensive
    // per-pixel bilinear moves off the CPU. bright = a scalar the per-pixel scrim reads (1 channel)
    // so the dithered pixel-art fog is preserved cheaply.
    const glow = glowImg.data;
    for (let i = 0, n = gridW * gridH; i < n; i++) {
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
    }
    glowCtx.putImageData(glowImg, 0, 0);

    // ---- scrim: per-pixel dithered darkness from the 1-channel brightness field ----
    const scrim = scrimImg.data;
    const skyY = (surface + 1) * T;
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
      const fy = (y + camY) / T - tileTop - 0.5; // tile-space (values live at tile centres)
      let gy = fy | 0;
      if (gy < 0) gy = 0;
      else if (gy > gridH - 2) gy = gridH - 2;
      const ty = fy - gy < 0 ? 0 : fy - gy > 1 ? 1 : fy - gy;
      const ty1 = 1 - ty;
      const rowTop = gy * gridW;
      const rowBottom = rowTop + gridW;
      const rowByteBase = y * LW * 4;
      const aboveSky = y + camY <= skyY;
      for (let x = 0; x < LW; x++) {
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

  return {
    addLight,
    render,
    get count() {
      return lightCount;
    },
  };
}
