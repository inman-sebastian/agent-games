// water.wgsl — surface water (#89), drawn at screen resolution over pixel-art rock.
//
//   liquid      a per-art-pixel mask says which body's liquid covers it (fluid/bodies.ts)
//   surface     each body's level plus its spring surface's offsets; a crest above the level is found by
//               looking a few pixels down for the body under it
//   the line    one art pixel thick at the surface, following it smoothly between columns
//   the body    one see-through tint over the rock behind
//   glints      short dashes gliding along just under the surface, fading in and out
//   streams     falling water from a spill, with highlights sliding down it
//
// The rock stays pixelated (sampled per art pixel); everything that moves moves every frame. Snapped to whole
// art pixels, ripples stepped and read as a low frame rate, and a 6 Hz shimmer read as choppy at a steady
// 60 fps. See docs/FLUIDS.md, "Rendering". Colours are Resurrect 64, 0–255.

struct Look {
  size: vec2u,        // art pixels
  time: f32,
  scale: f32,         // device pixels per art pixel
  snap: u32,          // 1: snap the water to whole art pixels (for comparison)
  streams: u32,       // live entries in `streams`
  pad1: u32,
  pad2: u32,
  // per kind (0 water, 1 lava): surface line rgb; body tint rgb, a = opacity
  colours: array<vec4f, 4>,
  // per kind: glint density (x), unused yzw
  glint: array<vec4f, 2>,
}

struct BodyInfo {
  level: f32,         // art-pixel row
  x0: f32,            // first surface column
  width: f32,         // surface columns
  start: f32,         // where its offsets begin in `offsets`
  kind: f32,          // 0 water, 1 lava
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

struct Stream {
  x: f32,
  top: f32,
  bottom: f32,
  kind: f32,
}

@group(0) @binding(0) var<uniform> look: Look;
@group(0) @binding(1) var rock: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> liquid: array<u32>;      // per art pixel: 0 dry, else body index + 1
@group(0) @binding(3) var<storage, read> bodies: array<BodyInfo>;
@group(0) @binding(4) var<storage, read> offsets: array<f32>;
@group(0) @binding(5) var<storage, read> streams: array<Stream>;
@group(0) @binding(6) var<storage, read> open: array<u32>;         // per art pixel: 1 where not rock

const GLINT_SPEED: f32 = 7.0;          // art px/s
const GLINT_SPACING: f32 = 26.0;       // art px between glint slots
const GLINT_HALF_LENGTH: f32 = 1.5;    // art px
const CREST_REACH: i32 = 10;           // how far a crest can rise above the level, art px
const STREAM_HALF_WIDTH: f32 = 1.5;    // art px

@vertex
fn water_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

fn rock_at(x: i32, y: i32) -> vec3f {
  let p = clamp(vec2i(x, y), vec2i(0), vec2i(look.size) - 1);
  return textureLoad(rock, p, 0).rgb;
}

fn inside(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && u32(x) < look.size.x && u32(y) < look.size.y;
}

fn is_open(x: i32, y: i32) -> bool {
  return inside(x, y) && open[u32(y) * look.size.x + u32(x)] == 1u;
}

fn body_index(x: i32, y: i32) -> i32 {
  if (!inside(x, y)) { return -1; }
  return i32(liquid[u32(y) * look.size.x + u32(x)]) - 1;
}

// a body's surface height over a column, fractional
fn surface_at(b: BodyInfo, column: f32) -> f32 {
  let local = clamp(column - b.x0, 0.0, b.width - 1.0);
  return b.level + offsets[u32(b.start + local)];
}

fn hash(x: i32, y: i32) -> u32 {
  var h = (u32(x) * 73856093u) ^ (u32(y) * 19349663u);
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  return h ^ (h >> 15u);
}

@fragment
fn water_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  var art = position.xy / look.scale;
  if (look.snap == 1u) { art = floor(art) + 0.5; }
  let x = i32(floor(art.x));
  let y = i32(floor(art.y));
  let background = rock_at(x, y);
  if (!is_open(x, y)) { return vec4f(background, 1.0); }

  // streams first: falling water from a spill, highlights sliding down it
  for (var s = 0u; s < look.streams; s++) {
    let stream = streams[s];
    if (abs(art.x - (stream.x + 0.5)) < STREAM_HALF_WIDTH && art.y >= stream.top && art.y < stream.bottom + 1.0) {
      let kind = u32(stream.kind);
      let body = look.colours[kind * 2u + 1u];
      var colour = mix(background, body.rgb / 255.0, min(1.0, body.a + 0.25));
      let slide = fract((art.y - look.time * 90.0) / 9.0);
      if (slide < 0.22) { colour = mix(colour, look.colours[kind * 2u].rgb / 255.0, 0.6); }
      return vec4f(colour, 1.0);
    }
  }

  // the body under this pixel: its liquid, or liquid a few pixels below for a crest above the level
  var index = body_index(x, y);
  for (var k = 1; index < 0 && k <= CREST_REACH; k++) { index = body_index(x, y + k); }
  if (index < 0) { return vec4f(background, 1.0); }
  let b = bodies[u32(index)];

  // the surface here, blended toward the neighbouring column across the pixel
  let across = art.x - (f32(x) + 0.5);
  let side = select(f32(x) - 1.0, f32(x) + 1.0, across > 0.0);
  var top = mix(surface_at(b, f32(x)), surface_at(b, side), abs(across));
  if (look.snap == 1u) { top = round(surface_at(b, f32(x))); }
  if (art.y < top) { return vec4f(background, 1.0); }

  let kind = u32(b.kind);
  if (art.y < top + 1.0) { return vec4f(look.colours[kind * 2u].rgb / 255.0, 1.0); }
  let body = look.colours[kind * 2u + 1u];
  var colour = mix(background, body.rgb / 255.0, body.a);

  // glints: short light dashes gliding along just under the surface, each fading in and out
  let depth = art.y - top;
  if (depth >= 1.0 && depth < 5.0) {
    let row = i32(floor(depth));
    let direction = f32(1 - 2 * (row % 2));
    let travel = art.x - direction * look.time * GLINT_SPEED;
    let slot = i32(floor(travel / GLINT_SPACING));
    let seed = hash(slot, row + 17 * i32(kind));
    let centre = (f32(slot) + 0.2 + 0.6 * f32(seed % 1000u) / 1000.0) * GLINT_SPACING;
    let alive = sin(look.time * 1.7 + f32(seed % 628u) / 100.0);
    let present = f32((seed >> 10u) % 1000u) / 1000.0 < look.glint[kind].x * 40.0;
    if (present && alive > 0.0 && abs(travel - centre) < GLINT_HALF_LENGTH) {
      colour = mix(colour, look.colours[kind * 2u].rgb / 255.0, 0.55 * alive);
    }
  }
  return vec4f(colour, 1.0);
}
