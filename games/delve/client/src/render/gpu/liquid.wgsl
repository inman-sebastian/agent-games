// liquid.wgsl — the liquid picture (#96): the WGSL twin of client/src/fluid/terraria-liquid-render.ts, which stays
// the reference it's gated against. The CPU hands it the per-cell plan (`planLiquid`); every pixel is here, in
// three stages:
//
//   kinds_main    what each pixel shows: a texel of its tile's source rectangle, liquid behind a slope, then the
//                 gap and side-edge settling (renderWater + settleKind); and whether it's rock or open air
//   heat_seed     lava's distance to open air: zero on air, far elsewhere
//   heat_step     one relaxation step: the least of a pixel and its four neighbours plus one, never through rock
//   colour_main   the colour, every frame: see-through water over the scene, or lava's molten surface
//
// Needs the constants prelude, noise.wgsl and the liquid constants from liquid.ts in front of it.

// every field a scalar, 4 bytes apart, as liquid.ts writes them
struct Params {
  width: u32,      // art pixels
  height: u32,
  cols: u32,       // cells
  rows: u32,
  cell: u32,       // art px per cell
  frame: u32,      // animation frame
  lava: u32,
  origin_x: i32,   // world pixel of the top-left
  origin_y: i32,
  time: f32,
}

const CLEAR: u32 = 0u;
const BODY: u32 = 1u;
const TOP_OUTER: u32 = 2u;
const TOP_INNER: u32 = 3u;
const SIDE_OUTER: u32 = 4u;
const SIDE_INNER: u32 = 5u;
const SHIMMER: u32 = 6u;

// a pixel's kinds entry: the kind, then flags
const ROCK_BIT: u32 = 256u;
const AIR_BIT: u32 = 512u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> plan: array<i32>;
@group(0) @binding(2) var<storage, read> open_mask: array<u32>;
@group(0) @binding(3) var<storage, read_write> kinds: array<u32>;
@group(0) @binding(4) var<storage, read> dist_in: array<i32>;
@group(0) @binding(5) var<storage, read_write> dist_out: array<i32>;
@group(0) @binding(6) var<storage, read> scene: array<u32>;
@group(0) @binding(7) var<storage, read_write> colour_out: array<u32>;
@group(0) @binding(8) var<storage, read> palette: array<f32>;
@group(0) @binding(9) var<storage, read> kinds_in: array<u32>;

// ---- the texture (terraria-liquid-render.ts `texel`) ------------------------------------------------------------

fn hash_pixel(x: i32, y: i32) -> u32 {
  var h: u32 = (u32(x) * 374761393u + u32(y) * 668265263u) * 1274126177u;
  h = h ^ (h >> 13u);
  return h * 1103515245u;
}

fn edge_kind(distance: i32, top: bool) -> u32 {
  if (distance <= 0) { return select(SIDE_OUTER, TOP_OUTER, top); }
  if (distance == 1) { return select(SIDE_INNER, TOP_INNER, top); }
  return BODY;
}

fn rounded_edge(x: i32, y: i32, side_x: i32, top_y: i32, frame: i32) -> u32 {
  if (side_x + top_y < 2) { return CLEAR; }
  let distance = min(min(side_x, top_y), side_x + top_y - 2);
  let top = top_y <= side_x;
  if (distance == 2 && top && hash_pixel((x + frame) % 24, y) % 7u == 0u) { return SHIMMER; }
  return edge_kind(distance, top);
}

fn texel(x: i32, y: i32, frame: i32) -> u32 {
  let surface_row = SURFACE_FRAME_Y / UNITS_PER_PIXEL;
  if (y >= surface_row) {
    let row = y - surface_row;
    if (x < 8 || x > 15 || row > 7) { return CLEAR; }
    return edge_kind(row, true);
  }
  let local_y = y % 40;
  if (local_y < 24) {
    if (x >= 8 && x <= 15 && local_y >= 8) {
      return rounded_edge(x, local_y, min(x - 8, 15 - x), local_y - 8, frame);
    }
    var side_x = 8;
    if (x < 8) { side_x = x; } else if (x > 15) { side_x = 23 - x; }
    return rounded_edge(x, local_y, side_x, local_y, frame);
  }
  if (local_y < 32) {
    let row = local_y - 24;
    let side_x = min(x - 6, 17 - x);
    if (row < 6) {
      if (side_x < 0) { return CLEAR; }
      return edge_kind(side_x, false);
    }
    if (row == 6) {
      if (side_x < 0) { return TOP_OUTER; }
      return select(BODY, TOP_INNER, side_x < 2);
    }
    return select(BODY, TOP_INNER, side_x < 0);
  }
  return BODY;
}

