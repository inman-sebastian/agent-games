// world-window.ts — the GPU renderer's CPU mirror of the world around the view (#71).
//
// The spike rebuilt the world upload from world queries every frame — about 25,000 `solidAt` calls, and
// 3.7 of its 3.8 ms on the main thread. The upload itself was never the cost: a window's worth of cells
// is tens of kilobytes. So this keeps a mirror that only ever asks the world about cells it doesn't
// already know: the strips that scroll into it, and the cells a dig changes. The renderer uploads the
// whole mirror whenever `version` moves.
//
// Pure and DOM-free, so it's tested without a GPU.

/**
 * What the window mirrors: the world's current solidity (static rock minus digs), each cell's material id
 * (static — an ore id with a registered material, else 0 for the strata stone), and surface heights.
 */
export interface WorldSource {
  solid(column: number, row: number): boolean;
  material(column: number, row: number): number;
  /** A cell's static shape: 0 full, or a slope 1–4 (#94). Open cells may answer anything; it isn't read. */
  shape(column: number, row: number): number;
  /** The lowest row that shows sky in a column. */
  surface(column: number): number;
}

/** A packed window cell: bit 0 is solidity, bits 1–3 the shape, bits 8–15 the material id. */
export const SOLID_BIT = 1;
export const SHAPE_SHIFT = 1;
export const SHAPE_MASK = 7;
export const MATERIAL_SHIFT = 8;

export interface WorldWindow {
  /** World cell of the window's top-left, and its size in cells. */
  readonly left: number;
  readonly top: number;
  readonly cols: number;
  readonly rows: number;
  /** Row-major packed cells: `SOLID_BIT` where solid, the material id at `MATERIAL_SHIFT`. */
  readonly cells: Uint32Array<ArrayBuffer>;
  /** Each window column's surface row. Static, but it scrolls with the window. */
  readonly surface: Float32Array<ArrayBuffer>;
  /** Moves whenever the mirror's contents change — the renderer's cue to upload. */
  readonly version: number;
  /** Keep the view, and the context the shaders read around it, inside the window. */
  follow(viewLeft: number, viewTop: number, viewCols: number, viewRows: number): void;
  /** A cell changed in the world (a dig, the player's or the server's). */
  dig(column: number, row: number): void;
  /** The world was replaced (a new game, a hello from the server): forget everything. */
  reset(): void;
}

/** Cells of slack on every side, so the view can scroll this far before the window has to move. */
export const WINDOW_MARGIN = 16;

/**
 * Rows above the view the shaders read: the top light looks up to TOP_LIGHT_ROWS (12) cells for an
 * opening, and the erosion mask reads one ring of neighbours.
 */
export const TOP_CONTEXT_ROWS = 13;

export function createWorldWindow(source: WorldSource): WorldWindow {
  let left = 0;
  let top = 0;
  let cols = 0;
  let rows = 0;
  let cells = new Uint32Array(0);
  let surface = new Float32Array(0);
  let version = 0;
  let built = false;

  const query = (column: number, row: number): number =>
    (source.solid(column, row) ? SOLID_BIT : 0) |
    ((Math.max(0, source.shape(column, row)) & SHAPE_MASK) << SHAPE_SHIFT) |
    (source.material(column, row) << MATERIAL_SHIFT);

  /** Place the window around the view, reusing every cell the old window already knew. */
  function place(nextLeft: number, nextTop: number, nextCols: number, nextRows: number): void {
    const nextCells = new Uint32Array(nextCols * nextRows);
    const nextSurface = new Float32Array(nextCols);
    // cells are matched by world position, so a window of a different size reuses whatever overlaps
    const reuse = built;
    for (let row = 0; row < nextRows; row++) {
      const worldRow = nextTop + row;
      const oldRow = worldRow - top;
      for (let column = 0; column < nextCols; column++) {
        const worldColumn = nextLeft + column;
        const oldColumn = worldColumn - left;
        const known = reuse && oldRow >= 0 && oldRow < rows && oldColumn >= 0 && oldColumn < cols;
        nextCells[row * nextCols + column] = known
          ? cells[oldRow * cols + oldColumn]
          : query(worldColumn, worldRow);
      }
    }
    for (let column = 0; column < nextCols; column++) {
      const oldColumn = nextLeft + column - left;
      const known = reuse && oldColumn >= 0 && oldColumn < cols;
      nextSurface[column] = known ? surface[oldColumn] : source.surface(nextLeft + column);
    }
    left = nextLeft;
    top = nextTop;
    cols = nextCols;
    rows = nextRows;
    cells = nextCells;
    surface = nextSurface;
    built = true;
    version++;
  }

  function follow(viewLeft: number, viewTop: number, viewCols: number, viewRows: number): void {
    const wantCols = viewCols + 2 * WINDOW_MARGIN;
    const wantRows = viewRows + TOP_CONTEXT_ROWS + 2 * WINDOW_MARGIN;
    const covered =
      built &&
      cols === wantCols &&
      rows === wantRows &&
      viewLeft - 1 >= left &&
      viewLeft + viewCols + 1 <= left + cols &&
      viewTop - TOP_CONTEXT_ROWS >= top &&
      viewTop + viewRows + 1 <= top + rows;
    if (covered) return;
    place(viewLeft - WINDOW_MARGIN, viewTop - TOP_CONTEXT_ROWS - WINDOW_MARGIN, wantCols, wantRows);
  }

  function dig(column: number, row: number): void {
    const localColumn = column - left;
    const localRow = row - top;
    if (!built || localColumn < 0 || localColumn >= cols || localRow < 0 || localRow >= rows)
      return;
    // A dig changes solidity only; a cell's shape and material are static, so they aren't asked again.
    const index = localRow * cols + localColumn;
    const material = cells[index] & ~SOLID_BIT;
    cells[index] = material | (source.solid(column, row) ? SOLID_BIT : 0);
    version++;
  }

  function reset(): void {
    built = false;
  }

  return {
    get left() {
      return left;
    },
    get top() {
      return top;
    },
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    get cells() {
      return cells;
    },
    get surface() {
      return surface;
    },
    get version() {
      return version;
    },
    follow,
    dig,
    reset,
  };
}
