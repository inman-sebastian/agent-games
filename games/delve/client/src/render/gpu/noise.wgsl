// noise.wgsl — WGSL ports of the world-anchored hashes and noise in shared/src/rng.ts, and of the
// Bayer quantiser in client/src/render/palette.ts. Prepended to every shader that needs them (WGSL has no
// includes).
//
// The integer parts are EXACT ports. rng.ts multiplies in float64 and then truncates with `>>> 0` or
// `^`, which for the magnitudes the renderer uses is precisely 32-bit wrapping arithmetic, and `u32`
// multiplication in WGSL wraps the same way. Only the final divide into [0, 1) is float32 here instead
// of float64, so a value sitting on a threshold can land on the other side of it. That's the one place
// the GPU look may differ from the CPU look by a pixel.

const UINT32_COUNT: f32 = 4294967296.0;

// rng.ts `vnoise`'s lattice hash.
fn lattice_hash(a: i32, b: i32, seed: u32) -> f32 {
  var n: u32 = u32(a) * 374761393u + u32(b) * 668265263u + seed * 362437u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / UINT32_COUNT;
}

fn smooth01(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

// rng.ts `vnoise`: bilinearly interpolated hash lattice, in [0, 1).
fn vnoise(x: f32, y: f32, seed: u32) -> f32 {
  let cell_x = floor(x);
  let cell_y = floor(y);
  let ix = i32(cell_x);
  let iy = i32(cell_y);
  let weight_x = smooth01(x - cell_x);
  let weight_y = smooth01(y - cell_y);
  let top = mix(lattice_hash(ix, iy, seed), lattice_hash(ix + 1, iy, seed), weight_x);
  let bottom = mix(lattice_hash(ix, iy + 1, seed), lattice_hash(ix + 1, iy + 1, seed), weight_x);
  return mix(top, bottom, weight_y);
}

// rng.ts `hashXY`.
fn hash_xy(x: i32, y: i32, seed: u32) -> u32 {
  return (u32(x) * 73856093u) ^ (u32(y) * 19349663u) ^ (seed * 83492791u);
}

// palette.ts `BAYER`, the 4×4 ordered dither matrix.
const BAYER = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);

fn bayer_threshold(px: i32, py: i32) -> f32 {
  let index = u32(px & 3) | (u32(py & 3) << 2u);
  return (f32(BAYER[index]) + 0.5) / 16.0;
}

// palette.ts `quantize`: which of `band_count` bands (dark→light) a dithered brightness falls in.
fn quantize_band(brightness: f32, band_count: i32, px: i32, py: i32) -> i32 {
  let last = band_count - 1;
  let scaled = clamp(brightness, 0.0, 1.0) * f32(last);
  let band = i32(scaled);
  let step_up = select(0, 1, scaled - f32(band) > bayer_threshold(px, py));
  return min(last, band + step_up);
}
