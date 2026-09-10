// ore-art.js — authored ore/gem crystals and the veins they're embedded in, shared
// by the game (index.html) and the style lab (style-lab.html) so the look can never
// drift between them. Pure drawing over any 2D context; depends only on the rng/noise
// helpers in cave-render.js. Attaches DelveOre to `self` (window or worker), matching
// cave-render.js's module pattern (no build step, works everywhere).
(function (root) {
  'use strict';
  const CR = root.CaveRender;
  const T = CR.T, TEX = CR.TEX, mulberry = CR.mulberry, hashXY = CR.hashXY, vnoise = CR.vnoise;
  const OUT = '#0a0912';                       // shared dark crystal outline

  // ore art, keyed by engine ore id: crystal shape + [dark, mid, highlight] triad.
  // `dim` ores (dirt) are plain clods that never glow.
  const ORE_ART = {
    1: { shape: 'nugget',  c: ['#48371f', '#6d5230', '#8f6b3c'], dim: true }, // Dirt clod
    2: { shape: 'nugget',  c: ['#7a3045', '#cd683d', '#f79617'] },            // Copper
    3: { shape: 'nugget',  c: ['#3e3546', '#7f708a', '#c7dcd0'] },            // Iron
    4: { shape: 'nugget',  c: ['#625565', '#9babb2', '#e8eef5'] },            // Silver
    5: { shape: 'nugget',  c: ['#4c3e24', '#f9c22b', '#fbff86'] },            // Gold
    6: { shape: 'prism',   c: ['#165a4c', '#1ebc73', '#91db69'] },            // Emerald
    7: { shape: 'cluster', c: ['#831c5d', '#f04f78', '#f68181'] },            // Ruby
    8: { shape: 'gem',     c: ['#0b8a8f', '#30e1b9', '#8ff8e2'] },            // Diamond
    9: { shape: 'shard',   c: ['#484a77', '#905ea9', '#a884f3'] },            // Mythril
  };

  // crystal shapes — symmetric, centred, ~±(r+1) footprint. Each takes a `pen(a,b,w,h,
  // color)` that draws one rect in ABSOLUTE canvas coords, so they work over any target.
  function gem(pen, cx, cy, r, c) { if (r < 1) r = 1;
    for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx - w - 1, cy + dy, 1, 1, OUT); pen(cx + w + 1, cy + dy, 1, 1, OUT); }
    pen(cx, cy - r - 1, 1, 1, OUT); pen(cx, cy + r + 1, 1, 1, OUT);
    for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx - w, cy + dy, 2 * w + 1, 1, c[1]); }
    for (let dy = -r; dy <= 0; dy++) { const w = r - Math.abs(dy); pen(cx - w, cy + dy, w + 1, 1, c[2]); }
    for (let dy = 0; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx, cy + dy, w + 1, 1, c[0]); }
    pen(cx - 1, cy - r + 1, 1, 1, '#ffffff'); }
  function nugget(pen, cx, cy, r, c) { if (r < 1) r = 1; const R = r;
    let sd = 0; for (const ch of c[1]) sd = (sd * 31 + ch.charCodeAt(0)) >>> 0; const rnd = mulberry(sd || 1);
    const a1 = rnd() * 6.283, a2 = rnd() * 6.283, a3 = rnd() * 6.283;
    const rad = (dx, dy) => { const a = Math.atan2(dy, dx), up = Math.max(0, -Math.sin(a));
      return R * (1 + 0.05 * up + 0.08 * Math.sin(2 * a + a1) + 0.11 * Math.sin(3 * a + a2) + 0.07 * Math.sin(5 * a + a3)); };
    for (let dy = -r - 2; dy <= r + 2; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) { if (Math.hypot(dx, dy) <= rad(dx, dy) + 1.0) pen(cx + dx, cy + dy, 1, 1, OUT); }
    for (let dy = -r - 2; dy <= r + 2; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) { if (Math.hypot(dx, dy) <= rad(dx, dy)) pen(cx + dx, cy + dy, 1, 1, (dx + dy) < -r * 0.3 ? c[2] : (dx + dy) > r * 0.6 ? c[0] : c[1]); }
    const hx = cx - Math.round(r * 0.35), hy = cy - Math.round(r * 0.45);
    pen(hx, hy, 1, 1, c[2]); pen(hx + 1, hy, 1, 1, c[2]); pen(hx, hy + 1, 1, 1, c[2]);
    pen(hx, hy, 1, 1, '#ffffff'); pen(hx + 1, hy, 1, 1, '#ffffff'); }
  function prism(pen, cx, cy, r, c) { const w = r, h = r; const ww = dy => (dy < -h + 2 || dy > h - 2) ? Math.max(0, w - 2) : w;
    for (let dy = -h - 1; dy <= h + 1; dy++) { const a = ww(Math.max(-h, Math.min(h, dy))); pen(cx - a - 1, cy + dy, 1, 1, OUT); pen(cx + a + 1, cy + dy, 1, 1, OUT); }
    pen(cx, cy - h - 1, 1, 1, OUT); pen(cx, cy + h + 1, 1, 1, OUT);
    for (let dy = -h; dy <= h; dy++) { const a = ww(dy); pen(cx - a, cy + dy, 2 * a + 1, 1, c[1]); }
    for (let dy = -h; dy <= h; dy++) { const a = ww(dy); pen(cx - a, cy + dy, a, 1, c[2]); pen(cx + 1, cy + dy, a, 1, c[0]); }
    pen(cx - 1, cy - h + 1, 1, 1, '#ffffff'); }
  function shardTall(pen, x, y, h, w, c) {
    for (let dy = -h; dy <= h; dy++) { const t = 1 - Math.abs(dy) / (h + 0.6), ww = Math.max(0, Math.round(w * t));
      pen(x - ww - 1, y + dy, 1, 1, OUT); pen(x + ww + 1, y + dy, 1, 1, OUT);
      pen(x - ww, y + dy, 2 * ww + 1, 1, c[1]); pen(x - ww, y + dy, ww, 1, c[2]); }
    pen(x, y - h - 1, 1, 1, OUT); pen(x, y + h + 1, 1, 1, OUT); pen(x - 1, y - h + 1, 1, 1, '#ffffff'); }
  function shard(pen, cx, cy, r, c) {
    shardTall(pen, cx - (r - 1), cy, Math.max(1, r - 2), 1, c);
    shardTall(pen, cx + (r - 1), cy, Math.max(1, r - 2), 1, c);
    shardTall(pen, cx, cy, r, Math.max(1, r - 3), c); }
  function cluster(pen, cx, cy, r, c) { const rs = Math.max(1, r - 2);
    gem(pen, cx - 2, cy + 2, rs, c); gem(pen, cx + 2, cy + 2, rs, c); gem(pen, cx, cy - 1, Math.max(1, r - 1), c); }
  const SHAPES = { gem, nugget, prism, shard, cluster };

  // Draw an ore BLOCK into 2D context `g`: the tile is (col,row) with top-left pixel
  // (X,Y), damage `frac` in 0..1. `sameOre(dc,dr)` returns whether the neighbour at
  // (col+dc,row+dr) is part of the SAME ore node — so a pocket of adjacent cells tiles
  // into one crystalline MASS (Terraria-style) rather than a per-cell centred crystal.
  //
  // The body is a world-anchored faceted crystal fill (its noise is keyed to world
  // coords, so it flows continuously across cells). Only CLUSTER-BOUNDARY edges (where
  // the neighbour isn't the same ore) get the dark outline + a top rim highlight —
  // internal cell seams are invisible, so the whole node reads as a single block. There
  // is no reveal: the block simply *is* ore; damage shows as spreading cracks.
  function drawOreBlock(g, art, X, Y, col, row, frac, sameOre) {
    if (!art) return; const c = art.c, dark = c[0], mid = c[1], hi = c[2];
    const wx0 = col * T, wy0 = row * T;
    const px = (a, b, w, h, cc) => { g.fillStyle = cc; g.fillRect(X + a, Y + b, w || 1, h || 1); };
    // crystalline body — base fill + world-anchored facet pixels (only non-base drawn)
    px(0, 0, T, T, mid);
    for (let dy = 0; dy < T; dy++) for (let dx = 0; dx < T; dx++) {
      const wx = wx0 + dx, wy = wy0 + dy;
      const base = vnoise(wx * 0.5, wy * 0.5, TEX + 11), fine = vnoise(wx * 1.3 + 7, wy * 1.3, TEX + 12);
      let cc = base < 0.42 ? dark : base > 0.66 ? hi : mid;
      if (fine > 0.85) cc = hi; else if (fine < 0.13 && base < 0.6) cc = dark;
      if (cc !== mid) px(dx, dy, 1, 1, cc);
    }
    // cracks as damage rises (the block is ore — no crystal reveal)
    if (frac > 0.15) { const cr = mulberry(hashXY(col, row, 91)), n = 1 + Math.floor(frac * 3);
      for (let k = 0; k < n; k++) { let a = cr() * 6.283, x = T / 2 + Math.cos(a) * 2, y = T / 2 + Math.sin(a) * 2; const steps = 2 + Math.floor(frac * 4);
        for (let s = 0; s < steps; s++) { if (x < 1 || x > T - 1 || y < 1 || y > T - 1) break; px(x | 0, y | 0, 1, 1, OUT); x += Math.cos(a); y += Math.sin(a); } } }
    // cluster-boundary edges only: top rim highlight (inside), then dark outline (edge)
    const up = !sameOre(0, -1), dn = !sameOre(0, 1), lf = !sameOre(-1, 0), rt = !sameOre(1, 0);
    if (up) { for (let dx = 0; dx < T; dx++) if (vnoise((wx0 + dx) * 0.6, wy0 * 0.6, TEX + 13) > 0.35) px(dx, 1, 1, 1, hi); }
    if (up) px(0, 0, T, 1, OUT);
    if (dn) px(0, T - 1, T, 1, OUT);
    if (lf) px(0, 0, 1, T, OUT);
    if (rt) px(T - 1, 0, 1, T, OUT);
  }

  root.DelveOre = { OUT, ORE_ART, SHAPES, drawOreBlock };
})(self);
