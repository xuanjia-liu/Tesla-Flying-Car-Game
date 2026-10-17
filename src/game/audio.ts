/**
 * All sound is synthesized with WebAudio: no audio files to download.
 * Buses: master -> (music, sfx). Loops (engine, thrust, wind) live on the sfx bus.
 */
let ctx: AudioContext | null = null;
let master: GainNode;
let musicBus: GainNode;
let sfxBus: GainNode;
let noise: AudioBuffer;
let comp: DynamicsCompressorNode;

const vol = { music: 0.6, sfx: 0.8, muted: false };

interface Loops {
  engineA: OscillatorNode;
  engineB: OscillatorNode;
  whine: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  thrustFilter: BiquadFilterNode;
  thrustGain: GainNode;
  windFilter: BiquadFilterNode;
  windGain: GainNode;
}
let loops: Loops | null = null;

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vol.muted ? 0 : 1, t, 0.05);
  musicBus.gain.setTargetAtTime(vol.music * 0.55, t, 0.05);
  sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.05);
}

export function unlockAudio() {
  ensure();
}

export function setVolumes(music: number, sfx: number, muted: boolean) {
  vol.music = music;
  vol.sfx = sfx;
  vol.muted = muted;
  applyVolumes();
}

function noiseSource(c: AudioContext, loop = false) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = loop;
  if (!loop) src.loopStart = Math.random();
  return src;
}

// ---------------- continuous loops ----------------

export function startLoops() {
  const c = ensure();
  if (!c || loops) return;
  const engineFilter = c.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 300;
  engineFilter.Q.value = 3;
  const engineGain = c.createGain();
  engineGain.gain.value = 0;
  const engineA = c.createOscillator();
  engineA.type = 'sawtooth';
  const engineB = c.createOscillator();
  engineB.type = 'sawtooth';
  engineB.detune.value = 14;
  const whine = c.createOscillator();
  whine.type = 'sine';
  const whineGain = c.createGain();
  whineGain.gain.value = 0.18;
  engineA.connect(engineFilter);
  engineB.connect(engineFilter);
  whine.connect(whineGain).connect(engineGain);
  engineFilter.connect(engineGain).connect(sfxBus);

  const thrustSrc = noiseSource(c, true);
  const thrustFilter = c.createBiquadFilter();
  thrustFilter.type = 'bandpass';
  thrustFilter.frequency.value = 900;
  thrustFilter.Q.value = 0.7;
  const thrustGain = c.createGain();
  thrustGain.gain.value = 0;
  thrustSrc.connect(thrustFilter).connect(thrustGain).connect(sfxBus);

  const windSrc = noiseSource(c, true);
  const windFilter = c.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 400;
  const windGain = c.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter).connect(windGain).connect(sfxBus);

  for (const o of [engineA, engineB, whine]) o.start();
  thrustSrc.start();
  windSrc.start(0, 0.7);
  loops = { engineA, engineB, whine, engineFilter, engineGain, thrustFilter, thrustGain, windFilter, windGain };
}

export function updateLoops(speed01: number, thrust01: number, boost01: number, airborne: boolean) {
  if (!loops || !ctx) return;
  const t = ctx.currentTime;
  const s = Math.max(0, Math.min(1, speed01));
  const f = 42 + s * 95 + boost01 * 25;
  loops.engineA.frequency.setTargetAtTime(f, t, 0.06);
  loops.engineB.frequency.setTargetAtTime(f * 1.5, t, 0.06);
  loops.whine.frequency.setTargetAtTime(600 + s * 2600 + boost01 * 800, t, 0.08);
  loops.engineFilter.frequency.setTargetAtTime(220 + s * 1400 + boost01 * 1200, t, 0.08);
  loops.engineGain.gain.setTargetAtTime((0.05 + s * 0.08) * (airborne ? 0.7 : 1), t, 0.1);
  loops.thrustGain.gain.setTargetAtTime(thrust01 * 0.28 + boost01 * 0.22, t, 0.05);
  loops.thrustFilter.frequency.setTargetAtTime(700 + thrust01 * 900 + boost01 * 1800, t, 0.05);
  loops.windGain.gain.setTargetAtTime(s * s * 0.22 + (airborne ? 0.06 : 0), t, 0.2);
  loops.windFilter.frequency.setTargetAtTime(300 + s * 1500, t, 0.2);
}

export function stopLoops() {
  if (!loops || !ctx) return;
  const t = ctx.currentTime;
  const l = loops;
  loops = null;
  for (const g of [l.engineGain, l.thrustGain, l.windGain]) g.gain.setTargetAtTime(0, t, 0.08);
  window.setTimeout(() => {
    for (const o of [l.engineA, l.engineB, l.whine]) o.stop();
  }, 600);
}

// ---------------- one-shots ----------------

