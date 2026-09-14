// bodies.ts — surface water's bodies and how digging moves them (#89, step 2). A body is a VOLUME (a whole
// number of pixels) and the cave shape around it; its level is where that volume reaches when the shape fills
// from its lowest point up, so it's always flat. Past its rim, or through a hole dug under it, the excess
// leaves as a stream at a set rate and lands in whatever is below. See docs/FLUIDS.md, "Flow".
//
// Pure and deterministic: no DOM, no randomness, integer volumes.

export const WATER = 1;
export const LAVA = 2;

export interface FlowParams {
  /** Pixels of volume per second a stream carries. */
  streamRate: number;
}

export const WATER_FLOW: FlowParams = { streamRate: 900 };

/**
 * How deep below a basin's level a floor pit can be and still count as part of the basin, art px, and how big.
 * Deeper, or bigger, and it's a way down: the basin spills into it as a stream. The eroded rock leaves pits
 * of a pixel or two all along a floor, and treating each as a spill kept a pool trickling into itself.
 */
export const PIT_DEPTH = 3;
const PIT_LIMIT = 256;

export interface Body {
  readonly id: number;
  readonly kind: number;
  /** Pixels of liquid. Integer. */
  volume: number;
  /**
   * The pixels the basin fills from: where liquid came to rest. A body joined from two basins over a rim keeps
   * both, so it fills from both at once instead of seeing the other basin as a way down.
   */
  seeds: number[];
  /** Pixel indices in the order the basin fills, up to its rim (or the first way down). */
  fill: Int32Array;
  /** Where the basin overflows: the first open pixel below its level, or -1 if it can hold anything. */
  spill: number;
  /** Fractional volume owed to the current stream. */
  owed: number;
}

export interface Stream {
  readonly from: number;
  /** Art-pixel column, and the rows it falls between. */
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
  readonly kind: number;
}

export interface WaterSim {
  readonly width: number;
  readonly height: number;
  readonly bodies: Body[];
  /** The streams running this step, for drawing. */
  readonly streams: Stream[];
  /** Pour `volume` pixels of liquid in at (x, y): it joins the body there, or starts one where it lands. */
  add(kind: number, x: number, y: number, volume: number): void;
  /** The rock changed (a dig, a build): every basin is re-measured. */
  setOpen(open: Uint8Array): void;
  step(dt: number): void;
  /**
   * The body whose liquid is SHOWN at a pixel, or null. What's shown follows the true state at the stream rate,
   * so a dig that joins a pool to an empty basin drains one side and fills the other visibly, instead of
   * teleporting the water into its new level.
   */
  bodyAt(index: number): Body | null;
  /** Show the true state at once (a scene being set up). */
  snap(): void;
  /** A body's level: the row of its highest filled pixel. */
  levelOf(body: Body): number;
  /** Total liquid of a kind, for conservation checks. */
  total(kind: number): number;
}

