// surface.ts — a water body's interactive surface (#89): one column per art pixel along its top edge, each
// with an offset from the level and a velocity, stepped as a damped 1D wave: neighbours pull on each other
// (so a disturbance travels outward as ripples at `waveSpeed`), a weak spring pulls every column back to the
// level, and damping makes it all die away. See docs/FLUIDS.md, "The model".
//
// Pure and deterministic, so it's tested without a browser.

export interface SurfaceParams {
  /** How fast ripples travel along the surface, art px/s. */
  waveSpeed: number;
  /** Spring pulling each column back to the level, 1/s². */
  tension: number;
  /** Fraction of velocity lost per second. */
  damping: number;
  /**
   * Velocity diffusion between neighbours, px²/s: damps the shortest ripples and leaves long waves. Without it
   * a big step (a breach) rings at the grid frequency as a sawtooth trailing the surge.
   */
  viscosity: number;
  /** The furthest a column can be pushed from the level, art px — a splash, not a geyser. */
  maxOffset: number;
}

export const WATER_SURFACE: SurfaceParams = {
  waveSpeed: 90,
  tension: 18,
  damping: 1.6,
  viscosity: 40,
  maxOffset: 10,
};

export interface Surface {
  /** One column per art pixel across the body. */
  readonly columns: number;
  /** Each column's offset from the level, art px; down is positive. */
  readonly offset: Float32Array<ArrayBuffer>;
  readonly velocity: Float32Array<ArrayBuffer>;
  /**
   * Something broke the surface at column `x` moving at `speed` px/s (down positive): push the columns
   * within `radius` with a smooth falloff.
   */
  disturb(x: number, speed: number, radius: number): void;
  step(dt: number): void;
  /** The largest |offset|, px: how disturbed the surface still is. */
  readonly amplitude: number;
}

export function createSurface(columns: number, params: SurfaceParams = WATER_SURFACE): Surface {
  const offset = new Float32Array(columns);
  const velocity = new Float32Array(columns);
  const pull = new Float32Array(columns);

  function disturb(x: number, speed: number, radius: number): void {
    const from = Math.max(0, Math.floor(x - radius));
    const to = Math.min(columns - 1, Math.ceil(x + radius));
    for (let column = from; column <= to; column++) {
      const t = Math.abs(column - x) / Math.max(radius, 1e-6);
      if (t > 1) continue;
      const falloff = 0.5 + 0.5 * Math.cos(Math.PI * t);
      velocity[column] += speed * falloff;
    }
  }

  function step(dt: number): void {
    // substep so a ripple crosses at most half a column per substep: the explicit wave step's stability limit
    const substeps = Math.max(1, Math.ceil((params.waveSpeed * dt) / 0.5));
    const sub = dt / substeps;
    const stiffness = params.waveSpeed * params.waveSpeed;
    const keep = Math.max(0, 1 - params.damping * sub);
    for (let k = 0; k < substeps; k++) {
      for (let column = 0; column < columns; column++) {
        // the ends are reflective: a missing neighbour mirrors the column itself
        const left = column > 0 ? offset[column - 1] : offset[column];
        const right = column < columns - 1 ? offset[column + 1] : offset[column];
        const leftV = column > 0 ? velocity[column - 1] : velocity[column];
        const rightV = column < columns - 1 ? velocity[column + 1] : velocity[column];
        pull[column] =
          stiffness * (left + right - 2 * offset[column]) -
          params.tension * offset[column] +
          params.viscosity * (leftV + rightV - 2 * velocity[column]);
      }
      for (let column = 0; column < columns; column++) {
        velocity[column] = (velocity[column] + pull[column] * sub) * keep;
        const next = offset[column] + velocity[column] * sub;
        if (Math.abs(next) > params.maxOffset) {
          offset[column] = Math.sign(next) * params.maxOffset;
          velocity[column] = 0;
        } else {
          offset[column] = next;
        }
      }
    }
  }

  return {
    columns,
    offset,
    velocity,
    disturb,
    step,
    get amplitude() {
      let largest = 0;
      for (let column = 0; column < columns; column++)
        largest = Math.max(largest, Math.abs(offset[column]));
      return largest;
    },
  };
}
