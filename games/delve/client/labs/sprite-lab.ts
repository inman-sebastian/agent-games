// sprite-lab.ts — every imported player animation, playing, with the equipment pipeline exposed.
//
// The per-layer colour pickers are the point of the whole format: a sprite pixel stores an INDEX
// into its layer's ramp, never a colour, so re-skinning a body part is substituting that ramp. Drag
// the torso to a different colour and you have authored a chest piece; it applies to every animation
// at once because layer names are normalised at import time.
import { PLAYER_SPRITES, PLAYER_SLOTS, type PlayerAnim } from '../src/render/entity/sprites';
import { drawSprite, frameAt, type SpriteSkin } from '../src/render/entity/sprite';

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
let skin: Record<string, string> = {}; // slot -> replacement colour for the whole ramp

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

const resetBtn = document.createElement('button');
resetBtn.textContent = 'Reset layers & colours';
resetBtn.onclick = (): void => {
  hidden = new Set();
  skin = {};
  rebuild();
};
side.append(resetBtn);

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
    text.textContent = `${slot} (${layer.palette.length})`;
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.value = skin[slot] ?? layer.palette[0];
    colour.oninput = (): void => {
      skin[slot] = colour.value;
      rebuild();
    };
    row.append(toggle, text, colour);
    layerBox.append(row);
  }
}

/**
 * Build the draw-time skin. A slot the user recoloured gets a FLAT ramp of that colour, which is
 * honest about what the pack gives us: its parts are single flat colours, so there is no gradient to
 * remap yet. Real armour will author a full ramp per slot the way a material does.
 */
function skinFor(): SpriteSkin {
  const anim = PLAYER_SPRITES[current];
  const out: Record<string, readonly string[]> = {};
  for (const layer of anim.layers) {
    if (hidden.has(layer.name)) out[layer.name] = [];
    else if (skin[layer.name]) out[layer.name] = layer.palette.map(() => skin[layer.name]);
  }
  return out;
}

// ---- drawing -----------------------------------------------------------------------------------
function rebuild(): void {
  const anim = PLAYER_SPRITES[current];
  for (const [name, b] of animButtons) b.setAttribute('aria-pressed', String(name === current));
  flipBtn.textContent = `facing: ${flip ? 'left' : 'right'}`;
  buildLayerControls();

  live.width = anim.w * SCALE;
  live.height = anim.h * SCALE;
  strip.width = anim.w * anim.frames * STRIP_SCALE;
  strip.height = anim.h * STRIP_SCALE;

  const img = stripCtx.createImageData(strip.width, strip.height);
  for (let f = 0; f < anim.frames; f++) {
    drawSprite(img, anim, f, (f * anim.w + anim.w / 2) * STRIP_SCALE, anim.h * STRIP_SCALE, {
      scale: STRIP_SCALE,
      flip,
      skin: skinFor(),
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
  drawSprite(img, anim, frameAt(anim, t - t0), live.width / 2, live.height, {
    scale: SCALE,
    flip,
    skin: skinFor(),
  });
  liveCtx.putImageData(img, 0, 0);
  requestAnimationFrame(tick);
}

rebuild();
requestAnimationFrame(tick);
