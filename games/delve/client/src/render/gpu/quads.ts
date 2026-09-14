// quads.ts — what the GPU's entity pass draws (#83): a batch of screen-space quads, each either a solid
// colour with alpha (a particle, a dust mote, the reticle's edges) or a rectangle of the sprite atlas (a
// baked player frame), plus the shelf packer that places frames in that atlas.
//
// Pure and DOM-free, so both are tested without a GPU. quads.wgsl draws the batch; renderer.ts owns the
// atlas texture and uploads a frame the first time the packer places it.
import type { Rgb } from '../palette';

/** Floats per quad: x, y, width, height · atlas x, atlas y, textured, (pad) · r, g, b (0–255), alpha. */
export const QUAD_FLOATS = 12;

export interface QuadBatch {
  /** QUAD_FLOATS per quad, in draw order: later quads composite over earlier ones. */
  readonly data: Float32Array<ArrayBuffer>;
  readonly count: number;
  clear(): void;
  /** A solid rectangle, in screen pixels, `alpha` 0–1 — Canvas 2D's `fillRect` under `globalAlpha`. */
  rect(x: number, y: number, width: number, height: number, colour: Rgb, alpha: number): void;
  /**
   * A one-pixel outline just inside the `width`×`height` box at (`x`, `y`) — Canvas 2D's
   * `strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)` at line width 1, corners covered once.
   */
  outline(x: number, y: number, width: number, height: number, colour: Rgb, alpha: number): void;
  /** `width`×`height` pixels of the atlas from (`atlasX`, `atlasY`), drawn unscaled at (`x`, `y`). */
  image(x: number, y: number, width: number, height: number, atlasX: number, atlasY: number): void;
}

export function createQuadBatch(): QuadBatch {
  let data = new Float32Array(64 * QUAD_FLOATS);
  let count = 0;
  const push = (values: readonly number[]): void => {
    if ((count + 1) * QUAD_FLOATS > data.length) {
      const grown = new Float32Array(data.length * 2);
      grown.set(data);
      data = grown;
    }
    data.set(values, count * QUAD_FLOATS);
    count++;
  };
  return {
    get data() {
      return data;
    },
    get count() {
      return count;
    },
    clear: () => {
      count = 0;
    },
    rect: (x, y, width, height, colour, alpha) => {
      push([x, y, width, height, 0, 0, 0, 0, colour[0], colour[1], colour[2], alpha]);
    },
    outline(x, y, width, height, colour, alpha) {
      this.rect(x, y, width, 1, colour, alpha);
      this.rect(x, y + height - 1, width, 1, colour, alpha);
      this.rect(x, y + 1, 1, height - 2, colour, alpha);
      this.rect(x + width - 1, y + 1, 1, height - 2, colour, alpha);
    },
    image: (x, y, width, height, atlasX, atlasY) => {
      push([x, y, width, height, atlasX, atlasY, 1, 0, 255, 255, 255, 1]);
    },
  };
}

export interface AtlasSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShelfPacker {
  /**
   * The slot for `key`. `fresh` is true the first time a key is placed — the caller uploads its pixels
   * then. Null when it doesn't fit: the caller `reset`s and places again.
   */
  place(key: string, width: number, height: number): { slot: AtlasSlot; fresh: boolean } | null;
  /** Forget every slot, so the atlas refills from empty. */
  reset(): void;
}

/**
 * A shelf packer: frames fill rows left to right, and a row is as tall as its tallest frame. The player's
 * frames are all the same height, so a shelf wastes nothing; a real mix of sizes would want a skyline
 * packer, which this can become without changing its callers.
 */
export function createShelfPacker(size: number): ShelfPacker {
  let slots = new Map<string, AtlasSlot>();
  let shelfY = 0;
  let shelfHeight = 0;
  let cursorX = 0;
  return {
    place(key, width, height) {
      const known = slots.get(key);
      if (known) return { slot: known, fresh: false };
      if (width > size || height > size) return null;
      if (cursorX + width > size) {
        shelfY += shelfHeight;
        shelfHeight = 0;
        cursorX = 0;
      }
      if (shelfY + height > size) return null;
      const slot = { x: cursorX, y: shelfY, width, height };
      cursorX += width;
      shelfHeight = Math.max(shelfHeight, height);
      slots.set(key, slot);
      return { slot, fresh: true };
    },
    reset() {
      slots = new Map();
      shelfY = 0;
      shelfHeight = 0;
      cursorX = 0;
    },
  };
}
