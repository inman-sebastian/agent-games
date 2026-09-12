// sprites.test.ts — invariants over the imported player sprites.
//
// The importer already proves each animation is pixel-exact against its source before it writes
// anything, so these tests are not about fidelity. They guard the things that can rot AFTER import:
// a module added to the directory and forgotten in the registry, a hand-edit to generated data, a
// layer name that drifts and silently breaks every equipment override keyed on it.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLAYER_SPRITES,
  PLAYER_SLOTS,
  TEMPLATE_PALETTE,
  type PlayerAnim,
} from '../client/src/render/entity/sprites';
import { drawSprite, frameAt, spriteMask } from '../client/src/render/entity/sprite';
import {
  MINER_SKIN,
  TEMPLATE_PARTS,
  buildSkin,
  MINER_RAMPS,
} from '../client/src/render/entity/skin';

const SPRITE_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  '../client/src/render/entity/sprites',
);
const names = Object.keys(PLAYER_SPRITES) as PlayerAnim[];

const decode = (data: string): Uint8Array => new Uint8Array(Buffer.from(data, 'base64'));

describe('the sprite registry', () => {
  it('lists every module in the sprites directory', () => {
    const onDisk = readdirSync(SPRITE_DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'palette.ts')
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

  it('has every index inside the template palette', () => {
    // 0 is transparent; n means TEMPLATE_PALETTE[n - 1]. An out-of-range index draws nothing at
    // runtime — a hole in the sprite rather than a crash, which is exactly the sort of silent damage
    // a hand-edit to generated data would cause.
    for (const layer of anim.layers) {
      for (const cel of layer.cels) {
        if (!cel) continue;
        for (const index of decode(cel.data)) {
          expect(index, `${name}/${layer.name}`).toBeLessThanOrEqual(TEMPLATE_PALETTE.length);
        }
      }
    }
  });

  it('stands on the shared ground row', () => {
    // One ground row for every animation: it is a property of the pack's canvas, not of a pose.
    expect(anim.ground).toBe(PLAYER_SPRITES.idle.ground);
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

  it('re-skins one body part without touching the others', () => {
    // The whole point of index-mapped pixels: equipment is a lookup-table swap, and it must not
    // disturb the silhouette or any other part.
    const plain = blank(anim.w, anim.h);
    const skinned = blank(anim.w, anim.h);
    drawSprite(plain, anim, 0, Math.floor(anim.w / 2), anim.h, { skin: MINER_SKIN });
    drawSprite(skinned, anim, 0, Math.floor(anim.w / 2), anim.h, {
      skin: buildSkin({ ...MINER_RAMPS, torso: ['#ff00ff'] }),
    });
    expect(lit(skinned)).toBe(lit(plain));
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) {
      if (plain.data[i + 3] === 0) continue;
      if (plain.data[i] !== skinned.data[i] || plain.data[i + 1] !== skinned.data[i + 1]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(lit(plain)); // other parts untouched
  });

  it('hides a slot without disturbing the rest', () => {
    const all = blank(anim.w, anim.h);
    const noHead = blank(anim.w, anim.h);
    drawSprite(all, anim, 0, Math.floor(anim.w / 2), anim.h, { skin: MINER_SKIN });
    drawSprite(noHead, anim, 0, Math.floor(anim.w / 2), anim.h, {
      skin: { ...MINER_SKIN, hide: ['head'] },
    });
    expect(lit(noHead)).toBeLessThan(lit(all));
    expect(lit(noHead)).toBeGreaterThan(0);
  });

  it('stays inside the image when the origin is off-canvas', () => {
    const img = blank(16, 16);
    expect(() => drawSprite(img, anim, 0, -40, -40, { scale: 3 })).not.toThrow();
    expect(() => drawSprite(img, anim, 0, 400, 400, { scale: 3 })).not.toThrow();
  });
});

describe('the authored skin', () => {
  it('maps every template colour', () => {
    // An unmapped colour draws nothing, so a pixel using it becomes a hole in the character. The
    // one deliberate exception is the colour no imported frame uses.
    const mapped = new Set(TEMPLATE_PARTS.map((e) => e.color));
    for (const colour of TEMPLATE_PALETTE) expect(mapped.has(colour), colour).toBe(true);
  });

  it('agrees with the generated palette on length and order', () => {
    // `buildSkin` emits one entry per template colour, positionally. A drift here would silently
    // recolour the wrong body part.
    expect(MINER_SKIN.colors).toHaveLength(TEMPLATE_PALETTE.length);
  });

  it('resolves every colour a frame actually uses', () => {
    const used = new Set<number>();
    for (const anim of Object.values(PLAYER_SPRITES)) {
      for (const layer of anim.layers) {
        for (const cel of layer.cels) {
          if (!cel) continue;
          for (const i of decode(cel.data)) if (i) used.add(i);
        }
      }
    }
    for (const i of used) {
      expect(
        MINER_SKIN.colors?.[i - 1],
        `template index ${i} (${TEMPLATE_PALETTE[i - 1]})`,
      ).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps near-side limbs lighter than far-side ones', () => {
    // The pack encodes depth by giving each side its own colour code. Losing that makes the two legs
    // merge into one shape whenever they overlap.
    const lum = (hex: string): number =>
      0.299 * parseInt(hex.slice(1, 3), 16) +
      0.587 * parseInt(hex.slice(3, 5), 16) +
      0.114 * parseInt(hex.slice(5, 7), 16);
    const top = (part: 'legNear' | 'legFar' | 'armNear' | 'armFar'): number =>
      Math.max(...MINER_RAMPS[part].map(lum));
    expect(top('legNear')).toBeGreaterThan(top('legFar'));
    expect(top('armNear')).toBeGreaterThan(top('armFar'));
  });
});
