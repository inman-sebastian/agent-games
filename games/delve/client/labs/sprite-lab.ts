// sprite-lab.ts — every imported player animation, playing, with the equipment pipeline exposed.
//
// The per-layer colour pickers are the point of the whole format: a sprite pixel stores an INDEX
// into its layer's ramp, never a colour, so re-skinning a body part is substituting that ramp. Drag
// the torso to a different colour and you have authored a chest piece; it applies to every animation
// at once because layer names are normalised at import time.
import { PLAYER_SPRITES, PLAYER_SLOTS, type PlayerAnim } from '../src/render/entity/sprites';
import { drawSprite, frameAt, type SpriteSkin } from '../src/render/entity/sprite';
import {
  ALL_STEEL,
  MINER_RAMPS,
  PLATE_ARMOUR,
  PLAYER_LAMP,
  buildSkin,
  type SkinPart,
  type SkinRamps,
} from '../src/render/entity/skin';
import { OVERHEAD, type SpriteLight } from '../src/render/entity/surface';

const SCALE = 6;
const STRIP_SCALE = 2;

const side = document.getElementById('side') as HTMLDivElement;
const strip = document.getElementById('strip') as HTMLCanvasElement;
const live = document.getElementById('live') as HTMLCanvasElement;
const readout = document.getElementById('readout') as HTMLParagraphElement;

const names = Object.keys(PLAYER_SPRITES) as PlayerAnim[];
let current: PlayerAnim = 'idle';
let flip = false;
let hidden = new Set<string>();
/**
 * Which colour source to draw with. `template` is the pack's raw codes; `flat` is the authored
 * colour table; `plate` and `steel` sample PROCEDURAL MATERIALS at each pixel's surface coordinate,
 * which is the two-dimensional form of the same pipeline and the only mode that can produce more
 * shades than the imported template carries.
 */
type Mode = 'flat' | 'template' | 'plate' | 'steel';
const MODES: readonly Mode[] = ['flat', 'template', 'plate', 'steel'];
let mode: Mode = 'flat';
// Per-part ramps, seeded from the shipped miner. Editing one is authoring equipment.
let ramps: SkinRamps = MINER_RAMPS;
// Where the light is, in sprite-local pixels. Only the material modes use it.
let light: SpriteLight = { ...PLAYER_LAMP };
let overhead = false;

const stripCtx = strip.getContext('2d')!;
const liveCtx = live.getContext('2d')!;
stripCtx.imageSmoothingEnabled = false;
liveCtx.imageSmoothingEnabled = false;

// ---- controls ----------------------------------------------------------------------------------
const heading = (text: string): void => {
  const h = document.createElement('h2');
  h.textContent = text;
  side.append(h);
};

heading('animation');
const animBox = document.createElement('div');
animBox.id = 'anims';
const animButtons = new Map<PlayerAnim, HTMLButtonElement>();
for (const name of names) {
  const b = document.createElement('button');
  b.textContent = `${name} (${PLAYER_SPRITES[name].frames}f)`;
  b.onclick = (): void => {
    current = name;
    rebuild();
  };
  animButtons.set(name, b);
  animBox.append(b);
}
side.append(animBox);

heading('view');
const viewRow = document.createElement('div');
const flipBtn = document.createElement('button');
flipBtn.onclick = (): void => {
  flip = !flip;
  rebuild();
};
viewRow.append(flipBtn);
side.append(viewRow);

heading('layers');
const layerBox = document.createElement('div');
side.append(layerBox);

// Per-part ramp editing: pick a part, pick a shade, pick a colour. This is the equipment pipeline —
// a chest piece is a torso ramp, and it applies to every animation because the mapping is global.
heading('skin');
const modeBtn = document.createElement('button');
modeBtn.onclick = (): void => {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  rebuild();
};
side.append(modeBtn);

const rampBox = document.createElement('div');
side.append(rampBox);

// Light position, in sprite-local pixels. Off-canvas values are valid and are how an entity lit from
// outside is expressed — drag x past the edges to see it.
heading('light');
const overheadBtn = document.createElement('button');
overheadBtn.onclick = (): void => {
  overhead = !overhead;
  rebuild();
};
side.append(overheadBtn);
for (const [key, min, max] of [
  ['x', -60, 108],
  ['y', -40, 100],
  ['reach', 8, 160],
] as const) {
  const row = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(key === 'reach' ? (light.reach ?? 34) : light[key]);
  const sync = (): void => {
    text.textContent = `${key} ${input.value}`;
  };
  input.oninput = (): void => {
    light = { ...light, [key]: Number(input.value) };
    sync();
    rebuild();
  };
  sync();
  row.append(text, input);
  side.append(row);
}

