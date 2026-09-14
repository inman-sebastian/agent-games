// water.wgsl — surface water (#89), drawn at screen resolution over pixel-art rock. For each art column the CPU
// hands over where its water starts (the level plus the surface offset, fractional) and ends (the rock below).
//
//   the surface line  one art pixel thick, following the surface smoothly between columns
//   the body          one see-through tint over the rock behind, which wavers
//   near the top      sparse shimmer pixels drifting along
//
// The rock stays pixelated (sampled per art pixel). Only the water's position is smooth: snapped to whole art
// pixels, a 1–3 px ripple stepped a pixel at a time and read as a low frame rate. `snap` restores that for
// comparison. See docs/FLUIDS.md, "Rendering". Colours are Resurrect 64, 0–255.

struct Look {
  size: vec2u,        // art pixels
  time: f32,
  scale: f32,         // device pixels per art pixel
  snap: u32,          // 1: snap the water to whole art pixels
  pad0: u32,
  pad1: u32,
  pad2: u32,
  // per kind (0 water, 1 lava): surface line rgb; body tint rgb, a = opacity
  colours: array<vec4f, 4>,
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

fn wet(column: i32) -> bool {
  if (column < 0 || u32(column) >= look.size.x) { return false; }
  let c = columns[u32(column)];
  return c.x <= c.y;
}

fn hash(x: i32, y: i32) -> u32 {
  var h = (u32(x) * 73856093u) ^ (u32(y) * 19349663u);
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  return h ^ (h >> 15u);
}

@fragment
fn water_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  // where this device pixel falls in art pixels, fractional, and the art pixel it's in
  var art = position.xy / look.scale;
  if (look.snap == 1u) { art = floor(art) + 0.5; }
  let x = i32(floor(art.x));
  let y = i32(floor(art.y));
  let background = rock_at(x, y);
  if (!wet(x) || !is_open(x, y)) { return vec4f(background, 1.0); }
  let column = columns[u32(x)];
  let bottom = f32(column.y) + 1.0;

  // the surface height here: blended toward the neighbouring column across the pixel, so it moves smoothly
  let across = art.x - (f32(x) + 0.5);
  let side = select(x - 1, x + 1, across > 0.0);
  var top = column.x;
  if (wet(side)) { top = mix(column.x, columns[u32(side)].x, abs(across)); }
  if (look.snap == 1u) { top = round(column.x); }
  if (art.y < top || art.y >= bottom) { return vec4f(background, 1.0); }

  let kind = min(u32(column.z), 1u);
  let waver = look.waver[kind];
  if (art.y < top + 1.0) { return vec4f(look.colours[kind * 2u].rgb / 255.0, 1.0); }

  // what's behind wavers: a whole-art-pixel horizontal offset that moves with time
  let sway = i32(round(sin(f32(y) * waver.y + look.time * waver.z) * waver.x));
  let behind = select(background, rock_at(x + sway, y), is_open(x + sway, y));
  let body = look.colours[kind * 2u + 1u];
  var colour = mix(behind, body.rgb / 255.0, body.a);

  // shimmer: sparse light pixels drifting along just under the surface
  let depth = i32(floor(art.y - top));
  if (depth < 7) {
    let drift = i32(floor(look.time * 6.0));
    let roll = f32(hash((x + drift * (1 - 2 * (depth % 2))) / 2, y) % 1000u) / 1000.0;
    if (roll < waver.w) { colour = mix(colour, look.colours[kind * 2u].rgb / 255.0, 0.5); }
  }
  return vec4f(colour, 1.0);
}
