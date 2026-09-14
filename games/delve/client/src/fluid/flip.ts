// flip.ts — the FLIP/PIC liquid (#88): particles carry the liquid, a MAC grid solves pressure. The model,
// its units and why it's built this way are in docs/FLUIDS.md; the reference is Matthias Müller's Ten
// Minute Physics FLIP, adapted to art pixels, y pointing down, and DELVE's rock mask.
//
// Deterministic: no Math.random, fixed loop orders, so a scene replays exactly.

export interface FlipParams {
  /** Grid cell spacing, art px. */
  h: number;
  /** px/s², downward. */
  gravity: number;
  /** 0 = PIC (stable, viscous) … 1 = FLIP (lively, noisy). */
  flipRatio: number;
  pressureIters: number;
  particleIters: number;
  overRelaxation: number;
  /** Extra per-step velocity damping, 0 = none (water); lava uses some. */
  damping: number;
  /** Largest distance, in cells, a particle may travel in one substep. */
  maxCellsPerSubstep: number;
  /**
   * Drift compensation, px/s of extra outflow per particle of excess density. The reference uses 1 in metres
   * with a 3 cm cell — about 33 cells/s — so in art pixels it has to scale with the cell: left at 1, it was
   * a hundred times too weak and the liquid compressed to 60% of its volume.
   */
  driftStiffness: number;
}

export const FLIP_DEFAULTS: FlipParams = {
  h: 4,
  gravity: 736, // engine.GRAVITY: 46 blocks/s², 8 art px per block... 46 × 2 cells × 8 px
  flipRatio: 0.9,
  pressureIters: 50,
  particleIters: 2,
  overRelaxation: 1.9,
  damping: 0,
  maxCellsPerSubstep: 1,
  driftStiffness: 133,
};

const FLUID = 0;
const AIR = 1;
const SOLID = 2;

export interface FlipSim {
  readonly width: number;
  readonly height: number;
  readonly params: FlipParams;
  /** Particle positions, x then y, art px. Only the first `count` pairs are live. */
  readonly positions: Float32Array<ArrayBuffer>;
  readonly velocities: Float32Array<ArrayBuffer>;
  readonly count: number;
  readonly radius: number;
  /** Seed particles on a jittered lattice over the open pixels of a rectangle. */
  fill(x0: number, y0: number, x1: number, y1: number): number;
  /** Pour: add up to `limit` particles in a disc, only where there's room for them. */
  pour(x: number, y: number, radius: number, limit: number): number;
  /** Replace the rock mask (1 = rock, one byte per art pixel). */
  setSolid(solid: Uint8Array): void;
  /** Advance by `dt` seconds, substepped. */
  step(dt: number): void;
}

