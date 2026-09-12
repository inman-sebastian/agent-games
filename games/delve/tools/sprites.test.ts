// sprites.test.ts — invariants over the imported player sprites.
//
// The importer already proves each animation is pixel-exact against its source before it writes
// anything, so these tests are not about fidelity. They guard the things that can rot AFTER import:
// a module added to the directory and forgotten in the registry, a hand-edit to generated data, a
// layer name that drifts and silently breaks every equipment override keyed on it.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_SPRITES, PLAYER_SLOTS, type PlayerAnim } from '../client/src/render/entity/sprites';
import { drawSprite, frameAt, spriteMask } from '../client/src/render/entity/sprite';

const SPRITE_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  '../client/src/render/entity/sprites',
);
const names = Object.keys(PLAYER_SPRITES) as PlayerAnim[];

const decode = (data: string): Uint8Array => new Uint8Array(Buffer.from(data, 'base64'));

describe('the sprite registry', () => {
  it('lists every module in the sprites directory', () => {
    const onDisk = readdirSync(SPRITE_DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) =>
        f
          .replace(/\.ts$/, '')
          .replace(/^player-/, '')
          .replace(/-/g, '_'),
      )
      .sort();
    expect(names.slice().sort()).toEqual(onDisk);
  });

  it('is not empty', () => {
    expect(names.length).toBeGreaterThan(0);
  });
});

describe.each(names)('%s', (name) => {
  const anim = PLAYER_SPRITES[name];

  it('has a coherent frame count', () => {
    expect(anim.frames).toBeGreaterThan(0);
    expect(anim.durations).toHaveLength(anim.frames);
    for (const d of anim.durations) expect(d).toBeGreaterThan(0);
    for (const layer of anim.layers) expect(layer.cels).toHaveLength(anim.frames);
  });

  it('uses only known layer slots', () => {
    // An unrecognised name here means an equipment override written against `PLAYER_SLOTS` would
    // silently miss this animation — the failure mode normalisation exists to prevent.
    for (const layer of anim.layers) {
      expect(PLAYER_SLOTS as readonly string[]).toContain(layer.name);
    }
  });

  it('names each slot at most once', () => {
    const seen = new Set(anim.layers.map((l) => l.name));
    expect(seen.size).toBe(anim.layers.length);
  });

  it('has cel data matching its declared size, inside the canvas', () => {
    for (const layer of anim.layers) {
      for (const [f, cel] of layer.cels.entries()) {
        if (!cel) continue;
        const where = `${name}/${layer.name}/frame ${f}`;
        expect(decode(cel.data), where).toHaveLength(cel.w * cel.h);
        expect(cel.x, where).toBeGreaterThanOrEqual(0);
        expect(cel.y, where).toBeGreaterThanOrEqual(0);
        expect(cel.x + cel.w, where).toBeLessThanOrEqual(anim.w);
        expect(cel.y + cel.h, where).toBeLessThanOrEqual(anim.h);
      }
    }
  });

  it('has every index inside its layer palette', () => {
    // 0 is transparent; n means palette[n - 1]. An out-of-range index draws nothing at runtime,
    // which is a hole in the sprite rather than a crash — exactly the sort of silent damage a
    // hand-edit to generated data would cause.
    for (const layer of anim.layers) {
      expect(layer.palette.length, `${name}/${layer.name} has no palette`).toBeGreaterThan(0);
      for (const c of layer.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      for (const cel of layer.cels) {
        if (!cel) continue;
        for (const index of decode(cel.data)) {
          expect(index, `${name}/${layer.name}`).toBeLessThanOrEqual(layer.palette.length);
        }
      }
    }
  });

  it('draws something on every frame', () => {
    for (let f = 0; f < anim.frames; f++) {
      const mask = spriteMask(anim, f);
      const lit = mask.reduce((a, b) => a + b, 0);
      expect(lit, `${name} frame ${f} is empty`).toBeGreaterThan(0);
    }
  });

  it('advances through every frame over one loop', () => {
    const total = anim.durations.reduce((a, b) => a + b, 0);
    const seen = new Set<number>();
    for (let ms = 0; ms < total; ms++) seen.add(frameAt(anim, ms));
    expect(seen.size).toBe(anim.frames);
  });
});

describe('drawSprite', () => {
  const anim = PLAYER_SPRITES.idle;
  const blank = (w: number, h: number) =>
    ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as unknown as ImageData;
  const lit = (img: ImageData): number => {
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++;
    return n;
  };

  it('draws the frame at whole-pixel scale', () => {
    const one = blank(anim.w, anim.h * 2);
    drawSprite(one, anim, 0, Math.floor(anim.w / 2), anim.h * 2);
    const two = blank(anim.w * 2, anim.h * 4);
    drawSprite(two, anim, 0, anim.w, anim.h * 4, { scale: 2 });
    // Every source pixel becomes exactly scale^2 destination pixels — no resampling, no soft edges.
    expect(lit(two)).toBe(lit(one) * 4);
  });

  it('mirrors without losing a pixel', () => {
    const a = blank(anim.w, anim.h);
    const b = blank(anim.w, anim.h);
    drawSprite(a, anim, 0, Math.floor(anim.w / 2), anim.h);
    drawSprite(b, anim, 0, Math.floor(anim.w / 2), anim.h, { flip: true });
    // Flipping indices is exact; flipping already-drawn pixels would not be.
    expect(lit(b)).toBe(lit(a));
  });

  it('re-skins a single layer without touching the others', () => {
    // The whole point of index-mapped layers: equipment is a palette swap, and it must not disturb
    // the silhouette or any other part.
    const plain = blank(anim.w, anim.h);
    const skinned = blank(anim.w, anim.h);
    drawSprite(plain, anim, 0, Math.floor(anim.w / 2), anim.h);
    const torso = anim.layers.find((l) => l.name === 'torso');
    expect(torso).toBeDefined();
    drawSprite(skinned, anim, 0, Math.floor(anim.w / 2), anim.h, {
      skin: { torso: torso!.palette.map(() => '#ff00ff') },
    });
    expect(lit(skinned)).toBe(lit(plain));
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) {
      if (plain.data[i + 3] === 0) continue;
      if (plain.data[i] !== skinned.data[i] || plain.data[i + 1] !== skinned.data[i + 1]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(lit(plain)); // other layers untouched
  });

  it('stays inside the image when the origin is off-canvas', () => {
    const img = blank(16, 16);
    expect(() => drawSprite(img, anim, 0, -40, -40, { scale: 3 })).not.toThrow();
    expect(() => drawSprite(img, anim, 0, 400, 400, { scale: 3 })).not.toThrow();
  });
});
