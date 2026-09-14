// iron.wgsl — the WGSL twin of iron.ts. IRON_BANDS and IRON_SHEEN are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_iron(ctx: ShadeCtx) -> vec3f {
  if (ctx.brightness > 0.78 && vnoise(ctx.world.x * 0.55, ctx.world.y * 0.55, TEX + 33u) > 0.9) {
    return IRON_SHEEN;
  }
  // rough, matte gunmetal: high blotch, coarse brushed grain
  return metal_surface(ctx, IRON_BANDS, 0.44, 0.16);
}
