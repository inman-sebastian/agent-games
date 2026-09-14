// bounds.test.ts — the world is FINITE (#26): a width set by its size preset, a bedrock floor, and
// one `mineable` rule that the sim, the server and the client's reticle all ask. The generator is
// still defined everywhere (so the world renders past its edge), which makes these properties of the
// SIM rather than of world-gen — and that is exactly where a leak would come from: a code path that
// mines or collides from `solidAt` alone.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  newSession,
  newWorld,
  physicsStep,
  mineTile,
  mineable,
  solidAt,
  surfaceAt,
  worldColumns,
  isWorldSize,
  hydrate,
  ORES,
  STRATA,
  FLOOR,
  SUB,
  PHYS,
  TICK_DT,
  WORLD_SIZES,
  type Session,
  type SimEvent,
  type WorldSize,
} from './index';

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });
const sizeArb = fc.constantFrom<WorldSize>('small', 'medium', 'large');
const FLOOR_ROW = FLOOR * SUB;

/** Drop the player onto the surface at `column`, then let it settle. */
function standAt(session: Session, column: number): void {
  const { player, world } = session;
  player.x = column + 0.5;
  player.y = surfaceAt(world.seed, column) - PHYS.HH - 2;
  player.vx = 0;
  player.vy = 0;
  for (let i = 0; i < 120; i++) physicsStep(session, {}, TICK_DT);
}

describe('size presets', () => {
  it('a bigger preset is wider and holds more players', () => {
    const order: WorldSize[] = ['small', 'medium', 'large'];
    for (let i = 1; i < order.length; i++) {
      expect(WORLD_SIZES[order[i]].width).toBeGreaterThan(WORLD_SIZES[order[i - 1]].width);
      expect(WORLD_SIZES[order[i]].players).toBeGreaterThan(WORLD_SIZES[order[i - 1]].players);
    }
  });

  it('a new world is medium unless told otherwise, and spawns at the centre of its own width', () => {
    expect(newWorld(3).size).toBe('medium');
    for (const size of ['small', 'medium', 'large'] as const) {
      const session = newSession(3, size);
      expect(session.world.size).toBe(size);
      expect(Math.floor(session.player.x)).toBe((worldColumns(size) - 1) >> 1);
    }
  });

  it('only the three preset names are sizes', () => {
    expect(isWorldSize('small')).toBe(true);
    expect(isWorldSize('huge')).toBe(false);
    expect(isWorldSize(undefined)).toBe(false);
  });
});

describe('the bedrock floor', () => {
  it('every ore band ends above the floor (mythril used to run to 99999)', () => {
    for (const ore of ORES) {
      expect(ore.band[1], `${ore.name} band`).toBeLessThan(FLOOR);
    }
  });

  it('the deepest stratum is bedrock, starting exactly at the floor', () => {
    const last = STRATA[STRATA.length - 1];
    expect(last.id).toBe('bedrock');
    expect(last.top).toBe(FLOOR);
  });

  it('rock below the floor is still solid (it renders and blocks), but is never mineable', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 0, max: 400 }), (seed, below) => {
        const world = newWorld(seed);
        const column = worldColumns(world.size) >> 1;
        const row = FLOOR_ROW + below;
        expect(solidAt(seed, column, row)).toBe(true);
        expect(mineable(world, column, row)).toBe(false);
        expect(mineable(world, column, FLOOR_ROW - 1)).toBe(true);
      }),
    );
  });
});

describe('the horizontal edges', () => {
  it('cells past either edge are never mineable, however solid they look', () => {
    fc.assert(
      fc.property(seedArb, sizeArb, fc.integer({ min: 1, max: 300 }), (seed, size, past) => {
        const world = newWorld(seed, size);
        const width = worldColumns(size);
        const row = surfaceAt(seed, 0) + 10;
        expect(mineable(world, -past, row)).toBe(false);
        expect(mineable(world, width - 1 + past, row)).toBe(false);
        expect(mineable(world, 0, surfaceAt(seed, 0) + 1)).toBe(true);
        expect(mineable(world, width - 1, surfaceAt(seed, width - 1) + 1)).toBe(true);
      }),
    );
  });

  it('mineTile refuses an out-of-bounds or bedrock cell, no matter how hard it is hit', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom('left', 'right', 'floor'), (seed, where) => {
        const session = newSession(seed, 'small');
        const width = worldColumns('small');
        const column = where === 'left' ? -1 : where === 'right' ? width : width >> 1;
        const row = where === 'floor' ? FLOOR_ROW : surfaceAt(seed, column) + 4;
        session.player.up.pick = 999;
        const events: SimEvent[] = [];
        for (let i = 0; i < 50; i++) mineTile(session, column, row, 10, events);
        expect(events).toEqual([]);
        expect(session.world.dug).toEqual({});
        expect(session.world.dmg).toEqual({});
      }),
    );
  });

  it('walking into either edge stops the body inside the world', () => {
    const session = newSession(77, 'small');
    const width = worldColumns('small');
    const hw = PHYS.HW;

    standAt(session, width - 6);
    for (let i = 0; i < 900; i++) physicsStep(session, { right: true, jump: i % 40 < 5 }, TICK_DT);
    expect(session.player.x + hw).toBeLessThanOrEqual(width);
    expect(session.player.x).toBeGreaterThan(width - 6); // it did walk — it stopped at the edge

    standAt(session, 5);
    for (let i = 0; i < 900; i++) physicsStep(session, { left: true, jump: i % 40 < 5 }, TICK_DT);
    expect(session.player.x - hw).toBeGreaterThanOrEqual(0);
    expect(session.player.x).toBeLessThan(6);
  });
});

describe('restoring a save into a bounded world', () => {
  it('a save from before presets loads as medium, and a bogus size is not trusted', () => {
    expect(hydrate({ world: { seed: 8, dug: {}, dmg: {} }, player: {} }).world.size).toBe('medium');
    expect(
      hydrate({ world: { seed: 8, size: 'huge', dug: {}, dmg: {} }, player: {} }).world.size,
    ).toBe('medium');
    expect(
      hydrate({ world: { seed: 8, size: 'large', dug: {}, dmg: {} }, player: {} }).world.size,
    ).toBe('large');
  });

  it('a player the infinite world let wander past the new edge comes back to spawn', () => {
    const seed = 8;
    const spawn = newSession(seed, 'small').player;
    for (const x of [-500.5, worldColumns('small') + 500.5]) {
      const s = hydrate({
        world: { seed, size: 'small', dug: {}, dmg: {} },
        player: { x, y: surfaceAt(seed, Math.floor(x)) - PHYS.HH },
      });
      expect(s.player.x).toBe(spawn.x);
      expect(s.player.y).toBe(spawn.y);
    }
  });
});
