/**
 * Game sounds, synthesized with the Web Audio API so there are no files to load.
 * Browsers only allow audio after the player has interacted with the page, so the
 * context is created lazily and resumed on the first click or key press.
 */
import { getSound, getVolume } from '../storage/prefs';

type Ctx = { ac: AudioContext; out: GainNode };
let ctx: Ctx | null = null;

function audio(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    const ac = new AC();
    const out = ac.createGain();
    out.connect(ac.destination);
    ctx = { ac, out };
  }
  if (ctx.ac.state === 'suspended') void ctx.ac.resume();
  ctx.out.gain.value = getVolume();
  return ctx;
}

// unlock audio on the first interaction, so the opponent's moves can be heard too
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  /** seconds from now */
  at?: number;
  /** glide to this frequency over the note */
  to?: number;
  attack?: number;
}

function tone(freq: number, dur: number, o: ToneOpts = {}) {
  const c = audio();
  if (!c || !getSound()) return;
  const t = c.ac.currentTime + (o.at ?? 0);
  const osc = c.ac.createOscillator();
  const g = c.ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** a filtered burst of noise: the "clack" part of a tile landing */
function noise(dur: number, o: { gain?: number; at?: number; freq?: number; q?: number; type?: BiquadFilterType } = {}) {
  const c = audio();
  if (!c || !getSound()) return;
  const t = c.ac.currentTime + (o.at ?? 0);
  const len = Math.max(1, Math.floor(c.ac.sampleRate * dur));
  const buf = c.ac.createBuffer(1, len, c.ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.ac.createBufferSource();
  src.buffer = buf;
  const f = c.ac.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.value = o.freq ?? 2200;
  f.Q.value = o.q ?? 1.2;
  const g = c.ac.createGain();
  g.gain.value = o.gain ?? 0.3;
  src.connect(f).connect(g).connect(c.out);
  src.start(t);
}

/** semitones above a base note */
const note = (base: number, semis: number) => base * Math.pow(2, semis / 12);

export const sfx = {
  /** a tile set down on the board */
  place() {
    noise(0.05, { freq: 2600, q: 1.5, gain: 0.35 });
    tone(180, 0.09, { type: 'triangle', gain: 0.22, to: 120 });
  },
  /** a tile flying back to the rack */
  recall() {
    tone(520, 0.12, { type: 'sine', gain: 0.12, to: 880 });
    noise(0.03, { freq: 4000, gain: 0.12, at: 0.02 });
  },
  /** new tiles arriving from the bag, one tick each */
  draw(count: number) {
    for (let i = 0; i < Math.min(count, 8); i++) {
      noise(0.035, { freq: 3000 + i * 150, gain: 0.18, at: i * 0.07 });
      tone(700 + i * 40, 0.05, { type: 'triangle', gain: 0.06, at: i * 0.07 });
    }
  },
  /** the server rejected the move */
  invalid() {
    tone(220, 0.16, { type: 'square', gain: 0.08 });
    tone(165, 0.24, { type: 'square', gain: 0.08, at: 0.14 });
  },
  /** one tile's points counting in the scoring animation; rises as the run goes on */
  chip(index: number) {
    const f = note(523, Math.min(index, 14) * 1.5);
    tone(f, 0.08, { type: 'triangle', gain: 0.14 });
    noise(0.02, { freq: 5000, gain: 0.08 });
  },
  /** a ×2 / ×3 equation multiplier slamming in */
  mult() {
    tone(110, 0.35, { type: 'sawtooth', gain: 0.18, to: 55 });
    noise(0.22, { freq: 400, q: 0.7, gain: 0.45, type: 'lowpass' });
    tone(880, 0.18, { type: 'square', gain: 0.05, at: 0.03, to: 1320 });
  },
  /** one equation's subtotal landing */
  subtotal() {
    tone(659, 0.1, { type: 'triangle', gain: 0.14 });
    tone(988, 0.16, { type: 'triangle', gain: 0.12, at: 0.06 });
  },
  /** the 8-tile bonus */
  bingo() {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(note(523, s), 0.22, { type: 'square', gain: 0.07, at: i * 0.07 }));
    noise(0.4, { freq: 6000, q: 0.5, gain: 0.12, at: 0.3, type: 'highpass' });
  },
  /** the final total; bigger scores get a bigger chord */
  total(score: number) {
    const chord = score >= 80 ? [0, 4, 7, 12, 16, 19] : score >= 30 ? [0, 4, 7, 12] : [0, 4, 7];
    chord.forEach((s, i) => tone(note(392, s), 0.5, { type: 'triangle', gain: 0.1, at: i * 0.045 }));
    tone(98, 0.4, { type: 'sine', gain: 0.25, to: 70 });
    if (score >= 50) noise(0.5, { freq: 7000, q: 0.4, gain: 0.1, at: 0.1, type: 'highpass' });
  },
  /** a sticker popping up */
  sticker() {
    tone(900, 0.07, { type: 'sine', gain: 0.1, to: 1500 });
  },
};
