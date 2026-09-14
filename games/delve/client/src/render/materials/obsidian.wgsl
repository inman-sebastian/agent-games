// obsidian.wgsl — the WGSL twin of obsidian.ts. OBSIDIAN_BANDS and OBSIDIAN_GLINT are generated from
// its TypeScript registration (docs/MATERIALS.md, "GPU twins").
fn shade_obsidian(ctx: ShadeCtx) -> vec3f {
  // glassy specular: sharp cool glints on only the brightest faces; otherwise near-black glass
  let glint = sparkle(ctx, OBSIDIAN_GLINT, 0.14, 0.72);
  if (glint.a > 0.0) { return glint.rgb; }
  return glass_surface(ctx, OBSIDIAN_BANDS);
}
