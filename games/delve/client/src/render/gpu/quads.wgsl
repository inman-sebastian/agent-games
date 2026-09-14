// quads.wgsl — the entity pass (#83): quads.ts's batch, one instance per quad, into the `entities`
// texture that present.wgsl composites where the Canvas 2D frame drew particles and the player.
//
// Output is PREMULTIPLIED, blended one / one-minus-src-alpha, so each quad lands source-over on the ones
// before it exactly as Canvas 2D's `fillRect` and `drawImage` do. A textured quad copies atlas texels
// 1:1 — whole-pixel positions, no filtering — so a sprite's hard edges survive.

struct Screen {
  size: vec2f,
}

struct Quad {
  @location(0) rect: vec4f,    // x, y, width, height in screen pixels
  @location(1) source: vec4f,  // atlas x, atlas y, textured (1) or solid (0), pad
  @location(2) colour: vec4f,  // r, g, b 0–255, alpha 0–1
}

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) source: vec4f,
  @location(2) @interpolate(flat) colour: vec4f,
}

@group(0) @binding(0) var<uniform> screen: Screen;
@group(0) @binding(1) var atlas: texture_2d<f32>;

@vertex
fn quad_vertex(@builtin(vertex_index) index: u32, quad: Quad) -> Varyings {
  let corners = array(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let local = corners[index] * quad.rect.zw;
  let pixel = quad.rect.xy + local;
  let clip = vec2f(pixel.x / screen.size.x * 2.0 - 1.0, 1.0 - pixel.y / screen.size.y * 2.0);
  return Varyings(vec4f(clip, 0.0, 1.0), local, quad.source, quad.colour);
}

@fragment
fn quad_fragment(in: Varyings) -> @location(0) vec4f {
  if (in.source.z == 1.0) {
    // the atlas holds the baked canvas premultiplied, as it was copied
    return textureLoad(atlas, vec2i(in.source.xy + floor(in.local)), 0) * in.colour.a;
  }
  return vec4f(in.colour.rgb / 255.0 * in.colour.a, in.colour.a);
}
