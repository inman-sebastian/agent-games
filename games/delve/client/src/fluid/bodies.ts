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
/** A place a stream lands that holds fewer pixels than this, and spills, is a ledge: the stream runs off it. */
export const LEDGE_CAPACITY = 24;
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
  /** Where its water is drawn: `fill`, or past the rim for a spilling body still holding more (see measure). */
  view: Int32Array;
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
  /** The body whose liquid covers a pixel, or null. */
  bodyAt(index: number): Body | null;
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
  /** Which body's water is drawn at each pixel (0 none), from each body's view. */
  const shownOwner = new Int32Array(width * height);
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
   * within PIT_DEPTH rows of the level. Returns the pit's pixels, or null for a real way down — and then sets
   * `dropAt` to the top of the column it goes down, the actual lip: `start` can be a notch beside it.
   */
  let dropAt = -1;
  function pitFrom(start: number, level: number): number[] | null {
    generation++;
    dropAt = start;
    const pit: number[] = [];
    const stack = [start];
    visited[start] = generation;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (pit.length > PIT_LIMIT) return null;
      if (y > level + PIT_DEPTH) {
        let top = y;
        while (top - 1 > level && isOpen(x, top - 1)) top--;
        dropAt = top * width + x;
        return null;
      }
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
  /**
   * The flood behind `measure`. Stopping at the spill gives the basin; not stopping — stepping over each way
   * down without descending into it, up to `limit` pixels — gives where a spilling body's water is while it
   * drains, for drawing.
   */
  function flood(
    body: Body,
    stopAtSpill: boolean,
    limit: number,
  ): { fill: number[]; level: number; spill: number } {
    basinStamp++;
    const buckets: number[][] = Array.from({ length: height }, () => []);
    const fill: number[] = [];
    let lowest = Math.max(...body.seeds.map((i) => Math.floor(i / width)));
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
    while (fill.length < limit) {
      while (lowest >= 0 && buckets[lowest].length === 0) lowest--;
      if (lowest < 0) break;
      const i = buckets[lowest].pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (y > level) {
        claimed[i] = 0; // let the pit search see it
        const pit = pitFrom(i, level);
        if (!pit) {
          if (spill < 0) spill = dropAt;
          claimed[i] = basinStamp;
          if (stopAtSpill) break;
          continue; // step over the way down
        }
        // claim the whole pit before pushing its neighbours, or a pit pixel is queued as a neighbour and filled twice
        for (const p of pit) claimed[p] = basinStamp;
        for (const p of pit) {
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
    return { fill, level, spill };
  }

  /**
   * Fill a basin from its seeds, lowest pixel first. The level is the highest row filled so far. A reachable
   * pixel BELOW that level is either a shallow pit in the floor, which becomes part of the basin, or the way
   * down: where the basin spills, and filling stops.
   */
  function measure(body: Body): void {
    const basinFlood = flood(body, true, Infinity);
    // A basin that spills can't hold liquid at its rim's own row: water standing that high is already over
    // the rim.
    let kept = basinFlood.fill;
    if (basinFlood.spill >= 0)
      kept = kept.filter((i) => Math.floor(i / width) !== basinFlood.level);
    // lowest rows first, so any volume fills the basin flat — pits included
    const lowestFirst = (a: number, b: number): number =>
      Math.floor(b / width) - Math.floor(a / width) || a - b;
    kept.sort(lowestFirst);
    body.fill = Int32Array.from(kept);
    body.spill = basinFlood.spill;
    // where its water shows: the basin, or, for a body holding more than its basin while it drains, the space
    // above the rim too — so a pool that's pouring away visibly drains instead of vanishing. That space is
    // stacked row by row on the basin's own water, never beside it: water shown past the rim, over the drop,
    // would stand in the air.
    if (body.spill >= 0 && body.volume > body.fill.length) {
      basinStamp++;
      const view = Array.from(kept);
      for (const i of view) claimed[i] = basinStamp;
      // standing on rock or on water already shown
      const supported = (i: number): boolean =>
        i >= 0 &&
        rock[i] === 1 &&
        claimed[i] !== basinStamp &&
        (i + width >= width * height || rock[i + width] !== 1 || claimed[i + width] === basinStamp);
      let row = basinFlood.fill.filter((i) => Math.floor(i / width) === basinFlood.level);
      while (view.length < body.volume && row.length > 0) {
        // the row spreads sideways over whatever holds it up, and stops at the edge of the drop
        const shown: number[] = [];
        const stack = row.filter(supported);
        for (const i of stack) claimed[i] = basinStamp;
        while (stack.length > 0) {
          const i = stack.pop()!;
          shown.push(i);
          const x = i % width;
          for (const side of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1]) {
            if (!supported(side)) continue;
            claimed[side] = basinStamp;
            stack.push(side);
          }
        }
        shown.sort((a, b) => a - b);
        view.push(...shown);
        row = shown.map((i) => i - width);
      }
      body.view = Int32Array.from(view);
    } else {
      body.view = body.fill;
    }
  }

  function rebuildOwners(): void {
    owner.fill(0);
    basin.fill(0);
    shownOwner.fill(0);
    for (const body of bodies) {
      const shown = Math.min(body.volume, body.view.length);
      for (let k = 0; k < shown; k++) shownOwner[body.view[k]] = body.id;
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
   * A body spilling into another is one body with it once they're connected: when the other is full too (both
   * stand above a shared rim, and on a bumpy floor two dips spilled their excess back and forth forever), or
   * when the other's liquid has risen to the spill point (a pool draining down a shaft into water that has
   * filled back up to it — kept apart, the two showed stacked surfaces while one drained into the other).
   * Merged, it fills from both bodies' seeds.
   */
  function mergeOverRims(): boolean {
    rebuildOwners();
    for (const body of bodies) {
      if (body.spill < 0 || body.volume <= body.fill.length) continue;
      const spillRow = Math.floor(body.spill / width);
      const land = landing(body.spill % width, spillRow);
      const other = bodyInBasin(land, body.kind);
      if (!other || other === body) continue;
      const full = other.volume >= other.fill.length;
      const risenToSpill = owner[body.spill] === other.id || levelOf(other) <= spillRow;
      if (!full && !risenToSpill) continue;
      merge(body.id < other.id ? body : other, body.id < other.id ? other : body);
      return true;
    }
    return false;
  }

  function levelOf(body: Body): number {
    const filled = Math.min(body.volume, body.fill.length);
    return filled > 0
      ? Math.floor(body.fill[filled - 1] / width)
      : Math.max(...body.seeds.map((i) => Math.floor(i / width)));
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
        view: new Int32Array(0),
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

  /**
   * A stream from `spill` falls straight down. Where it lands on a ledge too small to hold a pool (the eroded
   * rock's bumps along a wall face), it runs off that ledge's own spill point and keeps falling, instead of
   * starting a pool there that overflows into the next ledge down: a cascade of tiny pools. Each fall is a
   * stream segment to draw. Returns where the water finally lands.
   */
  function fall(body: Body, spill: number): number {
    let from = spill;
    let land = from;
    for (let hop = 0; hop < 16; hop++) {
      const x = from % width;
      const top = (from - x) / width;
      land = landing(x, top);
      streams.push({ from: body.id, x, top, bottom: (land - x) / width, kind: body.kind });
      // into water: done. A dry notch that happens to lie in some basin (below where that pool could rise) is
      // still only a ledge until the pool reaches it.
      if (bodyInBasin(land, body.kind) && owner[land] !== 0) break;
      const probe: Body = {
        id: -1,
        kind: body.kind,
        volume: 0,
        seeds: [land],
        fill: new Int32Array(0),
        view: new Int32Array(0),
        spill: -1,
        owed: 0,
      };
      measure(probe);
      if (probe.spill < 0 || probe.fill.length >= LEDGE_CAPACITY) break;
      // a basin whose overflow runs back into the source isn't a ledge: it fills
      const onward = landing(probe.spill % width, Math.floor(probe.spill / width));
      if (bodyInBasin(onward, body.kind) === body) break;
      from = probe.spill;
    }
    return land;
  }

  function step(dt: number): void {
    streams.length = 0;
    for (const body of [...bodies]) {
      if (!bodies.includes(body) || body.spill < 0 || body.volume <= body.fill.length) continue;
      // the excess leaves through the spill point at the stream's rate
      body.owed += params.streamRate * dt;
      const amount = Math.min(body.volume - body.fill.length, Math.floor(body.owed));
      body.owed -= amount;
      const land = fall(body, body.spill);
      if (amount <= 0) continue;
      body.volume -= amount;
      const target = bodyInBasin(land, body.kind);
      if (target && target !== body) {
        target.volume += amount;
        // a spilling body drawn from its view needs the view to reach its new volume
        if (target.spill >= 0 && target.volume > target.view.length) measure(target);
      } else {
        const fresh: Body = {
          id: nextId++,
          kind: body.kind,
          volume: amount,
          seeds: [land],
          fill: new Int32Array(0),
          view: new Int32Array(0),
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
  }

  return {
    width,
    height,
    bodies,
    streams,
    add,
    setOpen,
    step,
    bodyAt: (index) => {
      const id = shownOwner[index];
      return id === 0 ? null : (bodies.find((body) => body.id === id) ?? null);
    },
    levelOf,
    total: (kind) => bodies.reduce((sum, body) => sum + (body.kind === kind ? body.volume : 0), 0),
  };
}
