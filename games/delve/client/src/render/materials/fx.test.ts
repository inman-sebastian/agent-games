// fx.test.ts — self-check for the twinkle geometry/scheduling helpers (run: pnpm tsx <this file>).
// Covers the two bug-prone bits: the safe-zone position picker, and cluster-edge grouping.
import assert from 'node:assert';
import { pickAway, collectTwinkleEdges } from './fx';
import type { Material } from './types';

// ---- pickAway: always lands in [0,1] and keeps its distance from `prev` when there's room -------
for (let i = 0; i <= 20; i++) {
  const u = i / 20;
  for (const prev of [0, 0.25, 0.5, 0.75, 1]) {
    const gap = 0.4;
    const p = pickAway(u, prev, gap);
    assert.ok(p >= 0 && p <= 1, `pickAway in range: ${p}`);
    // when the safe zone doesn't cover the whole edge, the pick must respect the gap
    const roomExists = prev - gap > 0 || prev + gap < 1;
    if (roomExists) assert.ok(Math.abs(p - prev) >= gap - 1e-9, `pickAway keeps gap: ${p} vs ${prev}`);
  }
}

// ---- collectTwinkleEdges: adjacent same-material exposed tiles collapse into ONE edge ----------
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
const edges = collectTwinkleEdges(scan);
// the vein is exposed above AND below, so each horizontal face yields runs; the plain tile at col 3
// splits every run into [col2] and [cols 4,5] → 2 up-edges + 2 down-edges.
const horizontal = edges.filter((e) => e.y0 === e.y1);
assert.strictEqual(horizontal.length, 4, `two up + two down edges, got ${horizontal.length}`);
const widths = new Set(horizontal.map((e) => Math.round(Math.abs(e.x1 - e.x0))));
assert.strictEqual(widths.size, 2, 'runs come in two widths: 1-tile and 2-tile');

// a wholly dark run produces no edge
const darkEdges = collectTwinkleEdges({ ...scan, lit: () => 0 });
assert.strictEqual(darkEdges.length, 0, 'dark runs are dropped');

console.log('fx.test.ts OK');
