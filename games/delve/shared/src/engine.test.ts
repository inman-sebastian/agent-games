// engine.test.ts — the sim under FUZZING, which is the whole point of the move away from the old
// hand-crafted gate: instead of one scripted descent on one seed, drive physicsStep/mineTile with
// random input streams over random seeds and assert invariants that must hold in EVERY case —
// no tunneling into solid rock, no NaN, bounded velocity, monotonic depth, deterministic replay,
// and material conservation (everything broken is exactly what's in the inventory).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newSession,
  physicsStep,
  mineTile,
  isRich,
  invCount,
  solidCell,
  stats,
  key,
  unstick,
  PHYS,
  TICK_DT,
  WIDTH,
  SURFACE,
  blockAt,
  oreAt,
  type Input,
  type Session,
  type SimEvent,
} from '@delve/shared';

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });
// one input frame: any combination of move/jump/mine (mine targets the tile below at run time)
const stepArb = fc.record({
  left: fc.boolean(),
  right: fc.boolean(),
  jump: fc.boolean(),
  mine: fc.boolean(),
});
const scriptArb = fc.array(stepArb, { minLength: 1, maxLength: 240 });
type Step = { left: boolean; right: boolean; jump: boolean; mine: boolean };

const TOL = 1e-3; // ignore sub-milli-tile float overlap when probing for tunneling

function inputFor(step: Step, session: Session): Input {
  const input: Input = {};
  if (step.left) input.left = true;
  if (step.right) input.right = true;
  if (step.jump) input.jump = true;
  if (step.mine)
    input.mine = { column: Math.floor(session.player.x), row: Math.floor(session.player.y) + 1 };
  return input;
}

// The player's AABB must never overlap an undug solid cell.
function assertNoTunneling(session: Session): void {
  const { player, world } = session;
  const c0 = Math.floor(player.x - PHYS.HW + TOL);
  const c1 = Math.floor(player.x + PHYS.HW - TOL);
  const r0 = Math.floor(player.y - PHYS.HH + TOL);
  const r1 = Math.floor(player.y + PHYS.HH - TOL);
  for (let c = c0; c <= c1; c++)
    for (let r = r0; r <= r1; r++)
      expect(solidCell(world, c, r), `player AABB overlaps solid cell ${c},${r}`).toBe(false);
}

function assertSaneKinematics(session: Session): void {
  const { player } = session;
  for (const v of [player.x, player.y, player.vx, player.vy]) expect(Number.isFinite(v)).toBe(true);
  expect(Math.abs(player.vx)).toBeLessThanOrEqual(PHYS.RUN_SPEED + TOL);
  expect(player.vy).toBeLessThanOrEqual(PHYS.MAX_FALL + TOL);
}

function runScript(seed: number, steps: Step[]): { session: Session; events: SimEvent[] } {
  const session = newSession(seed);
  const events: SimEvent[] = [];
  let depth = session.player.depth;
  for (const step of steps) {
    const result = physicsStep(session, inputFor(step, session), TICK_DT);
    events.push(...result.events);
    assertNoTunneling(session);
    assertSaneKinematics(session);
    expect(session.player.depth, 'depth is monotonic non-decreasing').toBeGreaterThanOrEqual(depth);
    depth = session.player.depth;
  }
  return { session, events };
}

describe('physics fuzzing — invariants over random input streams', () => {
  it('never tunnels, never NaNs, stays within velocity/ depth bounds', () => {
    // invariants are enforced by `expect` inside runScript; the property just needs to not throw
    fc.assert(
      fc.property(seedArb, scriptArb, (seed, steps) => {
        runScript(seed, steps);
      }),
    );
  });

  it('is deterministic: same (seed, script) → identical session', () => {
    fc.assert(
      fc.property(seedArb, scriptArb, (seed, steps) => {
        const a = runScript(seed, steps).session;
        const b = runScript(seed, steps).session;
        expect(a).toEqual(b);
      }),
    );
  });

  it('conserves materials: everything broken is exactly what is collected', () => {
    fc.assert(
      fc.property(seedArb, scriptArb, (seed, steps) => {
        const { session, events } = runScript(seed, steps);
        const brokenQty = events
          .filter((e) => e.type === 'break' && e.ore)
          .reduce((sum, e) => sum + (e.qty ?? 0), 0);
        const loggedQty = Object.values(session.player.log).reduce((sum, r) => sum + r.mined, 0);
        expect(invCount(session.player)).toBe(brokenQty);
        expect(loggedQty).toBe(brokenQty);
      }),
    );
  });
});

