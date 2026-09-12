// rig-lab.ts — live tuning for the humanoid rig.
//
// The problem this solves: the rig's tunables were module constants, so dialling the silhouette in
// cost a code edit, a commit and a screenshot per guess. That loop ran eight times in one session
// and never converged, because a walk cycle can't be judged from a still and a value can't be
// judged without moving the one next to it.
//
// So: every tunable is a slider, the figure animates, and "Copy TS" emits a replacement for
// DEFAULT_CONFIG so tuning lands back in the repo rather than staying in a tab.
import { DEFAULT_CONFIG, configToTS, type HumanoidConfig } from '../src/render/entity/config';
import { buildHumanoid, idlePose, walkPose } from '../src/render/entity/humanoid';
import { drawRig, rigPalettes } from '../src/render/entity/rig';
import { setRimDarken } from '../src/render/entity/limb';

const SCALE = 6;
const FRAME_W = 32;
const FRAME_H = 52; // a little headroom over the 48px figure, like the reference's padded frames
const STRIP_FRAMES = 8;

type Group = { title: string; keys: [keyof HumanoidConfig, number, number, number][] };

// [key, min, max, step] — ranges chosen to bracket the plausible, not the possible.
const GROUPS: Group[] = [
  {
    title: 'skeleton',
    keys: [
      ['yHeadTop', -52, -36, 1],
      ['yNeck', -40, -26, 1],
      ['yShoulder', -38, -24, 1],
      ['yWaist', -30, -18, 1],
      ['yHip', -24, -12, 1],
      ['yKnee', -16, -6, 1],
      ['yAnkle', -6, 0, 1],
      ['yElbow', -30, -16, 1],
      ['yHand', -24, -10, 1],
    ],
  },
  {
    title: 'bones',
    keys: [
      ['femur', 4, 14, 0.5],
      ['tibia', 4, 14, 0.5],
      ['humerus', 4, 14, 0.5],
      ['ulna', 4, 14, 0.5],
    ],
  },
  {
    title: 'gait',
    keys: [
      ['stride', 0, 30, 1],
      ['footLift', 0, 12, 0.5],
      ['armSwing', 0, 24, 1],
      ['bob', 0, 5, 0.25],
      ['lean', -6, 8, 0.5],
      ['stretch', 1, 1.5, 0.02],
      ['armOffset', 0, 10, 0.2],
      ['handSplay', 0, 10, 0.2],
      ['limbCap', 0, 1, 0.05],
      ['legOffset', 0, 10, 0.2],
      ['stanceSplay', 0, 14, 0.2],
      ['kneeLead', -0.5, 1.5, 0.02],
      ['elbowLead', -0.5, 2, 0.05],
    ],
  },
  {
    title: 'widths',
    keys: [
      ['rHead', 3, 10, 0.1],
      ['rChest', 3, 10, 0.1],
      ['rWaist', 3, 10, 0.1],
      ['rPelvis', 3, 10, 0.1],
      ['torsoDrop', 0, 6, 0.5],
      ['rThigh', 2, 8, 0.1],
      ['rShin', 1.5, 7, 0.1],
      ['rUpperArm', 1.5, 6, 0.1],
      ['rForearm', 1, 5, 0.1],
      ['rFoot', 1, 5, 0.1],
      ['farNarrowArm', 0.2, 1, 0.05],
      ['farNarrowLeg', 0.5, 1.2, 0.05],
      ['footLen', 0, 9, 0.5],
      ['footDrop', -2, 4, 0.5],
    ],
  },
  {
    title: 'shading',
    keys: [
      ['rimDarken', 0, 0.5, 0.01],
      ['farBias', -0.6, 0, 0.01],
      ['headBias', -0.2, 0.5, 0.01],
      ['helmetFrom', 0, 1, 0.02],
      ['bootFrom', 0, 1, 0.02],
    ],
  },
];

