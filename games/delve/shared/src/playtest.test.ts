// playtest.test.ts — a SIMULATED PLAYTEST: play the game and assert it never becomes unplayable.
//
// Distinct from blocks.test.ts and engine.test.ts, which check that individual rules are correct.
// This drives long input streams through the real sim and asserts properties about the RESULTING
// SITUATION — the class of failure a unit test cannot see because no single rule is broken.
//
// Written because the player nearly doubled in height and the world grew terrain (#47, #44), and the
// gameplay consequences of both were entirely unvalidated. Every real bug in that work was found by
// rendering something or running a test, never by reasoning about it, so the honest move was to
// automate the part a human should not have to check by hand.
//
// THE SOFT-LOCK DEFINITION USED HERE: the player is stuck when it can neither MOVE nor DIG. Digging
// is how DELVE lets you reshape your way out of anywhere, so "can always dig" is the guarantee that
// makes the world escapable — not "can always walk", which was never true in a mine.
//
// What this deliberately does NOT test: whether any of it feels good. Two-tile tunnels as satisfying
// cost or tedium, step-up as assistance or as a yank — no assertion has an opinion on those, and
// pretending otherwise would be the same mistake as trusting a silhouette metric over the game.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newSession,
  physicsStep,
  solidCell,
  bodyFits,
  surfaceAt,
  PHYS,
  TICK_DT,
  key,
  type Input,
  type Session,
} from '@delve/shared';

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

/** The tiles the player's body spans, which is what reach is measured from. */
function bodyTiles(session: Session): { left: number; right: number; top: number; bottom: number } {
  const { x, y } = session.player;
  return {
    left: Math.floor(x - PHYS.HW + 1e-9),
    right: Math.floor(x + PHYS.HW - 1e-9),
    top: Math.floor(y - PHYS.HH + 1e-9),
    bottom: Math.floor(y + PHYS.HH - 1e-9),
  };
}

/** Every solid tile within reach of the body — the player's options for reshaping the world. */
function diggable(session: Session): { column: number; row: number }[] {
  const b = bodyTiles(session);
  const out: { column: number; row: number }[] = [];
  for (let row = b.top - PHYS.REACH; row <= b.bottom + PHYS.REACH; row++) {
    for (let column = b.left - PHYS.REACH; column <= b.right + PHYS.REACH; column++) {
      if (row <= surfaceAt(session.world.seed, column)) continue; // open sky is not diggable
      if (solidCell(session.world, column, row)) out.push({ column, row });
    }
  }
  return out;
}

/** Whether the body could occupy a position one tile to either side — i.e. walking is possible. */
function canMove(session: Session): boolean {
  const { x, y } = session.player;
  return bodyFits(session.world, x - 1, y) || bodyFits(session.world, x + 1, y);
}

/** Drive one input for `ticks`, mining the given target throughout. */
function play(session: Session, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) physicsStep(session, input, TICK_DT);
}