// ---- kinds --------------------------------------------------------------------------------------------------

fn plan_at(cell_index: i32, field: i32) -> i32 {
  return plan[cell_index * PLAN_STRIDE + field];
}

fn has_flag(cell_index: i32, flag: i32) -> bool {
  return (plan_at(cell_index, 0) & flag) != 0;
}

// slopes.ts `insideShape`
fn inside_shape(shape: i32, x: i32, y: i32, size: i32) -> bool {
  switch (shape) {
    case -1: { return false; }
    case 1: { return y >= x; }
    case 2: { return y >= size - 1 - x; }
    case 3: { return y <= size - 1 - x; }
    case 4: { return y <= x; }
    default: { return true; }
  }
}

// renderWater: what the target holds at a pixel of cell (column, row)
fn shown_at(column: i32, row: i32, px: i32, py: i32) -> u32 {
  let cols = i32(params.cols);
  let index = row * cols + column;
  let scale = TILE / i32(params.cell);
  if (has_flag(index, PLAN_DRAWN)) {
    let unit_x = px * scale - plan_at(index, 5);
    let unit_y = py * scale - plan_at(index, 6);
    if (unit_x < 0 || unit_x >= plan_at(index, 3) || unit_y < 0 || unit_y >= plan_at(index, 4)) { return CLEAR; }
    return texel((plan_at(index, 1) + unit_x) / UNITS_PER_PIXEL, (plan_at(index, 2) + unit_y) / UNITS_PER_PIXEL, i32(params.frame));
  }
  if (has_flag(index, PLAN_BEHIND)) {
    let unit_x = px * scale - plan_at(index, 7);
    let unit_y = py * scale - plan_at(index, 8);
    if (unit_x < 0 || unit_x >= plan_at(index, 10) || unit_y < 0 || unit_y >= plan_at(index, 11)) { return CLEAR; }
    if (inside_shape(plan_at(index, 12), px, py, i32(params.cell))) { return CLEAR; }
    return edge_kind((plan_at(index, 9) + unit_y) / UNITS_PER_PIXEL, true);
  }
  return CLEAR;
}

// settleKind's open air beside a cell: not rock, nothing drawn
fn air_cell(index: i32, in_row: bool) -> bool {
  return in_row && !has_flag(index, PLAN_DRAWN) && !has_flag(index, PLAN_SOLID);
}

@compute @workgroup_size(8, 8)
fn kinds_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let pixel = y * i32(params.width) + x;
  let cell = i32(params.cell);
  let cols = i32(params.cols);
  let column = x / cell;
  let row = y / cell;
  let index = row * cols + column;
  let open = open_mask[pixel] == 1u;
  var kind = CLEAR;
  if (open) {
    kind = shown_at(column, row, x - column * cell, y - row * cell);
    let air_left = air_cell(index - 1, column > 0);
    let air_right = air_cell(index + 1, column < cols - 1);
    let drawn = has_flag(index, PLAN_DRAWN);
    if (kind == CLEAR) {
      // a gap inside the body is body; a crop toward open air stays
      let above = index - cols;
      if (drawn && above >= 0 && has_flag(above, PLAN_DRAWN) && !air_left && !air_right) { kind = BODY; }
    }
    if ((kind == BODY || kind == SHIMMER) && drawn) {
      let local_x = x - column * cell;
      if (air_left && local_x < 2) {
        kind = select(SIDE_INNER, SIDE_OUTER, local_x == 0);
      } else if (air_right && local_x >= cell - 2) {
        kind = select(SIDE_INNER, SIDE_OUTER, local_x == cell - 1);
      }
    }
  }
  let solid = !open || has_flag(index, PLAN_SOLID);
  var entry = kind;
  if (solid && kind == CLEAR) { entry |= ROCK_BIT; }
  if (!solid && kind == CLEAR) { entry |= AIR_BIT; }
  kinds[pixel] = entry;
}

// ---- heat ---------------------------------------------------------------------------------------------------

fn far() -> i32 {
  return i32(params.width + params.height);
}