// Config survives a reload, because losing twenty minutes of tuning to a refresh is its own tax.
// Versioned: `load` merges the saved object over DEFAULT_CONFIG, so a stale entry would shadow
// every value a new default introduces. Bump this whenever the measured defaults change.
const STORAGE = 'delve.riglab.config.v3';
const load = (): HumanoidConfig => {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};
const save = (cfg: HumanoidConfig): void => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(cfg));
  } catch {
    /* private window / blocked storage — tuning just won't persist */
  }
};

let cfg = load();
let ghost: HTMLImageElement | null = null;
let ghostFrames = 1;
// CODED mode is the DEFAULT, because silhouette comes before texture: shading and noise actively
// hide the proportion errors you're trying to see. Same reason the reference pack ships a flat
// colour-coded template.
let coded = true;

const side = document.getElementById('side') as HTMLDivElement;
const strip = document.getElementById('strip') as HTMLCanvasElement;
const live = document.getElementById('live') as HTMLCanvasElement;
const readout = document.getElementById('readout') as HTMLParagraphElement;

strip.width = FRAME_W * STRIP_FRAMES;
strip.height = FRAME_H;
strip.style.width = `${strip.width * (SCALE - 2)}px`;
strip.style.height = `${strip.height * (SCALE - 2)}px`;
live.width = FRAME_W;
live.height = FRAME_H;
// 6x, not 12x: at double scale a 52px frame is taller than the viewport and the figure gets cropped,
// which defeats the point of a live view.
live.style.width = `${FRAME_W * SCALE}px`;
live.style.height = `${FRAME_H * SCALE}px`;

const stripCtx = strip.getContext('2d')!;
const liveCtx = live.getContext('2d')!;
stripCtx.imageSmoothingEnabled = false;
liveCtx.imageSmoothingEnabled = false;

// ---- controls ----------------------------------------------------------------------------------
for (const group of GROUPS) {
  const h = document.createElement('h2');
  h.textContent = group.title;
  side.append(h);
  for (const [key, min, max, step] of group.keys) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = key;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(cfg[key]);
    const out = document.createElement('output');
    out.textContent = String(cfg[key]);
    input.oninput = (): void => {
      (cfg as unknown as Record<string, number>)[key] = Number(input.value);
      out.textContent = input.value;
      save(cfg);
      rebuild();
    };
    label.append(name, input, out);
    side.append(label);
  }
}

// Bend direction is a sign, not a range — a knee bends backward and an elbow forward, so these are
// per-limb and getting one wrong is what put a forearm across the character's face.
const bendRow = document.createElement('div');
bendRow.className = 'row';
for (const key of ['kneeBend', 'elbowBend'] as const) {
  const b = document.createElement('button');
  const render = (): void => {
    b.textContent = `${key}: ${cfg[key] > 0 ? '+1' : '-1'}`;
  };
  b.onclick = (): void => {
    cfg[key] = (cfg[key] === 1 ? -1 : 1) as 1 | -1;
    render();
    save(cfg);
    rebuild();
  };
  render();
  bendRow.append(b);
}
side.append(bendRow);

const modeRow = document.createElement('div');
modeRow.className = 'row';
const modeBtn = document.createElement('button');
const renderMode = (): void => {
  modeBtn.textContent = coded ? 'mode: coded' : 'mode: shaded';
};
modeBtn.onclick = (): void => {
  coded = !coded;
  renderMode();
  rebuild();
};
renderMode();
// Build switch: the reference pack has one androgynous template, so this is ours. Same rig, same
// parts, a multiplier set over the measured widths — which is what keeps equipment authored against
// surface coordinates fitting either build without per-build art.
const buildBtn = document.createElement('button');
const renderBuild = (): void => {
  buildBtn.textContent = `build: ${cfg.build}`;
};
buildBtn.onclick = (): void => {
  cfg.build = cfg.build === 'male' ? 'female' : 'male';
  renderBuild();
  save(cfg);
  rebuild();
};
renderBuild();
modeRow.append(modeBtn, buildBtn);
side.append(modeRow);

const actions = document.createElement('div');
actions.className = 'row';

const copy = document.createElement('button');
copy.textContent = 'Copy TS';
copy.onclick = async (): Promise<void> => {
  const ts = configToTS(cfg);
  dump.value = ts;
  try {
    await navigator.clipboard.writeText(ts);
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = 'Copy TS'), 1200);
  } catch {
    copy.textContent = 'See box ↓';
  }
};

