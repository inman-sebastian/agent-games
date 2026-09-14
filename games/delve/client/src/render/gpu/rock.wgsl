// rock.wgsl — the rock compositor from client/src/render/cave-render.ts (`composeBand`), as compute
// passes over one band of the world at art resolution:
//
//   mask_main   the per-pixel solidity mask with eroded edges and rounded corners   (buildMask)
//   jfa_init    seed every open pixel for the edge distance field
//   jfa_step    one jump-flooding pass — the GPU stand-in for the two-pass chamfer sweep (distField)
//   shade_main  background, sky, top-lit stone, contact shadow and stalactites       (shadeRock + composeBand)
//
// The world comes from the persistent world window (gpu/world-window.ts): cell solidity and surface
// heights around the view, uploaded only when they change. The top-light seed above the band and the sky
// both come from that window here, rather than from per-column CPU queries.
//
// Needs, in front of it: the generated constants prelude (gpu/constants.ts), noise.wgsl, surfaces.wgsl,
// and the generated materials (gpu/materials.ts) — every material's shader and the dispatch to them.

struct Band {
  size: vec2u,          // art pixels
  origin: vec2i,        // world pixel of the band's top-left
  cell: vec2i,          // world cell of the band's top-left
  cells: vec2u,         // band size in cells
  tex_seed: u32,
  deepest_sky: f32,     // the lowest sky pixel, relative to the band's top
  window_cell: vec2i,   // world cell of the world window's top-left
  window_cells: vec2u,  // world window size in cells
  bg_fill: vec4f,       // colours are 0..255
  bg_silhouette: vec4f,
  sky_top: vec4f,
  sky_horizon: vec4f,
  bands: array<vec4f, 6>, // center, deep, body, body2, lit, rimA — palette.ts's stone bands, dark → light
  rim_b: vec4f,
  rim_rock: vec4f,
}

struct JfaStep {
  step: i32,
}

@group(0) @binding(0) var<uniform> band: Band;
@group(0) @binding(1) var<storage, read> cells: array<u32>;        // the world window, row-major, 1 = solid
@group(0) @binding(2) var<storage, read_write> mask: array<u32>;   // per pixel, 1 = solid
@group(0) @binding(3) var<storage, read> seeds_in: array<vec2i>;
@group(0) @binding(4) var<storage, read_write> seeds_out: array<vec2i>;
@group(0) @binding(5) var<storage, read> surface: array<f32>;      // the world window's surface row per column
@group(0) @binding(7) var scene: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(8) var<uniform> jfa: JfaStep;

const NO_SEED = vec2i(-1, -1);
const FAR: f32 = 1e6;

// A band-relative cell's solidity, read from the world window. The window always covers the band plus
// the context the shaders read (world-window.ts guarantees it); anything past it reads as rock.
fn solid_cell(column: i32, row: i32) -> bool {
  let local = band.cell + vec2i(column, row) - band.window_cell;
  if (local.x < 0 || local.y < 0 || local.x >= i32(band.window_cells.x) || local.y >= i32(band.window_cells.y)) {
    return true;
  }
  return (cells[u32(local.y) * band.window_cells.x + u32(local.x)] & 1u) != 0u;
}

// The sky's bottom edge in a band column, as a band-relative pixel row.
fn sky_bottom(column: i32) -> f32 {
  let local = band.cell.x + column - band.window_cell.x;
  let row = surface[u32(clamp(local, 0, i32(band.window_cells.x) - 1))];
  return (row + 1.0) * f32(T) - f32(band.origin.y);
}

// shadeRock's top-light seed for a column: how deep the solid rock above the band runs, up to
// TOP_LIGHT_ROWS; all the way means no top light reaches in at all.
fn column_seed(column: i32) -> f32 {
  var solid_above = 0;
  for (var k = 1; k <= TOP_LIGHT_ROWS; k++) {
    if (!solid_cell(column, -k)) { break; }
    solid_above++;
  }
  return select(f32(solid_above * T), FAR, solid_above >= TOP_LIGHT_ROWS);
}

fn pixel_index(px: i32, py: i32) -> i32 {
  return py * i32(band.size.x) + px;
}

fn in_band(px: i32, py: i32) -> bool {
  return px >= 0 && py >= 0 && px < i32(band.size.x) && py < i32(band.size.y);
}

