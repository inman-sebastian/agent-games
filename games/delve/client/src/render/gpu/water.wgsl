// water.wgsl — surface water drawn in pixel style (#89), at art resolution over the rock. For each art pixel
// column the CPU hands over where its water starts (the body's level plus the surface offset) and ends (the
// rock below). Inside that span, over open pixels:
//
//   the top pixel     a bright surface line
//   the next          a lighter line
//   below             the rock behind, wavering, seen through a tint that deepens in steps with depth
//   near the top      sparse shimmer pixels drifting along
//
// See docs/FLUIDS.md, "Rendering". Colours are Resurrect 64, 0–255.

struct Look {
  size: vec2u,
  time: f32,
  pad: f32,
  // per kind (0 water, 1 lava), five bands: surface, highlight, shallow, deep, deepest (rgb, a = tint opacity)
  colours: array<vec4f, 10>,
  // per kind: x waver amplitude px, y frequency along y, z speed, w shimmer density (0..1)
  waver: array<vec4f, 2>,
}

@group(0) @binding(0) var<uniform> look: Look;
@group(0) @binding(1) var rock: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> columns: array<vec4f>;   // per art column: top, bottom (top > bottom: dry), kind
@group(0) @binding(3) var<storage, read> open: array<u32>;        // per art pixel: 1 where not rock

@vertex
fn water_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

fn rock_at(x: i32, y: i32) -> vec3f {
  let p = clamp(vec2i(x, y), vec2i(0), vec2i(look.size) - 1);
  return textureLoad(rock, p, 0).rgb;
}

fn is_open(x: i32, y: i32) -> bool {
  if (x < 0 || y < 0 || u32(x) >= look.size.x || u32(y) >= look.size.y) { return false; }
  return open[u32(y) * look.size.x + u32(x)] == 1u;
}

fn hash(x: i32, y: i32) -> u32 {
  var h = (u32(x) * 73856093u) ^ (u32(y) * 19349663u);
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  return h ^ (h >> 15u);
}

@fragment
fn water_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let x = i32(position.x);
  let y = i32(position.y);
  let background = rock_at(x, y);
  let column = columns[u32(x)];
  let top = i32(round(column.x));
  let bottom = i32(column.y);
  if (y < top || y > bottom || !is_open(x, y)) { return vec4f(background, 1.0); }
  let kind = min(u32(column.z), 1u);
  let band = kind * 5u;
  let waver = look.waver[kind];

  let depth = y - top;
  if (depth == 0) { return vec4f(look.colours[band].rgb / 255.0, 1.0); }
  if (depth == 1) { return vec4f(look.colours[band + 1u].rgb / 255.0, 1.0); }

  // what's behind wavers: a whole-pixel horizontal offset that moves with time
  let sway = i32(round(sin(f32(y) * waver.y + look.time * waver.z) * waver.x));
  let behind = select(background, rock_at(x + sway, y), is_open(x + sway, y) == is_open(x, y));

  var tint = look.colours[band + 2u];
  if (depth >= 12) { tint = look.colours[band + 3u]; }
  if (depth >= 28) { tint = look.colours[band + 4u]; }
  var colour = mix(behind, tint.rgb / 255.0, tint.a);

  // shimmer: sparse light pixels drifting along just under the surface
  if (depth < 7) {
    let drift = i32(floor(look.time * 6.0));
    let roll = f32(hash((x + drift * (1 - 2 * (depth % 2))) / 2, y) % 1000u) / 1000.0;
    if (roll < waver.w) { colour = mix(colour, look.colours[band].rgb / 255.0, 0.6); }
  }
  return vec4f(colour, 1.0);
}