const reset = document.createElement('button');
reset.textContent = 'Reset';
reset.onclick = (): void => {
  cfg = { ...DEFAULT_CONFIG };
  save(cfg);
  location.reload();
};

// Reference underlay: pick one of the pack's sheet PNGs and it draws behind the figure, so the
// silhouette can be matched against it directly instead of from memory. Local-file only — the
// reference art is never committed, per the rule that all game art is authored.
const refLabel = document.createElement('label');
refLabel.style.gridTemplateColumns = '1fr';
const refInput = document.createElement('input');
refInput.type = 'file';
refInput.accept = 'image/png';
refInput.onchange = (): void => {
  const file = refInput.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = (): void => {
    ghost = img;
    ghostFrames = Math.max(1, Math.round(img.width / img.height));
    rebuild();
  };
  img.src = URL.createObjectURL(file);
};
refLabel.append(refInput);

actions.append(copy, reset);
side.append(actions, refLabel);

const dump = document.createElement('textarea');
dump.readOnly = true;
dump.placeholder = 'Copy TS → paste over DEFAULT_CONFIG in src/render/entity/config.ts';
side.append(dump);

// ---- drawing -----------------------------------------------------------------------------------
let rig = buildHumanoid(cfg);
let palettes = rigPalettes(rig);

function drawGhost(ctx: CanvasRenderingContext2D, frame: number, w: number, h: number): void {
  if (!ghost) return;
  const fw = ghost.width / ghostFrames;
  ctx.save();
  ctx.globalAlpha = 0.3;
  // The reference's figure sits low in its padded frame; align its bottom with ours.
  ctx.drawImage(
    ghost,
    (frame % ghostFrames) * fw,
    0,
    fw,
    ghost.height,
    (w - fw) / 2,
    h - ghost.height,
    fw,
    ghost.height,
  );
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  phase: number,
  ox: number,
  oy: number,
  idle: boolean,
): void {
  const img = ctx.createImageData(FRAME_W, FRAME_H);
  drawRig(
    img,
    rig,
    idle ? idlePose(cfg) : walkPose(phase, cfg),
    palettes,
    FRAME_W / 2,
    oy,
    undefined,
    coded,
  );
  // Composite so the ghost underlay stays visible through uncovered pixels.
  const scene = ctx.getImageData(ox, 0, FRAME_W, FRAME_H);
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] === 0) continue;
    scene.data[i - 3] = img.data[i - 3];
    scene.data[i - 2] = img.data[i - 2];
    scene.data[i - 1] = img.data[i - 1];
    scene.data[i] = 255;
  }
  ctx.putImageData(scene, ox, 0);
}

function rebuild(): void {
  setRimDarken(cfg.rimDarken);
  rig = buildHumanoid(cfg);
  palettes = rigPalettes(rig);
  const ground = FRAME_H - 2;

  stripCtx.clearRect(0, 0, strip.width, strip.height);
  for (let i = 0; i < STRIP_FRAMES; i++) {
    const ox = i * FRAME_W;
    stripCtx.save();
    stripCtx.translate(ox, 0);
    drawGhost(stripCtx, i, FRAME_W, FRAME_H);
    stripCtx.restore();
    drawFrame(stripCtx, i / STRIP_FRAMES, ox, ground, i === 0);
  }

  // Ankle minus hip, not the reverse: y increases downward, so hip - ankle is negative and every
  // comparison against it inverts. Same class of sign error as the negative bone lengths.
  const span = cfg.yAnkle - cfg.yHip;
  const reach = cfg.femur + cfg.tibia;
  // The worst thing a stride can do is ask for an ankle the leg can't reach on every frame, because
  // the solver then straightens the leg and the whole gait reads as stiff splits.
  const worstChord = Math.hypot(cfg.stride / 2, span);
  readout.textContent =
    `figure ${Math.abs(cfg.yHeadTop)}px tall · leg span ${span}px vs bone reach ${reach}px` +
    (reach <= span ? '  ⚠ no slack — the knee cannot bend' : '') +
    (reach > span + 3 ? '  ⚠ too much slack — reads as a crouch' : '') +
    (worstChord > reach * cfg.stretch
      ? `  ⚠ stride needs ${worstChord.toFixed(1)}px of reach, budget is ${(reach * cfg.stretch).toFixed(1)}px`
      : '') +
    silhouetteReport();
}

