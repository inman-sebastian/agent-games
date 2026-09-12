// import-aseprite.ts — turn a layered .aseprite animation into a committed SpriteAnim module.
//
//   pnpm --filter delve exec tsx tools/import-aseprite.ts <file.aseprite> <exportName> [--out dir]
//
// Reads the per-layer cels, maps each layer's colours to indices (so a layer's look is a swappable
// ramp — see sprite.ts), and writes a TypeScript module under
// `client/src/render/entity/sprites/`.
//
// IT VERIFIES BEFORE IT WRITES. The emitted data is decoded back, composited, and compared pixel for
// pixel against the .aseprite's own layers; if a single pixel differs the import fails and writes
// nothing. When a sibling PNG export exists it is diffed too, which is what catches a layer that
// should have been skipped — the pack's files carry a full-canvas "BG" layer that its own PNG export
// leaves out, and including it would have silently doubled every frame's pixel count.
//
// The source .aseprite files are NOT committed. This runs once per animation against a local copy of
// the purchased pack and the generated module is what ships.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readAseprite, flatten, type AseFile } from './aseprite';

/**
 * Layers that are scaffolding, backdrop or baked FX rather than character parts.
 *
 * The pack is inconsistent file to file — forty-odd animations authored over time — so this list is
 * long and every entry earned its place by failing the PNG diff. `gif bg` is a full-canvas backdrop
 * for GIF export; `Flattened` is a composite the artist left in beside the real layers; `Damage
 * Indicator` is a flash that DELVE should render as an effect rather than bake into art.
 */
const SKIP_LAYERS = new Set([
  'bg',
  'gif bg',
  'background',
  'flattened',
  'layer 1',
  'layer 2',
  'layer 3',
  'reference',
  'ref',
  'shadow',
  'door',
  'window',
  'dust',
  'slashies',
  'gunshot',
  'bullet',
  'old legs',
]);

/**
 * Layer names, normalised to DELVE's slots.
 *
 * This matters more than it looks: `drawSprite`'s equipment override keys on the layer name, so a
 * chest piece that fits the idle has to fit the walk too. The pack calls the same part "Back Arm" in
 * one file and "Back Hand" or "Left Arm" in another, and an un-normalised import would give the same
 * body part three different names across animations and silently break every override.
 */
const SLOTS: readonly [RegExp, string][] = [
  [/^head$/i, 'head'],
  [/^torso$/i, 'torso'],
  [/^(back|left)\s*(arm|hand)$/i, 'arm.far'],
  [/^(front|lead|right)\s*(arm|hand)$/i, 'arm.near'],
  [/^(back|left)\s*leg$/i, 'leg.far'],
  [/^((front|lead|right)\s*leg|new legs)$/i, 'leg.near'],
  // The pack already separates weapons as their own layer, which is the equipment pipeline for free.
  [/^(sword(\/sheathe)?|gun|katana)$/i, 'weapon'],
  // Baked FX kept as their own layer rather than skipped: keeping it makes the import exact, and a
  // caller that wants to render the flash itself simply does not draw this slot.
  [/^damage indicator$/i, 'fx.damage'],
];

const slotFor = (name: string): string | null =>
  SLOTS.find(([re]) => re.test(name.trim()))?.[1] ?? null;

const args = process.argv.slice(2);
const [source, exportName] = args;
if (!source || !exportName) {
  console.error(
    'usage: import-aseprite.ts <file.aseprite> <EXPORT_NAME> [--out dir] [--skip a,b] ' +
      '[--keep-strays] [--allow-unknown-layers] [--trust-source]',
  );
  process.exit(1);
}
const outAt = args.indexOf('--out');
const outDir = resolve(
  outAt >= 0
    ? args[outAt + 1]
    : join(dirname(new URL(import.meta.url).pathname), '../client/src/render/entity/sprites'),
);

