// platinum.wgsl — the WGSL twin of platinum.ts. PLATINUM_BANDS and PLATINUM_SHEEN are generated from
// its TypeScript registration (docs/MATERIALS.md, "GPU twins").
fn shade_platinum(ctx: ShadeCtx) -> vec3f {
  // a bright, tight sheen on the best-lit faces — brighter and rarer than iron's or silver's
  if (ctx.brightness > 0.76 && vnoise(ctx.world.x * 0.6, ctx.world.y * 0.6, TEX + 41u) > 0.9) {
    return PLATINUM_SHEEN;
  }
  // soft satin: mid blotch, minimal streak
  return metal_surface(ctx, PLATINUM_BANDS, 0.34, 0.09);
}