@compute @workgroup_size(8, 8)
fn heat_seed(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let pixel = i32(id.y * params.width + id.x);
  dist_out[pixel] = select(far(), 0, (kinds_in[pixel] & AIR_BIT) != 0u);
}

@compute @workgroup_size(8, 8)
fn heat_step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let width = i32(params.width);
  let x = i32(id.x);
  let y = i32(id.y);
  let pixel = y * width + x;
  var best = dist_in[pixel];
  if ((kinds_in[pixel] & ROCK_BIT) == 0u) {
    if (x > 0) { best = min(best, dist_in[pixel - 1] + 1); }
    if (x < width - 1) { best = min(best, dist_in[pixel + 1] + 1); }
    if (y > 0) { best = min(best, dist_in[pixel - width] + 1); }
    if (y < i32(params.height) - 1) { best = min(best, dist_in[pixel + width] + 1); }
  }
  dist_out[pixel] = best;
}

// ---- colour -------------------------------------------------------------------------------------------------

// palette: water surface, light, mid, deep, body; then lava's six bands (rgb, 0–255)
fn swatch(n: i32) -> vec3f {
  return vec3f(palette[n * 3], palette[n * 3 + 1], palette[n * 3 + 2]);
}

fn pack(colour: vec3f) -> u32 {
  let c = vec3u(colour);
  return c.r | (c.g << 8u) | (c.b << 16u) | (255u << 24u);
}

// palette.ts `moltenSurface`
fn molten_surface(world_x: f32, world_y: f32, px: i32, py: i32, heat: f32, time: f32) -> vec3f {
  let flow = time * MOLTEN_FLOW;
  let texture = 0.08 + heat * 0.42;
  var b = 0.2 + heat * 0.74;
  b += (vnoise(world_x * 0.07 + flow * 0.6, world_y * 0.11 - flow * 0.15, TEX + 21u) - 0.5) * texture;
  b += (vnoise(world_x * 0.26 - flow, world_y * 0.26 + flow * 0.4, TEX + 22u) - 0.5) * texture * 0.4;
  let crust = vnoise(world_x * 0.13 + flow * 0.35, world_y * 0.2, TEX + 23u);
  let plate = 0.62 + (1.0 - heat) * 0.5;
  if (crust > plate + 0.04) {
    b -= 0.38 * heat;
  } else if (crust > plate) {
    b = max(b, 0.55 + heat * 0.4);
  }
  return swatch(5 + quantize_band(b, 6, px, py));
}

@compute @workgroup_size(8, 8)
fn colour_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let pixel = i32(id.y * params.width + id.x);
  let kind = kinds_in[pixel] & 255u;
  if (kind == CLEAR) {
    colour_out[pixel] = select(scene[pixel], 0u, params.lava == 1u);
    return;
  }
  if (params.lava == 1u) {
    let world_x = params.origin_x + i32(id.x);
    let world_y = params.origin_y + i32(id.y);
    let wx = f32(world_x);
    let wy = f32(world_y);
    let distance = dist_in[pixel];
    let cooling = LAVA_COOLING_DEPTH * (LAVA_COOLING_BASE + vnoise(wx * 0.05, wy * 0.03, 7u) * LAVA_COOLING_RANGE);
    let heat = max(0.0, 1.0 - f32(distance) / cooling);
    if (kind == TOP_OUTER && distance <= 2) {
      colour_out[pixel] = pack(swatch(10));
    } else {
      colour_out[pixel] = pack(molten_surface(wx, wy, world_x, world_y, heat, params.time));
    }
    return;
  }
  var colour: vec3f;
  switch (kind) {
    case TOP_OUTER: { colour = swatch(0); }
    case TOP_INNER, SIDE_OUTER, SHIMMER: { colour = swatch(1); }
    case SIDE_INNER: { colour = swatch(2); }
    default: {
      let behind = scene[pixel];
      let brightness = 0.299 * f32(behind & 255u) + 0.587 * f32((behind >> 8u) & 255u) + 0.114 * f32((behind >> 16u) & 255u);
      if (brightness < SEE_THROUGH_DEEP) {
        colour = swatch(3);
      } else if (brightness < SEE_THROUGH_BODY) {
        colour = swatch(4);
      } else {
        colour = swatch(2);
      }
    }
  }
  colour_out[pixel] = pack(colour);
}