describe('mining mechanics', () => {
  it('breaks the targeted tile and collects its ore', () => {
    // dig straight down repeatedly; the shaft should deepen and any ore fall into the inventory
    const { session, events } = runScript(
      777,
      Array.from({ length: 400 }, () => ({ left: false, right: false, jump: false, mine: true })),
    );
    const breaks = events.filter((e) => e.type === 'break');
    expect(breaks.length).toBeGreaterThan(0);
    expect(session.player.depth).toBeGreaterThan(1); // actually descended
    // every ore break credited the inventory
    const oreBreaks = breaks.filter((e) => e.ore).reduce((s, e) => s + (e.qty ?? 0), 0);
    expect(invCount(session.player)).toBe(oreBreaks);
  });

  // The straight-down fuzz above rarely hits ore in a short script, so its conservation check is
  // mostly vacuous. This drives ore breaks deterministically so conservation actually has teeth:
  // break qty must equal what lands in the inventory AND the codex log (a +1 slip is caught here).
  it('mining ore cells conserves: break qty == inventory == log (30 seeds)', () => {
    const findOreCell = (seed: number): { c: number; r: number; ore: number } | null => {
      for (let r = 1; r <= 300; r++)
        for (let c = 0; c < WIDTH; c++) {
          const ore = oreAt(seed, c, r);
          if (ore) return { c, r, ore };
        }
      return null;
    };
    let exercised = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const cell = findOreCell(seed);
      if (!cell) continue;
      const session = newSession(seed);
      const events: SimEvent[] = [];
      const broke = mineTile(session, cell.c, cell.r, 50, events); // large dt → enough paced hits
      expect(broke, `seed ${seed}: shallow ore should break`).toBe(true);
      const brk = events.find((e) => e.type === 'break' && e.c === cell.c && e.r === cell.r);
      expect(brk?.ore).toBe(cell.ore);
      const qty = brk!.qty ?? 0;
      expect(qty).toBeGreaterThan(0);
      expect(session.player.inv[cell.ore]).toBe(qty);
      expect(session.player.log[cell.ore].mined).toBe(qty);
      expect(invCount(session.player)).toBe(qty);
      exercised++;
    }
    expect(exercised, 'the test must actually break ore in most seeds').toBeGreaterThanOrEqual(20);
  });

  it('mineTile deals damage over hits and eventually breaks the cell', () => {
    const session = newSession(555);
    const col = Math.floor(session.player.x);
    const row = 1; // first solid row below the surface
    expect(solidCell(session.world, col, row)).toBe(true);
    const events: SimEvent[] = [];
    // a large dt runs many paced hits in one call — enough to break shallow rock
    const broke = mineTile(session, col, row, 10, events);
    expect(broke).toBe(true);
    expect(session.world.dug[`${col},${row}`]).toBe(true);
    const block = blockAt(session.world.seed, col, row);
    if (block.ore) expect(session.player.inv[block.ore]).toBeGreaterThan(0);
  });

  it('a mine target outside REACH never digs', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const session = newSession(seed);
        const far = {
          column: Math.floor(session.player.x) + 30,
          row: Math.floor(session.player.y) + 30,
        };
        physicsStep(session, { mine: far }, TICK_DT);
        expect(session.world.dug[`${far.column},${far.row}`]).toBeUndefined();
      }),
    );
  });
});

