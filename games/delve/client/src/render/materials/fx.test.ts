// fx.test.ts — the twinkle geometry/scheduling helpers. Covers the two bug-prone bits: the
// safe-zone position picker, and cluster-edge grouping (adjacent same-material lit tiles collapse
// into one traveling glint edge).
import { describe, it, expect } from 'vitest';
import { pickAway, collectTwinkleEdges } from './fx';
import type { Material } from './types';

describe('pickAway', () => {
  it('always lands in [0,1] and keeps its gap from prev when there is room', () => {
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      for (const prev of [0, 0.25, 0.5, 0.75, 1]) {
        const gap = 0.4;
        const p = pickAway(u, prev, gap);
        expect(p, `in range: ${p}`).toBeGreaterThanOrEqual(0);
        expect(p, `in range: ${p}`).toBeLessThanOrEqual(1);
        // when the safe zone doesn't cover the whole edge, the pick must respect the gap
        const roomExists = prev - gap > 0 || prev + gap < 1;
        if (roomExists) expect(Math.abs(p - prev), `keeps gap: ${p} vs ${prev}`).toBeGreaterThanOrEqual(gap - 1e-9);
      }
    }
  });
});

describe('collectTwinkleEdges', () => {
  const twinkler: Material = { shade: () => [0, 0, 0], twinkle: () => {} };
  const plain: Material = { shade: () => [0, 0, 0] }; // no twinkle → never an edge

  // row 5 = a horizontal vein (cols 2..5) with open space above; col 3 is a different plain material.
  const vein = new Set(['2,5', '3,5', '4,5', '5,5']);
  const mats: Record<string, Material> = { '2,5': twinkler, '3,5': plain, '4,5': twinkler, '5,5': twinkler };
  const scan = {
    bandLeft: 0,
    bandTop: 0,
    cols: 8,
    rows: 8,
    solid: (c: number, r: number) => vein.has(`${c},${r}`),
    materialAt: (c: number, r: number) => mats[`${c},${r}`] ?? null,
    lit: () => 1,
    seedAt: (c: number, r: number) => c * 100 + r,
  };

  it('collapses adjacent same-material exposed tiles into shared edges, split by foreign tiles', () => {
    const edges = collectTwinkleEdges(scan);
    // exposed above AND below; the plain tile at col 3 splits each run into [col2] and [cols 4,5]
    // → 2 up-edges + 2 down-edges.
    const horizontal = edges.filter((e) => e.y0 === e.y1);
    expect(horizontal).toHaveLength(4);
    const widths = new Set(horizontal.map((e) => Math.round(Math.abs(e.x1 - e.x0))));
    expect(widths.size, 'runs come in two widths: 1-tile and 2-tile').toBe(2);
  });

  it('drops wholly dark runs', () => {
    expect(collectTwinkleEdges({ ...scan, lit: () => 0 })).toHaveLength(0);
  });
});
