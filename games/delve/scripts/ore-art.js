// ore-art.js — draws an ore BLOCK (the full-cell crystalline mass in the world). The
// per-ore art (crystal shape + colour triad) and the shared crystal shapes now live in
// the resource registry (scripts/resources.js + resources/*.js); this module is the
// block renderer + a thin back-compat facade (ORE_ART / SHAPES) over the registry.
// Pure drawing over any 2D context; depends on cave-render.js's rng/noise helpers.
(function (root) {
  'use strict';
  const CR = root.CaveRender, R = root.DelveResources;
  const T = CR.T, TEX = CR.TEX, mulberry = CR.mulberry, hashXY = CR.hashXY, vnoise = CR.vnoise;
  const OUT = R.OUT, SHAPES = R.shapes;

  // ore art keyed by ore id, sourced from the ore resources: { shape, c:[dark,mid,hi], dim? }.
  const ORE_ART = {};
  for (const o of R.all('ore')) ORE_ART[o.id] = o.art;

  // Draw an ore BLOCK into 2D context `g`: the tile is (col,row) with top-left pixel
  // (X,Y), damage `frac` in 0..1. `sameOre(dc,dr)` returns whether the neighbour is part
  // of the SAME ore node — so a pocket tiles into one crystalline MASS (Terraria-style).
  // World-anchored faceted fill; only cluster-boundary edges get the outline + top rim.
  function drawOreBlock(g, art, X, Y, col, row, frac, sameOre) {
    if (!art) return; const c = art.c, dark = c[0], mid = c[1], hi = c[2];
    const wx0 = col * T, wy0 = row * T;
    const px = (a, b, w, h, cc) => { g.fillStyle = cc; g.fillRect(X + a, Y + b, w || 1, h || 1); };
    px(0, 0, T, T, mid);
    for (let dy = 0; dy < T; dy++) for (let dx = 0; dx < T; dx++) {
      const wx = wx0 + dx, wy = wy0 + dy;
      const base = vnoise(wx * 0.5, wy * 0.5, TEX + 11), fine = vnoise(wx * 1.3 + 7, wy * 1.3, TEX + 12);
      let cc = base < 0.42 ? dark : base > 0.66 ? hi : mid;
      if (fine > 0.85) cc = hi; else if (fine < 0.13 && base < 0.6) cc = dark;
      if (cc !== mid) px(dx, dy, 1, 1, cc);
    }
    if (frac > 0.15) { const cr = mulberry(hashXY(col, row, 91)), n = 1 + Math.floor(frac * 3);
      for (let k = 0; k < n; k++) { let a = cr() * 6.283, x = T / 2 + Math.cos(a) * 2, y = T / 2 + Math.sin(a) * 2; const steps = 2 + Math.floor(frac * 4);
        for (let s = 0; s < steps; s++) { if (x < 1 || x > T - 1 || y < 1 || y > T - 1) break; px(x | 0, y | 0, 1, 1, OUT); x += Math.cos(a); y += Math.sin(a); } } }
    const up = !sameOre(0, -1), dn = !sameOre(0, 1), lf = !sameOre(-1, 0), rt = !sameOre(1, 0);
    if (up) { for (let dx = 0; dx < T; dx++) if (vnoise((wx0 + dx) * 0.6, wy0 * 0.6, TEX + 13) > 0.35) px(dx, 1, 1, 1, hi); }
    if (up) px(0, 0, T, 1, OUT);
    if (dn) px(0, T - 1, T, 1, OUT);
    if (lf) px(0, 0, 1, T, OUT);
    if (rt) px(T - 1, 0, 1, T, OUT);
  }

  root.DelveOre = { OUT, ORE_ART, SHAPES, drawOreBlock };
})(self);