describe('rich veins (isRich)', () => {
  it('is deterministic per (seed, column, row, fortune)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 600 }),
        (seed, c, r) => {
          expect(isRich(seed, c, r, 0.5)).toBe(isRich(seed, c, r, 0.5));
        },
      ),
    );
  });

  it('fortune 1 always crits, fortune 0 never does', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 600 }),
        (seed, c, r) => {
          expect(isRich(seed, c, r, 1)).toBe(true);
          expect(isRich(seed, c, r, 0)).toBe(false);
        },
      ),
    );
  });
});

describe('#8 regression — horizontal movement is unbounded', () => {
  it('walks far past the old WIDTH bound both directions', () => {
    const session = newSession(999);
    let maxX = session.player.x;
    let minX = session.player.x;
    for (let i = 0; i < 3000; i++) {
      physicsStep(session, { right: true }, TICK_DT);
      maxX = Math.max(maxX, session.player.x);
    }
    for (let i = 0; i < 6000; i++) {
      physicsStep(session, { left: true }, TICK_DT);
      minX = Math.min(minX, session.player.x);
    }
    expect(maxX).toBeGreaterThan(WIDTH + 20);
    expect(minX).toBeLessThan(-20);
  });
});

describe('derived stats at base levels', () => {
  it('a fresh player has sane base dig power/interval/lamp (attributes are neutral)', () => {
    const st = stats(newSession(1).player);
    expect(st.power).toBe(1);
    expect(st.interval).toBeGreaterThan(0);
    expect(st.lamp).toBeGreaterThan(0);
    expect(st.fortune).toBe(0);
  });

  it('SURFACE rows are open', () => {
    expect(blockAt(1, 0, SURFACE).solid).toBe(false);
  });
});

