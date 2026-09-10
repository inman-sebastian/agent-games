// chunk-worker.js — generates rectangular rock chunks off the main thread so moving
// through fresh world never stalls the game loop. Uses the SAME renderer as the main
// thread (cave-render.js) into an OffscreenCanvas, and ships the finished chunk back as
// a transferable ImageBitmap (zero-copy). The world is unbounded in both axes, so a
// chunk is a CW×CH tile tile-block addressed by (cx, cy); rock shape depends only on dug
// state, so each request carries the dug tiles overlapping the chunk's region.
// Only the renderer is needed here (no world queries) — the strata palette is posted in
// the init message, so the Worker doesn't load the entity registry.
importScripts('cave-render.js');

let cfg = { T: 16, CW: 12, CH: 6, SURFACE: 0, MARGIN: 1 };
let scratch = null, sctx = null, core = null, cctx = null;

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { cfg = m.cfg; CaveRender.setStrata(cfg.strata); return; }
  if (m.type !== 'chunk') return;

  const { T, CW, CH, SURFACE, MARGIN } = cfg;
  const PW = (CW + 2 * MARGIN) * T, PH = (CH + 2 * MARGIN) * T, coreW = CW * T, coreH = CH * T;
  if (!scratch || scratch.width !== PW || scratch.height !== PH) {
    scratch = new OffscreenCanvas(PW, PH); sctx = scratch.getContext('2d'); sctx.imageSmoothingEnabled = false;
    core = new OffscreenCanvas(coreW, coreH); cctx = core.getContext('2d'); cctx.imageSmoothingEnabled = false;
  }
  const dug = m.dug;               // Set of "c,r" keys dug within this chunk's region
  const solidTile = (c, r) => r > SURFACE && !dug.has(c + ',' + r);

  const bandLeft = m.cx * CW - MARGIN, bandTop = m.cy * CH - MARGIN;
  CaveRender.composeBand(sctx, solidTile, bandLeft, bandTop, CW + 2 * MARGIN, CH + 2 * MARGIN, Infinity, SURFACE);
  cctx.clearRect(0, 0, coreW, coreH);
  cctx.drawImage(scratch, MARGIN * T, MARGIN * T, coreW, coreH, 0, 0, coreW, coreH);   // drop the margin, keep the core
  const bmp = core.transferToImageBitmap();
  postMessage({ cx: m.cx, cy: m.cy, bmp }, [bmp]);
};
