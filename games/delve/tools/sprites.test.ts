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
  ALL_STEEL,
  MINER_SKIN,
  MINER_RAMPS,
  MINER_WITH_PACK,
  PLAYER_LAMP,
  TEMPLATE_PARTS,
  buildSkin,
  lampFrom,
} from '../client/src/render/entity/skin';
import { OVERHEAD, surfaceOf, type SpriteLight } from '../client/src/render/entity/surface';
import { BACKPACK, anchorPixel, decodeArt } from '../client/src/render/entity/attach';

// One directory per entity under sprites/, so the registry check walks the entity's own folder.
const SPRITE_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  '../client/src/render/entity/sprites/player',
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
    // Both skins must carry the SAME outline, or the comparison measures the rim rather than the
    // re-skin.
    drawSprite(plain, anim, 0, Math.floor(anim.w / 2), anim.h, { skin: MINER_SKIN });
    drawSprite(skinned, anim, 0, Math.floor(anim.w / 2), anim.h, {
      skin: { ...MINER_SKIN, ...buildSkin({ ...MINER_RAMPS, torso: ['#ff00ff'] }) },
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

describe('surface coordinates', () => {
  // The pixel-mapping pipeline: a pixel resolves to (along, around) on its part's surface, and a
  // material samples that. These are the invariants equipment authored against coordinates relies
  // on — get them wrong and a belt drawn at `along` 0.5 lands somewhere different every frame.
  const cel = (w: number, h: number, fill: (x: number, y: number) => boolean) => {
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fill(x, y)) data[y * w + x] = 1;
    return { spec: { x: 0, y: 0, w, h, data: Buffer.from(data).toString('base64') }, data };
  };

  it('runs `along` from 0 to 1 down a tall part', () => {
    const { spec, data } = cel(4, 10, () => true);
    const map = surfaceOf(spec, data);
    expect(map.along[0]).toBeCloseTo(0, 5);
    expect(map.along[9 * 4]).toBeCloseTo(1, 5);
    expect(map.along[5 * 4]).toBeCloseTo(5 / 9, 5);
  });

  it('runs `along` across a WIDE part, not down it', () => {
    // A foot, a fist, an outstretched arm. Scanning rows on a horizontal part would give every
    // pixel nearly the same `along`, collapsing the coordinate that equipment is placed against.
    const { spec, data } = cel(10, 3, () => true);
    const map = surfaceOf(spec, data);
    expect(map.along[0]).toBeCloseTo(0, 5);
    expect(map.along[9]).toBeCloseTo(1, 5);
    expect(map.along[1 * 10 + 5]).toBeCloseTo(5 / 9, 5);
  });

  it('runs `around` from -1 to +1 across the part, 0 on the spine', () => {
    const { spec, data } = cel(5, 8, () => true);
    const map = surfaceOf(spec, data);
    const row = 3 * 5;
    expect(map.around[row]).toBeCloseTo(-1, 5);
    expect(map.around[row + 2]).toBeCloseTo(0, 5);
    expect(map.around[row + 4]).toBeCloseTo(1, 5);
  });

  it('spans a run whole rather than per island', () => {
    // A part with a one-pixel hole is still one part. Measuring islands separately would restart
    // `around` mid-limb, so a marking would jump sides wherever the art has a gap.
    //
    // Tall on purpose: `around` runs across the part's SHORT axis, so a 5x4 shape is scanned by
    // column and this would be testing the vertical coordinate instead.
    const { spec, data } = cel(5, 12, (x) => x !== 2);
    const map = surfaceOf(spec, data);
    expect(map.around[6 * 5]).toBeCloseTo(-1, 5);
    expect(map.around[6 * 5 + 4]).toBeCloseTo(1, 5);
  });

  it('puts depth 0 at the silhouette and 1 deepest inside', () => {
    const { spec, data } = cel(9, 9, () => true);
    const map = surfaceOf(spec, data);
    expect(map.depth[0]).toBeLessThan(0.4); // a corner
    expect(map.depth[4 * 9 + 4]).toBeCloseTo(1, 5); // the centre
  });

  it('points the normal outward', () => {
    // From the distance-field gradient, so it works for any shape — a fist and a thigh both shade
    // correctly without anyone declaring which way the part points.
    const { spec, data } = cel(9, 9, () => true);
    const map = surfaceOf(spec, data);
    const top = 0 * 9 + 4;
    const bottom = 8 * 9 + 4;
    expect(map.normalY[top]).toBeLessThan(0); // up-facing edge points up
    expect(map.normalY[bottom]).toBeGreaterThan(0);
  });

  it('leaves every coordinate inside its declared range', () => {
    for (const anim of Object.values(PLAYER_SPRITES)) {
      for (const layer of anim.layers) {
        for (const c of layer.cels) {
          if (!c) continue;
          const map = surfaceOf(c, decode(c.data));
          for (let i = 0; i < map.along.length; i++) {
            if (decode(c.data)[i] === 0) continue;
            expect(map.along[i]).toBeGreaterThanOrEqual(0);
            expect(map.along[i]).toBeLessThanOrEqual(1);
            expect(Math.abs(map.around[i])).toBeLessThanOrEqual(1);
            expect(map.depth[i]).toBeGreaterThanOrEqual(0);
            expect(map.depth[i]).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('draws a material without changing the silhouette', () => {
    // A material must only decide COLOUR. If it changes which pixels are lit, equipment would
    // silently reshape the character.
    const anim = PLAYER_SPRITES.walk;
    const blank = () =>
      ({
        width: anim.w,
        height: anim.h,
        data: new Uint8ClampedArray(anim.w * anim.h * 4),
      }) as unknown as ImageData;
    const lit = (img: ImageData): number => {
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++;
      return n;
    };
    for (let f = 0; f < anim.frames; f++) {
      const flat = blank();
      const plate = blank();
      drawSprite(flat, anim, f, Math.floor(anim.w / 2), anim.ground, { skin: MINER_SKIN });
      drawSprite(plate, anim, f, Math.floor(anim.w / 2), anim.ground, { skin: ALL_STEEL });
      expect(lit(plate), `frame ${f}`).toBe(lit(flat));
    }
  });

  it('gives ONE BODY PART more shades than a flat ramp can', () => {
    // The reason the pipeline exists — but measured per PART, which is where the claim actually
    // lives. Across the whole figure a flat table already reaches six colours, because half a dozen
    // parts each contribute one or two, and comparing those totals made this test marginal enough to
    // fail once an outline added a colour to both sides. Within a single slot a flat ramp is capped
    // at its own length; a material is capped only by the band ladder.
    const anim = PLAYER_SPRITES.idle;
    const others = ['head', 'arm.near', 'arm.far', 'leg.near', 'leg.far', 'weapon', 'fx.damage'];
    const shades = (skin: object): number => {
      const img = {
        width: anim.w,
        height: anim.h,
        data: new Uint8ClampedArray(anim.w * anim.h * 4),
      } as unknown as ImageData;
      // Torso only, and no rim: anything else contributes colours that are not the torso's.
      drawSprite(img, anim, 0, Math.floor(anim.w / 2), anim.ground, {
        skin: { ...skin, hide: others, outline: null },
      });
      const seen = new Set<string>();
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue;
        seen.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
      }
      return seen.size;
    };
    const flat = shades(MINER_SKIN);
    const material = shades(ALL_STEEL);
    expect(flat).toBeLessThanOrEqual(MINER_RAMPS.torso.length);
    expect(material).toBeGreaterThan(flat);
  });
});

describe('lighting a material', () => {
  const anim = PLAYER_SPRITES.walk;
  const blank = () =>
    ({
      width: anim.w,
      height: anim.h,
      data: new Uint8ClampedArray(anim.w * anim.h * 4),
    }) as unknown as ImageData;
  const draw = (light?: SpriteLight): ImageData => {
    const img = blank();
    drawSprite(img, anim, 2, Math.floor(anim.w / 2), anim.ground, { skin: ALL_STEEL, light });
    return img;
  };
  const lit = (img: ImageData): number => {
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++;
    return n;
  };
  const differing = (a: ImageData, b: ImageData): number => {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i + 3] === 0) continue;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) n++;
    }
    return n;
  };

  it('changes shading without changing the silhouette', () => {
    // A light must only decide colour. If moving it changed which pixels are lit, the character
    // would visibly reshape as it walked past a lamp.
    const a = draw(OVERHEAD);
    const b = draw(PLAYER_LAMP);
    const c = draw(lampFrom(-30, 0));
    expect(lit(b)).toBe(lit(a));
    expect(lit(c)).toBe(lit(a));
    expect(differing(a, b)).toBeGreaterThan(0);
    expect(differing(a, c)).toBeGreaterThan(0);
  });

  it('lights the side the light is on', () => {
    // The clearest thing a positional light must get right, and the reason it is a position rather
    // than a fixed direction.
    const lum = (img: ImageData, from: number, to: number): number => {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < anim.h; y++) {
        for (let x = from; x < to; x++) {
          const i = (y * anim.w + x) * 4;
          if (img.data[i + 3] === 0) continue;
          sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
          n++;
        }
      }
      return n ? sum / n : 0;
    };
    const fromLeft = draw(lampFrom(-40, 0, 90));
    const fromRight = draw(lampFrom(40, 0, 90));
    const half = Math.floor(anim.w / 2);
    expect(lum(fromLeft, 0, half) - lum(fromLeft, half, anim.w)).toBeGreaterThan(
      lum(fromRight, 0, half) - lum(fromRight, half, anim.w),
    );
  });

  it('flattens toward mid with distance instead of darkening', () => {
    // The material owns FORM; the lighting pass owns darkness, compositing over the whole frame.
    // Multiplying brightness down here made a lamp-lit figure read dimmer than an overhead-lit one,
    // which is the wrong relationship between the two systems.
    const mean = (img: ImageData): number => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] === 0) continue;
        sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        n++;
      }
      return sum / n;
    };
    const near = mean(draw(PLAYER_LAMP));
    const far = mean(draw(lampFrom(0, 0, 4))); // reach so short nothing is lit
    expect(Math.abs(near - far)).toBeLessThan(near * 0.35);
  });

  it('carries the light with the sprite when it turns around', () => {
    // The light lives in the sprite's own space, so it is attached to the body. Mirror the flipped
    // render back and it must match the unflipped one exactly: same light relative to the body.
    //
    // This caught a real bug. Mirroring the light position and the pixel position but NOT the
    // surface normal flips the lambert's sign, so a turned-around character was lit on the wrong
    // side. Doing all the shading in sprite space removes the chance of that entirely.
    const img = (flip: boolean): ImageData => {
      const out = blank();
      drawSprite(out, anim, 2, Math.floor(anim.w / 2), anim.ground, {
        skin: ALL_STEEL,
        light: lampFrom(-40, 0, 90),
        flip,
      });
      return out;
    };
    const a = img(false);
    const b = img(true);
    // Mirror b back and it should match a: same light relative to the body, opposite facing.
    let same = 0;
    let total = 0;
    for (let y = 0; y < anim.h; y++) {
      for (let x = 0; x < anim.w; x++) {
        const i = (y * anim.w + x) * 4;
        const j = (y * anim.w + (anim.w - 1 - x)) * 4;
        if (a.data[i + 3] === 0) continue;
        total++;
        if (a.data[i] === b.data[j] && a.data[i + 1] === b.data[j + 1]) same++;
      }
    }
    expect(same / total).toBe(1);
  });

  it('does nothing to a flat colour table', () => {
    // Only materials sample the light. A skin with no materials must be unaffected, or moving a lamp
    // would recolour a character that has no shading to change.
    const flat = (light: SpriteLight): ImageData => {
      const img = blank();
      drawSprite(img, anim, 2, Math.floor(anim.w / 2), anim.ground, { skin: MINER_SKIN, light });
      return img;
    };
    expect(differing(flat(OVERHEAD), flat(lampFrom(-40, 10)))).toBe(0);
  });
});

