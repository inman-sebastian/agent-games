// liquid.wgsl — drawing the FLIP liquid (#88) smooth and palette-banded, in two passes:
//
//   splat      each particle adds a soft disc of density into a float texture, at screen resolution
//   composite  density becomes Resurrect-64 bands: a surface highlight, the body, and deep water below
//
// No pixel snapping: the edge is smooth at screen resolution. The bands tie it to the palette. See
// docs/FLUIDS.md, "Rendering".

struct View {
  screen: vec2f,       // the target, device pixels
  scale: f32,          // device pixels per art pixel
  radius: f32,         // splat radius, art px
  threshold: f32,      // density at the liquid's edge
  rim: f32,            // how far down from the surface the highlight reaches, art px
  deep: f32,           // how far down from the surface the deep band starts, art px
  pad: f32,
}

@group(0) @binding(0) var<uniform> view: View;

// ---- splat ------------------------------------------------------------------------------------------------

struct Splat {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,  // -1..1 across the disc
}

@vertex
fn splat_vertex(@builtin(vertex_index) index: u32, @location(0) particle: vec2f) -> Splat {
  let corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let corner = corners[index];
  let pixel = (particle + corner * view.radius) * view.scale;
  let clip = vec2f(pixel.x / view.screen.x * 2.0 - 1.0, 1.0 - pixel.y / view.screen.y * 2.0);
  return Splat(vec4f(clip, 0.0, 1.0), corner);
}

@fragment
fn splat_fragment(in: Splat) -> @location(0) vec4f {
  let q = 1.0 - dot(in.local, in.local);
  if (q <= 0.0) { discard; }
  return vec4f(q * q, 0.0, 0.0, 0.0);  // a smooth bump; additive blending sums them
}

// ---- composite ----------------------------------------------------------------------------------------------

@group(0) @binding(1) var density: texture_2d<f32>;

@vertex
fn composite_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

fn density_at(pixel: vec2f) -> f32 {
  let size = vec2f(textureDimensions(density));
  let p = vec2i(clamp(pixel, vec2f(0.0), size - 1.0));
  return textureLoad(density, p, 0).r;
}

@fragment
fn composite_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let here = density_at(position.xy);
  // a smooth, antialiased edge a device pixel or so wide
  let coverage = smoothstep(view.threshold * 0.85, view.threshold * 1.15, here);
  if (coverage <= 0.0) { return vec4f(0.0); }
  let rim_above = density_at(position.xy - vec2f(0.0, view.rim * view.scale));
  let deep_above = density_at(position.xy - vec2f(0.0, view.deep * view.scale));
  var colour = vec3f(77.0, 155.0, 230.0) / 255.0;                     // #4d9be6 body
  if (deep_above > view.threshold) { colour = vec3f(77.0, 101.0, 180.0) / 255.0; }  // #4d65b4 deep
  if (rim_above < view.threshold) { colour = vec3f(143.0, 211.0, 255.0) / 255.0; }  // #8fd3ff surface
  return vec4f(colour * coverage, coverage);
}
