// rng.ts — deterministic hashing and noise shared by world generation and rendering. All
// pure functions of their inputs (no global state), so the same coordinates always yield the
// same value — the backbone of the infinite, reproducible world. Previously duplicated across
// blocks.js and cave-render.js; consolidated here.
//
// The large integer literals below (73856093, 19349663, 0x6d2b79f5, 374761393, 668265263,
// 362437, 1274126177, 83492791, and the 61/1 odd bit-masks) are the fixed mixing primes of
// the standard spatial-hash and mulberry32 algorithms — arbitrary large primes chosen to
// scramble bits well. They have no individual meaning, so they stay inline per the "family of
// coefficients" exception in CODE-STYLE.md; do not change them (they'd change every seed).

/** 2^32 — divide a uint32 hash by this to normalise it to [0, 1). */
const UINT32_COUNT = 2 ** 32;

/** White noise in [0, 1), independent per cell — a hash of (seed, column, row). */
export function tileRand(seed: number, column: number, row: number): number {
  let hash = (seed ^ (column * 73856093) ^ (row * 19349663)) >>> 0;
  hash += 0x6d2b79f5;
  hash = Math.imul(hash ^ (hash >>> 15), hash | 1);
  hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
  return ((hash ^ (hash >>> 14)) >>> 0) / UINT32_COUNT;
}

/**
 * Spatially-coherent value noise in [0, 1) via a bilinearly-interpolated hash lattice.
 * Thresholding it yields contiguous blobs — the basis for ore nodes/clusters and rock texture.
 */
export function vnoise(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fracX = x - cellX;
  const fracY = y - cellY;

  const latticeHash = (a: number, b: number): number => {
    let n = (a * 374761393 + b * 668265263 + seed * 362437) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / UINT32_COUNT;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  const weightX = smooth(fracX);
  const weightY = smooth(fracY);
  const topLeft = latticeHash(cellX, cellY);
  const topRight = latticeHash(cellX + 1, cellY);
  const bottomLeft = latticeHash(cellX, cellY + 1);
  const bottomRight = latticeHash(cellX + 1, cellY + 1);

  const top = topLeft * (1 - weightX) + topRight * weightX;
  const bottom = bottomLeft * (1 - weightX) + bottomRight * weightX;
  return top * (1 - weightY) + bottom * weightY;
}

/** A seeded PRNG (mulberry32). Returns a function that yields the next value in [0, 1). */
export function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_COUNT;
  };
}

/** A cheap unsigned hash of (x, y, seed) — for per-tile "random but stable" choices. */
export function hashXY(x: number, y: number, seed = 0): number {
  return ((x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)) >>> 0;
}
