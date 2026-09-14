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
  bodyFits,
  withinReach,
  PHYS,
  TICK_DT,
  WIDTH,
  worldColumns,
  SURFACE_BASE,
  SUB,
  surfaceAt,
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
  if (step.mine) {
    // The cell below the FEET, derived from the body rather than from the centre. `floor(y) + 1` was
    // a cell the body itself occupies once the body is taller than two cells — so the fuzzer asked
    // to mine thin air and broke nothing, silently, for four hundred steps.
    input.mine = {
      column: Math.floor(session.player.x),
      row: Math.floor(session.player.y + PHYS.HH) + 1,
    };
  }
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
    // This used to also claim the shaft "actually descended" via `depth > 1`. It never did: mining the
    // single cell under the centre can't open a hole a three-cell-wide body falls through (#53). The
    // assertion passed only because the old spawn column's ground sat below row 1, and it went red the
    // moment spawn moved to the centre of a bounded world (#63). Descent belongs to #53's fix.
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

  it('mining an already-dug cell yields nothing — no second helping of ore', () => {
    // mineTile's only caller (physicsStep) checks solidity first, so this was never reachable through
    // play. But it's an exported sim function that minted ore for whatever it was pointed at, which
    // makes correctness depend on every future caller remembering a guard. The guard belongs here.
    let exercised = 0;
    for (let seed = 1; seed <= 20 && exercised < 5; seed++) {
      const session = newSession(seed);
      let cell: { c: number; r: number } | null = null;
      for (let r = 1; r <= 300 && !cell; r++)
        for (let c = 0; c < WIDTH && !cell; c++) if (oreAt(seed, c, r)) cell = { c, r };
      if (!cell) continue;
      expect(mineTile(session, cell.c, cell.r, 50, [])).toBe(true);
      const heldAfterFirst = invCount(session.player);

      const again: SimEvent[] = [];
      expect(mineTile(session, cell.c, cell.r, 50, again)).toBe(false);
      expect(again).toEqual([]);
      expect(invCount(session.player)).toBe(heldAfterFirst);
      exercised++;
    }
    expect(exercised).toBeGreaterThan(0);
  });

  it('mineTile deals damage over hits and eventually breaks the cell', () => {
    const session = newSession(555);
    const col = Math.floor(session.player.x);
    // The first solid row under this column. It was a hardcoded `1`, true only while the surface was
    // flat; with the heightmap (#44) it passed because seed 555 happens to be solid there.
    const row = surfaceAt(session.world.seed, col) + 1;
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

// #8's regression — movement stopped at the old 0-80 view span — now reads against the REAL bound:
// the world is finite again (#58), so the player must walk far past the dev-tools span, and stop only
// at the world's own edges (bounds.test.ts).
describe('#8 regression — the old view span is not a wall', () => {
  it('walks far past WIDTH in both directions', () => {
    const session = newSession(999);
    const start = session.player.x;
    let maxX = start;
    let minX = start;
    for (let i = 0; i < 3000; i++) {
      physicsStep(session, { right: true }, TICK_DT);
      maxX = Math.max(maxX, session.player.x);
    }
    for (let i = 0; i < 6000; i++) {
      physicsStep(session, { left: true }, TICK_DT);
      minX = Math.min(minX, session.player.x);
    }
    expect(maxX - start).toBeGreaterThan(WIDTH + 20);
    expect(start - minX).toBeGreaterThan(WIDTH + 20);
  });
});

const PHYS_MINE_DT = TICK_DT;

describe('reach has one definition', () => {
  // The client's reticle used to compute reach from the CENTRE cell while the sim measured from the
  // body's span; they disagreed by up to two cells vertically. withinReach is now the single rule both
  // call. physicsStep calls it too, so this first property can't catch a change to reach itself — it
  // catches the sim growing an EXTRA mining condition the reticle doesn't know about, which is how the
  // two would drift apart again. The test after it pins the rule itself.
  it('matches, cell for cell, what physicsStep will actually mine', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: -7, max: 7 }),
        (seed, dc, dr) => {
          const session = newSession(seed);
          // stand in a carved pocket so there is solid rock in every direction to aim at
          const column = Math.floor(session.player.x) + dc;
          const row = Math.floor(session.player.y) + dr;
          if (!solidCell(session.world, column, row)) return; // only solid targets are minable at all
          const predicted = withinReach(session.player, column, row);
          const before = session.world.dmg[key(column, row)] ?? 0;
          const { events } = physicsStep(
            session,
            { left: false, right: false, jump: false, mine: { column, row } },
            PHYS_MINE_DT,
          );
          const acted =
            events.some(
              (e) => (e.type === 'chip' || e.type === 'break') && e.c === column && e.r === row,
            ) ||
            (session.world.dmg[key(column, row)] ?? 0) !== before ||
            session.player.digKey === key(column, row);
          expect(acted, `target ${dc},${dr} from the body`).toBe(predicted);
        },
      ),
    );
  });

  it('reaches the cell under the feet and the cell above the head', () => {
    const { player } = newSession(1);
    const feetRow = Math.floor(player.y + PHYS.HH + 0.01);
    const headRow = Math.floor(player.y - PHYS.HH + 0.01) - 1;
    expect(withinReach(player, Math.floor(player.x), feetRow)).toBe(true);
    expect(withinReach(player, Math.floor(player.x), headRow)).toBe(true);
    expect(withinReach(player, Math.floor(player.x), feetRow + PHYS.REACH + 1)).toBe(false);
  });
});

