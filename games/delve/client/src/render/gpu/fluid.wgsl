// fluid.wgsl — the pixel fluid on the GPU (#87): the WGSL twin of client/src/fluid/rule.ts, stage for stage.
// fluid-lab checks the two agree exactly over hundreds of passes; change them together. The model is in
// docs/FLUIDS.md. A pass runs these entry points in order, each reading only the stage before it:
//
//   fluid_head    one relaxation step of the hydraulic head field (fluid.ts runs `headSteps` of them)
//   fluid_fall    every run of liquid over empty space falls one pixel, together
//   fluid_flow    one Margolus block pass: sinking, sliding, sideways flow
//
// plus fluid_brush (pour or erase in a disc) and fluid_vertex / fluid_fragment (draw the liquid).
//
// Needs noise.wgsl (hash_xy) in front of it. (WGSL reserves `from`, `target` and `pass`.)

struct Fluid {
  size: vec2u,
  pass_number: u32,
  energy: u32,        // FluidParams.energy
  sight: u32,         // FluidParams.sight
  chance_water: u32,  // FluidParams.chance, out of CHANCE_SCALE
  chance_lava: u32,
  pad: u32,
}

struct Brush {
  centre: vec2i,
  radius: i32,
  mode: u32,          // 0 pour water, 1 pour lava, 2 erase liquid
  pass_number: u32,
  energy: u32,
}

@group(0) @binding(0) var<uniform> fluid: Fluid;
@group(0) @binding(1) var<storage, read> solid: array<u32>;        // 1 where rock is
@group(0) @binding(2) var<storage, read> state_in: array<u32>;
@group(0) @binding(3) var<storage, read_write> state_out: array<u32>;
@group(0) @binding(4) var<storage, read> head_in: array<u32>;
@group(0) @binding(5) var<storage, read_write> head_out: array<u32>;
@group(0) @binding(6) var<uniform> brush: Brush;
@group(0) @binding(7) var<storage, read_write> state: array<u32>;   // the brush edits in place

const EMPTY: u32 = 0u;
const WATER: u32 = 1u;
const LAVA: u32 = 2u;
const DIRECTION_BIT: u32 = 4u;
const ENERGY_SHIFT: u32 = 8u;
const CHANCE_SCALE: u32 = 1024u;
const HEAD_UNITS: u32 = 4u;
const HEAD_SIDE: u32 = 1u;
const HEAD_UP: u32 = 4u;
const FALL_RUN: i32 = 64;
const ROCK: u32 = 0xffffffffu;  // rule.ts's -1: rock, or outside the grid

fn kind_of(value: u32) -> u32 { return value & 3u; }
fn energy_of(value: u32) -> u32 { return (value >> ENERGY_SHIFT) & 255u; }
fn with_energy(value: u32, energy: u32) -> u32 {
  return (value & ~(255u << ENERGY_SHIFT)) | (energy << ENERGY_SHIFT);
}
fn chance_of(roll: u32) -> u32 { return (roll >> 16u) & (CHANCE_SCALE - 1u); }
fn kind_chance(kind: u32) -> u32 {
  return select(select(0u, fluid.chance_lava, kind == LAVA), fluid.chance_water, kind == WATER);
}
fn flow_seed() -> u32 { return (fluid.pass_number & 0xffffffu) * 2u; }
fn fall_seed() -> u32 { return (fluid.pass_number & 0xffffffu) * 2u + 1u; }

// rule.ts `readerFor`: the state this stage reads, or ROCK
fn at(x: i32, y: i32) -> u32 {
  if (x < 0 || y < 0 || u32(x) >= fluid.size.x || u32(y) >= fluid.size.y) { return ROCK; }
  let index = u32(y) * fluid.size.x + u32(x);
  if (solid[index] != 0u) { return ROCK; }
  return state_in[index];
}

fn liquid_value(value: u32) -> bool { return value != ROCK && kind_of(value) != EMPTY; }
fn occupied_value(value: u32) -> bool { return value == ROCK || kind_of(value) != EMPTY; }
fn index_of(x: i32, y: i32) -> u32 { return u32(y) * fluid.size.x + u32(x); }

// ---- 1. head --------------------------------------------------------------------------------------------

fn resting(x: i32, y: i32) -> bool { return liquid_value(at(x, y)) && occupied_value(at(x, y + 1)); }

@compute @workgroup_size(8, 8)
fn fluid_head(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= fluid.size.x || id.y >= fluid.size.y) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  var best = id.y * HEAD_UNITS;
  if (resting(x, y)) {
    if (resting(x, y - 1)) { best = min(best, head_in[index_of(x, y - 1)]); }
    if (resting(x, y + 1)) { best = min(best, head_in[index_of(x, y + 1)] + HEAD_UP); }
    if (resting(x - 1, y)) { best = min(best, head_in[index_of(x - 1, y)] + HEAD_SIDE); }
    if (resting(x + 1, y)) { best = min(best, head_in[index_of(x + 1, y)] + HEAD_SIDE); }
  }
  head_out[index_of(x, y)] = best;
}

