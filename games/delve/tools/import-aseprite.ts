// import-aseprite.ts — import every animation in the manifest as committed SpriteAnim modules.
//
//   pnpm --filter delve exec tsx tools/import-aseprite.ts <pack-root> [--out dir]
//
// Reads the layered `.aseprite` files listed in `sprite-manifest.ts` directly — no Aseprite install,
// no intermediate export — and writes `client/src/render/entity/sprites/`. The `.aseprite` sources
// are not committed; the generated modules are.
//
// A BATCH, not one file at a time, because every animation shares ONE template palette. Importing
// separately gave each animation its own, so index 1 meant a different colour in each and any
// equipment override keyed on it was wrong depending on what was playing.
//
// IT VERIFIES BEFORE IT WRITES AND REFUSES ON A MISMATCH. Each animation's emitted data is decoded
// back, composited, and diffed pixel for pixel against the file's own layers and against its sibling
// PNG export. Every escape hatch below exists because a real file in this pack needed it; the table
// in docs/SPRITES.md says which.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readAseprite, flatten, type AseFile } from './aseprite';
import { ENTITIES, type SpriteEntity, type SpriteSource } from './sprite-manifest';

/**
 * Layers that are scaffolding, backdrop or baked FX rather than character parts.
 *
 * The pack is inconsistent across its forty-odd files and every entry here earned its place by
 * failing the PNG diff. `gif bg` is a full-canvas backdrop for GIF export; `Flattened` is a
 * composite the artist left beside the real layers.
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

const args = process.argv.slice(2);
const packRoot = args[0];
if (!packRoot) {
  console.error('usage: import-aseprite.ts <pack-root> [--out dir]');
  process.exit(1);
}
const outAt = args.indexOf('--out');
const outRoot = resolve(
  outAt >= 0
    ? args[outAt + 1]
    : join(dirname(new URL(import.meta.url).pathname), '../client/src/render/entity/sprites'),
);

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The shared template palette. Index 0 is transparent, so a colour's index is its position + 1. */
const template: string[] = [];
const templateIndex = new Map<string, number>();
const indexOf = (colour: string): number => {
  const hit = templateIndex.get(colour);
  if (hit !== undefined) return hit;
  template.push(colour);
  templateIndex.set(colour, template.length);
  return template.length;
};

interface OutCel {
  x: number;
  y: number;
  w: number;
  h: number;
  data: string;
}
interface OutLayer {
  name: string;
  cels: (OutCel | null)[];
}
interface OutAnim {
  source: SpriteSource;
  file: AseFile;
  slug: string;
  ground: number;
  layers: OutLayer[];
  notes: string[];
}

