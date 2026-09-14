// present.wgsl — the screen-space composite, in the order the Canvas 2D frame draws (client/src/index.ts
// `render`): the rock scene; the three 2D layers — damage cracks (source-over), twinkle glints (ADDED,
// as Canvas 2D's `lighter` adds them), everything else (source-over); then lighting.ts's per-pixel half —
// additive glow, the dithered darkness scrim, the vignette. Everything here is in SCREEN pixels at art resolution, with the
// camera's fractional position, exactly as the Canvas 2D lighting samples it.
//
// It renders into the `frame` texture, which blit.wgsl copies to the canvas and readback can read.
//
// Needs noise.wgsl (the Bayer threshold) and the constants prelude in front of it.

struct Present {
  size: vec2u,          // screen, art pixels
  origin: vec2i,        // world pixel at the screen's top-left, rounded as ctx.translate rounds the camera
  scene_origin: vec2i,  // world pixel at the scene texture's top-left (the rock band)
  tile: vec2i,          // world cell of the light field's top-left
  cam: vec2f,           // the camera's exact world pixel, fractional — what lighting.ts samples with
  grid: vec2u,          // light field size in cells
  window_cell: i32,     // world column of the world window's left edge
  window_cols: u32,
  lighting_on: u32,
  scrim_on: u32,
  overlay_on: u32,
  layers_on: u32,
  // the screen rectangle the under and glint layers hold this frame (plain i32s: every field here is a
  // 4-byte scalar, so the byte layout renderer.ts writes is exactly the declaration order)
  box_x: i32,
  box_y: i32,
  box_width: i32,
  box_height: i32,
}

@group(0) @binding(0) var<uniform> present: Present;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var overlay: texture_2d<f32>;              // premultiplied alpha
@group(0) @binding(3) var<storage, read> glow: array<u32>;       // per cell, RGBA bytes packed little-endian
@group(0) @binding(4) var<storage, read> bright: array<f32>;     // per cell, 0..1
@group(0) @binding(5) var<storage, read> surface: array<f32>;    // the world window's surface row per column
@group(0) @binding(6) var<storage, read> alpha_steps: array<f32>; // 8-bit alpha for each darkness level
@group(0) @binding(7) var under: texture_2d<f32>;                // damage cracks, premultiplied
@group(0) @binding(8) var glint: texture_2d<f32>;                // twinkle glints: premultiplied = the light they add

@vertex
fn composite_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  // one triangle that covers the whole viewport
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

fn glow_at(gx: i32, gy: i32) -> vec3f {
  let x = clamp(gx, 0, i32(present.grid.x) - 1);
  let y = clamp(gy, 0, i32(present.grid.y) - 1);
  let packed = glow[u32(y) * present.grid.x + u32(x)];
  return vec3f(f32(packed & 255u), f32((packed >> 8u) & 255u), f32((packed >> 16u) & 255u));
}

// The glow canvas drawn scaled by T with smoothing on: bilinear between cell centres, sampled at the
// destination PIXEL CENTRE, clamped at the grid's edge.
fn sample_glow(px: i32, py: i32) -> vec3f {
  let fx = (f32(px) + 0.5 + present.cam.x) / f32(T) - f32(present.tile.x) - 0.5;
  let fy = (f32(py) + 0.5 + present.cam.y) / f32(T) - f32(present.tile.y) - 0.5;
  let gx = i32(floor(fx));
  let gy = i32(floor(fy));
  let tx = fx - floor(fx);
  let ty = fy - floor(fy);
  let top = mix(glow_at(gx, gy), glow_at(gx + 1, gy), tx);
  let bottom = mix(glow_at(gx, gy + 1), glow_at(gx + 1, gy + 1), tx);
  return mix(top, bottom, ty);
}

