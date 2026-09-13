// ui/icon.ts — material icons rendered by the GAME'S OWN COMPOSITOR (#41).
//
// An inventory slot should show the material as it actually appears in the world, not an imitation
// of it. The existing icon path draws the ore's art shape — a crystal, a nugget, a shard — in its
// three-colour triad, which is a nice glyph and is emphatically not what the player just mined.
//
// So this composes a real band of world through `composeBand` with the ore's own material and crops
// one tile out of it. Every shader, every dither, every bit of world-anchored texture comes along for
// free, because none of it is reimplemented here.
//
// COHESION BY CONSTRUCTION, which is the same argument the material system won on: when a material's
// shader changes, its icon changes with it, and there is no second definition to forget.
import { T, UPSCALE, setStrata, composeBand } from '../render/cave-render';
import { oreMaterial } from '../render/materials';
import type { Material } from '../render/materials';
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
/**
 * The band composed around the icon's tile: three wide, four tall, with the tile at row 2.
 *
 * WHY FOUR TALL. An icon has to be a PERFECT SQUARE — an item in a slot is an object, not a piece of
 * the world, and a bitten corner reads as damage. The compositor erodes a tile's boundary wherever it
 * meets open space, so the tile's four neighbours all have to be solid. But a tile with no open space
 * anywhere near it is unlit, because brightness falls off with distance from the nearest opening.
 *
 * So the opening is moved TWO rows up instead of one: the tile above the icon stays solid, which
 * leaves the icon's own edges intact, while the gap two rows up still lights it. The tile keeps the
 * material's real texture and its real top-lighting, and loses only the erosion.
 */
const BAND_W = 3;
const BAND_H = 4;
/** Rows between the icon's tile and the open tile above. Two: one is close enough to erode. */
const LIGHT_GAP = 2;

/**
 * How an icon is lit, given its tile is deliberately buried and would otherwise be nearly black.
 *
 * Brightness is remapped rather than added to: `floor` is what an unlit pixel gets and `range` is
 * how much of the geometric variation survives on top. The material's own shader still chooses
 * every colour from its own ramp, so this can only ever pick a LIGHTER BAND — it cannot invent a
 * colour off the palette, which a canvas filter or a blend mode would.
 *
 * An item in a slot is being held up to the light, not viewed in situ. This is the one place an
 * icon knowingly departs from how the tile looks in the world, and it departs in the only dimension
 * that does not touch the art direction.
 */
const ICON_LIGHT_FLOOR = 0.62;
const ICON_LIGHT_RANGE = 0.38;

/** Wrap a material so its shader sees an icon-lit brightness. Everything else is untouched. */
const litForIcon = (material: Material): Material => ({
  ...material,
  shade: (ctx) =>
    material.shade({
      ...ctx,
      brightness: ICON_LIGHT_FLOOR + ctx.brightness * ICON_LIGHT_RANGE,
    }),
});

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
  band.width = BAND_W * T;
  band.height = BAND_H * T;
  const bg = band.getContext('2d')!;
  bg.imageSmoothingEnabled = false;

  const left = iconColumn(oreId);
  const centreColumn = left + 1;
  const centreRow = ICON_ROW + LIGHT_GAP;
  const ore = oreMaterial(oreId);
  // An ore with no registered material shader falls through to the rock's own look, which is what
  // the compositor does with a null material anyway.
  const material = ore ? litForIcon(ore) : null;
  composeBand(
    bg,
    // Solid everywhere except one tile LIGHT_GAP rows above the icon's tile. Far enough that the
    // icon's own boundary never meets open space, close enough that the light still reaches it.
    (column, row) => !(column === centreColumn && row === ICON_ROW),
    left,
    ICON_ROW,
    BAND_W,
    BAND_H,
    0,
    () => -1, // no sky in the crop; this tile is deep underground
    (column, row) => (column === centreColumn && row === centreRow ? material : null),
  );

  const tile = document.createElement('canvas');
  tile.width = T;
  tile.height = T;
  const tg = tile.getContext('2d')!;
  tg.imageSmoothingEnabled = false;
  tg.drawImage(band, T, LIGHT_GAP * T, T, T, 0, 0, T, T);
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