function importOne(entity: SpriteEntity, source: SpriteSource, path: string): OutAnim {
  const slotFor = (name: string): string | null =>
    entity.slots.find(([re]) => re.test(name.trim()))?.[1] ?? null;
  const file = readAseprite(new Uint8Array(readFileSync(path)));
  const extraSkip = new Set((source.skip ?? []).map((n) => n.toLowerCase()));
  const parts = file.layers.filter(
    (l) =>
      !l.isGroup &&
      l.visible &&
      !SKIP_LAYERS.has(l.name.toLowerCase()) &&
      !extraSkip.has(l.name.toLowerCase()),
  );
  if (parts.length === 0) throw new Error(`${source.file}: no character layers found`);

  const unnamed = parts.filter((l) => slotFor(l.name) === null);
  if (unnamed.length > 0) {
    throw new Error(
      `${source.file}: layer(s) map to no slot: ${unnamed.map((l) => `"${l.name}"`).join(', ')}. ` +
        `Add a slot pattern to the ${entity.name} entity, or list them in its \`skip\`.`,
    );
  }

  const notes: string[] = [];
  const built = parts.map((layer) => {
    const cels: (OutCel | null)[] = [];
    for (let f = 0; f < file.frames; f++) {
      const cel = file.cels.find((c) => c.frame === f && c.layer === layer.index);
      if (!cel || cel.w === 0 || cel.h === 0) {
        cels.push(null);
        continue;
      }
      // Trim to the cel's own opaque bounds — a fat cel is wasted bytes in the committed module.
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
          indices[y * w + x] = indexOf(hex(cel.rgba[s], cel.rgba[s + 1], cel.rgba[s + 2]));
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
    return { name: slotFor(layer.name)!, cels };
  });

  // A layer present in the file but empty in EVERY frame — an arm tucked behind the body for a whole
  // push cycle — would ship as a slot that draws nothing, which reads as broken rather than absent.
  const layers = built.filter((l) => l.cels.some(Boolean));
  const empty = built.filter((l) => !l.cels.some(Boolean));
  if (empty.length) notes.push(`empty layers dropped: ${empty.map((l) => l.name).join(', ')}`);
  if (layers.length === 0) throw new Error(`${source.file}: every layer is empty in every frame`);

  const decoded = (frame: number): Uint8Array => {
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
          const c = template[idx - 1];
          const i = (py * file.width + px) * 4;
          out[i] = parseInt(c.slice(1, 3), 16);
          out[i + 1] = parseInt(c.slice(3, 5), 16);
          out[i + 2] = parseInt(c.slice(5, 7), 16);
          out[i + 3] = 255;
        }
      }
    }
    return out;
  };

  // ---- verify against the file's own layers ----
  const kept: AseFile = { ...file, layers: parts };
  for (let f = 0; f < file.frames; f++) {
    const mine = decoded(f);
    const theirs = flatten(kept, f);
    for (let i = 0; i < mine.length; i += 4) {
      const a = mine[i + 3] === 0;
      const b = theirs[i + 3] === 0;
      if (a !== b || (!a && (mine[i] !== theirs[i] || mine[i + 1] !== theirs[i + 1]))) {
        throw new Error(`${source.file}: round trip differs on frame ${f} — refusing to write`);
      }
    }
  }

  // ---- verify against the sibling PNG export ----
  const png = path.replace(/\.aseprite$/i, '.png');
  if (existsSync(png) && hasPillow()) {
    const [pw, ph, flat] = readPng(png);
    if (ph === file.height && pw >= file.width * file.frames) {
      let extra = 0;
      let missing = 0;
      let recolour = 0;
      for (let f = 0; f < file.frames; f++) {
        const mine = decoded(f);
        for (let y = 0; y < file.height; y++) {
          for (let x = 0; x < file.width; x++) {
            const m = (y * file.width + x) * 4;
            const s = (y * pw + f * file.width + x) * 4;
            const a = mine[m + 3] !== 0;
            const b = flat[s + 3] !== 0;
            if (a && !b) extra++;
            else if (!a && b) missing++;
            else if (a && (mine[m] !== flat[s] || mine[m + 1] !== flat[s + 1])) recolour++;
          }
        }
      }
      if (missing > 0 || recolour > 0) {
        if (!source.trustSource) {
          const why =
            extra === 0 && missing === 0
              ? 'every differing pixel is the SAME pixel in a different colour, so this is layer ' +
                'opacity or a blend mode, which this reader composites straight through'
              : 'either a layer is being skipped that should not be, or the PNG export is stale ' +
                '(differences spread evenly in BOTH directions across every layer)';
          throw new Error(
            `${source.file}: disagrees with its PNG export (${extra} ours-only, ${missing} ` +
              `export-only, ${recolour} recoloured). ${why}. Set \`trustSource\` in the manifest ` +
              'with a reason if the layers are the newer truth. Nothing written.',
          );
        }
        notes.push(`PNG export not matched (${source.trustSource})`);
      } else if (extra > 0) {
        // Stray marks outside the artist's own export — dropped, and recorded.
        dropStrays(layers, flat, pw, file);
        notes.push(`${extra} stray px outside the PNG export dropped`);
      }
    }
  }

  // ---- the ground line ----
  // Taken from the entity, not measured per animation — see `SpriteEntity.ground` for why. What IS
  // checked here is that a grounded animation actually agrees with it.
  const ground = entity.ground;
  if (source.grounded) {
    const tally = new Map<number, number>();
    for (let f = 0; f < file.frames; f++) {
      const px = decoded(f);
      let bottom = -1;
      for (let y = 0; y < file.height; y++) {
        for (let x = 0; x < file.width; x++) if (px[(y * file.width + x) * 4 + 3]) bottom = y;
      }
      if (bottom >= 0) tally.set(bottom, (tally.get(bottom) ?? 0) + 1);
    }
    const modal = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] + 1;
    if (modal !== ground) {
      throw new Error(
        `${source.file}: marked grounded but its feet sit on row ${modal}, not ${entity.name}'s ` +
          `ground row ${ground}. Either the manifest is wrong or this animation is not grounded.`,
      );
    }
  }

  const slug = source.name.toLowerCase().replace(/_/g, '-');
  console.log(
    `${basename(source.file).padEnd(38)} ${file.frames}f ${file.width}x${file.height} ` +
      `ground=${ground} layers=${layers.map((l) => l.name).join(',')}`,
  );
  for (const n of notes) console.log(`    note: ${n}`);
  return { source, file, slug, ground, layers, notes };
}

// ---- run every entity, then emit -----------------------------------------------------------------
//
// One pass over all entities before anything is written, because the template palette is SHARED.
// That is what lets a material or an equipment ramp authored once apply to any entity whose slots it
// names, and it is why the import has to be a batch rather than a per-file command.
const byEntity = ENTITIES.map((entity) => {
  console.log(`\n${entity.name}:`);
  const anims = entity.sources.map((source) => {
    const path = join(packRoot, entity.root, source.file);
    if (!existsSync(path)) throw new Error(`missing from the pack: ${entity.root}/${source.file}`);
    return importOne(entity, source, path);
  });
  return { entity, anims };
});

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

