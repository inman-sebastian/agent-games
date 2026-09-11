// sprites.ts — authored character/entity sprites, shared by the game and the style lab so they
// stay identical. Pure drawing over any 2D context.
import type { Facing } from '@delve/shared';

// The miner's palette (all Resurrect-64). Named so the sprite reads; the pixel coordinates
// below are hand-placed art data for the 16px sprite (the "art data" exception in CODE-STYLE).
const OUTLINE = '#0a0912';
const HELMET = '#e6904e';
const HELMET_SHADOW = '#cd683d';
const HELMET_TRIM = '#f9c22b';
const VISOR = '#25222c';
const VISOR_GLINT = '#8fd3ff';
const LAMP = '#fbff86';
const FACE = '#e6b98e';
const FACE_SHADOW = '#c7955f';
const OVERALLS = '#4d65b4';
const OVERALLS_SHADOW = '#323353';
const OVERALLS_LIGHT = '#4d9be6';
const BOOT = '#4c3e24';
const PICK_HEAD = '#9babb2';
const PICK_HANDLE = '#7a5030';

// Outline rects (a, b, w, h) tracing the helmet, body and limbs.
const OUTLINE_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [4, 1, 5, 1],
  [3, 2, 7, 1],
  [3, 3, 1, 6],
  [9, 3, 1, 6],
  [3, 9, 7, 1],
  [3, 9, 1, 4],
  [8, 9, 1, 4],
  [4, 13, 5, 1],
];

/**
 * Draw the miner at top-left (x, y): dark cool outline, orange helmet + lamp, visor, blue
 * overalls, boots, a pickaxe over the shoulder. `bob` is a vertical offset for idle/walk bob.
 */
export function drawMiner(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: Facing | 'down',
  bob = 0,
): void {
  const pixel = (a: number, b: number, w: number, h: number, color: string): void => {
    g.fillStyle = color;
    g.fillRect(x + a, y + b + bob, w || 1, h || 1);
  };

  // pickaxe over the shoulder
  pixel(9, 3, 1, 4, PICK_HANDLE);
  pixel(8, 2, 4, 1, PICK_HEAD);
  pixel(11, 3, 1, 1, PICK_HEAD);
  pixel(8, 3, 1, 1, PICK_HEAD);

  for (const [a, b, w, h] of OUTLINE_RECTS) pixel(a, b, w, h, OUTLINE);

  // helmet
  pixel(4, 2, 5, 1, HELMET);
  pixel(4, 3, 5, 1, HELMET);
  pixel(4, 4, 5, 1, HELMET_SHADOW);
  const lampX = facing === 'left' ? 3 : facing === 'right' ? 8 : 6;
  pixel(lampX, 1, 2, 1, LAMP);
  pixel(lampX, 2, 1, 1, HELMET_TRIM);

  // face + visor
  pixel(4, 5, 5, 2, FACE);
  pixel(4, 7, 5, 1, FACE_SHADOW);
  pixel(4, 5, 5, 1, VISOR);
  pixel(7, 5, 1, 1, VISOR_GLINT);

  // torso overalls
  pixel(4, 7, 5, 2, OVERALLS);
  pixel(4, 8, 5, 1, OVERALLS_SHADOW);
  pixel(6, 7, 1, 2, OVERALLS_LIGHT);

  // legs + boots
  pixel(4, 9, 2, 3, OVERALLS);
  pixel(7, 9, 2, 3, OVERALLS);
  pixel(4, 12, 2, 1, BOOT);
  pixel(7, 12, 2, 1, BOOT);
}
