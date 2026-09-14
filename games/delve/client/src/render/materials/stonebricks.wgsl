// stonebricks.wgsl — the WGSL twin of stonebricks.ts: a running-bond brick pattern over the shared
// stone surface, keyed on world pixels so courses line up across cells. STONEBRICKS_BANDS, _RIM_B,
// _RIM_ROCK and _MORTAR are generated from its TypeScript registration (docs/MATERIALS.md, "GPU twins").

const BRICK_W: i32 = 16; // one block wide
const BRICK_H: i32 = 8;  // half a block tall: two courses per block
const MORTAR_PX: i32 = 1;

fn shade_stonebricks(ctx: ShadeCtx) -> vec3f {
  let wx = i32(floor(ctx.world.x));
  let wy = i32(floor(ctx.world.y));
  let course = floor_div(wy, BRICK_H);
  let offset = select(0, BRICK_W / 2, (course & 1) == 1); // running bond: alternate courses shift
  let y_in_course = ((wy % BRICK_H) + BRICK_H) % BRICK_H;
  let bx = wx + offset;
  let x_in_brick = ((bx % BRICK_W) + BRICK_W) % BRICK_W;

  // mortar recesses, darkened, lit by the geometric light
  if (y_in_course < MORTAR_PX || x_in_brick < MORTAR_PX) {
    let m = 0.4 + 0.4 * clamp(ctx.brightness, 0.0, 1.0);
    return STONEBRICKS_MORTAR * m;
  }

  // brick face: the stone texture, a small per-brick tint jitter, and a top-lit / bottom-shadowed bevel
  let brick_id = hash_xy(floor_div(bx, BRICK_W), course, 61u);
  let jitter = (f32(brick_id & 31u) / 31.0 - 0.5) * 0.14;
  let bevel = select(select(0.0, -0.12, y_in_course >= BRICK_H - 1), 0.16, y_in_course <= 1);
  return stone_surface(ctx, ctx.brightness + jitter + bevel, STONEBRICKS_BANDS, STONEBRICKS_RIM_B, STONEBRICKS_RIM_ROCK);
}