describe('facing is the movement rule, and only the movement rule', () => {
  // The miner used to turn toward the MOUSE while mining, which fought the direction they were
  // walking and flickered: `facing` is part of PlayerState, so the server owns it and replaces it on
  // every snapshot, and it is not part of `Input` — a client-side facing could never reach the
  // server to be agreed on. The rule has exactly one home, here, and it reads horizontal input.
  const step = (session: Session, input: Partial<Input>): void => {
    physicsStep(session, { left: false, right: false, jump: false, mine: null, ...input }, TICK_DT);
  };

  it('never changes without horizontal input, whatever is being aimed at or mined', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(fc.integer({ min: -6, max: 6 }), { minLength: 1, maxLength: 40 }),
        fc.boolean(),
        (seed, offsets, jump) => {
          const session = newSession(seed);
          const before = session.player.facing;
          for (const offset of offsets) {
            // aim all over the place, including behind the miner — mining must not steer them
            const column = Math.floor(session.player.x) + offset;
            const row = Math.floor(session.player.y + PHYS.HH + 0.01);
            step(session, { jump, mine: { column, row } });
          }
          expect(session.player.facing).toBe(before);
        },
      ),
    );
  });

  it('follows the held direction, and holds it after release', () => {
    const session = newSession(1);
    step(session, { left: true });
    expect(session.player.facing).toBe('left');
    step(session, { right: true });
    expect(session.player.facing).toBe('right');
    step(session, { left: true });
    expect(session.player.facing).toBe('left');
    // releasing does not reset it — you keep facing the way you were last going
    for (let i = 0; i < 30; i++) step(session, {});
    expect(session.player.facing).toBe('left');
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

  it('lights several BLOCKS, not several cells (#44 regression)', () => {
    // The 2x2 split scaled every length in here into cells but left the lamp behind, which halved
    // how far the miner could see without changing a single line of the lighting code. The lamp is
    // a distance, so it belongs in the same units as the body and the reach it has to out-range:
    // stated in blocks, so a future re-scale can't silently shrink it again.
    const st = stats(newSession(1).player);
    expect(st.lamp / SUB).toBeGreaterThanOrEqual(3);
    expect(st.lamp).toBeGreaterThan(PHYS.REACH); // you can always see further than you can dig
    const withLantern = newSession(1).player;
    withLantern.tech.lantern = true;
    expect(stats(withLantern).lamp / SUB).toBeGreaterThanOrEqual(6);
  });

  it("the rows around a column's own surface are open above it and solid below it", () => {
    // Per column, not at row 0: the surface is a heightmap (#44), so a hill puts rock above row 0
    // and a valley puts sky below it. World smoothing (#92) may move the surface row and the one below it.
    for (const column of [-40, -1, 0, 7, 123]) {
      expect(blockAt(1, column, surfaceAt(1, column) - 1).solid, `column ${column}`).toBe(false);
      expect(blockAt(1, column, surfaceAt(1, column) + 2).solid, `column ${column}`).toBe(true);
    }
  });
});

