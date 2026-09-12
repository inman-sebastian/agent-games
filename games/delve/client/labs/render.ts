// render.ts — the render harness entry. Draws EXACTLY one world region through the shared
// modules into a canvas sized to the crop, so a visual check is one tiny image of precisely the
// thing (captured headless via shot.sh). Driven entirely by URL params (see render.html).
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { WIDTH, STRATA, blockAt, oreAt, surfaceAt } from '@delve/shared';
import { ORE_ART, drawOreBlock } from '../src/render/ore-art';
import { oreMaterial, drawDamage } from '../src/render/materials';
import { drawPlayer, poseFor } from '../src/render/entity/player';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';

const DEFAULT_SEED = 12345;
const DEFAULT_CENTER_ROW = 100;
const DEFAULT_COLS = 18;
const DEFAULT_ROWS = 14;
const DEFAULT_SCALE = 3;
const DEFAULT_LAMP = 9;
const LAMP_BASE_INTENSITY = 0.9; // lamp seed brightness at lamp reach 0
const LAMP_REACH_GAIN = 0.16; // added per tile of lamp reach

setStrata(STRATA);

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number =>
  params.has(key) ? Number(params.get(key)) : fallback;
const seed = num('seed', DEFAULT_SEED);
const centerColumn = num('c', WIDTH >> 1);
const centerRow = num('r', DEFAULT_CENTER_ROW);
const cols = num('w', DEFAULT_COLS);
const rows = num('h', DEFAULT_ROWS);
const scale = num('scale', DEFAULT_SCALE);
const cave = params.get('cave') || 'shaft';
const applyLamp = num('lamp', 1);
const showMiner = num('miner', 1);
const lamp = num('lamp', DEFAULT_LAMP);
// ore rendering style: 'crystal' = the faceted crystal blocks (current); 'strata' = ore rendered
// through the shared rock shader in the ore's palette (the art-pass prototype — looks/functions
// like a stratum tile). Only ore in solid, still-buried tiles gets the strata treatment.
const oreStyle = params.get('orestyle') || 'crystal';
// dmg inspector: >0 shows the tiered damage (chipping) FX on a row of isolated, fully top-lit tiles,
// one per stage (dig progress rising left→right) — so one shot shows the whole break progression
// cleanly, on bright rock, without lighting/ore noise.
const damage = num('dmg', 0);
const DMG_STAGES = [0.001, 0.15, 0.4, 0.65, 0.9, 1.0]; // representative fracs (first ≈ pristine)
const dmgBlockCol = (i: number): number => bandLeft + 2 + i * 3; // isolated tiles, spaced so each is lit

const bandLeft = centerColumn - (cols >> 1);
const bandTop = centerRow - (rows >> 1);

// carve a cave shape into a dug set
const dug = new Set<string>();
if (damage > 0) {
  // dmg inspector: everything open except one isolated solid tile per stage on the centre row, so
  // each is surrounded by open space → fully top-lit, and the chipping reads on bright rock.
  const solidCols = new Set(DMG_STAGES.map((_, i) => dmgBlockCol(i)));
  for (let row = bandTop; row < bandTop + rows; row++)
    for (let column = bandLeft; column < bandLeft + cols; column++)
      if (!(row === centerRow && solidCols.has(column))) dug.add(`${column},${row}`);
} else if (cave === 'shaft') {
  for (let row = bandTop; row <= centerRow; row++) dug.add(`${centerColumn},${row}`); // shaft down the centre
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) dug.add(`${centerColumn + dx},${centerRow + dy}`); // chamber
}
// Per COLUMN, which is the whole point of the heightmap. A careless refactor briefly used the crop's
// centre column for every column here, which is flat by construction and rendered a dead-level
// horizon no matter what the generator produced.
const solidTile = (column: number, row: number): boolean =>
  row > surfaceAt(seed, column) && !dug.has(`${column},${row}`);

const LW = cols * T;
const LH = rows * T;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
canvas.width = LW;
canvas.height = LH;
g.imageSmoothingEnabled = false;
canvas.style.width = `${LW * scale}px`;
canvas.style.height = `${LH * scale}px`;

// rock + background + stalactites, at this depth. In 'strata' style, ore tiles are baked into the
// rock band through the shared compositor, each coloured by its OWN material shader (render/
// materials/*), with the material↔rock boundary feathered so they blend seamlessly.
const materialAt =
  oreStyle === 'strata'
    ? (column: number, row: number) => oreMaterial(oreAt(seed, column, row))
    : undefined;
// The real per-column surface, so a crop that includes the surface shows the actual terrain.
const surfaceOf = (column: number): number => surfaceAt(seed, column);
composeBand(g, solidTile, bandLeft, bandTop, cols, rows, WIDTH, surfaceOf, materialAt);

// crystal style only: draw the faceted ore blocks on top (the harness always reveals ore).
if (oreStyle !== 'strata') {
  for (let row = bandTop; row < bandTop + rows; row++) {
    for (let column = bandLeft; column < bandLeft + cols; column++) {
      if (!solidTile(column, row)) continue;
      const oreId = blockAt(seed, column, row).ore;
      const art = oreId ? ORE_ART[oreId] : null;
      if (!art || art.dim) continue;
      const sameOre = (dColumn: number, dRow: number): boolean =>
        solidTile(column + dColumn, row + dRow) &&
        oreAt(seed, column + dColumn, row + dRow) === oreId;
      drawOreBlock(g, art, (column - bandLeft) * T, (row - bandTop) * T, column, row, 0, sameOre);
    }
  }
}

// tiered damage overlay (chipping): one isolated tile per stage
if (damage > 0) {
  for (let i = 0; i < DMG_STAGES.length; i++) {
    const column = dmgBlockCol(i);
    if (column >= bandLeft + cols) break;
    drawDamage({
      g,
      x: (column - bandLeft) * T,
      y: (centerRow - bandTop) * T,
      scale: 1,
      frac: DMG_STAGES[i],
      seed: 42, // fixed across the row → shows ONE block's additive progression (not per-tile variety)
      lit: 1,
      dirX: 1, // mined from the right → chunks bite out of the right edge
      dirY: 0,
    });
  }
}

// The same character the game draws, through the same module — a lab that draws its own would be a
// second source of truth for what the player looks like.
//
// Stood on the first SOLID tile below the crop's centre, not at the centre itself. Placing it at a
// fixed spot left it hanging in mid-air whenever the centre happened to be open, which read as the
// character hovering when in fact it was standing on nothing.
if (showMiner) {
  let floorRow = centerRow;
  while (floorRow < bandTop + rows && !solidTile(centerColumn, floorRow)) floorRow++;
  drawPlayer(
    g,
    poseFor('idle', 0),
    (centerColumn - bandLeft) * T + T / 2,
    (floorRow - bandTop) * T,
    { scale: 1 },
  );
}

// lighting: camX/camY map this crop's screen pixels to world pixels
if (applyLamp) {
  const lighting = createLighting();
  const camX = bandLeft * T;
  const camY = bandTop * T;
  lighting.addLight(
    centerColumn * T + 8,
    centerRow * T + 8,
    0,
    LAMP_COLOR,
    LAMP_BASE_INTENSITY + LAMP_REACH_GAIN * lamp,
  );
  // (ore no longer emits its own light — matches the game; veins read by their lit surface alone)
  // The real surface, so the lighting's sky check follows the terrain like the compositor's does.
  lighting.render({ g, LW, LH, T, camX, camY, surfaceAt: surfaceOf, solidTile });
}

document.title = 'ready'; // signal for headless capture
