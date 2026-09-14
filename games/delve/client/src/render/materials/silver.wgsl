// silver.wgsl — the WGSL twin of silver.ts. SILVER_BANDS and SILVER_SHEEN are generated from its
// TypeScript registration (docs/MATERIALS.md, "GPU twins").
fn shade_silver(ctx: ShadeCtx) -> vec3f {
  // a brighter, tighter sheen than iron (silver catches light harder)
  if (ctx.brightness > 0.72 && vnoise(ctx.world.x * 0.6, ctx.world.y * 0.6, TEX + 27u) > 0.88) {
    return SILVER_SHEEN;
  }
  // near-mirror polish: low blotch, fine brushed grain
  return metal_surface(ctx, SILVER_BANDS, 0.26, 0.13);
}
