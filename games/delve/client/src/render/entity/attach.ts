// attach.ts — equipment that is NOT confined to the character's silhouette.
//
// The skin pipeline (skin.ts) can change what a body part looks like. It cannot add anything the
// body does not already occupy, because a re-skin only ever recolours pixels the imported frame
// already drew. A backpack sticking off the character's back, a cape, a sheathed sword, a lantern
// swinging from a belt hook — none of those are recolours. They are their own art, hung on the body.
//
// THE THREE KINDS OF EQUIPMENT, because the distinction decides what each may do:
//
//   1. RE-SKIN     — recolours a part in place. May never change the silhouette. Dyed cloth, skin
//                    tone, a steel sheen over the same shape. `SpriteSkin.colors` / `.materials`.
//   2. OVERLAY     — its own art, drawn over a part and CLIPPED to it. A helmet on the head, a
//                    pauldron on a shoulder: the shape is the body's, the detail is the item's.
//   3. ATTACHMENT  — its own art, anchored to a part and free to extend BEYOND the silhouette.
//                    This file.
//
// WHAT MAKES AN ATTACHMENT TRACTABLE is the same thing that made materials tractable: an attachment
// does not name a pixel or a frame, it names a POINT ON A PART'S SURFACE — `along` down the part,
// `around` across it. That point is resolved per frame from that frame's own derived surface map, so
// "the backpack hangs high on the torso's back edge" is authored once and lands correctly in all
// fifteen animations, following the body as it bobs, leans and turns. Nothing is authored per frame,
// and a new animation needs no attachment work at all.
import { surfaceOf } from './surface';
import type { SpriteAnim, SpriteCel } from './sprite';

/** A point on a part's surface. The coordinates a material shades by are the ones an item hangs on. */
export interface Anchor {
  /** The slot to hang from, e.g. `'torso'`. */
  readonly slot: string;
  /** 0 at the part's start along its dominant axis, 1 at its end. */
  readonly along: number;
  /** -1 at one silhouette edge, +1 at the other, 0 on the spine. */
  readonly around: number;
}

/**
 * A small authored bitmap: rows of single characters, one per pixel.
 *
 * Authored as picture-shaped text rather than an array of numbers, which is the one place
 * CODE-STYLE allows art data to look like art. `.` is transparent; every other character indexes
 * `palette` by its position in `keys`.
 */
export interface ItemArt {
  readonly rows: readonly string[];
  readonly keys: string;
  readonly palette: readonly string[];
}

export interface Attachment {
  readonly id: string;
  readonly art: ItemArt;
  readonly anchor: Anchor;
  /**
   * Where the art's own origin sits, as a fraction of its size — so an item is positioned by the
   * part of ITSELF that touches the body, not by its top-left corner.
   */
  readonly pivot: readonly [number, number];
  /** Whole-pixel nudge after anchoring, for the last pixel of placement. */
  readonly offset?: readonly [number, number];
  /**
   * Paint order: draw immediately BEHIND this slot, or in front of everything if `'front'`.
   *
   * A backpack goes behind the torso or it covers the character's back. A chest lamp goes in front.
   * Getting this wrong is the most visible way an attachment can look pasted on.
   */
  readonly behind?: string | 'front';
}

