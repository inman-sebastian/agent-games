// light-lab.ts — a sandbox for the real lighting system with many coloured emitters, to see how
// they blend (additive per-channel, max-propagated flood-fill) and how the additive cap reads.
// Keys: [H] hue-preserving vs per-channel cap · [Space] pause · [O] occluders. Pure dev tool.
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { STRATA } from '@delve/shared';
import { create as createLighting } from '../src/render/lighting';
import type { LightColor } from '@delve/shared';

setStrata(STRATA); // hand strata to the rock renderer
const cv = document.getElementById('c') as HTMLCanvasElement;
const g = cv.getContext('2d')!;
const lighting = createLighting();
const TILE_PX = 22; // on-screen size per tile
let COLS = 0;
let ROWS = 0;
let LW = 0;
let LH = 0;

// A rock chamber (open interior + border) with a few solid pillars to show occlusion.
let occluders = true;
let pillars: Array<[number, number]> = [];
function rebuildPillars(): void {
  const cx = COLS >> 1;
  const cy = ROWS >> 1;
  pillars = occluders
    ? [
        [cx - 5, cy + 1],
        [cx + 5, cy - 2],
        [cx, cy - 6],
        [cx - 8, cy + 6],
        [cx + 8, cy + 5],
      ]
    : [];
}
// solid = the chamber border (2 tiles) or a pillar; interior is open (in world/local coords, which
// are the same here since the region starts at 0,0).
function solidTile(c: number, r: number): boolean {
  if (c < 2 || r < 2 || c >= COLS - 2 || r >= ROWS - 2) return true; // chamber walls
  for (const p of pillars) if (c === p[0] && r === p[1]) return true;
  return false;
}

// Coloured emitters. col = [r,g,b] 0..1. They orbit their base so overlaps sweep.
interface Emitter {
  name: string;
  col: LightColor;
  bx: number;
  by: number;
  orbit: number;
  ph: number;
  i: number;
}
let LIGHTS: Emitter[] = [];
function rebuildLights(): void {
  const cx = COLS / 2;
  const cy = ROWS / 2;
  LIGHTS = [
    // tight, bright RGB trio → additive blend (yellow/cyan/magenta petals, white-ish core)
    { name: 'red', col: [1.0, 0.1, 0.1], bx: cx, by: cy - 2.4, orbit: 0.7, ph: 0.0, i: 2.6 },
    {
      name: 'green',
      col: [0.1, 1.0, 0.15],
      bx: cx - 2.4,
      by: cy + 1.4,
      orbit: 0.7,
      ph: 2.1,
      i: 2.6,
    },
    {
      name: 'blue',
      col: [0.15, 0.3, 1.0],
      bx: cx + 2.4,
      by: cy + 1.4,
      orbit: 0.7,
      ph: 4.2,
      i: 2.8,
    },
    // single-colour accents (these show the cap difference: warm vs washed-grey at saturation)
    { name: 'warm', col: [1.0, 0.72, 0.42], bx: cx - 10, by: cy - 5, orbit: 1.2, ph: 1.0, i: 2.4 },
    { name: 'cyan', col: [0.2, 0.95, 0.95], bx: cx + 10, by: cy - 5, orbit: 1.2, ph: 3.0, i: 2.2 },
    {
      name: 'magenta',
      col: [1.0, 0.25, 0.9],
      bx: cx - 11,
      by: cy + 6,
      orbit: 1.2,
      ph: 5.0,
      i: 2.2,
    },
    { name: 'amber', col: [1.0, 0.55, 0.1], bx: cx + 11, by: cy + 6, orbit: 1.2, ph: 0.6, i: 2.4 },
  ];
}

function fit(): void {
  COLS = Math.max(20, Math.ceil(innerWidth / TILE_PX));
  ROWS = Math.max(16, Math.ceil(innerHeight / TILE_PX));
  LW = COLS * T;
  LH = ROWS * T;
  cv.width = LW;
  cv.height = LH;
  g.imageSmoothingEnabled = false;
  cv.style.width = COLS * TILE_PX + 'px';
  cv.style.height = ROWS * TILE_PX + 'px';
  rebuildPillars();
  rebuildLights();
}
addEventListener('resize', fit);
fit();

let hueCap = true;
let paused = false;
let pauseT = 0;
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code === 'KeyH') hueCap = !hueCap;
  else if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  } else if (e.code === 'KeyO') {
    occluders = !occluders;
    rebuildPillars();
  }
});

function frame(now: number): void {
  const t = (paused ? pauseT : (pauseT = now)) / 1000;
  composeBand(g, solidTile, 0, 0, COLS, ROWS, Infinity, -1); // rock chamber backdrop
  for (const L of LIGHTS) {
    const x = (L.bx + Math.cos(t * 0.6 + L.ph) * L.orbit) * T + T / 2;
    const y = (L.by + Math.sin(t * 0.6 + L.ph) * L.orbit) * T + T / 2;
    lighting.addLight(x, y, 0, L.col, L.i);
  }
  lighting.render({ g, LW, LH, T, camX: 0, camY: 0, SURFACE: -1, solidTile, hueCap });

  (document.getElementById('hud') as HTMLElement).textContent =
    `DELVE · light lab\n` +
    `cap: ${hueCap ? 'HUE-PRESERVING' : 'per-channel clamp'}   [H] toggle\n` +
    `[Space] ${paused ? 'paused' : 'running'}   [O] occluders ${occluders ? 'on' : 'off'}\n` +
    `lights: ${LIGHTS.map((l) => l.name).join(' ')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
