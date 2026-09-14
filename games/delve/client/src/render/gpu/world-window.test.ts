// world-window.test.ts — the GPU renderer's CPU mirror of the world around the view (#71).
//
// Two things must hold, and both are why the window exists. It must never disagree with the world:
// a stale cell is rock drawn where the player dug. And it must not quietly go back to querying the
// whole view every frame, which is the 3.7 ms the spike measured and this replaced.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createWorldWindow, WINDOW_MARGIN, TOP_CONTEXT_ROWS } from './world-window';

/** A deterministic fake world with a mutable dug set, counting every query made of it. */
function fakeWorld(seed: number) {
  const dug = new Set<string>();
  let solidQueries = 0;
  let surfaceQueries = 0;
  const hash = (a: number, b: number): number => {
    let h = Math.imul(a ^ seed, 0x9e3779b1) ^ Math.imul(b + seed, 0x85ebca6b);
    h ^= h >>> 13;
    return (Math.imul(h, 0xc2b2ae35) >>> 0) % 7;
  };
  return {
    dug,
    source: {
      solid: (column: number, row: number): boolean => {
        solidQueries++;
        return hash(column, row) > 1 && !dug.has(`${column},${row}`);
      },
      surface: (column: number): number => {
        surfaceQueries++;
        return (hash(column, 99) % 5) - 2;
      },
      material: (column: number, row: number): number => hash(row, column) % 4,
      shape: (column: number, row: number): number => hash(column + 7, row) % 5,
    },
    queries: () => ({ solid: solidQueries, surface: surfaceQueries }),
    truth: (column: number, row: number): boolean =>
      hash(column, row) > 1 && !dug.has(`${column},${row}`),
    truthSurface: (column: number): number => (hash(column, 99) % 5) - 2,
    /** The packed cell the window stores: bit 0 solid, bits 1–3 the static shape, bits 8–15 the static material id. */
    truthCell: (column: number, row: number): number =>
      (hash(column, row) > 1 && !dug.has(`${column},${row}`) ? 1 : 0) |
      ((hash(column + 7, row) % 5) << 1) |
      ((hash(row, column) % 4) << 8),
  };
}

const opArb = fc.oneof(
  fc.record({
    kind: fc.constant('scroll' as const),
    dc: fc.integer({ min: -12, max: 12 }),
    dr: fc.integer({ min: -12, max: 12 }),
  }),
  fc.record({
    kind: fc.constant('jump' as const),
    dc: fc.integer({ min: -500, max: 500 }),
    dr: fc.integer({ min: -500, max: 500 }),
  }),
  fc.record({
    kind: fc.constant('dig' as const),
    dc: fc.integer({ min: -60, max: 60 }),
    dr: fc.integer({ min: -60, max: 60 }),
  }),
  fc.record({
    kind: fc.constant('resize' as const),
    dc: fc.integer({ min: 20, max: 60 }),
    dr: fc.integer({ min: 16, max: 40 }),
  }),
);

describe('the GPU world window', () => {
  it('always mirrors the world exactly, whatever the scrolling and digging', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(opArb, { maxLength: 40 }), (seed, ops) => {
        const world = fakeWorld(seed);
        const window = createWorldWindow(world.source);
        const view = { left: 100, top: 20, cols: 40, rows: 24 };
        window.follow(view.left, view.top, view.cols, view.rows);
        for (const op of ops) {
          if (op.kind === 'scroll' || op.kind === 'jump') {
            view.left += op.dc;
            view.top += op.dr;
          } else if (op.kind === 'resize') {
            view.cols = op.dc;
            view.rows = op.dr;
          } else {
            const column = view.left + op.dc;
            const row = view.top + op.dr;
            world.dug.add(`${column},${row}`);
            window.dig(column, row);
          }
          window.follow(view.left, view.top, view.cols, view.rows);
        }
        for (let row = 0; row < window.rows; row++) {
          for (let column = 0; column < window.cols; column++) {
            const expected = world.truthCell(window.left + column, window.top + row);
            expect(
              window.cells[row * window.cols + column],
              `cell ${window.left + column},${window.top + row}`,
            ).toBe(expected);
          }
        }
        for (let column = 0; column < window.cols; column++) {
          expect(window.surface[column]).toBe(world.truthSurface(window.left + column));
        }
      }),
    );
  });

  it('always covers the view with the context the shaders read around it', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: -400, max: 400 }), fc.integer({ min: -400, max: 400 })),
          { minLength: 1, maxLength: 30 },
        ),
        (moves) => {
          const window = createWorldWindow(fakeWorld(1).source);
          const view = { left: 0, top: 0, cols: 50, rows: 30 };
          for (const [dc, dr] of moves) {
            view.left += dc % 20;
            view.top += dr % 20;
            window.follow(view.left, view.top, view.cols, view.rows);
            // a ring of one cell on every side, and the top light's rows above
            expect(window.left).toBeLessThanOrEqual(view.left - 1);
            expect(window.top).toBeLessThanOrEqual(view.top - TOP_CONTEXT_ROWS);
            expect(window.left + window.cols).toBeGreaterThanOrEqual(view.left + view.cols + 1);
            expect(window.top + window.rows).toBeGreaterThanOrEqual(view.top + view.rows + 1);
          }
        },
      ),
    );
  });

  it('a small scroll queries only the cells that entered the window, not the whole view again', () => {
    const world = fakeWorld(7);
    const window = createWorldWindow(world.source);
    const cols = 200;
    const rows = 110;
    window.follow(1000, 50, cols, rows);
    const before = world.queries();
    // scroll one cell a frame for longer than the margin, so the window has to shift at least once
    let shifts = 0;
    let version = window.version;
    for (let step = 1; step <= WINDOW_MARGIN * 2; step++) {
      window.follow(1000 + step, 50, cols, rows);
      if (window.version !== version) shifts++;
      version = window.version;
    }
    const after = world.queries();
    expect(shifts).toBeGreaterThan(0);
    // each shift re-queries a strip of at most the margin's width, never the window's full area
    const fullWindow = window.cols * window.rows;
    expect(after.solid - before.solid).toBeLessThanOrEqual(
      shifts * (WINDOW_MARGIN * 2) * window.rows,
    );
    expect(after.solid - before.solid).toBeLessThan(fullWindow);
  });

  it('a dig outside the window is ignored, and one inside changes the version', () => {
    const world = fakeWorld(3);
    const window = createWorldWindow(world.source);
    window.follow(0, 0, 40, 30);
    const version = window.version;
    window.dig(10_000, 10_000);
    expect(window.version).toBe(version);
    world.dug.add('5,5');
    window.dig(5, 5);
    expect(window.version).toBeGreaterThan(version);
    expect(window.cells[(5 - window.top) * window.cols + (5 - window.left)] & 1).toBe(0);
  });
});
