// ruby.wgsl — the WGSL twin of ruby.ts. RUBY_BANDS and RUBY_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_ruby(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, RUBY_GLINT, 0.2, 0.6);
  if (glint.a > 0.0) { return glint.rgb; }
  // faceted crystal: cut planes instead of craggy rock
  return facet_surface(ctx, RUBY_BANDS, 5.0);
}