const file = readAseprite(new Uint8Array(readFileSync(source)));
const extraSkip = new Set(
  (args[args.indexOf('--skip') + 1] ?? '')
    .split(',')
    .filter(Boolean)
    .map((n) => n.trim().toLowerCase()),
);
const parts = file.layers.filter(
  (l) =>
    !l.isGroup &&
    l.visible &&
    !SKIP_LAYERS.has(l.name.toLowerCase()) &&
    !extraSkip.has(l.name.toLowerCase()),
);
if (parts.length === 0) throw new Error('no character layers found');

const unnamed = parts.filter((l) => slotFor(l.name) === null);
if (unnamed.length > 0 && !args.includes('--allow-unknown-layers')) {
  throw new Error(
    `layer(s) map to no DELVE slot: ${unnamed.map((l) => `"${l.name}"`).join(', ')}. ` +
      'Add a SLOTS pattern, or --skip them, or pass --allow-unknown-layers to keep the raw name.',
  );
}

console.log(`${basename(source)}: ${file.width}x${file.height}, ${file.frames} frames`);
console.log(
  `  layers kept:    ${parts.map((l) => `${l.name} -> ${slotFor(l.name) ?? l.name}`).join(', ')}`,
);
const skipped = file.layers.filter((l) => !parts.includes(l));
if (skipped.length) console.log(`  layers skipped: ${skipped.map((l) => l.name).join(', ')}`);

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

interface OutCel {
  x: number;
  y: number;
  w: number;
  h: number;
  data: string;
}

const allLayers = parts.map((layer) => {
  // One palette per layer, in first-seen order, so indices are stable across frames.
  const palette: string[] = [];
  const indexOf = new Map<string, number>();
  const cels: (OutCel | null)[] = [];

  for (let f = 0; f < file.frames; f++) {
    const cel = file.cels.find((c) => c.frame === f && c.layer === layer.index);
    if (!cel || cel.w === 0 || cel.h === 0) {
      cels.push(null);
      continue;
    }
    // Trim to the cel's own opaque bounds: Aseprite cels are already tight, but a linked or
    // hand-edited one may not be, and a fat cel is wasted bytes in the committed module.
    let minX = cel.w;
    let minY = cel.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        if (cel.rgba[(y * cel.w + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX) {
      cels.push(null);
      continue;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const indices = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y + minY) * cel.w + (x + minX)) * 4;
        if (cel.rgba[s + 3] === 0) continue;
        const key = hex(cel.rgba[s], cel.rgba[s + 1], cel.rgba[s + 2]);
        let idx = indexOf.get(key);
        if (idx === undefined) {
          palette.push(key);
          idx = palette.length; // 1-based; 0 stays transparent
          indexOf.set(key, idx);
        }
        indices[y * w + x] = idx;
      }
    }
    cels.push({
      x: cel.x + minX,
      y: cel.y + minY,
      w,
      h,
      data: Buffer.from(indices).toString('base64'),
    });
  }
  return { name: slotFor(layer.name) ?? layer.name, palette, cels };
});

// A layer present in the file but empty in every frame carries no palette and no cels — the arm
// tucked entirely behind the body through a whole push animation, for instance. Keeping it would put
// a slot with an empty palette in the shipped data, which reads as a broken layer rather than an
// absent one.
const layers = allLayers.filter((l) => l.cels.some(Boolean));
const empty = allLayers.filter((l) => !l.cels.some(Boolean));
if (empty.length) console.log(`  layers empty:   ${empty.map((l) => l.name).join(', ')} (dropped)`);
if (layers.length === 0) throw new Error('every layer is empty in every frame');

for (const l of layers) {
  const used = l.cels.filter(Boolean).length;
  console.log(
    `  ${l.name.padEnd(12)} ${used}/${file.frames} frames, ${l.palette.length} colour(s)`,
  );
}