/** A tiny deterministic hash in [0, 1): seeding jitter without Math.random. */
function jitter(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function createFlip(
  width: number,
  height: number,
  solid: Uint8Array,
  params: FlipParams = FLIP_DEFAULTS,
  maxParticles = 60000,
): FlipSim {
  const { h } = params;
  const inverseH = 1 / h;
  // one ring of solid cells around the simulated area
  const numX = Math.ceil(width / h) + 2;
  const numY = Math.ceil(height / h) + 2;
  const cells = numX * numY;
  const u = new Float32Array(cells);
  const v = new Float32Array(cells);
  const du = new Float32Array(cells);
  const dv = new Float32Array(cells);
  const prevU = new Float32Array(cells);
  const prevV = new Float32Array(cells);
  const pressure = new Float32Array(cells);
  const s = new Float32Array(cells);
  const cellType = new Int32Array(cells);
  const density = new Float32Array(cells);
  let restDensity = 0;

  const radius = 0.3 * h;
  const positions = new Float32Array(2 * maxParticles);
  const velocities = new Float32Array(2 * maxParticles);
  let count = 0;

  // spatial hash for particle separation
  const hashSpacing = 2.2 * radius;
  const hashX = Math.ceil(width / hashSpacing) + 1;
  const hashY = Math.ceil(height / hashSpacing) + 1;
  const hashCount = new Int32Array(hashX * hashY + 1);
  const hashIds = new Int32Array(maxParticles);

  let rock = solid;
  /** For each rock pixel, the index of the nearest open pixel (-1 when there's none). */
  let nearestOpen = new Int32Array(width * height);

  const cellIndex = (i: number, j: number): number => i * numY + j;

  function setSolid(next: Uint8Array): void {
    rock = next;
    // grid solidity: a cell is solid when at least half its pixels are rock; the border ring always is
    for (let i = 0; i < numX; i++) {
      for (let j = 0; j < numY; j++) {
        let solidPixels = 0;
        let pixels = 0;
        if (i > 0 && j > 0 && i < numX - 1 && j < numY - 1) {
          const px0 = (i - 1) * h;
          const py0 = (j - 1) * h;
          for (let py = py0; py < py0 + h; py++) {
            for (let px = px0; px < px0 + h; px++) {
              pixels++;
              if (px >= width || py >= height || rock[py * width + px]) solidPixels++;
            }
          }
        }
        s[cellIndex(i, j)] = pixels > 0 && solidPixels * 2 < pixels ? 1 : 0;
      }
    }
    // nearest open pixel for every rock pixel: a breadth-first flood from all open pixels at once
    nearestOpen = new Int32Array(width * height).fill(-1);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < width * height; i++) {
      if (!rock[i]) {
        nearestOpen[i] = i;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || nearestOpen[n] >= 0) continue;
        nearestOpen[n] = nearestOpen[i];
        queue[tail++] = n;
      }
    }
  }

  function fill(x0: number, y0: number, x1: number, y1: number): number {
    const spacing = 2 * radius;
    const rowSpacing = (Math.sqrt(3) / 2) * spacing;
    let added = 0;
    let row = 0;
    for (let y = y0 + radius; y < y1 - radius; y += rowSpacing, row++) {
      for (let x = x0 + radius + (row % 2) * radius; x < x1 - radius; x += spacing) {
        if (count >= maxParticles) return added;
        const px = x + (jitter(count, 1) - 0.5) * 0.2 * radius;
        const py = y + (jitter(count, 2) - 0.5) * 0.2 * radius;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= width || iy >= height || rock[iy * width + ix]) continue;
        positions[2 * count] = px;
        positions[2 * count + 1] = py;
        velocities[2 * count] = 0;
        velocities[2 * count + 1] = 0;
        count++;
        added++;
      }
    }
    if (count === added) restDensity = 0; // the first liquid: rest density is measured from it
    return added;
  }

  function pour(cx: number, cy: number, discRadius: number, limit: number): number {
    const spacing = 2 * radius;
    let added = 0;
    for (let attempt = 0; attempt < limit * 4 && added < limit && count < maxParticles; attempt++) {
      const angle = jitter(count * 31 + attempt, 5) * 2 * Math.PI;
      const distance = Math.sqrt(jitter(count * 17 + attempt, 6)) * discRadius;
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix < 1 || iy < 1 || ix >= width - 1 || iy >= height - 1 || rock[iy * width + ix])
        continue;
      let crowded = false;
      for (let p = 0; p < count && !crowded; p++) {
        const dx = positions[2 * p] - x;
        const dy = positions[2 * p + 1] - y;
        crowded = dx * dx + dy * dy < spacing * spacing;
      }
      if (crowded) continue;
      positions[2 * count] = x;
      positions[2 * count + 1] = y;
      velocities[2 * count] = 0;
      velocities[2 * count + 1] = 0;
      count++;
      added++;
    }
    return added;
  }

  function integrate(dt: number): void {
    const damping = 1 - params.damping;
    for (let p = 0; p < count; p++) {
      velocities[2 * p + 1] += dt * params.gravity;
      velocities[2 * p] *= damping;
      velocities[2 * p + 1] *= damping;
      positions[2 * p] += velocities[2 * p] * dt;
      positions[2 * p + 1] += velocities[2 * p + 1] * dt;
    }
  }

  function separate(): void {
    hashCount.fill(0);
    const hashOf = (x: number, y: number): number => {
      const hx = Math.min(hashX - 1, Math.max(0, Math.floor(x / hashSpacing)));
      const hy = Math.min(hashY - 1, Math.max(0, Math.floor(y / hashSpacing)));
      return hx * hashY + hy;
    };
    for (let p = 0; p < count; p++) hashCount[hashOf(positions[2 * p], positions[2 * p + 1])]++;
    let start = 0;
    for (let c = 0; c < hashX * hashY; c++) {
      start += hashCount[c];
      hashCount[c] = start;
    }
    hashCount[hashX * hashY] = start;
    for (let p = 0; p < count; p++) {
      const c = hashOf(positions[2 * p], positions[2 * p + 1]);
      hashCount[c]--;
      hashIds[hashCount[c]] = p;
    }
    const minDistance = 2 * radius;
    const minDistance2 = minDistance * minDistance;
    for (let iter = 0; iter < params.particleIters; iter++) {
      for (let p = 0; p < count; p++) {
        const px = positions[2 * p];
        const py = positions[2 * p + 1];
        const hx = Math.min(hashX - 1, Math.max(0, Math.floor(px / hashSpacing)));
        const hy = Math.min(hashY - 1, Math.max(0, Math.floor(py / hashSpacing)));
        for (let xi = Math.max(0, hx - 1); xi <= Math.min(hashX - 1, hx + 1); xi++) {
          for (let yi = Math.max(0, hy - 1); yi <= Math.min(hashY - 1, hy + 1); yi++) {
            const c = xi * hashY + yi;
            for (let k = hashCount[c]; k < hashCount[c + 1]; k++) {
              const q = hashIds[k];
              if (q === p) continue;
              const dx = positions[2 * q] - positions[2 * p];
              const dy = positions[2 * q + 1] - positions[2 * p + 1];
              const d2 = dx * dx + dy * dy;
              if (d2 > minDistance2) continue;
              if (d2 === 0) {
                // exactly on top of each other: part them along a fixed, per-pair direction
                const angle = jitter(p * 7919 + q, 3) * 2 * Math.PI;
                positions[2 * q] += Math.cos(angle) * radius;
                positions[2 * q + 1] += Math.sin(angle) * radius;
                continue;
              }
              const d = Math.sqrt(d2);
              const push = (0.5 * (minDistance - d)) / d;
              positions[2 * p] -= dx * push;
              positions[2 * p + 1] -= dy * push;
              positions[2 * q] += dx * push;
              positions[2 * q + 1] += dy * push;
            }
          }
        }
      }
    }
  }

  function collide(): void {
    for (let p = 0; p < count; p++) {
      let x = positions[2 * p];
      let y = positions[2 * p + 1];
      // the simulated area's edge
      if (x < radius) [x, velocities[2 * p]] = [radius, 0];
      if (x > width - radius) [x, velocities[2 * p]] = [width - radius, 0];
      if (y < radius) [y, velocities[2 * p + 1]] = [radius, 0];
      if (y > height - radius) [y, velocities[2 * p + 1]] = [height - radius, 0];
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const i = iy * width + ix;
      if (rock[i]) {
        const open = nearestOpen[i];
        if (open >= 0) {
          // into the nearest open pixel, at the point of it closest to where the particle was, so particles
          // pushed out along a wall keep their separate positions along it
          const openX = open % width;
          const openY = (open - openX) / width;
          const margin = 0.01;
          const cx = Math.min(openX + 1 - margin, Math.max(openX + margin, x));
          const cy = Math.min(openY + 1 - margin, Math.max(openY + margin, y));
          const nx = cx - x;
          const ny = cy - y;
          const length = Math.hypot(nx, ny) || 1;
          // remove the velocity into the wall (the component against the outward normal)
          const into = (velocities[2 * p] * nx + velocities[2 * p + 1] * ny) / length;
          if (into < 0) {
            velocities[2 * p] -= (into * nx) / length;
            velocities[2 * p + 1] -= (into * ny) / length;
          }
          x = cx;
          y = cy;
        }
      }
      positions[2 * p] = x;
      positions[2 * p + 1] = y;
    }
  }

  /** Grid coordinates of a component: u lives at (i, j + ½), v at (i + ½, j), in cells, offset by the ring. */
  function transferToGrid(): void {
    prevU.set(u);
    prevV.set(v);
    u.fill(0);
    v.fill(0);
    du.fill(0);
    dv.fill(0);
    for (let c = 0; c < cells; c++) cellType[c] = s[c] === 0 ? SOLID : AIR;
    for (let p = 0; p < count; p++) {
      const i = Math.min(numX - 1, Math.max(0, Math.floor(positions[2 * p] * inverseH) + 1));
      const j = Math.min(numY - 1, Math.max(0, Math.floor(positions[2 * p + 1] * inverseH) + 1));
      const c = cellIndex(i, j);
      if (cellType[c] === AIR) cellType[c] = FLUID;
    }
    for (const component of [0, 1]) {
      const offsetX = component === 0 ? 0 : 0.5 * h;
      const offsetY = component === 0 ? 0.5 * h : 0;
      const field = component === 0 ? u : v;
      const weights = component === 0 ? du : dv;
      for (let p = 0; p < count; p++) {
        const { i0, j0, tx, ty } = corner(positions[2 * p], positions[2 * p + 1], offsetX, offsetY);
        const value = velocities[2 * p + component];
        const w = [(1 - tx) * (1 - ty), tx * (1 - ty), tx * ty, (1 - tx) * ty];
        const idx = [
          cellIndex(i0, j0),
          cellIndex(i0 + 1, j0),
          cellIndex(i0 + 1, j0 + 1),
          cellIndex(i0, j0 + 1),
        ];
        for (let k = 0; k < 4; k++) {
          field[idx[k]] += value * w[k];
          weights[idx[k]] += w[k];
        }
      }
      for (let c = 0; c < cells; c++) if (weights[c] > 0) field[c] /= weights[c];
    }
    // faces touching solid carry no flow
    for (let i = 0; i < numX; i++) {
      for (let j = 0; j < numY; j++) {
        const c = cellIndex(i, j);
        const solidHere = cellType[c] === SOLID;
        if (solidHere || (i > 0 && cellType[cellIndex(i - 1, j)] === SOLID)) u[c] = prevU[c] = 0;
        if (solidHere || (j > 0 && cellType[cellIndex(i, j - 1)] === SOLID)) v[c] = prevV[c] = 0;
      }
    }
  }

  function corner(
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
  ): { i0: number; j0: number; tx: number; ty: number } {
    const gx = Math.min(Math.max((x - offsetX) * inverseH + 1, 0), numX - 1.001);
    const gy = Math.min(Math.max((y - offsetY) * inverseH + 1, 0), numY - 1.001);
    const i0 = Math.min(Math.floor(gx), numX - 2);
    const j0 = Math.min(Math.floor(gy), numY - 2);
    return { i0, j0, tx: gx - i0, ty: gy - j0 };
  }

  function updateDensity(): void {
    density.fill(0);
    for (let p = 0; p < count; p++) {
      const { i0, j0, tx, ty } = corner(positions[2 * p], positions[2 * p + 1], 0.5 * h, 0.5 * h);
      density[cellIndex(i0, j0)] += (1 - tx) * (1 - ty);
      density[cellIndex(i0 + 1, j0)] += tx * (1 - ty);
      density[cellIndex(i0 + 1, j0 + 1)] += tx * ty;
      density[cellIndex(i0, j0 + 1)] += (1 - tx) * ty;
    }
    if (restDensity === 0) {
      let sum = 0;
      let fluidCells = 0;
      for (let c = 0; c < cells; c++) {
        if (cellType[c] !== FLUID) continue;
        sum += density[c];
        fluidCells++;
      }
      if (fluidCells > 0) restDensity = sum / fluidCells;
    }
  }

  function solvePressure(): void {
    pressure.fill(0);
    // FLIP's change is measured across the solve alone: record the grid as the particles left it. (Recording
    // it before the particle-to-grid transfer, as this first did, fed each step the whole difference from the
    // last one, and the liquid gained energy until it exploded.)
    prevU.set(u);
    prevV.set(v);
    for (let iter = 0; iter < params.pressureIters; iter++) {
      for (let i = 1; i < numX - 1; i++) {
        for (let j = 1; j < numY - 1; j++) {
          const c = cellIndex(i, j);
          if (cellType[c] !== FLUID) continue;
          const left = cellIndex(i - 1, j);
          const right = cellIndex(i + 1, j);
          const top = cellIndex(i, j - 1);
          const bottom = cellIndex(i, j + 1);
          const sides = s[left] + s[right] + s[top] + s[bottom];
          if (sides === 0) continue;
          let divergence = u[right] - u[c] + v[bottom] - v[c];
          if (restDensity > 0) {
            const compression = density[c] - restDensity;
            if (compression > 0) divergence -= params.driftStiffness * compression;
          }
          const correction = (-divergence / sides) * params.overRelaxation;
          pressure[c] += correction;
          u[c] -= s[left] * correction;
          u[right] += s[right] * correction;
          v[c] -= s[top] * correction;
          v[bottom] += s[bottom] * correction;
        }
      }
    }
  }

  function transferToParticles(): void {
    for (const component of [0, 1]) {
      const offsetX = component === 0 ? 0 : 0.5 * h;
      const offsetY = component === 0 ? 0.5 * h : 0;
      const field = component === 0 ? u : v;
      const previous = component === 0 ? prevU : prevV;
      // a face is valid when either cell beside it isn't air
      const beside = component === 0 ? numY : 1;
      for (let p = 0; p < count; p++) {
        const { i0, j0, tx, ty } = corner(positions[2 * p], positions[2 * p + 1], offsetX, offsetY);
        const idx = [
          cellIndex(i0, j0),
          cellIndex(i0 + 1, j0),
          cellIndex(i0 + 1, j0 + 1),
          cellIndex(i0, j0 + 1),
        ];
        const w = [(1 - tx) * (1 - ty), tx * (1 - ty), tx * ty, (1 - tx) * ty];
        let total = 0;
        let pic = 0;
        let change = 0;
        for (let k = 0; k < 4; k++) {
          const c = idx[k];
          const valid =
            cellType[c] !== AIR || (c - beside >= 0 && cellType[c - beside] !== AIR) ? 1 : 0;
          const weight = valid * w[k];
          total += weight;
          pic += weight * field[c];
          change += weight * (field[c] - previous[c]);
        }
        if (total <= 0) continue;
        pic /= total;
        change /= total;
        const flip = velocities[2 * p + component] + change;
        velocities[2 * p + component] = (1 - params.flipRatio) * pic + params.flipRatio * flip;
      }
    }
  }

  setSolid(solid);

  return {
    width,
    height,
    params,
    positions,
    velocities,
    get count() {
      return count;
    },
    radius,
    fill,
    pour,
    setSolid,
    step(dt) {
      // substep so the fastest particle travels at most maxCellsPerSubstep cells
      let fastest = 0;
      for (let p = 0; p < count; p++) {
        fastest = Math.max(fastest, Math.abs(velocities[2 * p]), Math.abs(velocities[2 * p + 1]));
      }
      const substeps = Math.min(
        8,
        Math.max(
          1,
          Math.ceil(((fastest + params.gravity * dt) * dt) / (params.maxCellsPerSubstep * h)),
        ),
      );
      const sub = dt / substeps;
      for (let k = 0; k < substeps; k++) {
        integrate(sub);
        separate();
        collide();
        transferToGrid();
        updateDensity();
        solvePressure();
        transferToParticles();
      }
    },
  };
}
