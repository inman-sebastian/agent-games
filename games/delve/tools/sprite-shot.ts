// sprite-shot.ts — render an imported animation to a PNG, headlessly.
//
//   pnpm --filter delve exec tsx tools/sprite-shot.ts <anim> out.png [--scale 3] [--flip]
//                                                     [--template] [--hide fx.damage]
//
// Draws with the authored miner skin by default. `--template` shows the pack's raw colour codes
// instead, which is the view to use when checking an import or reasoning about which part is which.
//
// No browser, no dev server, no screenshot — it feeds `drawSprite` a plain buffer and writes the PNG
// through zlib, same as tools/rig-measure.ts. Use it to check an import, or to see an equipment
// re-skin, without leaving the terminal. `client/labs/sprite-lab.html` is the interactive version.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { PLAYER_SPRITES, type PlayerAnim } from '../client/src/render/entity/sprites';
import { drawSprite, type SpriteSkin } from '../client/src/render/entity/sprite';
import { MINER_SKIN } from '../client/src/render/entity/skin';

const args = process.argv.slice(2);
const [name, out] = args;
const anim = PLAYER_SPRITES[name as PlayerAnim];
if (!anim || !out) {
  console.error(
    `usage: sprite-shot.ts <anim> out.png [--scale n] [--flip] [--skin slot=#hex,...] [--hide slot,...]`,
  );
  console.error(`anims: ${Object.keys(PLAYER_SPRITES).join(', ')}`);
  process.exit(1);
}

const flag = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const scale = Math.max(1, Number(flag('--scale') ?? 3));
const flip = args.includes('--flip');

// A recoloured slot gets a FLAT ramp: the pack's parts are single flat colours, so there is no
// gradient to remap yet. Real armour will author a full ramp per slot, as a material does.
const hide = (flag('--hide') ?? '').split(',').filter(Boolean);
// `--template` leaves every colour as the pack authored it: no `colors` mapping at all, which is the
// view to use when checking an import or working out which code colour is which body part.
const skin: SpriteSkin = args.includes('--template')
  ? { hide }
  : { ...MINER_SKIN, hide: [...(MINER_SKIN.hide ?? []), ...hide] };

const W = anim.w * anim.frames * scale;
const H = anim.h * scale;
const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
for (let f = 0; f < anim.frames; f++) {
  drawSprite(
    img as unknown as ImageData,
    anim,
    f,
    Math.round((f * anim.w + anim.w / 2) * scale),
    anim.h * scale,
    { scale, flip, skin },
  );
}

/** Minimal PNG writer: one IDAT of filter-0 scanlines. zlib ships with Node; a canvas does not. */
function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tagged));
    return Buffer.concat([len, tagged, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Last line on purpose: `writePng` reaches for the `const` CRC table above, and calling it any
// earlier in the module hits the temporal dead zone.
writePng(out, W, H, img.data);
console.log(`${name}: ${anim.frames} frames at ${scale}x -> ${out} (${W}x${H})`);
