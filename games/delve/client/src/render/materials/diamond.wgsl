// diamond.wgsl — the WGSL twin of diamond.ts. DIAMOND_BANDS and DIAMOND_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_diamond(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, DIAMOND_GLINT, 0.3, 0.5);
  if (glint.a > 0.0) { return glint.rgb; }
  // faceted crystal: cut planes instead of craggy rock
  return facet_surface(ctx, DIAMOND_BANDS, 6.0);
}
