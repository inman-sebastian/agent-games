// light.wgsl — the per-pixel half of client/src/render/lighting.ts, composited over the rock scene:
// the additive colour glow, the dithered darkness scrim and the vignette. The per-cell field those read
// (propagation through open space and rock) still comes from lighting.ts's `field()` on the CPU: it's
// cheap, order-dependent, and the spike's job is the per-pixel cost.
//
// Needs noise.wgsl (the Bayer threshold) and the constants prelude in front of it.

struct Light {
  size: vec2u,        // art pixels
  cam: vec2f,         // world pixel of the view's top-left
  tile: vec2i,        // world cell of the field grid's top-left
  grid: vec2u,        // field grid size in cells
  scrim_on: u32,
  lighting_on: u32,  // 0: pass the scene straight through, to diff the rock on its own
  _pad: vec2u,
}

@group(0) @binding(0) var<uniform> light: Light;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var frame: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> glow: array<u32>;       // per cell, RGBA bytes packed little-endian
@group(0) @binding(4) var<storage, read> bright: array<f32>;     // per cell, 0..1
@group(0) @binding(5) var<storage, read> column_sky: array<f32>; // sky bottom per column, view-relative px
@group(0) @binding(6) var<storage, read> alpha_steps: array<f32>; // 8-bit alpha for each darkness level

fn glow_at(gx: i32, gy: i32) -> vec3f {
  let x = clamp(gx, 0, i32(light.grid.x) - 1);
  let y = clamp(gy, 0, i32(light.grid.y) - 1);
  let packed = glow[u32(y) * light.grid.x + u32(x)];
  return vec3f(f32(packed & 255u), f32((packed >> 8u) & 255u), f32((packed >> 16u) & 255u));
}

// The glow canvas drawn scaled by T with smoothing on: bilinear between cell centres, sampled at the
// destination PIXEL CENTRE, clamped at the grid's edge.
fn sample_glow(px: i32, py: i32) -> vec3f {
  let fx = (f32(px) + 0.5 + light.cam.x) / f32(T) - f32(light.tile.x) - 0.5;
  let fy = (f32(py) + 0.5 + light.cam.y) / f32(T) - f32(light.tile.y) - 0.5;
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
  let fx = (f32(px) + light.cam.x) / f32(T) - f32(light.tile.x) - 0.5;
  let fy = (f32(py) + light.cam.y) / f32(T) - f32(light.tile.y) - 0.5;
  let gx = clamp(i32(fx), 0, i32(light.grid.x) - 2);
  let gy = clamp(i32(fy), 0, i32(light.grid.y) - 2);
  let tx = clamp(fx - f32(gx), 0.0, 1.0);
  let ty = clamp(fy - f32(gy), 0.0, 1.0);
  let w = light.grid.x;
  let top = bright[u32(gy) * w + u32(gx)] * (1.0 - tx) + bright[u32(gy) * w + u32(gx + 1)] * tx;
  let bottom = bright[u32(gy + 1) * w + u32(gx)] * (1.0 - tx) + bright[u32(gy + 1) * w + u32(gx + 1)] * tx;
  return min(1.0, top * (1.0 - ty) + bottom * ty);
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

@compute @workgroup_size(8, 8)
fn light_main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= light.size.x || id.y >= light.size.y) { return; }
  let px = i32(id.x);
  let py = i32(id.y);
  var colour = floor(textureLoad(scene, vec2i(px, py), 0).rgb * 255.0 + 0.5);
  if (light.lighting_on == 0u) {
    textureStore(frame, vec2i(px, py), vec4f(colour / 255.0, 1.0));
    return;
  }

  // additive glow ('lighter')
  colour = min(vec3f(255.0), colour + floor(sample_glow(px, py) + 0.5));

  // the dithered darkness scrim: nothing above the ground, the void where no light reaches
  if (light.scrim_on == 1u) {
    let above_sky = f32(py) <= column_sky[px / T];
    var b = sample_bright(px, py);
    b = select((b - LIGHT_FLOOR) / (1.0 - LIGHT_FLOOR), 0.0, b <= LIGHT_FLOOR);
    let darkness = select((1.0 - b) * MAX_DARKNESS, 0.0, above_sky);
    colour = over(colour, SCRIM, dithered_alpha(darkness, px, py));
  }

  // the vignette
  let centre = vec2f(f32(light.size.x) / 2.0, f32(light.size.y) / 2.0);
  let distance = length(vec2f(f32(px), f32(py)) - centre);
  let inner = f32(light.size.y) * VIGNETTE_INNER;
  let span = f32(light.size.y) * VIGNETTE_SPAN;
  let strength = smooth01(clamp((distance - inner) / span, 0.0, 1.0)) * VIGNETTE_MAX;
  colour = over(colour, SCRIM, dithered_alpha(strength, px, py));

  textureStore(frame, vec2i(px, py), vec4f(colour / 255.0, 1.0));
}
