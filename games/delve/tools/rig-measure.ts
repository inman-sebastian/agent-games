// rig-measure.ts — how close is the humanoid silhouette to the reference, as a number.
//
// Five iterations went by judging a 48px figure from 6x screenshots without converging, because
// "the legs look long" is not a measurement. The reference pack's per-part layer extents are
// knowable and the coded render mode paints each of our parts in that part's reference colour, so
// the question becomes arithmetic: render coded, group pixels by colour, compare extents. The
// numbers themselves live in rig-reference.ts, shared with the test that gates them.
//
//   pnpm --filter delve exec tsx tools/rig-measure.ts [--parts] [--png sheet.png] [--shaded]
//
// `--png` writes idle plus the eight walk frames as one sheet, which is what keeps the whole loop
// headless: the table proves the extents, the sheet proves the shape the extents sit in.
//
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { buildHumanoid, idlePose, walkPose, CODED } from '../client/src/render/entity/humanoid';
import { drawRig, rigPalettes } from '../client/src/render/entity/rig';
import { DEFAULT_CONFIG, type HumanoidConfig } from '../client/src/render/entity/config';
import {
  GROUND,
  H,
  K,
  OUR_HEIGHT,
  PROFILES,
  REFERENCE,
  W,
  measure,
  toRef,
  type GroupName,
} from './rig-reference';

// ---- PNG out ------------------------------------------------------------------------------------
//
// A tiny encoder rather than a canvas dependency: the whole file is one IDAT of filter-0 scanlines,
// and zlib ships with Node. It exists so judging the silhouette never needs a browser.
function writePng(path: string, w: number, h: number, rgba: Uint8ClampedArray): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter type 0 — no prediction, the file is tiny either way
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

/** Idle plus the eight walk frames, on a checker so an off-by-one in the silhouette is visible. */
function sheet(cfg: HumanoidConfig, path: string, codedMode: boolean, zoom = 4): void {
  const frames = 9;
  const sw = W * frames * zoom;
  const sh = H * zoom;
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const shade =
      (Math.floor((i % sw) / zoom / 4) + Math.floor(Math.floor(i / sw) / zoom / 4)) % 2 ? 30 : 22;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = shade;
    out[i * 4 + 3] = 255;
  }
  const rig = buildHumanoid(cfg);
  const palettes = rigPalettes(rig);
  for (let f = 0; f < frames; f++) {
    const img = {
      width: W,
      height: H,
      data: new Uint8ClampedArray(W * H * 4),
    } as unknown as Parameters<typeof drawRig>[0];
    const pose = f === 0 ? idlePose(cfg) : walkPose((f - 1) / 8, cfg);
    drawRig(img, rig, pose, palettes, Math.floor(W / 2), GROUND, undefined, codedMode);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        if (img.data[si + 3] === 0) continue;
        for (let dy = 0; dy < zoom; dy++) {
          for (let dx = 0; dx < zoom; dx++) {
            const di = ((y * zoom + dy) * sw + (f * W + x) * zoom + dx) * 4;
            out[di] = img.data[si];
            out[di + 1] = img.data[si + 1];
            out[di + 2] = img.data[si + 2];
            out[di + 3] = 255;
          }
        }
      }
    }
  }
  writePng(path, sw, sh, out);
  console.log(`\nwrote ${path} — idle + 8 walk frames at ${zoom}x`);
}

// ---- report -------------------------------------------------------------------------------------
const cfg = DEFAULT_CONFIG;
const { groups: got, shapes, byColour, uncoded } = measure(cfg);
for (const k of uncoded) {
  console.warn(
    `\n⚠ uncoded colour ${k} — a part is missing its \`coded\` entry, or a GROUPS row is stale`,
  );
}

console.log(
  `\nhumanoid vs reference — build "${cfg.build}", our ${OUR_HEIGHT}px figure scaled by 1/${K.toFixed(3)}`,
);
console.log('\npart      |    top (ref/ours)   | bottom (ref/ours)   |  width (ref/ours)');
console.log('----------+---------------------+---------------------+--------------------');

let worst = 0;
for (const [name, ref] of Object.entries(REFERENCE) as [
  GroupName,
  (typeof REFERENCE)[GroupName],
][]) {
  const e = got[name];
  if (!e) {
    console.log(`${name.padEnd(9)} |  MISSING — no pixels carried this group's coded colour`);
    worst = Infinity;
    continue;
  }
  const cell = (refV: number, ourV: number): string => {
    const d = ourV - refV;
    worst = Math.max(worst, Math.abs(d));
    const flag = Math.abs(d) >= 1 ? (d > 0 ? ' ▲' : ' ▼') : '  ';
    return `${refV.toFixed(0).padStart(4)} /${ourV.toFixed(1).padStart(6)}${flag}`;
  };
  console.log(
    `${name.padEnd(9)} | ${cell(ref.top, toRef(e.top))} | ${cell(ref.bottom, toRef(e.bottom))} | ${cell(ref.width, e.width / K)}`,
  );
}

if (process.argv.includes('--parts')) {
  console.log('\nper coded colour (debug):');
  for (const [name, c] of Object.entries(CODED)) {
    const e = byColour[`${c[0]},${c[1]},${c[2]}`];
    console.log(
      `  ${name.padEnd(10)} ${e ? `rows ${toRef(e.top).toFixed(1)}..${toRef(e.bottom).toFixed(1)} ref  width ${(e.width / K).toFixed(1)} ref  ${e.count}px` : 'NOT DRAWN — fully occluded'}`,
    );
  }
}

const pngAt = process.argv.indexOf('--png');
if (pngAt >= 0)
  sheet(cfg, process.argv[pngAt + 1] ?? 'rig.png', !process.argv.includes('--shaded'));

// Shape, per row — the number that matters. Bounding boxes can agree while the shapes don't.
console.log('\npart      | width err | angle err | ours vs reference, width per row');
console.log('----------+-----------+-----------+---------------------------------------------');
let worstShape = 0;
for (const [name, err] of Object.entries(shapes)) {
  worstShape = Math.max(worstShape, err.width, err.drift);
  const ref = PROFILES[name as keyof typeof PROFILES];
  const fmt = (a: readonly number[]): string => a.map((v) => v.toFixed(0).padStart(2)).join('');
  console.log(
    `${name.padEnd(9)} |   ${err.width.toFixed(2)}    |   ${err.drift.toFixed(2)}    | ${fmt(err.widths)}\n` +
      `${' '.repeat(9)} |           |           | ${fmt(ref.widths)}  (reference)`,
  );
}
console.log(`\nworst SHAPE error: ${worstShape.toFixed(2)} reference px per row`);

console.log(
  `worst extent deviation: ${worst.toFixed(1)} reference px  (▲ ours is lower/wider, ▼ higher/narrower)`,
);
console.log(
  'a deviation under 1 reference px is under one pixel of the art it was measured from.\n',
);
