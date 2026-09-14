// store.test.ts — the save store's one hard requirement: a client-supplied playerId can never make it
// read or write outside DATA_DIR. `store.ts` says so in its header ("the one thing that MUST stay"),
// and until the maintenance run nothing tested it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { newSession } from '@delve/shared';

let dataDir: string;
let store: typeof import('./store');

beforeAll(async () => {
  // DATA_DIR is read when the module loads, so point it at a sandbox BEFORE importing
  const sandbox = mkdtempSync(join(tmpdir(), 'delve-store-'));
  dataDir = join(sandbox, 'data');
  process.env.DELVE_DATA_DIR = dataDir;
  store = await import('./store');
});

afterAll(() => {
  if (dataDir) rmSync(dirname(dataDir), { recursive: true, force: true });
});

describe('the save store stays inside DATA_DIR', () => {
  it('turns hostile player ids into bare filenames inside the data dir', () => {
    const hostile = [
      '../escape',
      '../../../../tmp/delve-owned',
      '/etc/passwd',
      'a/b/c',
      '..\\\\windows',
      '..',
      '',
      '💥',
      'x'.repeat(500),
    ];
    for (const id of hostile) store.persistSave(id, newSession(1));

    // nothing was written next to the data dir, only inside it, and every file is a flat name
    expect(readdirSync(dirname(dataDir))).toEqual(['data']);
    for (const file of readdirSync(dataDir)) {
      expect(file).toMatch(/^[a-zA-Z0-9_-]{1,64}\.json$/);
    }
    expect(existsSync('/tmp/delve-owned.json')).toBe(false);
  });

  it('reads back what it wrote, hydrated, for an ordinary id', () => {
    const session = newSession(77);
    store.persistSave('p_ordinary', session);
    const back = store.loadSave('p_ordinary');
    expect(back?.world.seed).toBe(77);
    expect(back?.player.tech).toBeDefined();
  });

  it('returns null rather than throwing for a corrupt file', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dataDir, 'corrupt.json'), '{ not json');
    expect(store.loadSave('corrupt')).toBeNull();
  });
});
