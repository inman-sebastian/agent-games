// ui/icon.ts — material icons rendered by the GAME'S OWN COMPOSITOR (#41).
//
// An inventory slot should show the material as it actually appears in the world, not an imitation
// of it. The existing icon path draws the ore's art shape — a crystal, a nugget, a shard — in its
// three-colour triad, which is a nice glyph and is emphatically not what the player just mined.
//
// So this composes a real tile: a 3x3 band of world, solid except for one open tile directly above
// the centre, through `composeBand` with the ore's own material — then crops the middle tile. That
// is the shape an exposed vein face actually has underground, so the top edge catches light and the
// rest of the tile stays whole. Every shader, every dither, every bit of world-anchored texture
// comes along for free, because none of it is reimplemented here.
//
// COHESION BY CONSTRUCTION, which is the same argument the material system won on: when a material's
// shader changes, its icon changes with it, and there is no second definition to forget.
import { T, UPSCALE, setStrata, composeBand } from '../render/cave-render';
import { oreMaterial } from '../render/materials';
import { STRATA, ORE_BY_ID } from '@delve/shared';

/**
 * Where in the world an icon's tile is sampled from — PER ORE, which matters.
 *
 * The compositor's edge erosion and texture are world-anchored, so every icon sampled at the same
 * coordinates gets the identical eroded corner. Twelve icons in a grid all notched in exactly the
 * same place stops reading as texture and starts reading as a defect, which is precisely what it
 * looked like. Spacing them out gives each material its own chip and bite, for free.
 */
const iconColumn = (oreId: number): number => oreId * 7;
/** Deep enough to sit in stone rather than topsoil, so the surround never tints the crop. */
const ICON_ROW = 120;
/** The 3x3 band the centre tile is cropped out of. */
const BAND = 3;

let strataReady = false;

/**
 * Draw one material's tile at art resolution. Cached per ore id — a shader costs a call per pixel
 * and an icon is drawn on every panel open.
 */
const tiles = new Map<number, HTMLCanvasElement>();

function materialTile(oreId: number): HTMLCanvasElement {
  const hit = tiles.get(oreId);
  if (hit) return hit;

  // The compositor reads the strata ramps from a module-level registry. A lab or a test may not
  // have set them, and an icon must not depend on the game having booted first.
  if (!strataReady) {
    setStrata(STRATA);
    strataReady = true;
  }

  const band = document.createElement('canvas');
  band.width = BAND * T;
  band.height = BAND * T;
  const bg = band.getContext('2d')!;
  bg.imageSmoothingEnabled = false;

  const left = iconColumn(oreId);
  const centreColumn = left + 1;
  const centreRow = ICON_ROW + 1;
  const material = oreMaterial(oreId);
  composeBand(
    bg,
    // Solid everywhere EXCEPT directly above the centre, which is the shape an exposed vein face
    // actually has underground: rock all around, one open tile overhead, so the top edge catches
    // the light and the rest of the tile stays whole.
    //
    // Leaving the centre tile isolated was the first attempt and it came out as a small blob — the
    // compositor erodes a tile's boundary against open space, so a tile with open space on all four
    // sides is eaten from every direction at once. Correct behaviour, wrong request.
    (column, row) => !(column === centreColumn && row === centreRow - 1),
    left,
    ICON_ROW,
    BAND,
    BAND,
    0,
    () => -1, // no sky in the crop; this tile is deep underground
    (column, row) => (column === centreColumn && row === centreRow ? material : null),
  );

  const tile = document.createElement('canvas');
  tile.width = T;
  tile.height = T;
  const tg = tile.getContext('2d')!;
  tg.imageSmoothingEnabled = false;
  tg.drawImage(band, T, T, T, T, 0, 0, T, T);
  tiles.set(oreId, tile);
  return tile;
}

/** Drop every cached icon. Call after changing a material's shader, or the old art keeps showing. */
export function clearIconCache(): void {
  tiles.clear();
}

/**
 * One tile at the size the world draws it: `T` art pixels, each `UPSCALE` CSS pixels wide.
 *
 * The natural size for an icon, and the reason it is a constant rather than a number a caller
 * picks. Passing 16 looks like "16 art pixels" and means 16 CSS pixels, which is HALF the art scale
 * — the icon came out at half the size of every other pixel on screen and simply read as small.
 */
export const ICON_PX = T * UPSCALE;

/**
 * A material's icon as a canvas, `size` CSS pixels square.
 *
 * `size` must be a whole multiple of `T` so the upscale stays integer and the pixels stay square;
 * anything else resamples the very texture this exists to show. In practice that means `ICON_PX`
 * or a doubling of it.
 */
export function materialIcon(oreId: number, size = ICON_PX): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'oreic';
  const name = ORE_BY_ID[oreId]?.name;
  if (name) canvas.title = name;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(materialTile(oreId), 0, 0, T, T, 0, 0, size, size);
  return canvas;
}
