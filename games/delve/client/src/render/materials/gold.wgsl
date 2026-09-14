// gold.wgsl — the WGSL twin of gold.ts. GOLD_BANDS and GOLD_GLINT are generated from its TypeScript
// registration (docs/MATERIALS.md, "GPU twins").
fn shade_gold(ctx: ShadeCtx) -> vec3f {
  let glint = sparkle(ctx, GOLD_GLINT, 0.14, 0.66);
  if (glint.a > 0.0) { return glint.rgb; }
  // lustrous smooth metal (a touch of blotch keeps it from looking flat)
  return metal_surface(ctx, GOLD_BANDS, 0.34, 0.12);
}
