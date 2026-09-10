// lighting.js — the geometry-aware lighting system, shared by the game (index.html)
// and the style lab's cave sample so the two light identically. It knows nothing about
// game state: the caller creates an instance, pushes emitters via addLight(), then
// calls render(cfg) with the viewport + a solidTile() predicate. Attaches DelveLighting
// to `self`, matching the other modules' pattern.
//
// One independent system: every light source — the miner's lamp, glowing ore veins,
// anything later — is an emitter and obeys the SAME rules. Light is OCCLUDED BY ROCK:
// emitters seed a world-space per-tile colour field, propagated across the visible tile
// window (Terraria's technique) — open/dug tiles conduct light (OPEN_ATTEN per step),
// solid rock absorbs it fast (ROCK_ATTEN). So light pools down the tunnels you've carved
// and dies a couple tiles into rock; the lit region takes the SHAPE of the dug space,
// not a circle. The tile field is bilinear-sampled per pixel and composited as a smooth
// additive colour glow (warm lamp, coloured ore) + a DITHERED darkness scrim (pixel-art
// fog) derived from the same field, plus a shared dithered vignette.
//
// Emitters: addLight(x, y, r, colour, intensity), positions in WORLD pixels (the render
// cfg's camX/camY window the field around the view, so the grid stays small in an
// unbounded world).
//   r === 0  → lamp field (warm, drives the darkness scrim / visibility).
//   r  >  0  → ore-glow field (its own colour, kept separate so the lamp can't swamp it,
//              added on top capped). Seed at the vein's EXPOSED face so it floods the
//              shaft, not the rock behind it (that's the caller's job — where to seed).
(function (root) {
  'use strict';
  const DSTEP = 10;                                     // dither steps for the darkness scrim + vignette
  const LBY = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];  // 4×4 ordered dither, same as the rock
  const AMB = [0.05, 0.05, 0.08];                       // ambient floor — unlit rock stays dim, faintly cool
  const SCRIM = [6, 7, 14];                             // colour the darkness fades toward (deep, cool)
  const ADD = 0.26;                                     // how strongly the light field shows as additive glow
  const ADD_MAX = 0.5;                                  // ceiling on TOTAL additive per channel (lamp+ore) — no blown sunspot where they overlap
  const LAMP_COLOR = [1.0, 0.72, 0.42];                 // warm lantern
  const OPEN_ATTEN = 0.70, ROCK_ATTEN = 0.45;           // per-step light conduction: open tunnel vs solid rock
  const LMARGIN = 2;                                    // extra tile rows above/below the view for clean edges
  const ORE_GLOW = 1.6;                                 // ore-glow seed strength (r>0 emitters flood their colour into open space)
  const GLOW_CAP = 0.42;                                // per-channel ceiling on ore glow (max-propagated already, this is the safety)

  function create() {
    let LIGHTS = [], lightCount = 0;
    const addLight = (x, y, r, col, i) => LIGHTS.push({ x, y, r, cr: col[0], cg: col[1], cb: col[2], i });

    const addCv = document.createElement('canvas'), addX = addCv.getContext('2d');
    const scrimCv = document.createElement('canvas'), scrimX = scrimCv.getContext('2d');
    const vigCv = document.createElement('canvas'), vigX = vigCv.getContext('2d');
    let addImg = null, scrimImg = null, accW = 0, accH = 0, vigW = 0, vigH = 0;
    let gxCol = null, txCol = null, tx1Col = null;   // per-x bilinear setup, precomputed once per frame
    let tR = null, tG = null, tB = null, gw = 0, gh = 0;  // lamp field (max-propagated)
    let ogR = null, ogG = null, ogB = null;              // ore-glow field (own colour, occlusion-aware)

    // shared vignette — dithered, screen-space, unchanging → build once per size, blit each frame
    function ensureVignette(LW, LH) {
      if (vigW === LW && vigH === LH) return;
      vigW = LW; vigH = LH; vigCv.width = LW; vigCv.height = LH; vigX.imageSmoothingEnabled = false;
      const vigImg = vigX.createImageData(LW, LH), vd = vigImg.data;
      const ccx = LW / 2, ccy = LH / 2, vigIn = LH * 0.34, vigSpan = LH * 0.48;
      for (let y = 0; y < LH; y++) { const dy = y - ccy;
        for (let x = 0; x < LW; x++) { const dx = x - ccx, dv = Math.sqrt(dx * dx + dy * dy), bay = (LBY[(x & 3) | ((y & 3) << 2)] + 0.5) / 16;
          let vg = (dv - vigIn) / vigSpan; vg = vg < 0 ? 0 : vg > 1 ? 1 : vg; let v = vg * vg * (3 - 2 * vg) * 0.5;
          const fV = v * DSTEP, lV = fV | 0; v = (lV + ((fV - lV) > bay ? 1 : 0)) / DSTEP;
          const i = (y * LW + x) * 4; vd[i] = SCRIM[0]; vd[i + 1] = SCRIM[1]; vd[i + 2] = SCRIM[2]; vd[i + 3] = v * 255; } }
      vigX.putImageData(vigImg, 0, 0);
    }

    // cfg: { g, LW, LH, T, camX, camY, SURFACE, solidTile }. Consumes and clears the emitters.
    function render(cfg) {
      const g = cfg.g, LW = cfg.LW, LH = cfg.LH, T = cfg.T, camX = cfg.camX || 0, camY = cfg.camY || 0;
      const SURFACE = (cfg.SURFACE == null ? -1 : cfg.SURFACE), solidTile = cfg.solidTile;
      ensureVignette(LW, LH);
      if (accW !== LW || accH !== LH) { accW = LW; accH = LH;
        addCv.width = LW; addCv.height = LH; addX.imageSmoothingEnabled = false; addImg = addX.createImageData(LW, LH);
        scrimCv.width = LW; scrimCv.height = LH; scrimX.imageSmoothingEnabled = false; scrimImg = scrimX.createImageData(LW, LH);
        gxCol = new Int32Array(LW); txCol = new Float32Array(LW); tx1Col = new Float32Array(LW); }

      // ---- world-space per-tile light fields (windowed around the view) ----
      const tileTop = Math.floor(camY / T) - LMARGIN, tileLeft = Math.floor(camX / T) - LMARGIN;
      const rows = Math.ceil(LH / T) + 2 * LMARGIN, cols = Math.ceil(LW / T) + 2 * LMARGIN;
      if (cols !== gw || rows !== gh) { gw = cols; gh = rows;
        tR = new Float32Array(gw * gh); tG = new Float32Array(gw * gh); tB = new Float32Array(gw * gh);
        ogR = new Float32Array(gw * gh); ogG = new Float32Array(gw * gh); ogB = new Float32Array(gw * gh); }
      tR.fill(0); tG.fill(0); tB.fill(0); ogR.fill(0); ogG.fill(0); ogB.fill(0);
      // seed: lamp (r=0) → lamp field; ore veins (r>0) → ore-glow field, at their own tile
      let oreSeeded = false;   // skip the ore-glow field entirely when nothing seeds it (common)
      for (const L of LIGHTS) {
        const tc = Math.floor(L.x / T) - tileLeft, tr = Math.floor(L.y / T) - tileTop;
        if (tc < 0 || tc >= gw || tr < 0 || tr >= gh) continue;
        const idx = tr * gw + tc;
        if (L.r > 0) { ogR[idx] += L.cr * L.i * ORE_GLOW; ogG[idx] += L.cg * L.i * ORE_GLOW; ogB[idx] += L.cb * L.i * ORE_GLOW; oreSeeded = true; }
        else { tR[idx] += L.cr * L.i; tG[idx] += L.cg * L.i; tB[idx] += L.cb * L.i; }
      }
      // propagate — 4 corner sweeps, max-with-attenuation (attenuation = the DESTINATION
      // tile's opacity, so light dims hard the moment it enters rock). One round converges
      // because each sweep chains through already-updated neighbours in its direction.
      const attenAt = (x, gy) => solidTile(x + tileLeft, gy + tileTop) ? ROCK_ATTEN : OPEN_ATTEN;
      const relax = (i, from, a) => {
        let v = tR[from] * a; if (v > tR[i]) tR[i] = v; v = tG[from] * a; if (v > tG[i]) tG[i] = v; v = tB[from] * a; if (v > tB[i]) tB[i] = v;
        v = ogR[from] * a; if (v > ogR[i]) ogR[i] = v; v = ogG[from] * a; if (v > ogG[i]) ogG[i] = v; v = ogB[from] * a; if (v > ogB[i]) ogB[i] = v;
      };
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x, a = attenAt(x, y), ad2 = a * 0.9;   // TL→BR
        if (x > 0) relax(i, i - 1, a); if (y > 0) relax(i, i - gw, a); if (x > 0 && y > 0) relax(i, i - gw - 1, ad2); }
      for (let y = 0; y < gh; y++) for (let x = gw - 1; x >= 0; x--) { const i = y * gw + x, a = attenAt(x, y), ad2 = a * 0.9; // TR→BL
        if (x < gw - 1) relax(i, i + 1, a); if (y > 0) relax(i, i - gw, a); if (x < gw - 1 && y > 0) relax(i, i - gw + 1, ad2); }
      for (let y = gh - 1; y >= 0; y--) for (let x = gw - 1; x >= 0; x--) { const i = y * gw + x, a = attenAt(x, y), ad2 = a * 0.9; // BR→TL
        if (x < gw - 1) relax(i, i + 1, a); if (y < gh - 1) relax(i, i + gw, a); if (x < gw - 1 && y < gh - 1) relax(i, i + gw + 1, ad2); }
      for (let y = gh - 1; y >= 0; y--) for (let x = 0; x < gw; x++) { const i = y * gw + x, a = attenAt(x, y), ad2 = a * 0.9; // BL→TR
        if (x > 0) relax(i, i - 1, a); if (y < gh - 1) relax(i, i + gw, a); if (x > 0 && y < gh - 1) relax(i, i + gw - 1, ad2); }

      // ---- composite: bilinear-sample the tile field per pixel → additive glow + dithered scrim ----
      // The x-dependent bilinear setup (column index + weights) is the same for every row,
      // so precompute it once per frame; and skip the ore-glow field wholesale when unlit.
      const ad = addImg.data, sd = scrimImg.data, skyY = (SURFACE + 1) * T;
      for (let x = 0; x < LW; x++) {
        const fx = (x + camX) / T - tileLeft - 0.5; let gx = fx | 0; if (gx < 0) gx = 0; else if (gx > gw - 2) gx = gw - 2;
        const tx = fx - gx < 0 ? 0 : (fx - gx > 1 ? 1 : fx - gx);
        gxCol[x] = gx; txCol[x] = tx; tx1Col[x] = 1 - tx;
      }
      for (let y = 0; y < LH; y++) {
        const fy = (y + camY) / T - tileTop - 0.5;         // tile-space (values live at tile centres)
        let gy = fy | 0; if (gy < 0) gy = 0; else if (gy > gh - 2) gy = gh - 2;
        const ty = fy - gy < 0 ? 0 : (fy - gy > 1 ? 1 : fy - gy), ty1 = 1 - ty;
        const row0 = gy * gw, row1 = row0 + gw, rowJ = y * LW * 4;
        const aboveSky = (y + camY) <= skyY;
        for (let x = 0; x < LW; x++) {
          const j = rowJ + x * 4;
          const gx = gxCol[x], tx = txCol[x], tx1 = tx1Col[x];
          const a00 = row0 + gx, a10 = a00 + 1, a01 = row1 + gx, a11 = a01 + 1;
          const w00 = tx1 * ty1, w10 = tx * ty1, w01 = tx1 * ty, w11 = tx * ty;
          const r = tR[a00] * w00 + tR[a10] * w10 + tR[a01] * w01 + tR[a11] * w11 + AMB[0];
          const g2 = tG[a00] * w00 + tG[a10] * w10 + tG[a01] * w01 + tG[a11] * w11 + AMB[1];
          const b = tB[a00] * w00 + tB[a10] * w10 + tB[a01] * w01 + tB[a11] * w11 + AMB[2];
          let br = r > g2 ? (r > b ? r : b) : (g2 > b ? g2 : b);
          let sr = r * ADD, sg = g2 * ADD, sb = b * ADD;
          if (oreSeeded) {                                  // ore colour only where it exists
            let cr = ogR[a00] * w00 + ogR[a10] * w10 + ogR[a01] * w01 + ogR[a11] * w11; if (cr > GLOW_CAP) cr = GLOW_CAP;
            let cg = ogG[a00] * w00 + ogG[a10] * w10 + ogG[a01] * w01 + ogG[a11] * w11; if (cg > GLOW_CAP) cg = GLOW_CAP;
            let cb = ogB[a00] * w00 + ogB[a10] * w10 + ogB[a01] * w01 + ogB[a11] * w11; if (cb > GLOW_CAP) cb = GLOW_CAP;
            sr += cr; sg += cg; sb += cb;
            if (cr > br) br = cr; if (cg > br) br = cg; if (cb > br) br = cb;
          }
          // total additive (lamp warm + ore colour) capped so their overlap can't blow to a white sunspot
          if (sr > ADD_MAX) sr = ADD_MAX; if (sg > ADD_MAX) sg = ADD_MAX; if (sb > ADD_MAX) sb = ADD_MAX;
          ad[j] = sr * 255; ad[j + 1] = sg * 255; ad[j + 2] = sb * 255; ad[j + 3] = 255;
          if (br > 1) br = 1;
          const bay = (LBY[(x & 3) | ((y & 3) << 2)] + 0.5) / 16;
          let dark = aboveSky ? 0 : (1 - br) * 0.85; const fD = dark * DSTEP, lD = fD | 0; dark = (lD + ((fD - lD) > bay ? 1 : 0)) / DSTEP;
          sd[j] = SCRIM[0]; sd[j + 1] = SCRIM[1]; sd[j + 2] = SCRIM[2]; sd[j + 3] = dark * 255;
        }
      }
      addX.putImageData(addImg, 0, 0); scrimX.putImageData(scrimImg, 0, 0);
      g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(addCv, 0, 0); g.restore();
      g.drawImage(scrimCv, 0, 0);                         // dithered darkness
      g.drawImage(vigCv, 0, 0);                           // shared vignette frame
      lightCount = LIGHTS.length; LIGHTS.length = 0;      // reset emitters for next frame
    }

    return { addLight, render, LAMP_COLOR, get count() { return lightCount; } };
  }

  root.DelveLighting = { create, LAMP_COLOR };
})(self);
