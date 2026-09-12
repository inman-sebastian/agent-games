// resources.test.ts (tools) — registry ↔ directory drift guard. Reads the resources directory
// from disk (node), so it lives here rather than in @delve/shared (which stays platform-neutral).
// Catches the classic mistake: you add shared/src/resources/<name>.ts but forget to import it in
// index.ts — the file exists on disk but never self-registers, so the counts diverge.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { all } from '@delve/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES_DIR = join(HERE, '..', 'shared', 'src', 'resources');

const resourceFiles = readdirSync(RES_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'))
  .map((f) => f.replace(/\.ts$/, ''));
const indexSource = readFileSync(join(RES_DIR, 'index.ts'), 'utf8');

describe('resources registry ↔ directory', () => {
  it.each(resourceFiles)('index.ts imports ./%s', (name) => {
    expect(indexSource).toContain(`'./${name}'`);
  });

  it('every resource file registers exactly one entity (no forgotten import)', () => {
    const registered = all('ore').length + all('strata').length;
    expect(registered).toBe(resourceFiles.length);
  });
});