// lighting.ts's scrim sampling: bilinear from the pixel's top-left corner, with the lower cell clamped
// to [0, grid − 2] and the weight clamped to [0, 1].
fn sample_bright(px: i32, py: i32) -> f32 {
  let fx = (f32(px) + present.cam.x) / f32(T) - f32(present.tile.x) - 0.5;
  let fy = (f32(py) + present.cam.y) / f32(T) - f32(present.tile.y) - 0.5;
  let gx = clamp(i32(fx), 0, i32(present.grid.x) - 2);
  let gy = clamp(i32(fy), 0, i32(present.grid.y) - 2);
  let tx = clamp(fx - f32(gx), 0.0, 1.0);
  let ty = clamp(fy - f32(gy), 0.0, 1.0);
  let w = present.grid.x;
  let top = bright[u32(gy) * w + u32(gx)] * (1.0 - tx) + bright[u32(gy) * w + u32(gx + 1)] * tx;
  let bottom = bright[u32(gy + 1) * w + u32(gx)] * (1.0 - tx) + bright[u32(gy + 1) * w + u32(gx + 1)] * tx;
  return min(1.0, top * (1.0 - ty) + bottom * ty);
}

// lighting.ts's sky test: the pixel is at or above its column's surface.
fn above_sky(px: i32, py: i32) -> bool {
  let column = i32(floor((f32(px) + present.cam.x) / f32(T)));
  let local = clamp(column - present.window_cell, 0, i32(present.window_cols) - 1);
  let sky = (surface[u32(local)] + 1.0) * f32(T);
  return f32(py) + present.cam.y <= sky;
}

// A value in 0..1 quantised to DITHER_STEPS levels with the 4×4 Bayer threshold, as the alpha byte
// lighting.ts's Uint8ClampedArray stores for it.
fn dithered_alpha(amount: f32, px: i32, py: i32) -> f32 {
  let scaled = amount * f32(DITHER_STEPS);
  let level = i32(scaled);
  let step_up = select(0, 1, scaled - f32(level) > bayer_threshold(px, py));
  return alpha_steps[min(DITHER_STEPS, level + step_up)];
}

// Canvas source-over of an 8-bit colour with 8-bit alpha onto an opaque pixel.
fn over(dst: vec3f, src: vec3f, alpha: f32) -> vec3f {
  return floor((src * alpha + dst * (255.0 - alpha)) / 255.0 + 0.5);
}

@fragment
fn composite_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let px = i32(position.x);
  let py = i32(position.y);

  let scene_texel = vec2i(px, py) + present.origin - present.scene_origin;
  var colour = floor(textureLoad(scene, scene_texel, 0).rgb * 255.0 + 0.5);

  // The under and glint layers only hold the lamp's box this frame; outside it they're stale.
  let in_box = px >= present.box_x && py >= present.box_y &&
    px < present.box_x + present.box_width && py < present.box_y + present.box_height;
  if (present.layers_on == 1u && in_box) {
    let cracks = textureLoad(under, vec2i(px, py), 0);
    colour = floor(cracks.rgb * 255.0 + colour * (1.0 - cracks.a) + 0.5);
    let light = textureLoad(glint, vec2i(px, py), 0);
    colour = min(vec3f(255.0), colour + floor(light.rgb * 255.0 + 0.5));
  }

  if (present.overlay_on == 1u) {
    let layer = textureLoad(overlay, vec2i(px, py), 0);
    colour = floor(layer.rgb * 255.0 + colour * (1.0 - layer.a) + 0.5);
  }

  if (present.lighting_on == 1u) {
    // additive glow ('lighter')
    colour = min(vec3f(255.0), colour + floor(sample_glow(px, py) + 0.5));

    // the dithered darkness scrim: nothing above the ground, the void where no light reaches
    if (present.scrim_on == 1u) {
      var b = sample_bright(px, py);
      b = select((b - LIGHT_FLOOR) / (1.0 - LIGHT_FLOOR), 0.0, b <= LIGHT_FLOOR);
      let darkness = select((1.0 - b) * MAX_DARKNESS, 0.0, above_sky(px, py));
      colour = over(colour, SCRIM, dithered_alpha(darkness, px, py));
    }

    // the vignette
    let centre = vec2f(f32(present.size.x) / 2.0, f32(present.size.y) / 2.0);
    let distance = length(vec2f(f32(px), f32(py)) - centre);
    let inner = f32(present.size.y) * VIGNETTE_INNER;
    let span = f32(present.size.y) * VIGNETTE_SPAN;
    let strength = smooth01(clamp((distance - inner) / span, 0.0, 1.0)) * VIGNETTE_MAX;
    colour = over(colour, SCRIM, dithered_alpha(strength, px, py));
  }

  return vec4f(colour / 255.0, 1.0);
}
