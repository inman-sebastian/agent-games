// chunk-worker.js — generates full rock chunks off the main thread so first-time
// descent never stalls the game loop. Uses the SAME renderer as the main thread
// (cave-render.js) into an OffscreenCanvas, and ships the finished chunk back as a
// transferable ImageBitmap (zero-copy). Rock shape depends only on dug state, so
// each request carries the dug tiles overlapping the chunk's region.
importScripts('blocks.js', 'cave-render.js');

let cfg = { T: 16, W: 21, SURFACE: 0, CHUNK: 4, MARGIN: 1 };
let scratch = null, sctx = null, core = null, cctx = null;

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { cfg = m.cfg; return; }
  if (m.type !== 'chunk') return;

  const { T, W, SURFACE, CHUNK, MARGIN } = cfg;
  const PW = W * T, PH = (CHUNK + 2 * MARGIN) * T, coreH = CHUNK * T;
  if (!scratch || scratch.width !== PW || scratch.height !== PH) {
    scratch = new OffscreenCanvas(PW, PH); sctx = scratch.getContext('2d'); sctx.imageSmoothingEnabled = false;
    core = new OffscreenCanvas(PW, coreH); cctx = core.getContext('2d'); cctx.imageSmoothingEnabled = false;
  }
  const dug = m.dug;               // Set of "c,r" keys dug within this chunk's region
  const solidTile = (c, r) => (c < 0 || c >= W) ? true : (r > SURFACE && !dug.has(c + ',' + r));

  CaveRender.composeBand(sctx, solidTile, 0, m.ci * CHUNK - MARGIN, W, CHUNK + 2 * MARGIN, W, SURFACE);
  cctx.clearRect(0, 0, PW, coreH);
  cctx.drawImage(scratch, 0, MARGIN * T, PW, coreH, 0, 0, PW, coreH);   // drop the margin, keep the core
  const bmp = core.transferToImageBitmap();
  postMessage({ ci: m.ci, bmp }, [bmp]);
};