function env(g: GainNode, t0: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  env(g, t0, peak, 0.008, dur);
  o.connect(g).connect(sfxBus);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function burst(type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1) {
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime;
  const src = noiseSource(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  env(g, t0, peak, 0.01, dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  hop() {
    burst('bandpass', 2400, 600, 0.35, 0.5, 0.8);
    tone('sine', 140, 70, 0.18, 0.3);
  },
  ring(combo: number) {
    const base = 660 * Math.pow(2, Math.min(combo - 1, 10) / 12);
    tone('triangle', base, base * 1.01, 0.18, 0.22);
    tone('sine', base * 1.5, base * 1.5, 0.22, 0.12, 0.05);
    tone('sine', base * 2, base * 2, 0.3, 0.08, 0.1);
  },
  land() {
    tone('sine', 110, 50, 0.16, 0.35);
    burst('lowpass', 1200, 200, 0.18, 0.2);
  },
  cleanLanding() {
    tone('triangle', 784, 784, 0.12, 0.16);
    tone('triangle', 1175, 1175, 0.25, 0.14, 0.08);
  },
  thud() {
    tone('sine', 90, 35, 0.35, 0.7);
    burst('lowpass', 900, 120, 0.3, 0.5);
  },
  crash() {
    tone('sawtooth', 160, 40, 0.5, 0.35);
    tone('sine', 70, 30, 0.5, 0.8);
    burst('bandpass', 3000, 400, 0.6, 0.6, 0.6);
  },
  boost() {
    burst('lowpass', 300, 5000, 0.7, 0.45);
    tone('sawtooth', 80, 240, 0.5, 0.15);
  },
  whoosh() {
    burst('bandpass', 500, 2600, 0.4, 0.4, 1.8);
  },
  roll() {
    burst('bandpass', 1800, 900, 0.45, 0.25, 2);
  },
  checkpoint() {
    [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.16, 0.08, i * 0.07));
  },
  count() {
    tone('square', 440, 440, 0.12, 0.12);
  },
  go() {
    tone('square', 880, 880, 0.4, 0.14);
    tone('sawtooth', 440, 440, 0.4, 0.06);
  },
  click() {
    tone('triangle', 1200, 900, 0.05, 0.08);
  },
  finish() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.35, 0.14, i * 0.09));
  },
  fail() {
    [392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.14, i * 0.16));
  },
};

// ---------------- music: procedural synthwave ----------------

const BPM = 104;
const STEP = 60 / BPM / 4;
// Am - F - C - G, two bars each
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

let musicTimer = 0;
let nextTime = 0;
let step = 0;
let intensity = 0; // 0 menu (pads + bass), 1 race (full kit + arp)
let musicOn = false;

function schedule(c: AudioContext) {
  while (nextTime < c.currentTime + 0.12) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
    const t = nextTime;

    if (s === 0 && bar % 2 === 0) pad(c, chord, t, STEP * 32);
    if (s % 2 === 0) bass(c, midi(chord[0] - 24 + (s % 8 === 6 ? 12 : 0)), t, STEP * 1.8);
    if (intensity > 0.5) {
      if (s % 4 === 0) kick(c, t);
      if (s === 4 || s === 12) snare(c, t);
      if (s % 2 === 1) hat(c, t, 0.05);
      const arpNote = chord[[0, 1, 2, 1][s % 4]] + 12 + (s >= 8 ? 12 : 0);
      arp(c, midi(arpNote), t, STEP * 0.9);
    } else if (s === 0) {
      hat(c, t, 0.02);
    }
    nextTime += STEP;
    step++;
  }
}

function voice(c: AudioContext, t: number, dur: number, peak: number, build: (out: AudioNode) => void, attack = 0.01) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(musicBus);
  build(g);
}

function pad(c: AudioContext, chord: number[], t: number, dur: number) {
  voice(
    c,
    t,
    dur,
    0.05,
    (out) => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(600, t);
      f.frequency.linearRampToValueAtTime(1600, t + dur / 2);
      f.frequency.linearRampToValueAtTime(600, t + dur);
      f.connect(out);
      for (const n of chord) {
        for (const det of [-9, 9]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midi(n);
          o.detune.value = det;
          o.connect(f);
          o.start(t);
          o.stop(t + dur + 0.1);
        }
      }
    },
    1.2
  );
}

function bass(c: AudioContext, f: number, t: number, dur: number) {
  voice(c, t, dur, 0.22, (out) => {
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(200, t + dur);
    filt.connect(out);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(filt);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function arp(c: AudioContext, f: number, t: number, dur: number) {
  voice(c, t, dur, 0.05, (out) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2600;
    o.connect(filt).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function kick(c: AudioContext, t: number) {
  voice(c, t, 0.35, 0.6, (out) => {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }, 0.003);
}

function snare(c: AudioContext, t: number) {
  voice(c, t, 0.22, 0.22, (out) => {
    const src = noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    src.connect(f).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.25);
  }, 0.002);
}

function hat(c: AudioContext, t: number, peak: number) {
  voice(c, t, 0.05, peak, (out) => {
    const src = noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    src.connect(f).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }, 0.002);
}

export function startMusic(level: number) {
  const c = ensure();
  if (!c) return;
  intensity = level;
  if (musicOn) return;
  musicOn = true;
  nextTime = c.currentTime + 0.05;
  step = 0;
  musicTimer = window.setInterval(() => schedule(c), 25);
}

export function setMusicIntensity(level: number) {
  intensity = level;
}

export function stopMusic() {
  musicOn = false;
  window.clearInterval(musicTimer);
}