// The distance the chamfer transform measures: orthogonal steps cost 1, diagonal steps 1.414.
fn chamfer(offset: vec2i) -> f32 {
  let a = abs(offset);
  let long_side = f32(max(a.x, a.y));
  let short_side = f32(min(a.x, a.y));
  return (long_side - short_side) + DIAGONAL * short_side;
}

// ---- mask -----------------------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn mask_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= band.size.x || id.y >= band.size.y) { return; }
  let px = i32(id.x);
  let py = i32(id.y);
  let column = px / T;
  let row = py / T;
  let index = pixel_index(px, py);
  if (!solid_cell(column, row)) {
    mask[index] = 0u;
    return;
  }
  let local_x = f32(px % T);
  let local_y = f32(py % T);
  let size = f32(T);
  let open_up = !solid_cell(column, row - 1);
  let open_down = !solid_cell(column, row + 1);
  let open_left = !solid_cell(column - 1, row);
  let open_right = !solid_cell(column + 1, row);

  var edge_dist = 99.0;
  if (open_up) { edge_dist = min(edge_dist, local_y + 0.5); }
  if (open_down) { edge_dist = min(edge_dist, size - 1.0 - local_y + 0.5); }
  if (open_left) { edge_dist = min(edge_dist, local_x + 0.5); }
  if (open_right) { edge_dist = min(edge_dist, size - 1.0 - local_x + 0.5); }
  if (!solid_cell(column - 1, row - 1)) { edge_dist = min(edge_dist, length(vec2f(local_x + 0.5, local_y + 0.5))); }
  if (!solid_cell(column + 1, row - 1)) { edge_dist = min(edge_dist, length(vec2f(size - local_x - 0.5, local_y + 0.5))); }
  if (!solid_cell(column - 1, row + 1)) { edge_dist = min(edge_dist, length(vec2f(local_x + 0.5, size - local_y - 0.5))); }
  if (!solid_cell(column + 1, row + 1)) { edge_dist = min(edge_dist, length(vec2f(size - local_x - 0.5, size - local_y - 0.5))); }

  let noise = vnoise(
    f32(band.origin.x + px) * EDGE_NOISE_FREQ,
    f32(band.origin.y + py) * EDGE_NOISE_FREQ,
    band.tex_seed + 2u,
  );
  let threshold = EDGE_EROSION_BASE + EDGE_EROSION_RANGE * noise;

  var corner_dist = 99.0;
  if (open_up && open_left) { corner_dist = min(corner_dist, length(vec2f(local_x + 0.5, local_y + 0.5))); }
  if (open_up && open_right) { corner_dist = min(corner_dist, length(vec2f(size - local_x - 0.5, local_y + 0.5))); }
  if (open_down && open_left) { corner_dist = min(corner_dist, length(vec2f(local_x + 0.5, size - local_y - 0.5))); }
  if (open_down && open_right) { corner_dist = min(corner_dist, length(vec2f(size - local_x - 0.5, size - local_y - 0.5))); }
  let round_radius = CORNER_ROUND_BASE + CORNER_ROUND_NOISE * noise;

  mask[index] = select(0u, 1u, edge_dist > threshold && corner_dist >= round_radius);
}

// ---- jump flooding ------------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn jfa_init(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= band.size.x || id.y >= band.size.y) { return; }
  let px = i32(id.x);
  let py = i32(id.y);
  let index = pixel_index(px, py);
  seeds_out[index] = select(NO_SEED, vec2i(px, py), mask[index] == 0u);
}

@compute @workgroup_size(8, 8)
fn jfa_step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= band.size.x || id.y >= band.size.y) { return; }
  let here = vec2i(i32(id.x), i32(id.y));
  var best = seeds_in[pixel_index(here.x, here.y)];
  var best_dist = select(FAR, chamfer(here - best), best.x >= 0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let probe = here + vec2i(dx, dy) * jfa.step;
      if (!in_band(probe.x, probe.y)) { continue; }
      let seed = seeds_in[pixel_index(probe.x, probe.y)];
      if (seed.x < 0) { continue; }
      let dist = chamfer(here - seed);
      if (dist < best_dist) {
        best = seed;
        best_dist = dist;
      }
    }
  }
  seeds_out[pixel_index(here.x, here.y)] = best;
}

// ---- shade ----------------------------------------------------------------------------------------

fn is_rock(px: i32, py: i32) -> bool {
  // Outside the band counts as rock for the contact shadow, exactly as distField's `outOfBounds = 0`.
  if (!in_band(px, py)) { return true; }
  return mask[pixel_index(px, py)] == 1u;
}

