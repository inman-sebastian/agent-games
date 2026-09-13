// ui-lab.ts — draw REAL cave behind the UI lab.
//
// The background started as a `repeating-linear-gradient` stand-in, which was honest about being a
// placeholder and dishonest about everything else: it read as ribbons, and judging panel contrast
// against stripes is barely better than judging it against a flat colour.
//
// So it calls the same compositor and the same lighting pass the game does. A panel's contrast now
// gets tested against the actual thing it will sit on — lit rock, unlit rock, ore, and the hard
// boundary between them — which is the only version of the question worth asking.
import { T, setStrata, composeBand } from '../src/render/cave-render';
import { UPSCALE } from '../src/render/palette';
import { WIDTH, STRATA, oreAt, surfaceAt } from '@delve/shared';
import { oreMaterial } from '../src/render/materials';
import { create as createLighting, LAMP_COLOR } from '../src/render/lighting';
import { installSurfaces } from '../src/ui/surface';
import { defineSlot } from '../src/ui/slot';
import { buildInventoryGrid } from '../src/ui/inventory';
import { ORE_BY_ID } from '@delve/shared';

const SEED = 12345;
const CENTER_ROW = 96; // deep enough for the stone/deepstone boundary and some ore
const LAMP_INTENSITY = 2.6;

setStrata(STRATA);

const canvas = document.getElementById('ground') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;

/** A carved chamber with tunnels running off it, so the crop has both lit and unlit rock. */
const dug = new Set<string>();
const carve = (column: number, row: number): void => void dug.add(`${column},${row}`);

export function draw(): void {
  // Logical resolution, upscaled by CSS — the same deal the game's canvas makes.
  const cols = Math.ceil(window.innerWidth / (T * UPSCALE)) + 1;
  const rows = Math.ceil(window.innerHeight / (T * UPSCALE)) + 1;
  const bandLeft = (WIDTH >> 1) - (cols >> 1);
  const bandTop = CENTER_ROW - (rows >> 1);

  dug.clear();
  // A wide chamber through the middle, plus a shaft, so there is a lit face and a dark pocket.
  for (let row = CENTER_ROW - 6; row <= CENTER_ROW + 6; row++) {
    for (let column = bandLeft + 2; column < bandLeft + cols - 2; column++) carve(column, row);
  }
  for (let row = bandTop; row <= CENTER_ROW; row++) carve(bandLeft + (cols >> 2), row);

  const solidTile = (column: number, row: number): boolean =>
    row > surfaceAt(SEED, column) && !dug.has(`${column},${row}`);

  canvas.width = cols * T;
  canvas.height = rows * T;
  canvas.style.width = `${cols * T * UPSCALE}px`;
  canvas.style.height = `${rows * T * UPSCALE}px`;
  g.imageSmoothingEnabled = false;

  composeBand(
    g,
    solidTile,
    bandLeft,
    bandTop,
    cols,
    rows,
    WIDTH,
    (column) => surfaceAt(SEED, column),
    (column, row) => oreMaterial(oreAt(SEED, column, row)),
  );

  // The lamp, so the rock is lit the way it is in play rather than evenly.
  const lighting = createLighting();
  lighting.addLight(
    (bandLeft + (cols >> 1)) * T + T / 2,
    CENTER_ROW * T + T / 2,
    0,
    LAMP_COLOR,
    LAMP_INTENSITY,
  );
  lighting.render({
    g,
    LW: canvas.width,
    LH: canvas.height,
    T,
    camX: bandLeft * T,
    camY: bandTop * T,
    surfaceAt: (column) => surfaceAt(SEED, column),
    solidTile,
  });
}

// ?type=current | display | all — which face does which job. See the note in ui-lab.html.
document.body.dataset.type = new URLSearchParams(location.search).get('type') ?? 'current';

installSurfaces(); // the same frames the game installs, from the same module
defineSlot();

// The slot grid, built by the same function the game's Inventory panel calls — so the lab cannot
// drift from what ships. A spread of counts and states, plus the empty tail.
const grid = buildInventoryGrid({ 2: 1, 3: 19, 5: 4, 9: 2, 12: 340 }, ORE_BY_ID, 9);
document.getElementById('slots')!.append(grid);
const states = document.getElementById('slot-states')!;
for (const [state, ore] of [
  ['empty', null],
  ['filled', 3],
  ['selected', 9],
  ['unaffordable', 5],
  ['locked', null],
] as const) {
  const el = document.createElement('delve-slot');
  el.setAttribute('state', state);
  if (ore !== null) {
    el.setAttribute('ore', String(ore));
    el.setAttribute('count', '12');
  }
  states.append(el);
}
draw();
addEventListener('resize', draw);

// Wait for the faces before signalling, or a capture shoots the fallback (tools/shot.sh).
void (async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.title = 'ready';
})();