/** Resolve an anchor to a pixel in the sprite's own (unflipped) space, or null if the part is absent. */
export function anchorPixel(
  anim: SpriteAnim,
  frame: number,
  anchor: Anchor,
  indicesOf: (cel: SpriteCel) => Uint8Array,
): readonly [number, number] | null {
  const layer = anim.layers.find((l) => l.name === anchor.slot);
  const cel = layer?.cels[frame];
  if (!cel) return null;
  const map = surfaceOf(cel, indicesOf(cel));
  const indices = indicesOf(cel);

  // SEQUENTIALLY: the scanline nearest `along` first, then within it the pixel nearest `around`.
  //
  // Not a single nearest-neighbour search in (along, around) space, which is what this did first and
  // what put the backpack on the character's chest for two frames of the walk. The two axes have
  // different ranges — `along` spans 0..1 and `around` spans -1..1 — so a combined distance lets the
  // search slide a long way down the part to satisfy `around`, and it picked a pixel two thirds of
  // the way down the torso on the wrong side rather than one at the requested height on the right
  // one. Resolving in order also matches how the coordinate reads when authoring: a height on the
  // part, then an edge of it.
  let bestAlong = Infinity;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] === 0) continue;
    const d = Math.abs(map.along[i] - anchor.along);
    if (d < bestAlong) bestAlong = d;
  }
  let bestX = -1;
  let bestY = -1;
  let best = Infinity;
  for (let y = 0; y < cel.h; y++) {
    for (let x = 0; x < cel.w; x++) {
      const i = y * cel.w + x;
      if (indices[i] === 0) continue;
      if (Math.abs(map.along[i] - anchor.along) > bestAlong + 1e-6) continue;
      const d = Math.abs(map.around[i] - anchor.around);
      if (d >= best) continue;
      best = d;
      bestX = x;
      bestY = y;
    }
  }
  if (bestX < 0) return null;
  return [cel.x + bestX, cel.y + bestY];
}

/** Decode an `ItemArt` into indices into its own palette. 0 is transparent. */
export function decodeArt(art: ItemArt): { w: number; h: number; data: Uint8Array } {
  const h = art.rows.length;
  const w = Math.max(...art.rows.map((r) => r.length));
  const data = new Uint8Array(w * h);
  for (const [y, row] of art.rows.entries()) {
    for (let x = 0; x < row.length; x++) {
      const at = art.keys.indexOf(row[x]);
      if (at >= 0) data[y * w + x] = at + 1;
    }
  }
  return { w, h, data };
}

// ---- a worked example ---------------------------------------------------------------------------
//
// The backpack, which is the case that motivated all of this: it hangs off the character's back and
// is wider than the torso it attaches to, so no amount of recolouring could produce it.
//
// Authored, not imported — the reference pack has no backpack, and everything DELVE adds on top of
// the imported bodies is ours and follows the palette (docs/PALETTE.md). All Resurrect-64.

const PACK_ART: ItemArt = {
  rows: ['.LLLL.', 'LBBBBL', 'LBSSBL', 'LBSSBL', 'LBBBBL', 'LBTTBL', 'LBBBBL', '.LLLL.'],
  keys: 'LBST',
  palette: [
    '#2e222f', // outline, the same darkest step the body's rim uses
    '#7a5030', // leather body
    '#a2653e', // lit face
    '#4c3e24', // strap buckle
  ],
};

/**
 * High on the torso's BACK edge — `around: -1` is the far side, which is the character's back given
 * the pack's near/far layering.
 *
 * Behind the torso so the character's body reads in front of it, which is what separates an
 * attachment from a sticker.
 */
export const BACKPACK: Attachment = {
  id: 'backpack',
  art: PACK_ART,
  anchor: { slot: 'torso', along: 0.35, around: -1 },
  // Almost entirely BEHIND the anchor, overlapping the body by a pixel.
  //
  // This is the placement rule an attachment has to obey, learned the hard way: at 0.85 the pack sat
  // mostly inside the torso's footprint, and on the two walk frames where the near arm swings back
  // across the body it vanished completely. The occlusion was correct — a near-side arm really is in
  // front of something on the back — so the fix is not the paint order, it is that an attachment
  // must CLEAR the silhouette by design rather than relying on nothing else being there.
  pivot: [1, 0.4],
  offset: [1, 0],
  // The very back of the paint order, which is where a back-mounted item belongs: behind the far
  // arm as well as the torso.
  //
  // KNOWN LIMITATION (#48), a real one rather than a bug to chase. On the two walk frames where
  // the torso leans hardest, the torso's own back edge sits further inboard than the near arm, so
  // the pack lands underneath that arm and disappears. The occlusion is correct — a near-side arm
  // IS in front of something on the back — and the anchor is correct too; what is wrong is expecting
  // one part's extent to know about another's. Fixing it properly means either art that clears the
  // arm's full swing, or an anchor resolved against the whole figure's silhouette rather than one
  // part's. Both are decisions, not tweaks.
  behind: 'arm.far',
};