// ---- 2. fall --------------------------------------------------------------------------------------------

// rule.ts `falls`
fn falls(x: i32, y: i32) -> bool {
  if (!liquid_value(at(x, y))) { return false; }
  for (var k = 1; k <= FALL_RUN; k++) {
    let below = at(x, y + k);
    if (below == ROCK) { return false; }
    if (kind_of(below) != EMPTY) { continue; }
    let bottom = at(x, y + k - 1);
    return chance_of(hash_xy(x, y + k - 1, fall_seed())) < kind_chance(kind_of(bottom));
  }
  return false;
}

@compute @workgroup_size(8, 8)
fn fluid_fall(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= fluid.size.x || id.y >= fluid.size.y) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let index = index_of(x, y);
  if (falls(x, y - 1)) {
    state_out[index] = with_energy(state_in[index - fluid.size.x], fluid.energy);
  } else if (falls(x, y)) {
    state_out[index] = EMPTY;
  } else {
    state_out[index] = state_in[index];
  }
}

// ---- 3. flow --------------------------------------------------------------------------------------------

// rule.ts `underPressure`: the body's surface stands more than one pixel above
fn pressurized(x: i32, y: i32) -> bool {
  return head_in[index_of(x, y)] + HEAD_UNITS < u32(y) * HEAD_UNITS;
}

fn drop_ahead(x: i32, y: i32, right: bool) -> bool {
  let stride = select(-1, 1, right);
  for (var k = 1; k <= i32(fluid.sight); k++) {
    let ahead = at(x + k * stride, y);
    if (ahead == ROCK || kind_of(ahead) != EMPTY) { return false; }
    if (!occupied_value(at(x + k * stride, y + 1))) { return true; }
  }
  return false;
}

struct Block {
  s: array<u32, 4>,
  moved: array<bool, 4>,
  chance_roll: u32,
}

fn is_rock(b: ptr<function, Block>, i: u32) -> bool { return (*b).s[i] == ROCK; }
fn kind(b: ptr<function, Block>, i: u32) -> u32 { return select(kind_of((*b).s[i]), EMPTY, is_rock(b, i)); }
fn is_liquid(b: ptr<function, Block>, i: u32) -> bool { return kind(b, i) != EMPTY; }
fn is_empty(b: ptr<function, Block>, i: u32) -> bool { return !is_rock(b, i) && kind(b, i) == EMPTY; }
fn occupied(b: ptr<function, Block>, i: u32) -> bool { return is_rock(b, i) || kind(b, i) != EMPTY; }
fn acts(b: ptr<function, Block>, i: u32) -> bool { return (*b).chance_roll < kind_chance(kind(b, i)); }
fn move_pixel(b: ptr<function, Block>, source: u32, destination: u32, energy: u32) {
  let travelling = with_energy((*b).s[source], energy);
  (*b).s[source] = (*b).s[destination];
  (*b).s[destination] = travelling;
  (*b).moved[source] = true;
  (*b).moved[destination] = true;
}

fn flow(b: ptr<function, Block>, source: u32, destination: u32, toward_right: bool, supported: bool, x: i32, y: i32) {
  if (!supported) { return; }
  if (!is_liquid(b, source) || (*b).moved[source] || !acts(b, source)) { return; }
  let under_pressure = pressurized(x, y);
  let energy = energy_of((*b).s[source]);
  let stored = ((*b).s[source] & DIRECTION_BIT) != 0u;
  let sees_ahead = !under_pressure && energy == 0u && drop_ahead(x, y, stored);
  if (!under_pressure && energy == 0u && !sees_ahead && drop_ahead(x, y, !stored)) {
    if (stored == toward_right) { (*b).s[source] ^= DIRECTION_BIT; }
    return;
  }
  if (!under_pressure && stored != toward_right) { return; }
  if (is_empty(b, destination) && !(*b).moved[destination] && (under_pressure || energy > 0u || sees_ahead)) {
    if (under_pressure) {
      (*b).s[source] = ((*b).s[source] & ~DIRECTION_BIT) | select(0u, DIRECTION_BIT, toward_right);
    }
    move_pixel(b, source, destination, select(max(energy, 1u) - 1u, fluid.energy, under_pressure));
  } else if (!is_empty(b, destination) && !under_pressure && energy > 0u) {
    (*b).s[source] = with_energy((*b).s[source] ^ DIRECTION_BIT, energy - 1u);
  }
}