describe('ground alignment', () => {
  // A character that floats even one pixel above the floor reads as hovering, and it is the kind of
  // error that survives every other check here: the silhouette, the palette and the coordinates are
  // all still correct.
  const bottomRow = (anim: (typeof PLAYER_SPRITES)[PlayerAnim], frame: number): number => {
    const mask = spriteMask(anim, frame);
    let bottom = -1;
    for (let y = 0; y < anim.h; y++) {
      for (let x = 0; x < anim.w; x++) if (mask[y * anim.w + x]) bottom = y;
    }
    return bottom;
  };

  it('plants every always-grounded animation flush on the ground line', () => {
    // `ground` is the row the feet stand ON, so the lowest DRAWN row must be the one just above it,
    // on every frame — not merely on the frame the importer happened to measure.
    //
    // `run` is NOT in this list, and finding that out was the point of writing it: the pack's run is
    // a sprint with an airborne phase, and its frame 3 sits four pixels clear of the ground. The
    // manifest still marks it grounded, which is the weaker and correct claim — that its MODAL
    // bottom row matches the shared ground line.
    for (const name of ['idle', 'walk', 'land', 'hurt', 'death'] as PlayerAnim[]) {
      const anim = PLAYER_SPRITES[name];
      for (let f = 0; f < anim.frames; f++) {
        expect(bottomRow(anim, f), `${name} frame ${f}`).toBe(anim.ground - 1);
      }
    }
  });

  it('lets airborne animations leave the ground line', () => {
    // The other half of the same rule: a jump is SUPPOSED to break contact, so pinning it flush
    // would be the bug. Asserted so nobody "fixes" it later.
    for (const name of ['jump', 'run'] as PlayerAnim[]) {
      const anim = PLAYER_SPRITES[name];
      const rows = Array.from({ length: anim.frames }, (_, f) => bottomRow(anim, f));
      expect(
        rows.some((r) => r !== anim.ground - 1),
        name,
      ).toBe(true);
    }
  });

  it('draws the feet on the row the caller asks for', () => {
    // The contract `drawPlayer` and the game both rely on: pass the floor's pixel row and the lowest
    // opaque pixel lands immediately above it.
    const anim = PLAYER_SPRITES.idle;
    const H = anim.h * 2;
    const img = {
      width: anim.w,
      height: H,
      data: new Uint8ClampedArray(anim.w * H * 4),
    } as unknown as ImageData;
    const footY = anim.h + 8;
    drawSprite(img, anim, 0, Math.floor(anim.w / 2), footY, { skin: MINER_SKIN });
    let lowest = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < anim.w; x++) if (img.data[(y * anim.w + x) * 4 + 3]) lowest = y;
    }
    expect(lowest).toBe(footY - 1);
  });
});

