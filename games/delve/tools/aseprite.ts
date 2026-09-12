// aseprite.ts — a minimal reader for Aseprite files, enough to lift LAYERED frame data out.
//
// Only what the sprite importer needs: layers (names + visibility) and cels (raw, linked, or
// zlib-compressed RGBA images). No tilemaps, no blend modes, no slices, no tags.
//
// Format reference: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
//
// Two offsets in here are easy to get wrong and both were, the first time: the FRAME header keeps
// its old chunk count at byte 6 and its new 32-bit count at byte 12 (not the other way round), and
// a CEL's image data always starts at byte 16 of the chunk body regardless of which reserved-field
// layout the writing version used.
import { inflateSync } from 'node:zlib';

export interface AseLayer {
  readonly index: number;
  readonly name: string;
  readonly visible: boolean;
  /** Group layers hold no pixels; their children are indented by `childLevel`. */
  readonly isGroup: boolean;
  readonly childLevel: number;
}

export interface AseCel {
  readonly frame: number;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** RGBA, `w * h * 4` bytes. Empty for a cel that resolved to nothing. */
  readonly rgba: Uint8Array;
}

export interface AseFile {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly depth: 32 | 16 | 8;
  readonly layers: readonly AseLayer[];
  readonly cels: readonly AseCel[];
  /** Per-frame duration in ms. */
  readonly durations: readonly number[];
  /** Palette, only present for indexed (8-bit) files. */
  readonly palette: readonly [number, number, number, number][];
  readonly transparentIndex: number;
}

const MAGIC_FILE = 0xa5e0;
const MAGIC_FRAME = 0xf1fa;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_PALETTE = 0x2019;

export function readAseprite(bytes: Uint8Array): AseFile {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint16(4, true) !== MAGIC_FILE) throw new Error('not an Aseprite file');
  const frames = d.getUint16(6, true);
  const width = d.getUint16(8, true);
  const height = d.getUint16(10, true);
  const depth = d.getUint16(12, true) as 32 | 16 | 8;
  const transparentIndex = bytes[28];

  const layers: AseLayer[] = [];
  const cels: AseCel[] = [];
  const palette: [number, number, number, number][] = [];
  // Linked cels point at another frame's cel on the same layer, so keep what we have decoded.
  const byLayerFrame = new Map<string, AseCel>();

  const durations: number[] = [];
  let o = 128;
  for (let f = 0; f < frames; f++) {
    const frameBytes = d.getUint32(o, true);
    durations.push(d.getUint16(o + 8, true));
    if (d.getUint16(o + 4, true) !== MAGIC_FRAME) throw new Error(`bad frame header at ${o}`);
    const oldCount = d.getUint16(o + 6, true);
    const newCount = d.getUint32(o + 12, true);
    const chunks = newCount || oldCount;

    let p = o + 16;
    for (let c = 0; c < chunks; c++) {
      const size = d.getUint32(p, true);
      const type = d.getUint16(p + 4, true);
      const body = bytes.subarray(p + 6, p + size);
      const bd = new DataView(body.buffer, body.byteOffset, body.byteLength);

      if (type === CHUNK_LAYER) {
        const flags = bd.getUint16(0, true);
        const layerType = bd.getUint16(2, true);
        const childLevel = bd.getUint16(4, true);
        const nameLen = bd.getUint16(16, true);
        const name = new TextDecoder().decode(body.subarray(18, 18 + nameLen));
        layers.push({
          index: layers.length,
          name,
          visible: (flags & 1) !== 0,
          isGroup: layerType === 1,
          childLevel,
        });
      } else if (type === CHUNK_PALETTE) {
        const first = bd.getUint32(8, true);
        const last = bd.getUint32(12, true);
        let q = 24;
        for (let i = first; i <= last; i++) {
          const entryFlags = bd.getUint16(q, true);
          palette[i] = [body[q + 2], body[q + 3], body[q + 4], body[q + 5]];
          q += 6;
          if (entryFlags & 1) q += 2 + bd.getUint16(q, true); // a named entry
        }
      } else if (type === CHUNK_CEL) {
        const layer = bd.getUint16(0, true);
        const x = bd.getInt16(2, true);
        const y = bd.getInt16(4, true);
        const celType = bd.getUint16(7, true);
        if (celType === 1) {
          const from = bd.getUint16(16, true);
          const linked = byLayerFrame.get(`${from},${layer}`);
          if (linked) {
            const cel = { ...linked, frame: f, x, y };
            cels.push(cel);
            byLayerFrame.set(`${f},${layer}`, cel);
          }
          p += size;
          continue;
        }
        if (celType !== 0 && celType !== 2) {
          p += size;
          continue; // tilemap cels aren't used by this pack
        }
        const w = bd.getUint16(16, true);
        const h = bd.getUint16(18, true);
        const raw = body.subarray(20);
        const pixels = celType === 2 ? new Uint8Array(inflateSync(raw)) : raw;
        const cel: AseCel = {
          frame: f,
          layer,
          x,
          y,
          w,
          h,
          rgba: toRgba(pixels, w, h, depth, palette, transparentIndex),
        };
        cels.push(cel);
        byLayerFrame.set(`${f},${layer}`, cel);
      }
      p += size;
    }
    o += frameBytes;
  }

  return { width, height, frames, depth, layers, cels, durations, palette, transparentIndex };
}

/** Normalise any colour depth to straight RGBA, so callers only handle one layout. */
function toRgba(
  pixels: Uint8Array,
  w: number,
  h: number,
  depth: number,
  palette: readonly [number, number, number, number][],
  transparentIndex: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (depth === 32) {
      out[i * 4] = pixels[i * 4];
      out[i * 4 + 1] = pixels[i * 4 + 1];
      out[i * 4 + 2] = pixels[i * 4 + 2];
      out[i * 4 + 3] = pixels[i * 4 + 3];
    } else if (depth === 16) {
      // Grayscale + alpha.
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = pixels[i * 2];
      out[i * 4 + 3] = pixels[i * 2 + 1];
    } else {
      const idx = pixels[i];
      const c = palette[idx] ?? [0, 0, 0, 0];
      out[i * 4] = c[0];
      out[i * 4 + 1] = c[1];
      out[i * 4 + 2] = c[2];
      out[i * 4 + 3] = idx === transparentIndex ? 0 : c[3];
    }
  }
  return out;
}

/** Composite a frame's visible layers bottom-to-top, for verifying an import against the source. */
export function flatten(file: AseFile, frame: number): Uint8Array {
  const out = new Uint8Array(file.width * file.height * 4);
  const visible = new Set(file.layers.filter((l) => l.visible && !l.isGroup).map((l) => l.index));
  for (const cel of file.cels) {
    if (cel.frame !== frame || !visible.has(cel.layer)) continue;
    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        const a = cel.rgba[(y * cel.w + x) * 4 + 3];
        if (a === 0) continue;
        const dx = cel.x + x;
        const dy = cel.y + y;
        if (dx < 0 || dy < 0 || dx >= file.width || dy >= file.height) continue;
        const i = (dy * file.width + dx) * 4;
        out[i] = cel.rgba[(y * cel.w + x) * 4];
        out[i + 1] = cel.rgba[(y * cel.w + x) * 4 + 1];
        out[i + 2] = cel.rgba[(y * cel.w + x) * 4 + 2];
        out[i + 3] = a;
      }
    }
  }
  return out;
}