// rule.ts `blockStep`
fn block_step(x0: i32, y0: i32) -> array<u32, 4> {
  var b = Block(
    array<u32, 4>(at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)),
    array<bool, 4>(false, false, false, false),
    chance_of(hash_xy(x0, y0, flow_seed())),
  );

  // lava sinks through water
  for (var top = 0u; top < 2u; top++) {
    let bottom = top + 2u;
    if (kind(&b, top) == LAVA && kind(&b, bottom) == WATER && acts(&b, top)) {
      move_pixel(&b, top, bottom, fluid.energy);
    }
  }

  // diagonal slide
  if (is_liquid(&b, 0u) && !b.moved[0] && acts(&b, 0u) && occupied(&b, 2u) && is_empty(&b, 3u) && is_empty(&b, 1u)) {
    move_pixel(&b, 0u, 3u, fluid.energy);
  } else if (is_liquid(&b, 1u) && !b.moved[1] && acts(&b, 1u) && occupied(&b, 3u) && is_empty(&b, 2u) && is_empty(&b, 0u)) {
    move_pixel(&b, 1u, 2u, fluid.energy);
  }

  // sideways flow, in rule.ts's order
  flow(&b, 2u, 3u, true, occupied_value(at(x0, y0 + 2)), x0, y0 + 1);
  flow(&b, 3u, 2u, false, occupied_value(at(x0 + 1, y0 + 2)), x0 + 1, y0 + 1);
  flow(&b, 0u, 1u, true, occupied(&b, 2u), x0, y0);
  flow(&b, 1u, 0u, false, occupied(&b, 3u), x0 + 1, y0);
  return b.s;
}

@compute @workgroup_size(8, 8)
fn fluid_flow(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= fluid.size.x || id.y >= fluid.size.y) { return; }
  let offset = i32(fluid.pass_number & 1u);
  let x = i32(id.x);
  let y = i32(id.y);
  let x0 = ((x + offset) / 2) * 2 - offset;
  let y0 = ((y + offset) / 2) * 2 - offset;
  let local = u32(x - x0) + 2u * u32(y - y0);
  let result = block_step(x0, y0)[local];
  let index = id.y * fluid.size.x + id.x;
  // rock keeps whatever state it had, as rule.ts does
  state_out[index] = select(result, state_in[index], result == ROCK);
}

// ---- brush ----------------------------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn fluid_brush(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= fluid.size.x || id.y >= fluid.size.y) { return; }
  let offset = vec2i(id.xy) - brush.centre;
  if (dot(offset, offset) > brush.radius * brush.radius) { return; }
  let index = id.y * fluid.size.x + id.x;
  if (brush.mode == 2u) {
    state[index] = EMPTY;
    return;
  }
  if (solid[index] != 0u || kind_of(state[index]) != EMPTY) { return; }
  let right = (hash_xy(i32(id.x), i32(id.y), brush.pass_number) & 1u) == 1u;
  state[index] = (brush.mode + 1u) | select(0u, DIRECTION_BIT, right) | (brush.energy << ENERGY_SHIFT);
}

// ---- drawing ----------------------------------------------------------------------------------------------

struct Draw {
  size: vec2u,
}

@group(0) @binding(8) var<uniform> draw: Draw;
@group(0) @binding(9) var<storage, read> liquid: array<u32>;

@vertex
fn fluid_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

fn liquid_kind(x: i32, y: i32) -> u32 {
  if (x < 0 || y < 0 || u32(x) >= draw.size.x || u32(y) >= draw.size.y) { return EMPTY; }
  return kind_of(liquid[u32(y) * draw.size.x + u32(x)]);
}

// Liquid is covered above by more of itself or by rock: under an overhang it isn't surface.
fn covered(x: i32, y: i32, k: u32) -> bool {
  if (x < 0 || y < 0 || u32(x) >= draw.size.x || u32(y) >= draw.size.y) { return false; }
  return solid[u32(y) * draw.size.x + u32(x)] != 0u || liquid_kind(x, y) == k;
}

// Resurrect 64, opaque: water brightest at its surface and deepening; lava hottest at its surface
@fragment
fn fluid_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let x = i32(position.x);
  let y = i32(position.y);
  let k = liquid_kind(x, y);
  if (k == EMPTY) { return vec4f(0.0); }
  var depth = 0;
  while (depth < 11 && covered(x, y - depth - 1, k)) { depth++; }
  var colour: vec3f;
  if (k == WATER) {
    colour = vec3f(72.0, 74.0, 119.0);                                // #484a77
    if (depth < 11) { colour = vec3f(77.0, 101.0, 180.0); }           // #4d65b4
    if (depth < 3) { colour = vec3f(77.0, 155.0, 230.0); }            // #4d9be6
    if (depth == 0) { colour = vec3f(143.0, 211.0, 255.0); }          // #8fd3ff
  } else {
    colour = vec3f(232.0, 59.0, 59.0);                                // #e83b3b
    if (depth < 5) { colour = vec3f(251.0, 107.0, 29.0); }            // #fb6b1d
    if (depth < 2) { colour = vec3f(249.0, 194.0, 43.0); }            // #f9c22b
    if (depth == 0) { colour = vec3f(251.0, 255.0, 134.0); }          // #fbff86
  }
  return vec4f(colour / 255.0, 1.0);
}