describe('movement feel is stated in world units', () => {
  // Acceleration and friction are lengths per second squared — lengths in disguise. The 2x2 split
  // (#44) scaled run speed, gravity, jump and fall by SUB but not these three, so reaching top speed
  // took twice as long, the skid after letting go ran twice as long and nearly twice as far, and air
  // control halved. Nothing noticed, because nothing measured feel in units a player perceives.
  // These are the pre-split values, as seconds and BLOCKS.
  const runRight = { left: false, right: true, jump: false };
  const release = { left: false, right: false, jump: false };

  it('reaches top speed in about 70ms, from standing', () => {
    const session = newSession(3);
    let seconds = 0;
    while (Math.abs(session.player.vx) < PHYS.RUN_SPEED * 0.999 && seconds < 2) {
      physicsStep(session, runRight, TICK_DT);
      seconds += TICK_DT;
    }
    expect(seconds).toBeLessThan(0.1);
  });

  it('skids about a third of a block after letting go at top speed', () => {
    const session = newSession(3);
    for (let i = 0; i < 30; i++) physicsStep(session, runRight, TICK_DT);
    expect(Math.abs(session.player.vx)).toBeCloseTo(PHYS.RUN_SPEED, 5);
    const from = session.player.x;
    for (let i = 0; i < 60 && session.player.vx !== 0; i++) physicsStep(session, release, TICK_DT);
    const skidBlocks = (session.player.x - from) / SUB;
    expect(skidBlocks).toBeGreaterThan(0.2);
    expect(skidBlocks).toBeLessThan(0.4);
  });
});

describe('unstick searches a WORLD distance', () => {
  it('rescues a wedged player whose nearest room is five blocks up', () => {
    // The search range is a length. It was `maxTiles = 6` counted in cells, so the 2x2 split (#44)
    // quietly halved it from six blocks to three, and a rescue that used to succeed fell through to
    // a fresh spawn — losing the player's place in the world.
    const session = newSession(3);
    const { world, player } = session;
    player.x = 40.5;
    player.y = 100.5; // deep in solid rock
    const blocksUp = 5;
    const lift = blocksUp * SUB;
    // carve a pocket exactly the body's size, `lift` cells straight up
    const left = Math.floor(player.x - PHYS.HW + 1e-4);
    const right = Math.floor(player.x + PHYS.HW - 1e-4);
    const top = Math.floor(player.y - lift - PHYS.HH + 1e-4);
    const bottom = Math.floor(player.y - lift + PHYS.HH - 1e-4);
    for (let c = left; c <= right; c++)
      for (let r = top; r <= bottom; r++) world.dug[key(c, r)] = true;

    expect(bodyFits(world, player.x, player.y, player)).toBe(false);
    expect(unstick(world, player)).toBe(true);
    expect(player.y).toBe(100.5 - lift);
  });
});

