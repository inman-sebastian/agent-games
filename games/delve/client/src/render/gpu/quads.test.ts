// quads.test.ts — the entity pass's quad batch and sprite-atlas packer (#83).
//
// The packer is the part that can silently draw the wrong thing: two frames given overlapping slots, or
// a slot hanging off the atlas, shows one sprite's pixels inside another with nothing to flag it.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createQuadBatch, createShelfPacker, QUAD_FLOATS } from './quads';

describe('the sprite atlas packer', () => {
  it('never overlaps two slots or leaves the atlas, and a key keeps its slot', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 40 }),
            fc.integer({ min: 1, max: 70 }),
            fc.integer({ min: 1, max: 70 }),
          ),
          { maxLength: 200 },
        ),
        (requests) => {
          const size = 256;
          const packer = createShelfPacker(size);
          const placed = new Map<string, { x: number; y: number; width: number; height: number }>();
          for (const [id, width, height] of requests) {
            const key = `frame-${id}`;
            const known = placed.get(key);
            // a key always keeps its first size, as a baked frame does
            const result = packer.place(key, known?.width ?? width, known?.height ?? height);
            if (!result) {
              expect(known).toBeUndefined();
              continue;
            }
            const { slot, fresh } = result;
            expect(fresh).toBe(!known);
            if (known) expect(slot).toEqual(known);
            expect(slot.x).toBeGreaterThanOrEqual(0);
            expect(slot.y).toBeGreaterThanOrEqual(0);
            expect(slot.x + slot.width).toBeLessThanOrEqual(size);
            expect(slot.y + slot.height).toBeLessThanOrEqual(size);
            placed.set(key, slot);
          }
          const slots = [...placed.values()];
          for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
              const a = slots[i];
              const b = slots[j];
              const apart =
                a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y;
              expect(apart, `${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`).toBe(true);
            }
          }
        },
      ),
    );
  });

  it('refuses a frame that no longer fits, and places it again after a reset', () => {
    const packer = createShelfPacker(64);
    expect(packer.place('a', 64, 64)?.fresh).toBe(true);
    expect(packer.place('b', 10, 10)).toBeNull();
    packer.reset();
    expect(packer.place('b', 10, 10)).toEqual({
      slot: { x: 0, y: 0, width: 10, height: 10 },
      fresh: true,
    });
  });
});

describe('the quad batch', () => {
  it('keeps every quad, in order, as it grows past its first buffer', () => {
    const batch = createQuadBatch();
    for (let i = 0; i < 500; i++) batch.rect(i, i + 1, 1, 2, [i % 256, 7, 9], 0.5);
    batch.image(3, 4, 30, 40, 100, 200);
    expect(batch.count).toBe(501);
    expect([...batch.data.subarray(123 * QUAD_FLOATS, 124 * QUAD_FLOATS)]).toEqual([
      123, 124, 1, 2, 0, 0, 0, 0, 123, 7, 9, 0.5,
    ]);
    expect([...batch.data.subarray(500 * QUAD_FLOATS, 501 * QUAD_FLOATS)]).toEqual([
      3, 4, 30, 40, 100, 200, 1, 0, 255, 255, 255, 1,
    ]);
    batch.clear();
    batch.outline(10, 20, 8, 8, [1, 2, 3], 1);
    const edges = Array.from({ length: batch.count }, (_, i) =>
      [...batch.data.subarray(i * QUAD_FLOATS, i * QUAD_FLOATS + 4)].join(','),
    );
    // the four edges of an 8×8 box, touching but never overlapping, so a translucent corner isn't doubled
    expect(edges).toEqual(['10,20,8,1', '10,27,8,1', '10,21,1,6', '17,21,1,6']);
    batch.clear();
    expect(batch.count).toBe(0);
  });
});
