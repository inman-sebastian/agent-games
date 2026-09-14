// mythril.wgsl — the WGSL twin of mythril.ts. MYTHRIL_BANDS and MYTHRIL_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_mythril(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, MYTHRIL_GLINT, 0.26, 0.55);
  if (glint.a > 0.0) { return glint.rgb; }
  // faceted crystal: cut planes instead of craggy rock
  return facet_surface(ctx, MYTHRIL_BANDS, 5.0);
}