export function createWaterSim(
  width: number,
  height: number,
  open: Uint8Array,
  params: FlowParams = WATER_FLOW,
): WaterSim {
  let rock = open;
  const bodies: Body[] = [];
  const streams: Stream[] = [];
  let nextId = 1;
  /** Which body covers each pixel (0 none), rebuilt whenever volumes change. */
  const owner = new Int32Array(width * height);
  /** Which body's liquid is shown at each pixel (0 none): it follows `owner` at the stream rate. */
  const shown = new Int32Array(width * height);
  /** Which body's basin each pixel is in, filled or not (0 none): where landing liquid joins. */
  const basin = new Int32Array(width * height);
  const visited = new Int32Array(width * height);
  let generation = 0;
  /** Pixels the basin being measured has taken. */
  const claimed = new Int32Array(width * height);
  let basinStamp = 0;

  const isOpen = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && rock[y * width + x] === 1;

  /** Where something dropped at (x, y) comes to rest: straight down to the last open pixel. */
  function landing(x: number, y: number): number {
    let row = y;
    while (isOpen(x, row + 1)) row++;
    return row * width + x;
  }

  /**
   * Is the open pixel at `start`, just below the basin's `level`, only a shallow enclosed pit (the eroded floor
   * under a pool), or the way down to somewhere deeper? A pit is every below-level pixel connected to it lying
   * within PIT_DEPTH rows of the level. Returns the pit's pixels, or null for a real way down.
   */
  function pitFrom(start: number, level: number): number[] | null {
    generation++;
    const pit: number[] = [];
    const stack = [start];
    visited[start] = generation;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (y > level + PIT_DEPTH || pit.length > PIT_LIMIT) return null;
      pit.push(i);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y + 1],
      ]) {
        if (!isOpen(nx, ny) || ny <= level) continue;
        const n = ny * width + nx;
        if (visited[n] === generation || claimed[n] === basinStamp) continue;
        visited[n] = generation;
        stack.push(n);
      }
    }
    return pit;
  }

  /**
   * Fill a basin from its seeds, lowest pixel first. The level is the highest row filled so far. A reachable
   * pixel BELOW that level is either a shallow pit in the floor, which becomes part of the basin, or the way
   * down: where the basin spills, and filling stops. A bucket queue per row keeps it linear.
   */
  function measure(body: Body): void {
    basinStamp++;
    const buckets: number[][] = Array.from({ length: height }, () => []);
    const fill: number[] = [];
    const seedRows = body.seeds.map((i) => Math.floor(i / width));
    let lowest = Math.max(...seedRows);
    let level = lowest;
    let spill = -1;
    const push = (x: number, y: number): void => {
      if (!isOpen(x, y)) return;
      const i = y * width + x;
      if (claimed[i] === basinStamp) return;
      claimed[i] = basinStamp;
      buckets[y].push(i);
      lowest = Math.max(lowest, y);
    };
    for (const seed of body.seeds) push(seed % width, Math.floor(seed / width));
    while (spill < 0) {
      while (lowest >= 0 && buckets[lowest].length === 0) lowest--;
      if (lowest < 0) break;
      const i = buckets[lowest].pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (y > level) {
        claimed[i] = 0; // let the pit search see it
        const pit = pitFrom(i, level);
        if (!pit) {
          spill = i;
          break;
        }
        for (const p of pit) {
          claimed[p] = basinStamp;
          fill.push(p);
          const px = p % width;
          const py = (p - px) / width;
          // the pit's rim neighbours at or above the level carry on filling
          if (py - 1 <= level) push(px, py - 1);
          push(px - 1, py);
          push(px + 1, py);
        }
        continue;
      }
      level = y;
      fill.push(i);
      push(x - 1, y);
      push(x + 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    // A basin that spills can't hold liquid at its rim's own row: water standing that high is already over
    // the rim.
    let kept = fill;
    if (spill >= 0) kept = fill.filter((i) => Math.floor(i / width) !== level);
    // lowest rows first, so any volume fills the basin flat — pits included
    kept.sort((a, b) => Math.floor(b / width) - Math.floor(a / width) || a - b);
    body.fill = Int32Array.from(kept);
    body.spill = spill;
  }

  function rebuildOwners(): void {
    owner.fill(0);
    basin.fill(0);
    for (const body of bodies) {
      const filled = Math.min(body.volume, body.fill.length);
      for (let k = 0; k < body.fill.length; k++) {
        basin[body.fill[k]] = body.id;
        if (k < filled) owner[body.fill[k]] = body.id;
      }
    }
  }

  /** Merge `gone` into `keep`: one volume, and both bodies' seeds to fill from. */
  function merge(keep: Body, gone: Body): void {
    keep.volume += gone.volume;
    for (let i = 0; i < shown.length; i++) if (shown[i] === gone.id) shown[i] = keep.id;
    keep.seeds = [...new Set([...keep.seeds, ...gone.seeds])];
    bodies.splice(bodies.indexOf(gone), 1);
    measure(keep);
  }

  /** Bodies whose liquid touches merge. */
  function mergeTouching(): boolean {
    rebuildOwners();
    for (const body of bodies) {
      const filled = Math.min(body.volume, body.fill.length);
      for (let k = 0; k < filled; k++) {
        const i = body.fill[k];
        const x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
          if (n < 0 || n >= width * height) continue;
          const other = owner[n];
          if (other === 0 || other === body.id) continue;
          const them = bodies.find((b) => b.id === other)!;
          if (them.kind !== body.kind) continue;
          merge(body.id < them.id ? body : them, body.id < them.id ? them : body);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Two FULL bodies where one spills into the other stand above a shared rim: they're one body. (Each basin
   * stops below its rim row, so their liquid never touches, and on a bumpy floor two dips spilled their
   * excess back and forth forever.) Merged, it fills from both basins' seeds and rises over the rim.
   */
  function mergeOverRims(): boolean {
    rebuildOwners();
    for (const body of bodies) {
      if (body.spill < 0 || body.volume <= body.fill.length) continue;
      const land = landing(body.spill % width, Math.floor(body.spill / width));
      const other = bodyInBasin(land, body.kind);
      if (!other || other === body || other.volume < other.fill.length) continue;
      merge(body.id < other.id ? body : other, body.id < other.id ? other : body);
      return true;
    }
    return false;
  }

  function settle(): void {
    for (let guard = 0; guard < 256 && (mergeTouching() || mergeOverRims()); guard++);
    rebuildOwners();
  }

  function bodyInBasin(index: number, kind: number): Body | null {
    const id = basin[index];
    const body = id === 0 ? undefined : bodies.find((b) => b.id === id);
    return body && body.kind === kind ? body : null;
  }

  function add(kind: number, x: number, y: number, volume: number): void {
    if (volume <= 0 || !isOpen(Math.floor(x), Math.floor(y))) return;
    const at = landing(Math.floor(x), Math.floor(y));
    const existing = bodyInBasin(at, kind);
    if (existing) {
      existing.volume += volume;
    } else {
      const body: Body = {
        id: nextId++,
        kind,
        volume,
        seeds: [at],
        fill: new Int32Array(0),
        spill: -1,
        owed: 0,
      };
      measure(body);
      bodies.push(body);
    }
    settle();
  }

  function setOpen(next: Uint8Array): void {
    rock = next;
    for (const body of bodies) {
      // a seed may have been built over; keep the open ones, or start again from any open liquid pixel
      body.seeds = body.seeds.filter((i) => rock[i] === 1);
      if (body.seeds.length === 0) {
        const anyOpen = body.fill.find((i) => rock[i] === 1);
        if (anyOpen === undefined) continue;
        body.seeds = [anyOpen];
      }
      measure(body);
    }
    settle();
  }

  function step(dt: number): void {
    streams.length = 0;
    for (const body of [...bodies]) {
      if (!bodies.includes(body) || body.spill < 0 || body.volume <= body.fill.length) continue;
      // the excess leaves through the spill point at the stream's rate
      body.owed += params.streamRate * dt;
      const amount = Math.min(body.volume - body.fill.length, Math.floor(body.owed));
      body.owed -= amount;
      const sx = body.spill % width;
      const sy = (body.spill - sx) / width;
      const land = landing(sx, sy);
      streams.push({ from: body.id, x: sx, top: sy, bottom: (land - sx) / width, kind: body.kind });
      if (amount <= 0) continue;
      body.volume -= amount;
      const target = bodyInBasin(land, body.kind);
      if (target && target !== body) {
        target.volume += amount;
      } else {
        const fresh: Body = {
          id: nextId++,
          kind: body.kind,
          volume: amount,
          seeds: [land],
          fill: new Int32Array(0),
          spill: -1,
          owed: 0,
        };
        measure(fresh);
        bodies.push(fresh);
      }
    }
    // a body that emptied is gone
    for (let k = bodies.length - 1; k >= 0; k--) if (bodies[k].volume <= 0) bodies.splice(k, 1);
    settle();
    follow(dt);
  }

  /**
   * Move what's shown toward the true state: for each body, clear up to the stream rate's worth of shown pixels
   * it no longer holds (highest first: a level falls) and fill as many it now holds (lowest first: a basin fills
   * from the bottom).
   */
  function follow(dt: number): void {
    const allowance = Math.max(1, Math.ceil(params.streamRate * dt));
    const toClear = new Map<number, number[]>();
    const toFill = new Map<number, number[]>();
    for (let i = 0; i < shown.length; i++) {
      const was = shown[i];
      const now = owner[i];
      if (was === now) continue;
      if (was !== 0) (toClear.get(was) ?? toClear.set(was, []).get(was)!).push(i);
      if (now !== 0) (toFill.get(now) ?? toFill.set(now, []).get(now)!).push(i);
    }
    // row-major order: the front of a list is its highest pixels, the back its lowest
    for (const list of toClear.values()) {
      for (let k = 0; k < Math.min(allowance, list.length); k++) shown[list[k]] = 0;
    }
    for (const [id, list] of toFill) {
      let filled = 0;
      for (let k = list.length - 1; k >= 0 && filled < allowance; k--) {
        if (shown[list[k]] !== 0) continue;
        shown[list[k]] = id;
        filled++;
      }
    }
  }

  return {
    width,
    height,
    bodies,
    streams,
    add,
    setOpen,
    step,
    snap: () => shown.set(owner),
    bodyAt: (index) => {
      const id = shown[index];
      return id === 0 ? null : (bodies.find((body) => body.id === id) ?? null);
    },
    levelOf: (body) => {
      const filled = Math.min(body.volume, body.fill.length);
      return filled > 0
        ? Math.floor(body.fill[filled - 1] / width)
        : Math.max(...body.seeds.map((i) => Math.floor(i / width)));
    },
    total: (kind) => bodies.reduce((sum, body) => sum + (body.kind === kind ? body.volume : 0), 0),
  };
}
