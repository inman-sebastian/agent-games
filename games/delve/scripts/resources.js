// resources.js — the DELVE entity RESOURCE REGISTRY. Every game entity (each depth
// stratum, each ore, and future types) lives in its own self-registering file under
// resources/*.js that calls DelveResources.register({...}). This module holds the
// registry + the shared procedural art helpers (crystal shapes) those files reuse.
//
// Works synchronously in every context with no build step: browser/Worker attach to
// `self`; Node sets module.exports AND auto-requires every resources/*.js so that simply
// requiring the registry populates it. Load order (browser): cave-render.js (art helpers
// depend on its rng), THEN resources.js, THEN the resource files, THEN blocks.js.
(function (root) {
  'use strict';

  const REG = {};          // type -> [def, …]
  const BY_ID = {};        // "type:id" -> def
  function register(def) {
    if (!def || def.type == null || def.id == null) throw new Error('resource needs {type,id}');
    (REG[def.type] || (REG[def.type] = [])).push(def);
    BY_ID[def.type + ':' + def.id] = def;
    return def;
  }
  // All registered defs of a type, in a stable gameplay order (ore by id, strata by depth).
  function all(type) {
    const list = (REG[type] || []).slice();
    if (type === 'ore') list.sort((a, b) => a.id - b.id);
    else if (type === 'strata') list.sort((a, b) => a.top - b.top);
    return list;
  }
  const byId = (type, id) => BY_ID[type + ':' + id] || null;

  // ---- shared procedural art helpers (crystal shapes) ------------------------------
  // Reused by ore resources' `art` (an ore declares { shape, c:[dark,mid,hi] } and the
  // renderer applies the matching shape). Each takes a `pen(a,b,w,h,color)` that fills one
  // rect in ABSOLUTE canvas coords, so they compose over any target. Kept procedural (the
  // metals get a per-ore seeded wobble; gems are faceted) — the resource just parameterises.
  const OUT = '#0a0912';                        // shared dark crystal outline
  const mul = (seed) => root.CaveRender.mulberry(seed);   // rng lives in cave-render (loaded first)

  function gem(pen, cx, cy, r, c) { if (r < 1) r = 1;
    for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx - w - 1, cy + dy, 1, 1, OUT); pen(cx + w + 1, cy + dy, 1, 1, OUT); }
    pen(cx, cy - r - 1, 1, 1, OUT); pen(cx, cy + r + 1, 1, 1, OUT);
    for (let dy = -r; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx - w, cy + dy, 2 * w + 1, 1, c[1]); }
    for (let dy = -r; dy <= 0; dy++) { const w = r - Math.abs(dy); pen(cx - w, cy + dy, w + 1, 1, c[2]); }
    for (let dy = 0; dy <= r; dy++) { const w = r - Math.abs(dy); pen(cx, cy + dy, w + 1, 1, c[0]); }
    pen(cx - 1, cy - r + 1, 1, 1, '#ffffff'); }
  function nugget(pen, cx, cy, r, c) { if (r < 1) r = 1; const R = r;
    let sd = 0; for (const ch of c[1]) sd = (sd * 31 + ch.charCodeAt(0)) >>> 0; const rnd = mul(sd || 1);
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
  const shapes = { gem, nugget, prism, shard, cluster };

  const DelveResources = { register, all, byId, shapes, OUT };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DelveResources;               // export BEFORE requiring children (circular-safe)
    const fs = require('fs'), path = require('path');   // Node: auto-load every resource file
    const dir = path.join(__dirname, '..', 'resources');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) require(path.join(dir, f));
  } else root.DelveResources = DelveResources;
})(typeof self !== 'undefined' ? self : this);