/**
 * Numeric silhouette comparison against the loaded reference frame.
 *
 * This is the payoff of using the pack's exact coded colours: "is the silhouette right" stops being
 * a judgement and becomes intersection-over-union of the two masks, plus a height and width
 * comparison. Eyeballing a 48px figure at 6x is how five iterations went by without converging.
 */
function silhouetteReport(): string {
  if (!ghost) return '  ·  load a reference PNG to compare';
  const fw = Math.round(ghost.width / ghostFrames);
  const probe = document.createElement('canvas');
  probe.width = fw;
  probe.height = ghost.height;
  const pc = probe.getContext('2d')!;
  pc.drawImage(ghost, 0, 0, fw, ghost.height, 0, 0, fw, ghost.height);
  const refData = pc.getImageData(0, 0, fw, ghost.height).data;

  // Reference mask + its bbox.
  let rMinX = 1e9,
    rMaxX = -1,
    rMinY = 1e9,
    rMaxY = -1,
    rCount = 0;
  for (let y = 0; y < ghost.height; y++) {
    for (let x = 0; x < fw; x++) {
      if (refData[(y * fw + x) * 4 + 3] < 8) continue;
      rCount++;
      rMinX = Math.min(rMinX, x);
      rMaxX = Math.max(rMaxX, x);
      rMinY = Math.min(rMinY, y);
      rMaxY = Math.max(rMaxY, y);
    }
  }
  if (rCount === 0) return '  ·  reference frame is empty';

  // Ours, at idle, measured the same way.
  const mine = stripCtx.createImageData(FRAME_W, FRAME_H);
  drawRig(mine, rig, idlePose(cfg), palettes, FRAME_W / 2, FRAME_H - 2, undefined, coded);
  let mMinX = 1e9,
    mMaxX = -1,
    mMinY = 1e9,
    mMaxY = -1,
    mCount = 0;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (mine.data[(y * FRAME_W + x) * 4 + 3] < 8) continue;
      mCount++;
      mMinX = Math.min(mMinX, x);
      mMaxX = Math.max(mMaxX, x);
      mMinY = Math.min(mMinY, y);
      mMaxY = Math.max(mMaxY, y);
    }
  }
  if (mCount === 0) return '  ·  nothing drawn';

  const rh = rMaxY - rMinY + 1;
  const rw = rMaxX - rMinX + 1;
  const mh = mMaxY - mMinY + 1;
  const mw = mMaxX - mMinX + 1;
  // Compare SHAPE, not size: the reference figure is ~29px and ours is ~48px by decision, so the
  // meaningful numbers are the aspect ratio and the fill density, both scale-free.
  const rAspect = rw / rh;
  const mAspect = mw / mh;
  const rFill = rCount / (rw * rh);
  const mFill = mCount / (mw * mh);
  const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
  return (
    `  ·  ref ${rw}x${rh} aspect ${rAspect.toFixed(2)} fill ${pct(rFill)}` +
    `  ·  ours ${mw}x${mh} aspect ${mAspect.toFixed(2)} fill ${pct(mFill)}` +
    `  ·  aspect off by ${pct(Math.abs(mAspect - rAspect) / rAspect)}`
  );
}

let t = 0;
function tick(): void {
  t += 1 / 60;
  const ground = FRAME_H - 2;
  liveCtx.clearRect(0, 0, FRAME_W, FRAME_H);
  const phase = (t * 1.2) % 1;
  drawGhost(liveCtx, Math.floor(phase * ghostFrames), FRAME_W, FRAME_H);
  drawFrame(liveCtx, phase, 0, ground, false);
  requestAnimationFrame(tick);
}

rebuild();
tick();