describe('a played session never becomes unplayable', () => {
  it('is never wedged inside rock, whatever the inputs', () => {
    // The failure the size change made possible: a 1.82-tile body squeezed where a 0.92-tile one fit.
    fc.assert(
      fc.property(
        seedArb,
        fc.array(
          fc.record({
            left: fc.boolean(),
            right: fc.boolean(),
            jump: fc.boolean(),
            digBelow: fc.boolean(),
          }),
          { minLength: 40, maxLength: 160 },
        ),
        (seed, stream) => {
          const session = newSession(seed);
          for (const frame of stream) {
            const b = bodyTiles(session);
            const input: Input = {
              left: frame.left,
              right: frame.right,
              jump: frame.jump,
              // Digging straight down is the most common real action and the one that reshapes the
              // world underneath the player, which is where a wedge would come from.
              mine: frame.digBelow ? { column: b.left, row: b.bottom + 1 } : undefined,
            };
            play(session, input, 6);
            expect(
              bodyFits(session.world, session.player.x, session.player.y),
              `wedged at ${session.player.x.toFixed(2)},${session.player.y.toFixed(2)} on seed ${seed}`,
            ).toBe(true);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('can always either move or dig', () => {
    // THE soft-lock property. Digging is how the player reshapes its way out, so losing both options
    // at once is the only genuinely unrecoverable state.
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 0, max: 400 }), (seed, depth) => {
        const session = newSession(seed);
        // Dig straight down `depth` tiles, which is the deepest a player can commit themselves.
        for (let i = 0; i < depth; i++) {
          const b = bodyTiles(session);
          for (const column of [b.left, b.right]) {
            session.world.dug[key(column, b.bottom + 1)] = true;
          }
          play(session, { left: false, right: false, jump: false }, 12);
        }
        expect(
          canMove(session) || diggable(session).length > 0,
          `seed ${seed} depth ${depth}`,
        ).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('can climb out of a shaft it dug straight down', () => {
    // The scenario a player actually gets into, and the one the taller body threatened: dig down,
    // then get back up. There is no upward traversal yet (see CLAUDE.md), so the only way out is to
    // dig a staircase and walk it — which is exactly what step-up exists to make possible.
    const session = newSession(2024);
    const startY = session.player.y;
    const DEPTH = 12;
    for (let i = 0; i < DEPTH; i++) {
      const b = bodyTiles(session);
      for (const column of [b.left, b.right]) session.world.dug[key(column, b.bottom + 1)] = true;
      play(session, { left: false, right: false, jump: false }, 12);
    }
    expect(session.player.y).toBeGreaterThan(startY + DEPTH - 2); // actually went down

    // Now cut a staircase upward and walk it: one tile up, one tile across, repeatedly.
    //
    // The head clearance has to be carved in BOTH columns, which is a real property of the game and
    // not a quirk of this test. Mid-step the body straddles the column it is leaving and the one it
    // is entering, so it needs the extra row over both — a staircase wants THREE tiles of vertical
    // clearance even though standing still only wants two. Carving two, which is what this tried
    // first, climbs exactly one step and then jams against the ceiling of the column behind it.
    for (let i = 0; i < DEPTH + 4; i++) {
      const b = bodyTiles(session);
      for (let row = b.top - 1; row <= b.bottom - 1; row++) {
        session.world.dug[key(b.right + 1, row)] = true;
      }
      session.world.dug[key(b.left, b.top - 1)] = true; // headroom over the step being left
      session.world.dug[key(b.right, b.top - 1)] = true;
      play(session, { left: false, right: true, jump: false }, 24);
    }
    expect(session.player.y, 'never climbed back out of its own shaft').toBeLessThan(startY + 2);
  });

  it('walks a long stretch of terrain without getting stuck on it', () => {
    // The heightmap's slope is bounded and the player has step-up, so open ground must never stop
    // it. The #8 regression caught this once already, at 62 tiles; this drives much further and
    // over many seeds.
    fc.assert(
      fc.property(seedArb, (seed) => {
        const session = newSession(seed);
        const startX = session.player.x;
        play(session, { left: false, right: true, jump: false }, 60 * 20);
        expect(session.player.x - startX, `seed ${seed} stalled`).toBeGreaterThan(60);
      }),
      { numRuns: 20 },
    );
  });

  it('keeps the body above the ground it is standing on', () => {
    // Sinking into terrain would not wedge the player — `bodyFits` would still pass once the tile
    // below is dug — but it would look broken and let the player dig from inside the floor.
    fc.assert(
      fc.property(seedArb, (seed) => {
        const session = newSession(seed);
        play(session, { left: false, right: true, jump: true }, 60 * 10);
        const b = bodyTiles(session);
        for (let row = b.top; row <= b.bottom; row++) {
          for (let column = b.left; column <= b.right; column++) {
            expect(solidCell(session.world, column, row), `inside rock at ${column},${row}`).toBe(
              false,
            );
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});