// ---- verify, before anything is written ---------------------------------------------------------
function decoded(frame: number): Uint8Array {
  const out = new Uint8Array(file.width * file.height * 4);
  for (const layer of layers) {
    const cel = layer.cels[frame];
    if (!cel) continue;
    const indices = Buffer.from(cel.data, 'base64');
    for (let y = 0; y < cel.h; y++) {
      for (let x = 0; x < cel.w; x++) {
        const idx = indices[y * cel.w + x];
        if (idx === 0) continue;
        const px = cel.x + x;
        const py = cel.y + y;
        if (px < 0 || py < 0 || px >= file.width || py >= file.height) continue;
        const c = layer.palette[idx - 1];
        const i = (py * file.width + px) * 4;
        out[i] = parseInt(c.slice(1, 3), 16);
        out[i + 1] = parseInt(c.slice(3, 5), 16);
        out[i + 2] = parseInt(c.slice(5, 7), 16);
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

const kept: AseFile = { ...file, layers: parts };
let worst = 0;
for (let f = 0; f < file.frames; f++) {
  const mine = decoded(f);
  const theirs = flatten(kept, f);
  let diff = 0;
  for (let i = 0; i < mine.length; i += 4) {
    const a = mine[i + 3] === 0;
    const b = theirs[i + 3] === 0;
    if (
      a !== b ||
      (!a &&
        (mine[i] !== theirs[i] || mine[i + 1] !== theirs[i + 1] || mine[i + 2] !== theirs[i + 2]))
    ) {
      diff++;
    }
  }
  worst = Math.max(worst, diff);
}
if (worst > 0)
  throw new Error(`round trip differs by ${worst} px on at least one frame — refusing to write`);
console.log(`  round trip:     exact on all ${file.frames} frames`);

// The pack ships a PNG export beside most .aseprite files. Diffing it catches the class of error a
// self-consistent round trip cannot: a layer kept or skipped that the artist decided differently.
const png = source.replace(/\.aseprite$/i, '.png');
if (existsSync(png) && hasPillow()) {
  const raw = execFileSync(
    'python3',
    [
      '-c',
      `from PIL import Image
import sys, json
im = Image.open(${JSON.stringify(png)}).convert('RGBA')
sys.stdout.write(json.dumps([im.size[0], im.size[1], list(im.tobytes())]))`,
    ],
    { maxBuffer: 1 << 30 },
  ).toString();
  const [pw, ph, flat] = JSON.parse(raw) as [number, number, number[]];
  if (ph === file.height && pw >= file.width * file.frames) {
    // Split the difference by DIRECTION, because the two mean opposite things. Pixels we have that
    // the export lacks are usually stray marks on a layer the artist had hidden — droppable. Pixels
    // the export has that we lack mean a layer was wrongly skipped, which is not droppable at all.
    let extra = 0;
    let missing = 0;
    let recolour = 0;
    const extraLayers = new Map<string, number>();
    for (let f = 0; f < file.frames; f++) {
      const mine = decoded(f);
      for (let y = 0; y < file.height; y++) {
        for (let x = 0; x < file.width; x++) {
          const m = (y * file.width + x) * 4;
          const s = (y * pw + f * file.width + x) * 4;
          const a = mine[m + 3] !== 0;
          const b = flat[s + 3] !== 0;
          if (a && !b) {
            extra++;
            for (const layer of layers) {
              const cel = layer.cels[f];
              if (!cel) continue;
              const lx = x - cel.x;
              const ly = y - cel.y;
              if (lx < 0 || ly < 0 || lx >= cel.w || ly >= cel.h) continue;
              if (Buffer.from(cel.data, 'base64')[ly * cel.w + lx] !== 0) {
                extraLayers.set(layer.name, (extraLayers.get(layer.name) ?? 0) + 1);
              }
            }
          } else if (!a && b) {
            missing++;
          } else if (
            a &&
            (mine[m] !== flat[s] || mine[m + 1] !== flat[s + 1] || mine[m + 2] !== flat[s + 2])
          ) {
            recolour++;
          }
        }
      }
    }
    if (extra + missing + recolour === 0) {
      console.log(`  vs PNG export:  exact on all ${file.frames} frames`);
    } else {
      console.log(
        `  vs PNG export:  ${extra} px ours-only, ${missing} px export-only, ${recolour} px recoloured`,
      );
      if (extraLayers.size) {
        console.log(
          `    ours-only pixels live on: ${[...extraLayers].map(([n, c]) => `${n} (${c})`).join(', ')}`,
        );
      }
      if (missing > 0 || recolour > 0) {
        // Differences in BOTH directions spread evenly across every layer mean the PNG export is
        // simply older than the .aseprite — the artist edited the layers and did not re-export. The
        // layers round-trip exactly, so they are the newer truth, but that is a judgement for a
        // human to make per file rather than something to assume.
        if (!args.includes('--trust-source')) {
          // Geometry identical, only colours differ: that is layer opacity or a blend mode, which
          // this reader deliberately ignores. The unblended layer is the more useful thing to keep —
          // a caller can blend it, or not draw it at all.
          const why =
            extra === 0 && missing === 0
              ? 'every differing pixel is the SAME pixel in a different colour, which means layer ' +
                'opacity or a blend mode — this reader composites straight. Keeping the layer ' +
                'unblended is usually what you want; --trust-source does that.'
              : 'either a layer is being skipped that should not be, or the PNG export is stale. ' +
                'Differences spread evenly in BOTH directions across every layer mean a stale ' +
                'export, and --trust-source is the right call.';
          throw new Error(`the export and our layers disagree: ${why} Nothing written.`);
        }
        console.log(
          '    --trust-source: PNG export treated as stale, .aseprite layers used as-is.',
        );
      } else {
        console.log('    ours-only pixels dropped: stray marks outside the export.');
        if (!args.includes('--keep-strays')) dropStrays(flat, pw);
      }
    }
  } else {
    console.log(
      `  vs PNG export:  skipped (${pw}x${ph} is not ${file.frames} frames of ${file.width}x${file.height})`,
    );
  }
} else {
  console.log('  vs PNG export:  skipped (no sibling PNG, or python3/Pillow unavailable)');
}

/** Clear any pixel the PNG export does not have, per layer, so the import matches it exactly. */
function dropStrays(flat: number[], pw: number): void {
  for (const layer of layers) {
    layer.cels.forEach((cel, f) => {
      if (!cel) return;
      const indices = Buffer.from(cel.data, 'base64');
      for (let y = 0; y < cel.h; y++) {
        for (let x = 0; x < cel.w; x++) {
          if (indices[y * cel.w + x] === 0) continue;
          const px = cel.x + x;
          const py = cel.y + y;
          const s = (py * pw + f * file.width + px) * 4;
          if (px < 0 || py < 0 || px >= file.width || py >= file.height || flat[s + 3] === 0) {
            indices[y * cel.w + x] = 0;
          }
        }
      }
      layer.cels[f] = { ...cel, data: Buffer.from(indices).toString('base64') };
    });
  }
}

function hasPillow(): boolean {
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---- emit ---------------------------------------------------------------------------------------
const slug = exportName.toLowerCase().replace(/_/g, '-');
const module = `// ${slug}.ts — GENERATED by tools/import-aseprite.ts. Do not edit by hand.
//
// Source: ${basename(source)} (${file.frames} frames, ${file.width}x${file.height})
// Layers: ${layers.map((l) => l.name).join(', ')}
//
// Each pixel is an INDEX into its layer's palette, not a colour — swap a layer's palette to re-skin
// that body part. See client/src/render/entity/sprite.ts.
import type { SpriteAnim } from '../sprite';

export const ${exportName}: SpriteAnim = {
  name: ${JSON.stringify(slug)},
  w: ${file.width},
  h: ${file.height},
  frames: ${file.frames},
  durations: [${file.durations.join(', ')}],
  layers: [
${layers
  .map(
    (l) => `    {
      name: ${JSON.stringify(l.name)},
      palette: [${l.palette.map((c) => `'${c}'`).join(', ')}],
      cels: [
${l.cels
  .map((c) =>
    c === null
      ? '        null,'
      : `        { x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}, data: '${c.data}' },`,
  )
  .join('\n')}
      ],
    },`,
  )
  .join('\n')}
  ],
};
`;

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${slug}.ts`);
writeFileSync(outFile, module);
console.log(`  wrote ${outFile} (${(module.length / 1024).toFixed(1)} KB)`);