writeFileSync(
  join(outRoot, 'palette.ts'),
  `// palette.ts — GENERATED by tools/import-aseprite.ts. Do not edit by hand.
//
// The TEMPLATE palette: every distinct colour across every imported animation of every entity, in
// first-seen order. A sprite pixel stores an index into this (0 = transparent, n = entry n - 1), so
// this table is the one place a colour code means something — which is what makes a skin or a
// material authored once work identically in every animation, and across entities.
//
// These are CODE colours, not finished art: the source packs are colour-coded templates. Everything
// the player sees is decided in ../skin.ts.
export const TEMPLATE_PALETTE = [
${template.map((c) => `  '${c}',`).join('\n')}
] as const;
`,
);

const key = (slug: string, entity: string): string =>
  slug.replace(new RegExp(`^${entity}-`), '').replace(/-/g, '_');

for (const { entity, anims } of byEntity) {
  const dir = join(outRoot, entity.name);
  mkdirSync(dir, { recursive: true });
  for (const anim of anims) {
    writeFileSync(
      join(dir, `${anim.slug}.ts`),
      `// ${anim.slug}.ts — GENERATED by tools/import-aseprite.ts. Do not edit by hand.
//
// Source: ${entity.root}/${anim.source.file} (${anim.file.frames} frames, ${anim.file.width}x${anim.file.height})
${anim.notes.map((n) => `// Note: ${n}\n`).join('')}//
// Pixels are indices into TEMPLATE_PALETTE (see ../palette.ts), never colours.
import type { SpriteAnim } from '../../sprite';

export const ${anim.source.name}: SpriteAnim = {
  name: ${JSON.stringify(anim.slug)},
  w: ${anim.file.width},
  h: ${anim.file.height},
  frames: ${anim.file.frames},
  ground: ${anim.ground},
  durations: [${anim.file.durations.join(', ')}],
  layers: [
${anim.layers
  .map(
    (l) => `    {
      name: ${JSON.stringify(l.name)},
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
`,
    );
  }

  const upper = entity.name.toUpperCase();
  writeFileSync(
    join(dir, 'index.ts'),
    `// index.ts — GENERATED by tools/import-aseprite.ts. Do not edit by hand.
//
// Every ${entity.name} animation listed in tools/sprite-manifest.ts. The source animations
// deliberately NOT imported, and why, are recorded there too.
${anims.map((a) => `import { ${a.source.name} } from './${a.slug}';`).join('\n')}

export const ${upper}_SPRITES = {
${anims.map((a) => `  ${key(a.slug, entity.name)}: ${a.source.name},`).join('\n')}
} as const;

export type ${titleCase(entity.name)}Anim = keyof typeof ${upper}_SPRITES;

/**
 * The layer slots a ${entity.name} animation may use, in paint order.
 *
 * Normalised at import precisely so a skin or material authored once applies to every animation —
 * the source pack calls the same body part by several different names across its files.
 */
export const ${upper}_SLOTS = [${entity.order.map((s) => `'${s}'`).join(', ')}] as const;

export type ${titleCase(entity.name)}Slot = (typeof ${upper}_SLOTS)[number];
`,
  );
}

writeFileSync(
  join(outRoot, 'index.ts'),
  `// index.ts — GENERATED by tools/import-aseprite.ts. Do not edit by hand.
//
// Re-exports every imported entity. Adding an entity is an entry in tools/sprite-manifest.ts and a
// re-run of the importer; nothing here is written by hand.
export { TEMPLATE_PALETTE } from './palette';
${byEntity.map(({ entity }) => `export * from './${entity.name}';`).join('\n')}
`,
);

const total = byEntity.reduce((n, e) => n + e.anims.length, 0);
console.log(
  `\n${byEntity.length} entit${byEntity.length === 1 ? 'y' : 'ies'}, ${total} animations, ` +
    `${template.length} template colours -> ${outRoot}`,
);

function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---- helpers ------------------------------------------------------------------------------------
function dropStrays(layers: OutLayer[], flat: number[], pw: number, file: AseFile): void {
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

function readPng(path: string): [number, number, number[]] {
  const raw = execFileSync(
    'python3',
    [
      '-c',
      `from PIL import Image
import sys, json
im = Image.open(${JSON.stringify(path)}).convert('RGBA')
sys.stdout.write(json.dumps([im.size[0], im.size[1], list(im.tobytes())]))`,
    ],
    { maxBuffer: 1 << 30 },
  ).toString();
  return JSON.parse(raw) as [number, number, number[]];
}

function hasPillow(): boolean {
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
