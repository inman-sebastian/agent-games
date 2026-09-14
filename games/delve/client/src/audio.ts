// audio.ts — the synthesized sound: one lazily-unlocked AudioContext, a master gain for an instant and
// total mute, and the SFX bank. No sample files; every sound is oscillators and filtered noise.
// Timbres follow the design convention: rising pitch = good, noise = friction, low body = heavy.
const MASTER_VOLUME = 0.5;
let AC: AudioContext | null = null;
let muted = false;
let master: GainNode | null = null;

/** The AudioContext, created on first call. Browsers keep it suspended until a user gesture, so
 * call this from one (key, click, tap) to unlock sound. */
export function unlockAudio(): AudioContext | null {
  if (AC) return AC;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    AC = new Ctor();
    master = AC.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(AC.destination);
  } catch {
    AC = null;
  }
  return AC;
}
// A short attack→decay envelope: silence → peak over `attack`, then exponential fall over `decay`.
function env(node: GainNode, gain: number, attack: number, decay: number): void {
  const now = AC!.currentTime;
  node.gain.setValueAtTime(0, now);
  node.gain.linearRampToValueAtTime(gain, now + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}
function tone(
  freq: number,
  attack: number,
  decay: number,
  type: OscillatorType = 'square',
  gain = 0.3,
): void {
  if (!unlockAudio() || muted) return;
  const osc = AC!.createOscillator();
  const gainNode = AC!.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gainNode);
  gainNode.connect(master!);
  env(gainNode, gain, attack, decay);
  osc.start();
  osc.stop(AC!.currentTime + attack + decay + 0.02);
}
function noise(duration: number, cutoff: number, gain = 0.4): void {
  if (!unlockAudio() || muted) return;
  const source = AC!.createBufferSource();
  const buffer = AC!.createBuffer(1, AC!.sampleRate * duration, AC!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // white noise
  source.buffer = buffer;
  const filter = AC!.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gainNode = AC!.createGain();
  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(master!);
  env(gainNode, gain, 0.002, duration);
  source.start();
}
// SFX bank — the frequencies/durations below are a synth coefficient family, tuned by ear.
export const sfx = {
  dig(depth: number): void {
    noise(0.06, 800 - Math.min(600, depth * 2), 0.18); // deeper rock reads as duller/lower
  },
  chip(): void {
    noise(0.04, 1200, 0.12);
  },
  // `prize` is NORMALISED rarity, 0 (worthless) .. 1 (the rarest thing in the game) — not a tier
  // index. The tier count is a content decision that changes whenever an ore is added, and reward
  // pitch should not move when it does (#46).
  break(prize: number): void {
    noise(0.12, 500 + prize * 960, 0.4);
  },
  ore(prize: number): void {
    const base = 520 + prize * 720;
    tone(base, 0.005, 0.14, 'triangle', 0.28);
    setTimeout(() => tone(base * 1.5, 0.005, 0.16, 'triangle', 0.22), 60); // a bright rising fifth
  },
  land(impact: number): void {
    noise(0.09, 300 - impact * 130, 0.18 + impact * 0.26); // heavier fall → lower, louder thud
  },
};

/** Flip the master mute; returns whether sound is now muted. */
export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  return muted;
}

/** For the debug panel: locked (no gesture yet), muted, or the context's own state. */
export function audioStatus(): string {
  return AC ? (muted ? 'muted' : AC.state) : 'locked';
}
