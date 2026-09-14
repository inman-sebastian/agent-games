// surfaces.wgsl — the material surface primitives from client/src/render/palette.ts and the baked
// sparkle from client/src/render/materials/fx.ts, for the material shaders' WGSL twins (#73). A material
// builds its colour on one of these, exactly as its TypeScript twin builds on the palette.ts function of
// the same name. See docs/MATERIALS.md, "GPU twins".
//
// Needs noise.wgsl and the constants prelude in front of it.

/** materials/types.ts `ShadeCtx`: everything the compositor hands a material to colour one pixel. */
struct ShadeCtx {
  world: vec2f,      // world pixel — seed noise with this, so texture is stable and seamless
  px: i32,           // pixel within the render band, for Bayer dithering
  py: i32,
  local: vec2i,      // pixel within its cell, 0..T-1
  cell: vec2i,       // world cell
  brightness: f32,   // the geometric top light, 0..1, before any texture
  edge_dist: f32,
  top_dist: f32,
}

// Math.floor(a / b) for integers, which `/` (truncating toward zero) isn't for a negative `a`.
fn floor_div(a: i32, b: i32) -> i32 {
  return i32(floor(f32(a) / f32(b)));
}

// A colour the TypeScript shader returns as fractions, as Uint8ClampedArray stores it: clamped, rounded
// half to even (WGSL's round() rounds half to even). The compositor applies it once, to the final
// colour, as shadeRock's setPixel does — so a material returns its colour unrounded, and a blend between
// two materials mixes the unrounded values first.
fn clamped_byte(colour: vec3f) -> vec3f {
  return round(clamp(colour, vec3f(0.0), vec3f(255.0)));
}

// palette.ts `quantize` over a material's six bands.
fn quantize_colour(bands: array<vec3f, 6>, brightness: f32, px: i32, py: i32) -> vec3f {
  return bands[quantize_band(brightness, 6, px, py)];
}

// palette.ts `stoneSurface`.
fn stone_surface(ctx: ShadeCtx, brightness: f32, bands: array<vec3f, 6>, rim_b: vec3f, rim_rock: vec3f) -> vec3f {
  let x = ctx.world.x;
  let y = ctx.world.y;
  var b = brightness
    + (vnoise(x * 0.16, y * 0.16, TEX) - 0.5) * 0.55
    + (vnoise(x * 0.45 + 7.0, y * 0.45, TEX) - 0.5) * 0.3
    + (vnoise(x * 1.05, y * 1.05 + 3.0, TEX) - 0.5) * 0.14;
  b = clamp(b, 0.0, 1.0);
  var colour = quantize_colour(bands, b, ctx.px, ctx.py);
  if (b > 0.6 && vnoise(x * 0.5 + 2.0, y * 0.5, TEX + 8u) < 0.4) { colour = rim_rock; }
  if (b > 0.25 && b < 0.72 && vnoise(x * 0.75, y * 0.75, TEX + 5u) > 0.86) { colour = bands[0]; }
  if (b > 0.88 && vnoise(x * 0.7, y * 0.5, TEX) > 0.6) { colour = rim_b; }
  return colour;
}

// palette.ts `metalSurface`.
fn metal_surface(ctx: ShadeCtx, bands: array<vec3f, 6>, blotch: f32, streak: f32) -> vec3f {
  var b = ctx.brightness;
  b += (vnoise(ctx.world.x * 0.09, ctx.world.y * 0.09, TEX) - 0.5) * blotch;
  b += (vnoise(ctx.world.x * 0.6, ctx.world.y * 0.13, TEX + 11u) - 0.5) * streak;
  return quantize_colour(bands, clamp(b, 0.0, 1.0), ctx.px, ctx.py);
}

// palette.ts `facetSurface`.
fn facet_surface(ctx: ShadeCtx, bands: array<vec3f, 6>, facet: f32) -> vec3f {
  let u = i32(floor((ctx.world.x * 0.92 + ctx.world.y * 0.38) / facet));
  let v = i32(floor((ctx.world.y * 0.92 - ctx.world.x * 0.3) / facet));
  let tone = (f32(hash_xy(u, v, 17u) & 255u) / 255.0 - 0.5) * 0.6;
  let grain = (vnoise(ctx.world.x * 0.6, ctx.world.y * 0.6, TEX + 3u) - 0.5) * 0.1;
  return quantize_colour(bands, clamp(ctx.brightness + tone + grain, 0.0, 1.0), ctx.px, ctx.py);
}

// palette.ts `glassSurface`.
fn glass_surface(ctx: ShadeCtx, bands: array<vec3f, 6>) -> vec3f {
  let b = clamp(ctx.brightness * 0.88 + (vnoise(ctx.world.x * 0.1, ctx.world.y * 0.1, TEX + 7u) - 0.5) * 0.14, 0.0, 1.0);
  return quantize_colour(bands, b, ctx.px, ctx.py);
}

// fx.ts `sparkle` (with its default 8 px cell): a sparse, world-anchored scatter of small star glints on
// well-lit pixels. Returns the glint in rgb with alpha 1, or alpha 0 where there's no glint.
fn sparkle(ctx: ShadeCtx, colour: vec3f, chance: f32, min_lit: f32) -> vec4f {
  let cell = 8;
  let lit = ctx.brightness;
  if (lit < min_lit) { return vec4f(0.0); }
  let wx = i32(ctx.world.x);
  let wy = i32(ctx.world.y);
  let block_x = floor_div(wx, cell);
  let block_y = floor_div(wy, cell);
  if (f32(hash_xy(block_x, block_y, 71u) & 1023u) / 1023.0 > chance) { return vec4f(0.0); }
  let margin = 2;
  let span = u32(max(1, cell - 2 * margin));
  let centre_x = block_x * cell + margin + i32(hash_xy(block_x, block_y, 72u) % span);
  let centre_y = block_y * cell + margin + i32(hash_xy(block_x, block_y, 73u) % span);
  let dx = abs(wx - centre_x);
  let dy = abs(wy - centre_y);
  let t = clamp((lit - min_lit) / (1.0 - min_lit), 0.0, 1.0);
  let size = select(1, 2, t > 0.72);
  let on_star = (dx == 0 && dy <= size) || (dy == 0 && dx <= size);
  if (!on_star) { return vec4f(0.0); }
  let arm = dx + dy;
  let intensity = select(select(0.6, 0.82, arm == 1), 1.0, arm == 0) * (0.55 + 0.45 * t);
  return vec4f(colour * intensity, 1.0);
}
