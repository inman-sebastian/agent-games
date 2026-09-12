// entity-lab.ts — the crispness proof for the procedural character rig (issue #47).
//
// The question this lab exists to answer: can a rasterized limb sit in the same frame as the
// material art and read as the same hand? So it draws limbs INTO a real rock scene rather than
// beside one — the grain, the banding and the tonal range have to match under direct comparison,
// not from memory.
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { WIDTH, SURFACE, STRATA, strataIndexAt, solidAt } from '@delve/shared';
import { colorsFor } from '../src/render/palette';
import { rasterizeLimb, clothSurface, plateSurface, snap, type Limb } from '../src/render/entity/limb';

const DEFAULT_SEED = 12345;
const DEFAULT_ROW = 100;
const DEFAULT_SCALE = 4;
const DEFAULT_ANGLES = 12;

setStrata(STRATA);

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number =>
  params.has(key) ? Number(params.get(key)) : fallback;
const seed = num('seed', DEFAULT_SEED);
const centerRow = num('r', DEFAULT_ROW);
const scale = num('scale', DEFAULT_SCALE);
const angleCount = num('angles', DEFAULT_ANGLES);

const COLS = 20;
const ROCK_ROWS = 8;
const STRIP_ROWS = 5;
const LIMB_LEN = 13;
const LIMB_RADIUS = 3.2;

// The limb wears the palette of the stratum it's standing in, so any tonal mismatch with the rock
// is the rasterizer's fault rather than a palette difference confusing the comparison.
// Carve a chamber, because an uncarved slab is a dishonest comparison: `shadeRock`'s brightness
// comes from distance to the nearest OPEN edge, so solid-everywhere rock shades to a flat dark
// centre with none of the top-light, erosion or corner-rounding that give it its character. A
// character also stands in carved space, so this is the real setting.
const dug = new Set<string>();
const carve = (left: number, top: number, w: number, h: number): void => {
  for (let r = top; r < top + h; r++) for (let c = left; c < left + w; c++) dug.add(`${c},${r}`);
};
const bandLeft = (WIDTH >> 1) - (COLS >> 1);
const solidTile = (column: number, row: number): boolean =>
  solidAt(seed, column, row) && !dug.has(`${column},${row}`);

const strata = STRATA[strataIndexAt(centerRow)];
const rockColors = colorsFor([...strata.ramp]);

// A separate, deliberately character-ish ramp (R64 blues — the miner's overalls family) to check
// the surface holds up in a palette that ISN'T the rock's.
const CLOTH_RAMP = ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff'];
const clothColors = colorsFor(CLOTH_RAMP);

const width = COLS * T;
const height = (STRIP_ROWS + ROCK_ROWS + ROCK_ROWS) * T;

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = width;
canvas.height = height;
canvas.style.width = `${width * scale}px`;
canvas.style.height = `${height * scale}px`;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

// ---- strip 1: one limb swept through rotations ------------------------------------------------
// Every angle is rasterized from geometry, so none of them is a resampled bitmap. If rotation cost
// crispness, this row is where it would show.
{
  const h = STRIP_ROWS * T;
  const img = ctx.createImageData(width, h);
  const cy = h / 2;
  const step = width / angleCount;
  for (let i = 0; i < angleCount; i++) {
    const angle = (i / angleCount) * Math.PI;
    const cx = step * (i + 0.5);
    const dx = (Math.cos(angle) * LIMB_LEN) / 2;
    const dy = (Math.sin(angle) * LIMB_LEN) / 2;
    rasterizeLimb(
      img,
      { ax: snap(cx - dx), ay: snap(cy - dy), bx: snap(cx + dx), by: snap(cy + dy), radius: LIMB_RADIUS },
      i % 2 === 0 ? clothSurface : plateSurface,
      clothColors,
    );
  }
  ctx.putImageData(img, 0, 0);
}

// ---- strip 2: limbs over real rock -------------------------------------------------------------
// The actual test. Same frame, same scale, no cheating.
{
  const y = STRIP_ROWS * T;
  carve(bandLeft + 1, centerRow + 2, COLS - 2, 4); // the chamber the limbs stand in
  ctx.save();
  ctx.translate(0, y); // composeBand draws at the context origin
  composeBand(ctx, solidTile, bandLeft, centerRow, COLS, ROCK_ROWS, WIDTH, SURFACE);
  ctx.restore();
  const h = ROCK_ROWS * T;
  const img = ctx.createImageData(width, h);
  const cy = 4 * T; // inside the carved chamber
  // a crude two-bone leg, posed — the shape the rig will actually produce
  const poses: Limb[][] = [];
  for (let i = 0; i < 4; i++) {
    const hipX = width * (0.14 + i * 0.24);
    const knee = { x: hipX + (i - 1.5) * 3, y: cy + 1 };
    poses.push([
      { ax: snap(hipX), ay: snap(cy - 9), bx: snap(knee.x), by: snap(knee.y), radius: 3.4 },
      { ax: snap(knee.x), ay: snap(knee.y), bx: snap(knee.x + (i - 1.5) * 2), by: snap(cy + 10), radius: 2.8 },
    ]);
  }
  for (const pose of poses) for (const limb of pose) rasterizeLimb(img, limb, clothSurface, clothColors);
  // and one in the ROCK's own palette, to isolate "does the surface match" from "does the palette match"
  rasterizeLimb(
    img,
    { ax: snap(width - 40), ay: snap(cy - 9), bx: snap(width - 34), by: snap(cy + 10), radius: 3.4 },
    plateSurface,
    rockColors,
  );
  // composite only the covered pixels so the rock shows through
  const scene = ctx.getImageData(0, y, width, h);
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] === 0) continue;
    scene.data[i - 3] = img.data[i - 3];
    scene.data[i - 2] = img.data[i - 2];
    scene.data[i - 1] = img.data[i - 1];
  }
  ctx.putImageData(scene, 0, y);
}

// ---- strip 3: rock alone ------------------------------------------------------------------------
carve(bandLeft + 1, centerRow + ROCK_ROWS + 2, COLS - 2, 4); // same chamber shape, no limbs
ctx.save();
ctx.translate(0, (STRIP_ROWS + ROCK_ROWS) * T);
composeBand(ctx, solidTile, bandLeft, centerRow + ROCK_ROWS, COLS, ROCK_ROWS, WIDTH, SURFACE);
ctx.restore();