// Distance from an open pixel to the nearest rock. Only < 2.7 ever matters (the contact shadow), so a
// ±2 window is exact — (2, 2) is already 2.83.
fn rock_dist(px: i32, py: i32) -> f32 {
  var best = FAR;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      if (is_rock(px + dx, py + dy)) { best = min(best, chamfer(vec2i(dx, dy))); }
    }
  }
  return best;
}

// Distance down from the nearest open pixel above, seeded above the band like shadeRock's `topDist`.
// Past TOP_SCAN_PX the answer can't change the pixel: brightness has already clamped to 0 by then.
const TOP_SCAN_PX: i32 = 36;
fn top_dist(px: i32, py: i32) -> f32 {
  for (var k = 0; k <= TOP_SCAN_PX; k++) {
    let y = py - k;
    if (y < 0) { return column_seed(px / T) + f32(py); }
    if (mask[pixel_index(px, y)] == 0u) { return f32(k); }
  }
  return FAR;
}

fn band_colour(index: i32) -> vec3f {
  return band.bands[index].rgb;
}

// A band-relative cell's material id, from the world window (0 = the strata stone).
fn material_cell(column: i32, row: i32) -> u32 {
  let local = band.cell + vec2i(column, row) - band.window_cell;
  if (local.x < 0 || local.y < 0 || local.x >= i32(band.window_cells.x) || local.y >= i32(band.window_cells.y)) {
    return 0u;
  }
  return (cells[u32(local.y) * band.window_cells.x + u32(local.x)] >> 8u) & 255u;
}

// The strata's own stone, in the band's ramp: what every cell without a material is made of.
fn strata_stone(ctx: ShadeCtx) -> vec3f {
  let bands = array<vec3f, 6>(band_colour(0), band_colour(1), band_colour(2), band_colour(3), band_colour(4), band_colour(5));
  return stone_surface(ctx, ctx.brightness, bands, band.rim_b.rgb, band.rim_rock.rgb);
}

fn shade_cell(id: u32, ctx: ShadeCtx) -> vec3f {
  if (has_material(id)) { return material_shade(id, ctx); }
  return strata_stone(ctx);
}

// shadeRock's `materialBlendAt` and what follows it: the pixel's own material, feathered across the
// nearest cardinal boundary with a DIFFERENT material — only between two solid cells, so a mined-out
// vein leaves no stain — by a world-noise-jittered cross-fade whose width comes from both feathers.
fn composite_material(ctx: ShadeCtx, px: i32, py: i32) -> vec3f {
  let column = px / T;
  let row = py / T;
  let here = material_cell(column, row);
  let local_x = f32(px % T);
  let local_y = f32(py % T);
  let size = f32(T);
  var best = FAR;
  var other = 0u;
  var found = false;
  if (solid_cell(column, row - 1)) {
    let up = material_cell(column, row - 1);
    if (up != here && local_y + 0.5 < best) { best = local_y + 0.5; other = up; found = true; }
  }
  if (solid_cell(column, row + 1)) {
    let down = material_cell(column, row + 1);
    if (down != here && size - 1.0 - local_y + 0.5 < best) { best = size - 1.0 - local_y + 0.5; other = down; found = true; }
  }
  if (solid_cell(column - 1, row)) {
    let left = material_cell(column - 1, row);
    if (left != here && local_x + 0.5 < best) { best = local_x + 0.5; other = left; found = true; }
  }
  if (solid_cell(column + 1, row)) {
    let right = material_cell(column + 1, row);
    if (right != here && size - 1.0 - local_x + 0.5 < best) { best = size - 1.0 - local_x + 0.5; other = right; found = true; }
  }
  let colour_a = shade_cell(here, ctx);
  if (!found) { return colour_a; }
  let width = max(2.0, (material_feather(here) + material_feather(other)) * 0.5 * BLEND_WIDTH);
  let jitter = (vnoise(ctx.world.x * FEATHER_FREQ, ctx.world.y * FEATHER_FREQ, band.tex_seed + 21u) - 0.5) * width * 0.6;
  let t = 0.5 * clamp(1.0 - (best + jitter) / width, 0.0, 1.0);
  if (t <= 0.001) { return colour_a; }
  return mix(colour_a, shade_cell(other, ctx), t);
}

// JavaScript's Math.round (half rounds up). WGSL's round() rounds half to even.
fn js_round(v: f32) -> f32 {
  return floor(v + 0.5);
}

