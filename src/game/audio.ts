let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let engineNodes: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function out(): AudioNode {
  ac();
  return master as AudioNode;
}

export function unlockAudio() {
  ac();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}

export function isMuted() {
  return muted;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Continuous engine hum; pitch rises with speed */
export function engineStart() {
  const c = ac();
  if (!c || engineNodes) return;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 55;
  const osc2 = c.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 110;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  osc.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(out());
  osc.start();
  osc2.start();
  engineNodes = { osc, osc2, gain };
}

export function engineUpdate(speed01: number) {
  if (!engineNodes || !ctx) return;
  const s = Math.max(0, Math.min(1, speed01));
  engineNodes.osc.frequency.setTargetAtTime(55 + s * 130, ctx.currentTime, 0.08);
  engineNodes.osc2.frequency.setTargetAtTime(110 + s * 260, ctx.currentTime, 0.08);
  engineNodes.gain.gain.setTargetAtTime(0.02 + s * 0.07, ctx.currentTime, 0.1);
}

export function engineStop() {
  if (!engineNodes || !ctx) return;
  const { osc, osc2, gain } = engineNodes;
  gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
  osc.stop(ctx.currentTime + 0.3);
  osc2.stop(ctx.currentTime + 0.3);
  engineNodes = null;
}

/** White-vapor thruster hiss (cold-gas blast) */
export function playThruster(duration = 0.45, volume = 0.5) {
  const c = ac();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, duration);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2600, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(700, c.currentTime + duration);
  filter.Q.value = 0.9;
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  src.connect(filter).connect(gain).connect(out());
  src.start();
}

/** Low thud for a rough landing */
export function playThud(volume = 0.6) {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(38, c.currentTime + 0.22);
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
  osc.connect(gain).connect(out());
  osc.start();
  osc.stop(c.currentTime + 0.3);
}

/** Clean landing chime */
export function playChime() {
  const c = ac();
  if (!c) return;
  [660, 990].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const gain = c.createGain();
    const t0 = c.currentTime + i * 0.09;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(gain).connect(out());
    osc.start(t0);
    osc.stop(t0 + 0.35);
  });
}

/** Ring pickup blip */
export function playBlip() {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1760, c.currentTime + 0.08);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.12, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
  osc.connect(gain).connect(out());
  osc.start();
  osc.stop(c.currentTime + 0.16);
}

/** Boost whoosh for 0-60 burst */
export function playBoost() {
  const c = ac();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.8);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(3800, c.currentTime + 0.5);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.3, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.8);
  src.connect(filter).connect(gain).connect(out());
  src.start();
}

/** Near-miss whoosh */
export function playWhoosh() {
  const c = ac();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.35);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2200, c.currentTime + 0.3);
  filter.Q.value = 2;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.28, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
  src.connect(filter).connect(gain).connect(out());
  src.start();
}

/** Fail buzzer */
export function playFail() {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.7);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.22, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.75);
  osc.connect(gain).connect(out());
  osc.start();
  osc.stop(c.currentTime + 0.8);
}
