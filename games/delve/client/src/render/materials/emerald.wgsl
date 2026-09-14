// emerald.wgsl — the WGSL twin of emerald.ts. EMERALD_BANDS and EMERALD_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_emerald(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, EMERALD_GLINT, 0.24, 0.56);
  if (glint.a > 0.0) { return glint.rgb; }
  // faceted crystal: cut planes instead of craggy rock
  return facet_surface(ctx, EMERALD_BANDS, 5.0);
}