// The stalactite and stalagmite pixels composeBand draws with `pen`, as a per-pixel test. A tip can
// overhang into the next cell, so the cells either side are asked too — in the order composeBand draws
// them, so a later one still wins.
fn stalactite(px: i32, py: i32, colour_in: vec3f) -> vec3f {
  var colour = colour_in;
  let row = py / T;
  let center = band_colour(0);
  let deep = band_colour(1);
  let rim_a = band_colour(5);
  for (var dc = -1; dc <= 1; dc++) {
    let column = px / T + dc;
    if (column < 0 || column >= i32(band.cells.x) || solid_cell(column, row)) { continue; }
    let world_column = band.cell.x + column;
    let world_row = band.cell.y + row;
    let x = column * T;
    let y = row * T;
    if (solid_cell(column, row - 1) && hash_xy(world_column, world_row, 21u) % 3u == 0u) {
      let tip = x + (T >> 1u) + i32(hash_xy(world_column, world_row, 22u) % 5u) - 2;
      let span = 3 + i32(hash_xy(world_column, world_row, 23u) % 4u);
      let i = py - y;
      if (i >= 0 && i < span) {
        let half_width = max(0, i32(js_round(f32(span - i) / 2.2)));
        if (abs(px - tip) <= half_width) { colour = select(deep, center, i < 2); }
      }
      if (px == tip && py == y) { colour = rim_a; }
    }
    if (solid_cell(column, row + 1) && hash_xy(world_column, world_row, 24u) % 4u == 0u) {
      let tip = x + (T >> 1u) + i32(hash_xy(world_column, world_row, 25u) % 5u) - 2;
      let span = 2 + i32(hash_xy(world_column, world_row, 26u) % 3u);
      let i = y + T - 1 - py;
      if (i >= 0 && i < span) {
        let half_width = max(0, i32(js_round(f32(span - i) / 2.2)));
        if (abs(px - tip) <= half_width) { colour = select(deep, center, i < 1); }
      }
    }
  }
  return colour;
}

// Canvas source-over of an 8-bit black with alpha `alpha` onto an opaque pixel.
fn darken(colour: vec3f, alpha: f32) -> vec3f {
  return floor(colour * (255.0 - alpha) / 255.0 + 0.5);
}

@compute @workgroup_size(8, 8)
fn shade_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= band.size.x || id.y >= band.size.y) { return; }
  let px = i32(id.x);
  let py = i32(id.y);
  let world_x = f32(band.origin.x + px);
  let world_y = f32(band.origin.y + py);
  let index = pixel_index(px, py);

  // background wall, with the world-anchored 2×2 silhouettes
  var colour = band.bg_fill.rgb;
  let block_x = px & ~1;
  let block_y = py & ~1;
  if (vnoise(f32(band.origin.x + block_x) * BG_SILHOUETTE_FREQ_X, f32(band.origin.y + block_y) * BG_SILHOUETTE_FREQ_Y, band.tex_seed + 50u) < BG_SILHOUETTE_THRESHOLD) {
    colour = band.bg_silhouette.rgb;
  }

  // sky, per column, above the ground
  if (f32(py) < sky_bottom(px / T)) {
    let t = clamp(f32(py) / band.deepest_sky, 0.0, 1.0);
    colour = floor(mix(band.sky_top.rgb, band.sky_horizon.rgb, t) + 0.5);
  }

  if (mask[index] == 1u) {
    let edge_seed = seeds_in[index];
    let edge_dist = select(FAR, chamfer(vec2i(px, py) - edge_seed), edge_seed.x >= 0);
    let top = top_dist(px, py);
    let range = select(SHADE_RANGE_SIDE_PX, SHADE_RANGE_TOP_PX, top <= edge_dist + 0.8);
    let ctx = ShadeCtx(
      vec2f(world_x, world_y),
      px,
      py,
      vec2i(px % T, py % T),
      band.cell + vec2i(px / T, py / T),
      1.0 - edge_dist / range,
      edge_dist,
      top,
    );
    colour = clamped_byte(composite_material(ctx, px, py));
  } else {
    let near = rock_dist(px, py);
    if (near < 1.4) { colour = darken(colour, CONTACT_SHADOW_NEAR); }
    else if (near < 2.7) { colour = darken(colour, CONTACT_SHADOW_FAR); }
  }
  // After the rock, over everything: a tip can overhang onto the neighbouring cell's rock.
  colour = stalactite(px, py, colour);

  textureStore(scene, vec2i(px, py), vec4f(colour / 255.0, 1.0));
}
