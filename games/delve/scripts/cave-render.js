// cave-render.js — the shared DELVE rock renderer. Pure, no game state: given a
// `solidTile(c,r)` predicate and a world window, it composites the layered cave
// (background + top-lit rock + sky + stalactites) into a 2D context. Imported by
// BOTH the main thread (index.html, for cheap per-dig patches) and the chunk
// Worker (chunk-worker.js, for off-thread full-chunk generation) so the look can
// never drift between the two. Attaches `CaveRender` to `self` (window or worker).
(function (root) {
  'use strict';
  const T = 16, TEX = 90210;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgbHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const desat = (h, t) => { const c = hexRgb(h), g = c[0] * .3 + c[1] * .59 + c[2] * .11; return rgbHex(c.map(v => v + (g - v) * t)); };
  const mulberry = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const hashXY = (x, y, sd) => (((x * 73856093) ^ (y * 19349663) ^ ((sd || 0) * 83492791)) >>> 0);
  function vnoise(x, y, sd) { const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
    const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + sd * 362437) >>> 0; n = Math.imul(n ^ n >>> 13, 1274126177) >>> 0; return ((n ^ n >>> 16) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t), au = sm(tx), av = sm(ty), a = h(fx, fy), b = h(fx + 1, fy), c = h(fx, fy + 1), d = h(fx + 1, fy + 1);
    return (a * (1 - au) + b * au) * (1 - av) + (c * (1 - au) + d * au) * av; }

  // depth strata → an interpolated 6-stop Resurrect-64 ramp, so colour reads by depth
  const STRATA = [
    { top: 1,   ramp: ['#2e222f', '#45293f', '#7a3045', '#9e4539', '#cd683d', '#e6904e'] }, // topsoil (red-brown)
    { top: 12,  ramp: ['#2a2018', '#48371f', '#6d5230', '#8f6b3c', '#b28a4e', '#d0aa66'] }, // clay (ochre)
    { top: 42,  ramp: ['#2e222f', '#3e3546', '#625565', '#7f708a', '#9babb2', '#c7dcd0'] }, // stone (gray)
    { top: 95,  ramp: ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff'] }, // deep stone (blue)
    { top: 185, ramp: ['#2e222f', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded'] }, // basalt (violet)
  ];
  const smoothstep = t => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
  function rampAt(row) {
    let i = 0; while (i < STRATA.length - 1 && row >= STRATA[i + 1].top) i++;
    const a = STRATA[i], b = STRATA[Math.min(i + 1, STRATA.length - 1)];
    if (a === b) return a.ramp.slice();
    const t = smoothstep((row - a.top) / (b.top - a.top));
    return a.ramp.map((h, k) => mix(h, b.ramp[k], t));
  }
  function colorsFor(R) { const C = {
      rimB: desat(R[5], 0.22), rimA: desat(R[4], 0.28), lit: desat(R[3], 0.15), body2: R[2], body: R[1], deep: R[0],
      center: mix(R[0], '#000000', 0.4), rimRock: desat(mix(R[4], R[2], 0.45), 0.35) };
    const o = {}; for (const k in C) o[k] = hexRgb(C[k]); return o; }
  function bgFor(R) { const base = desat(mix(R[1], '#4a4864', 0.64), 0.52);
    return { top: mix(base, '#585672', 0.18), bot: mix(base, '#171525', 0.5), sil: mix(base, '#000000', 0.3) }; }

  // chamfer distance transform (edge distance & AO)
  function distField(src, PW, PH, oob) { const INF = 1e6, d = new Float32Array(PW * PH);
    for (let i = 0; i < d.length; i++) d[i] = src(i) ? 0 : INF;
    const at = (x, y) => (x < 0 || x >= PW || y < 0 || y >= PH) ? oob : d[y * PW + x];
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) { const i = y * PW + x; if (d[i] === 0) continue; d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414); }
    for (let y = PH - 1; y >= 0; y--) for (let x = PW - 1; x >= 0; x--) { const i = y * PW + x; if (d[i] === 0) continue; d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414); }
    return d; }

  // per-pixel solidity field, with gently eroded (organic) edges; noise in WORLD space
  function buildMask(solidTile, PW, PH, bandLeft, bandTop) { const ox = bandLeft * T, oy = bandTop * T, mask = new Uint8Array(PW * PH);
    for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) { const tx = bandLeft + ((px / T) | 0), ty = bandTop + ((py / T) | 0);
      if (!solidTile(tx, ty)) { mask[py * PW + px] = 0; continue; }
      const lx = px % T, ly = py % T; let dmin = 99;
      if (!solidTile(tx, ty - 1)) dmin = Math.min(dmin, ly + 0.5);
      if (!solidTile(tx, ty + 1)) dmin = Math.min(dmin, (T - 1 - ly) + 0.5);
      if (!solidTile(tx - 1, ty)) dmin = Math.min(dmin, lx + 0.5);
      if (!solidTile(tx + 1, ty)) dmin = Math.min(dmin, (T - 1 - lx) + 0.5);
      if (!solidTile(tx - 1, ty - 1)) dmin = Math.min(dmin, Math.hypot(lx + 0.5, ly + 0.5));
      if (!solidTile(tx + 1, ty - 1)) dmin = Math.min(dmin, Math.hypot(T - lx - 0.5, ly + 0.5));
      if (!solidTile(tx - 1, ty + 1)) dmin = Math.min(dmin, Math.hypot(lx + 0.5, T - ly - 0.5));
      if (!solidTile(tx + 1, ty + 1)) dmin = Math.min(dmin, Math.hypot(T - lx - 0.5, T - ly - 0.5));
      const thr = 0.4 + 1.4 * vnoise((ox + px) * 0.28, (oy + py) * 0.28, TEX + 2);
      mask[py * PW + px] = dmin > thr ? 1 : 0; }
    return mask; }

  // foreground rock → a canvas (alpha layer): top-lit, dark-bodied, organic edges
  let _fc = null, _fx = null;
  function shadeRock(solidTile, PW, PH, C, bandLeft, bandTop) {
    const ox = bandLeft * T, oy = bandTop * T;
    const mask = buildMask(solidTile, PW, PH, bandLeft, bandTop);
    const openAt = (x, y) => (x < 0 || x >= PW || y < 0 || y >= PH) ? 0 : (mask[y * PW + x] ? 0 : 1);
    const rock = distField(i => mask[i] === 1, PW, PH, 0);
    const edge = distField(i => mask[i] === 0, PW, PH, 1e6);
    const top = new Float32Array(PW * PH);
    for (let x = 0; x < PW; x++) { const wc = bandLeft + ((x / T) | 0); let sa = 0; for (let k = 1; k <= 12; k++) { if (solidTile(wc, bandTop - k)) sa++; else break; }
      let depth = sa >= 12 ? 1e6 : sa * T;
      for (let y = 0; y < PH; y++) { if (openAt(x, y)) depth = 0; top[y * PW + x] = depth; depth++; } }
    const LV = [C.center, C.deep, C.body, C.body2, C.lit, C.rimA];
    if (!_fc || _fc.width !== PW || _fc.height !== PH) { _fc = makeCanvas(PW, PH); _fx = _fc.getContext('2d'); _fx.imageSmoothingEnabled = false; }
    const img = _fx.createImageData(PW, PH), d = img.data;
    const set = (i, c, a) => { const j = i * 4; d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = a; };
    for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) { const i = py * PW + px, wx = ox + px, wy = oy + py;
      if (mask[i]) { const ed = edge[i], td = top[i];
        const range = (td <= ed + 0.8) ? 6.0 : 3.8; let L = 1 - ed / range;
        L += (vnoise(wx * 0.16, wy * 0.16, TEX) - 0.5) * 0.55 + (vnoise(wx * 0.45 + 7, wy * 0.45, TEX) - 0.5) * 0.30 + (vnoise(wx * 1.05, wy * 1.05 + 3, TEX) - 0.5) * 0.14;
        L = clamp01(L);
        const f = L * 5, lo = f | 0, b = (BAYER[(px & 3) | ((py & 3) << 2)] + 0.5) / 16;
        let c = LV[Math.min(5, lo + ((f - lo) > b ? 1 : 0))];
        if (L > 0.6 && vnoise(wx * 0.5 + 2, wy * 0.5, TEX + 8) < 0.40) c = C.rimRock;
        if (L > 0.25 && L < 0.72 && vnoise(wx * 0.75, wy * 0.75, TEX + 5) > 0.86) c = C.center;
        if (L > 0.88 && vnoise(wx * 0.7, wy * 0.5, TEX) > 0.6) c = C.rimB;
        set(i, c, 255);
      } else { const dr = rock[i];
        if (dr < 1.4) set(i, [0, 0, 0], 105); else if (dr < 2.7) set(i, [0, 0, 0], 48); else set(i, [0, 0, 0], 0);
      } }
    _fx.putImageData(img, 0, 0);
    return _fc;
  }

  // Compose bg + rock + sky + stalactites for a world rectangle into 2D context `g`
  // (destination top-left, PW×PH). `solidTile(c,r)` is the world solidity predicate.
  function composeBand(g, solidTile, bandLeft, bandTop, colsW, rowsH, W, SURFACE) {
    const PW = colsW * T, PH = rowsH * T, ox = bandLeft * T, oy = bandTop * T;
    const R = rampAt(Math.max(1, bandTop + (rowsH >> 1))), C = colorsFor(R), BG = bgFor(R);
    // background: flat midpoint fill (so cached chunks meet seamlessly) + world-anchored silhouettes
    g.fillStyle = mix(BG.top, BG.bot, 0.5); g.fillRect(0, 0, PW, PH);
    g.fillStyle = BG.sil;
    for (let py = 0; py < PH; py += 2) for (let px = 0; px < PW; px += 2) { if (vnoise((ox + px) * 0.045, (oy + py) * 0.06, TEX + 50) < 0.42) g.fillRect(px, py, 2, 2); }
    // foreground rock
    g.drawImage(shadeRock(solidTile, PW, PH, C, bandLeft, bandTop), 0, 0);
    // sky fills the open space above the ground (world y < row 1)
    const skyBot = (SURFACE + 1) * T;
    if (oy < skyBot) for (let py = 0; py < PH; py++) { const wy = oy + py; if (wy >= skyBot) break;
      g.fillStyle = mix('#0e1830', '#6a86b4', clamp01((wy - oy) / (skyBot - oy))); g.fillRect(0, py, PW, 1); }
    // stalactites / stalagmites where open tiles meet rock
    const pen = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w || 1, h || 1); };
    for (let ty = Math.max(SURFACE + 1, bandTop); ty < bandTop + rowsH; ty++) for (let tx = bandLeft; tx < bandLeft + colsW; tx++) {
      if (tx < 0 || tx >= W || solidTile(tx, ty)) continue; const X = (tx - bandLeft) * T, Y = (ty - bandTop) * T;
      if (solidTile(tx, ty - 1) && hashXY(tx, ty, 21) % 3 === 0) { const cx = X + (T >> 1) + (hashXY(tx, ty, 22) % 5 - 2), len = 3 + hashXY(tx, ty, 23) % 4;
        for (let i = 0; i < len; i++) { const w = Math.max(0, Math.round((len - i) / 2.2)); pen(cx - w, Y + i, 2 * w + 1, 1, rgbHex(i < 2 ? C.center : C.deep)); }
        pen(cx, Y, 1, 1, rgbHex(C.rimA)); }
      if (solidTile(tx, ty + 1) && hashXY(tx, ty, 24) % 4 === 0) { const cx = X + (T >> 1) + (hashXY(tx, ty, 25) % 5 - 2), len = 2 + hashXY(tx, ty, 26) % 3;
        for (let i = 0; i < len; i++) { const w = Math.max(0, Math.round((len - i) / 2.2)); pen(cx - w, Y + T - 1 - i, 2 * w + 1, 1, rgbHex(i < 1 ? C.center : C.deep)); } } }
  }

  root.CaveRender = { T, TEX, STRATA, composeBand, hexRgb, rgbHex, mix, desat, mulberry, hashXY, vnoise, clamp01, rampAt, colorsFor, bgFor };
})(self);