const resetBtn = document.createElement('button');
resetBtn.textContent = 'Reset layers & colours';
resetBtn.onclick = (): void => {
  hidden = new Set();
  ramps = MINER_RAMPS;
  rebuild();
};
side.append(resetBtn);

function buildRampControls(): void {
  rampBox.replaceChildren();
  // The ramp pickers only drive the flat colour table; the material modes shade themselves.
  if (mode !== 'flat') {
    const note = document.createElement('p');
    note.className = 'hint';
    note.style.textAlign = 'left';
    note.textContent = 'material mode shades from surface coordinates — ramps below are unused';
    rampBox.append(note);
    return;
  }
  for (const part of Object.keys(ramps) as SkinPart[]) {
    const ramp = ramps[part];
    if (ramp.length === 0) continue;
    const row = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = part;
    row.append(text);
    ramp.forEach((colour, i) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = colour;
      input.title = `${part} shade ${i}`;
      input.oninput = (): void => {
        const next = ramp.slice();
        next[i] = input.value;
        ramps = { ...ramps, [part]: next };
        rebuild();
      };
      row.append(input);
    });
    rampBox.append(row);
  }
}

/** Rebuilt per animation, since not every animation has every slot. */
function buildLayerControls(): void {
  layerBox.replaceChildren();
  const anim = PLAYER_SPRITES[current];
  for (const slot of PLAYER_SLOTS) {
    const layer = anim.layers.find((l) => l.name === slot);
    if (!layer) continue;
    const row = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !hidden.has(slot);
    toggle.onchange = (): void => {
      if (toggle.checked) hidden.delete(slot);
      else hidden.add(slot);
      rebuild();
    };
    const text = document.createElement('span');
    text.textContent = slot;
    row.append(toggle, text);
    layerBox.append(row);
  }
}

/** The draw-time skin for the current mode, plus whatever slots are hidden. */
function skinFor(): SpriteSkin {
  const hide = [...hidden];
  if (mode === 'template') return { hide };
  if (mode === 'plate') return { ...PLATE_ARMOUR, hide };
  if (mode === 'steel') return { ...ALL_STEEL, hide };
  return { ...buildSkin(ramps), hide };
}

// ---- drawing -----------------------------------------------------------------------------------
function rebuild(): void {
  const anim = PLAYER_SPRITES[current];
  for (const [name, b] of animButtons) b.setAttribute('aria-pressed', String(name === current));
  flipBtn.textContent = `facing: ${flip ? 'left' : 'right'}`;
  overheadBtn.textContent = overhead ? 'light: overhead' : 'light: positional';
  modeBtn.textContent = `colours: ${
    { flat: 'authored skin', template: 'pack template', plate: 'plate armour', steel: 'all steel' }[
      mode
    ]
  }`;
  buildLayerControls();
  buildRampControls();

  live.width = anim.w * SCALE;
  live.height = anim.h * SCALE;
  strip.width = anim.w * anim.frames * STRIP_SCALE;
  strip.height = anim.h * STRIP_SCALE;

  const img = stripCtx.createImageData(strip.width, strip.height);
  for (let f = 0; f < anim.frames; f++) {
    drawSprite(img, anim, f, (f * anim.w + anim.w / 2) * STRIP_SCALE, anim.ground * STRIP_SCALE, {
      scale: STRIP_SCALE,
      flip,
      skin: skinFor(),
      light: overhead ? OVERHEAD : light,
    });
  }
  stripCtx.putImageData(img, 0, 0);

  const total = anim.durations.reduce((a, b) => a + b, 0);
  readout.textContent =
    `${anim.name} · ${anim.w}x${anim.h} · ${anim.frames} frames · ${total}ms ` +
    `· layers: ${anim.layers.map((l) => l.name).join(', ')}`;
}

let t0 = 0;
function tick(t: number): void {
  if (!t0) t0 = t;
  const anim = PLAYER_SPRITES[current];
  const img = liveCtx.createImageData(live.width, live.height);
  drawSprite(img, anim, frameAt(anim, t - t0), live.width / 2, anim.ground * SCALE, {
    scale: SCALE,
    flip,
    skin: skinFor(),
    light: overhead ? OVERHEAD : light,
  });
  liveCtx.putImageData(img, 0, 0);
  requestAnimationFrame(tick);
}

rebuild();
requestAnimationFrame(tick);