describe('the player body is taller than one tile (#47)', () => {
  // The size change is the point of adopting the imported character's proportions: a one-tile gap no
  // longer fits, so a tunnel has to be dug two tiles tall. None of the existing physics tests noticed
  // the change, because every one of them was written against a body that fitted inside a tile —
  // which is exactly why these exist.
  const ROW = SURFACE + 20; // well below the surface, where every tile is solid until dug
  const COL = WIDTH >> 1;

  /**
   * A session with an open chamber whose FLOOR is row `ROW` — left solid on purpose. Digging it out
   * too made the player fall through the first version of these tests, which quietly moved the body
   * and put the dig target out of reach.
   */
  const chamber = (): Session => {
    const session = newSession(7);
    for (let c = COL - 8; c <= COL + 8; c++) {
      for (let r = ROW - 8; r <= ROW - 1; r++) session.world.dug[key(c, r)] = true;
    }
    return session;
  };
  const stand = (session: Session, floorRow: number): void => {
    session.player.x = COL + 0.5;
    session.player.y = floorRow - PHYS.HH;
    session.player.vx = 0;
    session.player.vy = 0;
    session.player.grounded = true;
  };
  const bodyRows = (session: Session): [number, number] => [
    Math.floor(session.player.y - PHYS.HH + 1e-6),
    Math.floor(session.player.y + PHYS.HH - 1e-6),
  ];

  it('is taller than a tile and narrower than one', () => {
    expect(PHYS.HH * 2).toBeGreaterThan(1);
    expect(PHYS.HW * 2).toBeLessThan(1);
  });

  it('spans two tile rows when standing', () => {
    // The whole basis of the digging cost: a body inside one row would fit a one-tile tunnel.
    const session = chamber();
    stand(session, ROW);
    const [top, bottom] = bodyRows(session);
    expect(bottom - top).toBe(1);
  });

  it('does not fit a one-tile gap', () => {
    const session = chamber();
    // Fill everything back in except a single open row above the floor.
    for (let c = COL - 8; c <= COL + 8; c++) {
      for (let r = ROW - 8; r <= ROW + 2; r++) delete session.world.dug[key(c, r)];
      session.world.dug[key(c, ROW - 1)] = true;
    }
    session.player.x = COL + 0.5;
    session.player.y = ROW - 0.5;
    expect(unstick(session.world, session.player, 0)).toBe(false);
  });

  it('fits a two-tile gap', () => {
    const session = chamber();
    for (let c = COL - 8; c <= COL + 8; c++) {
      for (let r = ROW - 8; r <= ROW + 2; r++) delete session.world.dug[key(c, r)];
      session.world.dug[key(c, ROW - 1)] = true;
      session.world.dug[key(c, ROW - 2)] = true;
    }
    session.player.x = COL + 0.5;
    session.player.y = ROW - PHYS.HH;
    expect(unstick(session.world, session.player, 0)).toBe(true);
  });

  it('can still dig the tile above its own head', () => {
    // Reach is measured from the BODY's tile span, not its centre tile. Measured from the centre, a
    // 1.82-tall player could dig the tile its head occupies but not the one above it, so tunnelling
    // straight up silently became impossible.
    const session = chamber();
    stand(session, ROW);
    const aboveHead = bodyRows(session)[0] - 1;
    delete session.world.dug[key(COL, aboveHead)];
    expect(solidCell(session.world, COL, aboveHead)).toBe(true);
    for (let i = 0; i < 600 && solidCell(session.world, COL, aboveHead); i++) {
      physicsStep(
        session,
        { left: false, right: false, jump: false, mine: { column: COL, row: aboveHead } },
        TICK_DT,
      );
    }
    expect(solidCell(session.world, COL, aboveHead)).toBe(false);
  });

  it('cannot dig two tiles clear of its body', () => {
    // The ring must still be a ring: reach measured from the body must not become reach from anywhere.
    const session = chamber();
    stand(session, ROW);
    const far = bodyRows(session)[0] - 3;
    delete session.world.dug[key(COL, far)];
    for (let i = 0; i < 300; i++) {
      physicsStep(
        session,
        { left: false, right: false, jump: false, mine: { column: COL, row: far } },
        TICK_DT,
      );
    }
    expect(solidCell(session.world, COL, far)).toBe(true);
  });

  it('still rises more than a tile when it jumps', () => {
    // Jump height in tiles is a property of velocity and gravity, not of the body, so growing the
    // player must not have changed it.
    expect((PHYS.JUMP_VEL * PHYS.JUMP_VEL) / (2 * PHYS.GRAVITY)).toBeGreaterThan(1);
  });

  it('lifts a player stuck inside rock into a gap that fits', () => {
    const session = chamber();
    session.player.x = COL + 0.5;
    session.player.y = ROW + 1.5; // centre buried in the floor
    expect(unstick(session.world, session.player)).toBe(true);
    const [top, bottom] = bodyRows(session);
    for (let row = top; row <= bottom; row++) {
      expect(solidCell(session.world, COL, row), `row ${row} is solid`).toBe(false);
    }
  });

  it('spawns a fresh player standing on the surface, not inside it', () => {
    // The body is derived from the character art, so the spawn height has to be derived from the
    // body. At the old size `SURFACE + 0.5` was fine; at 1.82 tiles it buried the feet in the first
    // solid row and let the physics eject the player over the following frames.
    const session = newSession(99);
    expect(unstick(session.world, session.player, 0)).toBe(true);
    expect(session.player.grounded).toBe(false); // not yet stepped
    const before = session.player.y;
    for (let i = 0; i < 60; i++) {
      physicsStep(session, { left: false, right: false, jump: false }, TICK_DT);
    }
    // Standing still on solid ground must not move the player at all.
    expect(session.player.y).toBeCloseTo(before, 2);
    expect(session.player.grounded).toBe(true);
  });

  it('gives up rather than teleporting a hopelessly stuck player', () => {
    const session = newSession(7); // nothing dug anywhere
    session.player.x = COL + 0.5;
    session.player.y = ROW;
    expect(unstick(session.world, session.player, 3)).toBe(false);
  });
});
