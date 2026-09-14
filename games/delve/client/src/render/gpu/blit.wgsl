// blit.wgsl — copy the finished art-resolution frame to the canvas, one texel per canvas pixel. The
// canvas is sized to the art resolution and upscaled by CSS `image-rendering: pixelated`, exactly as the
// Canvas 2D game is, so there's no sampler and no filtering to go wrong.

@group(0) @binding(0) var frame: texture_2d<f32>;

@vertex
fn blit_vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  // one triangle that covers the whole viewport
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn blit_fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureLoad(frame, vec2i(position.xy), 0);
}