describe('the player body is taller than one tile (#47)', () => {
  // The size change is the point of adopting the imported character's proportions: a one-tile gap no
  // longer fits, so a tunnel has to be dug two tiles tall. None of the existing physics tests noticed
  // the change, because every one of them was written against a body that fitted inside a tile —
  // which is exactly why these exist.
  const ROW = SURFACE_BASE + 20; // well below the surface, where every tile is solid until dug
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

  it('is taller than a block and narrower than one', () => {
    // In CELLS after the 2x2 split (#44); the claim is about BLOCKS, which is what the world is
    // generated in and what the player reads as a "block" of rock.
    expect((PHYS.HH * 2) / SUB, 'taller than a block').toBeGreaterThan(1);
    expect((PHYS.HW * 2) / SUB, 'narrower than a block').toBeLessThan(1);
  });

  it('spans two block rows when standing', () => {
    // The whole basis of the digging cost: a body inside one block would fit a one-block tunnel.
    // Counted in blocks, since after the split it spans four CELL rows.
    const session = chamber();
    stand(session, ROW);
    const [top, bottom] = bodyRows(session);
    expect(bottom - top, 'spans 4 cell rows').toBe(2 * SUB - 1);
    expect(Math.floor(bottom / SUB) - Math.floor(top / SUB), 'which is 2 blocks').toBe(1);
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

  it('fits a two-block gap', () => {
    const session = chamber();
    for (let c = COL - 8; c <= COL + 8; c++) {
      for (let r = ROW - 8; r <= ROW + 2; r++) delete session.world.dug[key(c, r)];
      // Two BLOCKS of headroom, which is 2 * SUB cells.
      for (let i = 1; i <= 2 * SUB; i++) session.world.dug[key(c, ROW - i)] = true;
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
    // body. At the old size `SURFACE_BASE + 0.5` was fine; at 1.82 tiles it buried the feet in the first
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

describe('walking over terrain (#44)', () => {
  it('steps up a one-tile rise instead of stopping at it', () => {
    // The heightmap's slope is bounded to one tile per column, and one tile is a WALL to a walker
    // with no assist — which is how this was found: the movement regression test stopped dead at
    // the first hill.
    const session = newSession(4242);
    const startX = session.player.x;
    for (let i = 0; i < 600; i++) {
      physicsStep(session, { left: false, right: true, jump: false }, TICK_DT);
    }
    expect(session.player.x - startX).toBeGreaterThan(20);
  });

  it('does not let step-up climb more than one cell', () => {
    // The assist must not become a ladder. Tested UNDERGROUND, where geometry can actually be built
    // by digging: above ground, solidity comes from the heightmap and a hand-built wall is not
    // possible — the first version of this test "walled off" columns that were never dug, so
    // nothing changed and the player strolled past it.
    const ROW = SURFACE_BASE + 30;
    // Inside the world: column 0 is its left edge now (#58), and past it every cell blocks the body.
    const COL = worldColumns('medium') >> 1;
    const session = newSession(4242);
    // A corridor running right, whose floor rises by TWO CELLS half way along — one more than the
    // assist may climb. After the split a cell is half a block, so this is a half-block wall.
    //
    // Carved from COL - 2 because the body is wider than one cell and straddles the column behind
    // its centre; starting at COL left it overlapping undug rock and it never even fitted.
    for (let c = COL - 2; c <= COL + 20; c++) {
      const floor = c < COL + 10 ? ROW : ROW - 2;
      for (let r = floor - (2 * SUB + 1); r < floor; r++) session.world.dug[key(c, r)] = true;
    }
    session.player.x = COL + 0.5;
    session.player.y = ROW - PHYS.HH;
    session.player.vx = 0;
    session.player.vy = 0;
    expect(bodyFits(session.world, session.player.x, session.player.y)).toBe(true);
    for (let i = 0; i < 600; i++) {
      physicsStep(session, { left: false, right: true, jump: false }, TICK_DT);
    }
    // Stopped at the two-tile step rather than climbing it.
    expect(session.player.x).toBeLessThan(COL + 10.5);
  });

  it('spawns standing on the ground whatever the terrain does', () => {
    for (const seed of [1, 2, 3, 77, 4242, 999999]) {
      const session = newSession(seed);
      expect(bodyFits(session.world, session.player.x, session.player.y), `seed ${seed}`).toBe(
        true,
      );
      // And resting on it, not hovering above it.
      expect(
        bodyFits(session.world, session.player.x, session.player.y + 0.2),
        `seed ${seed} is airborne`,
      ).toBe(false);
    }
  });
});