describe('attachments', () => {
  // Equipment that extends BEYOND the silhouette, which a re-skin can never do. The invariants here
  // are the ones that make an attachment authorable once and correct in every animation.
  const anim = PLAYER_SPRITES.walk;
  const blank = () =>
    ({
      width: anim.w,
      height: anim.h,
      data: new Uint8ClampedArray(anim.w * anim.h * 4),
    }) as unknown as ImageData;
  const lit = (img: ImageData): number => {
    let n = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++;
    return n;
  };
  const draw = (skin: object, frame: number, flip = false): ImageData => {
    const img = blank();
    drawSprite(img, anim, frame, Math.floor(anim.w / 2), anim.ground, { skin, flip });
    return img;
  };

  it('adds pixels outside the body, which is the whole point', () => {
    // A re-skin is silhouette-preserving by construction; an attachment must not be.
    let grew = 0;
    for (let f = 0; f < anim.frames; f++) {
      if (lit(draw(MINER_WITH_PACK, f)) > lit(draw(MINER_SKIN, f))) grew++;
    }
    expect(grew).toBeGreaterThan(0);
  });

  it('resolves an anchor on every frame that has the part', () => {
    // The anchor is a surface coordinate, so it must land somewhere real in every frame without any
    // per-frame authoring. A null here means an animation silently loses the item.
    const decode = (cel: { data: string }): Uint8Array =>
      new Uint8Array(Buffer.from(cel.data, 'base64'));
    for (const name of Object.keys(PLAYER_SPRITES) as PlayerAnim[]) {
      const a = PLAYER_SPRITES[name];
      const hasTorso = a.layers.some((l) => l.name === BACKPACK.anchor.slot);
      if (!hasTorso) continue;
      for (let f = 0; f < a.frames; f++) {
        expect(
          anchorPixel(a, f, BACKPACK.anchor, decode as never),
          `${name} frame ${f}`,
        ).not.toBeNull();
      }
    }
  });

  it('anchors at the requested height, not somewhere down the part', () => {
    // The first version searched (along, around) as one distance. Those axes have different ranges,
    // so it slid down the part to satisfy `around` and put the pack on the character's chest.
    const decode = (cel: { data: string }): Uint8Array =>
      new Uint8Array(Buffer.from(cel.data, 'base64'));
    const torso = anim.layers.find((l) => l.name === 'torso')!;
    for (let f = 0; f < anim.frames; f++) {
      const cel = torso.cels[f]!;
      const at = anchorPixel(anim, f, BACKPACK.anchor, decode as never)!;
      const within = (at[1] - cel.y) / Math.max(1, cel.h - 1);
      expect(Math.abs(within - BACKPACK.anchor.along), `frame ${f}`).toBeLessThan(0.3);
    }
  });

  it('stays on the same side of the body when the sprite flips', () => {
    // Attachments live in sprite space like the light does, so an item on the back turns with the
    // character instead of swapping to its chest.
    const a = draw(MINER_WITH_PACK, 0);
    const b = draw(MINER_WITH_PACK, 0, true);
    let same = 0;
    let total = 0;
    for (let y = 0; y < anim.h; y++) {
      for (let x = 0; x < anim.w; x++) {
        const i = (y * anim.w + x) * 4;
        const j = (y * anim.w + (anim.w - 1 - x)) * 4;
        if (a.data[i + 3] === 0) continue;
        total++;
        if (a.data[i] === b.data[j] && a.data[i + 1] === b.data[j + 1]) same++;
      }
    }
    expect(same / total).toBe(1);
  });

  it('decodes its authored art as written', () => {
    const art = decodeArt(BACKPACK.art);
    expect(art.h).toBe(BACKPACK.art.rows.length);
    expect(art.w).toBe(Math.max(...BACKPACK.art.rows.map((r) => r.length)));
    for (const index of art.data) expect(index).toBeLessThanOrEqual(BACKPACK.art.palette.length);
  });
});
