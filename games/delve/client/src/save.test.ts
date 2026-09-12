// save.test.ts — save/load + format migration (happy-dom for localStorage). The important cases
// are the unhappy ones: corrupt/empty storage, and OLD saves — including ones written before the
// economy was removed, which must still load (their coins/refine/scanner fields just don't matter).
import { describe, it, expect, beforeEach } from 'vitest';
import { hydrate, load, save, fresh, SAVE_KEY } from './save';

beforeEach(() => localStorage.clear());

describe('hydrate', () => {
  it('round-trips a current split save and resets transient physics', () => {
    const saved = {
      world: { seed: 4242, dug: { '1,1': true }, dmg: { '2,2': 5 } },
      player: {
        x: 10.5, y: 20.5, vx: 3, vy: -2, grounded: true, digKey: '1,1', digTime: 0.4,
        inv: { 2: 7, 5: 3 }, log: { 2: { mined: 7, deepest: 30 } }, depth: 40,
        up: { pick: 1, speed: 2, fortune: 3 }, tech: { lantern: true },
      },
    };
    const s = hydrate(saved);
    expect(s.world.seed).toBe(4242);
    expect(s.world.dug).toEqual({ '1,1': true });
    expect(s.player.inv).toEqual({ 2: 7, 5: 3 });
    expect(s.player.depth).toBe(40);
    expect(s.player.up).toEqual({ pick: 1, speed: 2, fortune: 3 });
    // transient physics reset regardless of what was saved
    expect(s.player.vx).toBe(0);
    expect(s.player.vy).toBe(0);
    expect(s.player.grounded).toBe(false);
    expect(s.player.digKey).toBeNull();
    expect(s.player.digTime).toBe(0);
  });

  it('loads an older save without crashing (stray coins/refine/scanner/best ignored)', () => {
    const oldSave = {
      world: { seed: 7, dug: {}, dmg: {} },
      player: {
        x: 5, y: 5, inv: { 5: 12 }, log: {}, depth: 100,
        best: 5, // removed: the rarest-material-found stat
        coins: 9999, earned: 50000, // removed economy fields
        up: { pick: 3, speed: 1, refine: 8, fortune: 2 }, // refine removed
        tech: { lantern: true, scanner: true }, // scanner removed
      },
    };
    const s = hydrate(oldSave);
    expect(s.player.inv).toEqual({ 5: 12 });
    expect(s.player.depth).toBe(100);
    // the fields that still exist come through
    expect(s.player.up.pick).toBe(3);
    expect(s.player.up.fortune).toBe(2);
    expect(s.player.tech.lantern).toBe(true);
  });

  it('migrates a pre-split flat save', () => {
    const flat = { seed: 3, dug: { '0,1': true }, dmg: {}, x: 8, y: 9, inv: { 2: 1 }, depth: 12 };
    const s = hydrate(flat);
    expect(s.world.seed).toBe(3);
    expect(s.world.dug).toEqual({ '0,1': true });
    expect(s.player.x).toBe(8);
    expect(s.player.inv).toEqual({ 2: 1 });
    expect(s.player.depth).toBe(12);
  });

  it('migrates a pre-physics grid save (c/r → tile centre)', () => {
    const grid = { seed: 5, c: 40, r: 6 };
    const s = hydrate(grid);
    expect(s.player.x).toBe(40.5);
    expect(s.player.y).toBe(6.5);
  });
});

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
