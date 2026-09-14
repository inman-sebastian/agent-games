// hydrate.test.ts — turning a saved object back into a valid Session. Pure, so it runs in Node with
// no DOM: this is the rule BOTH the client's localStorage cache and the server's save of record go
// through. The important cases are the unhappy ones — old saves, and saves the current body no
// longer fits.
import { describe, it, expect } from 'vitest';
import * as engine from './index';
import { hydrate, toSave, SAVE_FORMAT } from './hydrate';

describe('hydrate', () => {
  it('round-trips a current split save and resets transient physics', () => {
    const saved = {
      world: { seed: 4242, dug: { '1,1': true }, dmg: { '2,2': 5 } },
      player: {
        x: 10.5,
        y: 20.5,
        vx: 3,
        vy: -2,
        grounded: true,
        digKey: '1,1',
        digTime: 0.4,
        inv: { 2: 7, 5: 3 },
        log: { 2: { mined: 7, deepest: 30 } },
        depth: 40,
        up: { pick: 1, speed: 2, fortune: 3 },
        tech: { lantern: true },
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
        x: 5,
        y: 5,
        inv: { 5: 12 },
        log: {},
        depth: 100,
        best: 5, // removed: the rarest-material-found stat
        coins: 9999,
        earned: 50000, // removed economy fields
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
    // Position is asserted separately below: hydrate now rescues a player whose body does not fit
    // where the save left it, and these fixtures' worlds are almost entirely solid.
    const flat = { seed: 3, dug: { '0,1': true }, dmg: {}, x: 8, y: 9, inv: { 2: 1 }, depth: 12 };
    const s = hydrate(flat);
    expect(s.world.seed).toBe(3);
    expect(s.world.dug).toEqual({ '0,1': true });
    expect(s.player.inv).toEqual({ 2: 1 });
    expect(s.player.depth).toBe(12);
  });

  it('keeps a saved position the body still fits', () => {
    // A pocket big enough for the body, which after the 2x2 split (#44) is 1.8 x 3.64 CELLS — so the
    // pocket is carved in cells, generously, and the save's own position must survive hydrate
    // untouched. Carved from the body's span rather than hand-counted, or this test becomes a
    // restatement of whatever the body size happens to be today.
    const dug: Record<string, boolean> = {};
    for (let c = 37; c <= 43; c++) for (let r = 4; r <= 12; r++) dug[`${c},${r}`] = true;
    const s = hydrate({ seed: 5, dug, dmg: {}, x: 40.5, y: 9.2 });
    expect(s.player.x).toBe(40.5);
    expect(s.player.y).toBe(9.2);
  });

  it('rescues a saved position the body no longer fits', () => {
    // The player grew from 0.92 to 1.82 tiles, so an old save can leave it inside rock — and a
    // wedged player cannot move, jump or dig its way out. A one-tile pocket is exactly that case:
    // it fitted the old body and does not fit this one.
    const dug: Record<string, boolean> = {};
    for (let c = 39; c <= 41; c++) dug[`${c},9`] = true;
    const s = hydrate({ seed: 5, dug, dmg: {}, x: 40.5, y: 9.5 });
    expect(s.player.y).not.toBe(9.5);
  });

  it("falls back to a fresh spawn on the save's own world when there is nowhere to rescue to", () => {
    // A pre-physics grid save records a tile the old game let the player stand in with no physics at
    // all, so its surroundings are solid. Better a fresh spawn than a save that cannot be played —
    // but on this world's ground. This test used to compare against `newPlayer()` with no seed, i.e.
    // seed 1's spawn, so it passed while the fallback put the player on a different world's surface.
    // Deep in unbroken rock, so there is genuinely no room within the search range. (This sat at row 6
    // until unstick's range was restored to six blocks, at which point the sky was within reach.)
    const seed = 5;
    const s = hydrate({ seed, c: 40, r: 200 });
    const spawn = engine.newPlayer(seed);
    expect(s.player.x).toBe(spawn.x);
    expect(s.player.y).toBe(spawn.y);
    // and that spawn genuinely stands on this world: feet on the ground, body clear of rock
    expect(engine.bodyFits(s.world, s.player.x, s.player.y, s.player)).toBe(true);
    expect(engine.bodyFits(s.world, s.player.x, s.player.y + 0.05, s.player)).toBe(false);
  });

  it('never throws on data that is not a save at all', () => {
    for (const junk of [null, undefined, 42, 'x', [], { world: null, player: null }]) {
      expect(() => hydrate(junk)).not.toThrow();
    }
  });
});

describe('the save format stamp', () => {
  it('stamps what it writes, and hydrate ignores the stamp', () => {
    const session = engine.newSession(9);
    const written = JSON.parse(JSON.stringify(toSave(session)));
    expect(written.format).toBe(SAVE_FORMAT);
    const back = hydrate(written);
    expect('format' in back).toBe(false); // the stamp is an envelope, never live session state
    expect(back.world.seed).toBe(session.world.seed);
  });
});
