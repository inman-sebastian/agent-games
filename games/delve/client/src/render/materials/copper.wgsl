// copper.wgsl — the WGSL twin of copper.ts. COPPER_BANDS and COPPER_SHEEN are generated from its
// TypeScript registration (docs/MATERIALS.md, "GPU twins").
fn shade_copper(ctx: ShadeCtx) -> vec3f {
  // a broad, low-frequency warm sheen on the best-lit faces — duller and more common than gold's
  if (ctx.brightness > 0.74 && vnoise(ctx.world.x * 0.5, ctx.world.y * 0.5, TEX + 21u) > 0.86) {
    return COPPER_SHEEN;
  }
  return metal_surface(ctx, COPPER_BANDS, 0.42, 0.14);
}
