// quartz.wgsl — the WGSL twin of quartz.ts. QUARTZ_BANDS and QUARTZ_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_quartz(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, QUARTZ_GLINT, 0.2, 0.58);
  if (glint.a > 0.0) { return glint.rgb; }
  // faceted crystal: cut planes instead of craggy rock
  return facet_surface(ctx, QUARTZ_BANDS, 5.0);
}
