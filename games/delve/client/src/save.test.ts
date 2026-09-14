// save.test.ts — the client's localStorage cache (happy-dom). The unhappy cases matter most: empty or
// corrupt storage. Turning a saved object back into a Session — old formats, rescues — is tested
// where that rule lives now, in shared/src/hydrate.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { load, save, fresh, SAVE_KEY } from './save';

beforeEach(() => localStorage.clear());

describe('load / save', () => {
  it('returns null when there is no save', () => {
    expect(load()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(SAVE_KEY, '{not json');
    expect(load()).toBeNull();
  });

  it('returns null on a seedless object', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ player: {} }));
    expect(load()).toBeNull();
  });

  it('round-trips a session through save() then load()', () => {
    const s = fresh();
    s.player.inv = { 3: 5 };
    s.player.depth = 22;
    save(s);
    const loaded = load()!;
    expect(loaded).not.toBeNull();
    expect(loaded.world.seed).toBe(s.world.seed);
    expect(loaded.player.inv).toEqual({ 3: 5 });
    expect(loaded.player.depth).toBe(22);
  });
});
