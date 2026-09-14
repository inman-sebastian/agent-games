// light.wgsl — lighting.ts's per-cell light field, propagated on the GPU (#82). Three compute passes over
// the light grid (the view's cells plus lighting.ts's LMARGIN):
//
//   light_seed    zero the grid and add each emitter's seed at its cell (the plan, from lighting.ts)
//   light_step    one Jacobi relaxation: every cell in the sweep box takes the max of itself and each of
//                 its 8 neighbours times the DESTINATION cell's attenuation (and DIAGONAL_ATTEN on a
//                 diagonal). renderer.ts runs `reach` of them, rounded up to even, ping-ponging A ↔ B.
//   light_finish  the glow bytes and scalar brightness present.wgsl reads, with lighting.ts's caps
//
// Why Jacobi rather than lighting.ts's four corner sweeps: a sweep is sequential by construction (each
// cell reads neighbours the same sweep just updated), and a relaxation step is not. After `reach` steps
// every path that could still carry more than PROPAGATION_EPS has been walked. The best path to a cell
// runs diagonal-first — a diagonal step costs ×0.95 where a detour costs a whole extra step at ×0.84 —
// so it's as long as the Chebyshev distance, and the two methods agree to rounding. See RENDERING.md.
//
// Needs the constants prelude in front of it.

struct LightGrid {
  grid: vec2u,          // grid size in cells
  tile: vec2i,          // world cell of the grid's top-left
  window_cell: vec2i,   // world cell of the world window's top-left
  window_cells: vec2u,
  box_min: vec2i,       // the sweep box, inclusive; empty when box_max < box_min
  box_max: vec2i,
  seed_count: u32,
  hue_cap: u32,         // lighting.ts's hueCap: 1 scales RGB together, 0 clamps per channel
}

struct LightCell {
  lamp: vec3f,
  ore: vec3f,
}

@group(0) @binding(0) var<uniform> light: LightGrid;
@group(0) @binding(1) var<storage, read> cells: array<u32>;             // the world window, bit 0 solid
@group(0) @binding(2) var<storage, read> seeds: array<f32>;             // SEED_FLOATS per seed
@group(0) @binding(3) var<storage, read> state_in: array<LightCell>;
@group(0) @binding(4) var<storage, read_write> state_out: array<LightCell>;
@group(0) @binding(5) var<storage, read_write> glow: array<u32>;        // RGBA bytes, little-endian
@group(0) @binding(6) var<storage, read_write> bright: array<f32>;

fn in_grid(id: vec3u) -> bool {
  return id.x < light.grid.x && id.y < light.grid.y;
}

fn in_box(x: i32, y: i32) -> bool {
  return x >= light.box_min.x && x <= light.box_max.x && y >= light.box_min.y && y <= light.box_max.y;
}

// lighting.ts's attenAt: rock absorbs, open space conducts. The window always covers the light grid;
// solid is the safe answer if it somehow doesn't.
fn atten_at(x: i32, y: i32) -> f32 {
  let local = vec2i(x, y) + light.tile - light.window_cell;
  if (local.x < 0 || local.y < 0 || u32(local.x) >= light.window_cells.x || u32(local.y) >= light.window_cells.y) {
    return ROCK_ATTEN;
  }
  let solid = (cells[u32(local.y) * light.window_cells.x + u32(local.x)] & 1u) == 1u;
  return select(OPEN_ATTEN, ROCK_ATTEN, solid);
}

@compute @workgroup_size(8, 8)
fn light_seed(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) { return; }
  var cell = LightCell(vec3f(0.0), vec3f(0.0));
  for (var n = 0u; n < light.seed_count; n++) {
    let base = n * SEED_FLOATS;
    if (u32(seeds[base]) == id.x && u32(seeds[base + 1u]) == id.y) {
      cell.lamp += vec3f(seeds[base + 2u], seeds[base + 3u], seeds[base + 4u]);
      cell.ore += vec3f(seeds[base + 5u], seeds[base + 6u], seeds[base + 7u]);
    }
  }
  state_out[id.y * light.grid.x + id.x] = cell;
}

@compute @workgroup_size(8, 8)
fn light_step(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let index = id.y * light.grid.x + id.x;
  var cell = state_in[index];
  if (in_box(x, y)) {
    let straight = atten_at(x, y);
    let diagonal = straight * DIAGONAL_ATTEN;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if ((dx == 0 && dy == 0) || !in_box(x + dx, y + dy)) { continue; }
        let weight = select(straight, diagonal, dx != 0 && dy != 0);
        let neighbour = state_in[u32(y + dy) * light.grid.x + u32(x + dx)];
        cell.lamp = max(cell.lamp, neighbour.lamp * weight);
        cell.ore = max(cell.ore, neighbour.ore * weight);
      }
    }
  }
  state_out[index] = cell;
}

// A value stored into a Uint8ClampedArray: clamped, rounded half to even (as WGSL's round() rounds).
fn clamped_u8(value: f32) -> u32 {
  return u32(round(clamp(value, 0.0, 255.0)));
}

@compute @workgroup_size(8, 8)
fn light_finish(@builtin(global_invocation_id) id: vec3u) {
  if (!in_grid(id)) { return; }
  let index = id.y * light.grid.x + id.x;
  let cell = state_in[index];
  let lamp = cell.lamp; // + AMBIENT, which is black
  let ore = min(cell.ore, vec3f(GLOW_CAP));
  var sum = lamp * ADD + ore;
  if (light.hue_cap == 1u) {
    let peak = max(sum.r, max(sum.g, sum.b));
    if (peak > ADD_MAX) { sum *= ADD_MAX / peak; }
  } else {
    sum = min(sum, vec3f(ADD_MAX));
  }
  glow[index] = clamped_u8(sum.r * 255.0) | (clamped_u8(sum.g * 255.0) << 8u) |
    (clamped_u8(sum.b * 255.0) << 16u) | (255u << 24u);
  bright[index] = min(1.0, max(max(lamp.r, max(lamp.g, lamp.b)), max(ore.r, max(ore.g, ore.b))));
}
