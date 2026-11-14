// A short "Jingle Bells" (public domain tune, own arrangement) synthesised with Web Audio:
// music-box melody, soft bass, sleigh bells and a bit of hall reverb. No audio files needed.
const F = { G2: 98.0, C3: 130.81, F3: 174.61, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0 };

const TUNE = [
  ["E4", 1], ["E4", 1], ["E4", 2], ["E4", 1], ["E4", 1], ["E4", 2],
  ["E4", 1], ["G4", 1], ["C4", 1.5], ["D4", 0.5], ["E4", 4],
  ["F4", 1], ["F4", 1], ["F4", 1.5], ["F4", 0.5], ["F4", 1], ["E4", 1], ["E4", 1], ["E4", 0.5], ["E4", 0.5],
  ["E4", 1], ["D4", 1], ["D4", 1], ["E4", 1], ["D4", 2], ["G4", 2],
];
// bass root per bar (4 beats each)
const BASS = ["C3", "C3", "C3", "C3", "F3", "C3", "G2", "G2"];
const BEAT = 0.44;

let ctx = null;
let master = null;
let reverb = null;
let noiseBuf = null;
let on = true;
let timer = null;

function impulse(seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.62;
    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.4, 3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    master.connect(dry).connect(ctx.destination);
    master.connect(reverb).connect(wet).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return true;
}

function boxNote(freq, t, vol = 0.2, ring = 1.1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  g.connect(master);
  [[freq * 2, "triangle", 1], [freq * 4, "sine", 0.28], [freq * 6.02, "sine", 0.09]].forEach(([f, type, k]) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = type; o.frequency.value = f; og.gain.value = k;
    o.connect(og).connect(g);
    o.start(t); o.stop(t + ring + 0.05);
  });
}

function bassNote(freq, t, dur, vol = 0.12) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  const o = ctx.createOscillator();
  o.type = "sine"; o.frequency.value = freq;
  o.connect(g);
  o.start(t); o.stop(t + dur + 0.05);
}

function bell(t, vol = 0.05) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 6500;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 9000; bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  src.connect(hp).connect(bp).connect(g).connect(master);
  src.start(t);
}

function loop() {
  if (!on || !ensure()) return;
  const t0 = ctx.currentTime + 0.08;
  let beat = 0;
  for (const [n, beats] of TUNE) {
    boxNote(F[n], t0 + beat * BEAT, 0.2, 0.9 + beats * BEAT * 0.5);
    beat += beats;
  }
  const bars = beat / 4;
  for (let b = 0; b < bars; b++) {
    const root = F[BASS[b % BASS.length]];
    bassNote(root, t0 + b * 4 * BEAT, 1.5 * BEAT * 2, 0.13);
    bassNote(root * 1.5, t0 + (b * 4 + 2) * BEAT, 1.5 * BEAT * 2, 0.07);
  }
  for (let i = 0; i < beat * 2; i++) bell(t0 + i * BEAT * 0.5, i % 2 === 0 ? 0.045 : 0.026);
  timer = setTimeout(loop, (t0 + beat * BEAT - ctx.currentTime + 2.0) * 1000);
}

function arpeggio(freqs, gap, vol) {
  if (!on || !ensure()) return;
  const t = ctx.currentTime + 0.03;
  freqs.forEach((f, i) => boxNote(f, t + i * gap, vol, 1.4));
}

export const Music = {
  start() { on = true; clearTimeout(timer); loop(); },
  stop() {
    on = false;
    clearTimeout(timer);
    if (master) { master.disconnect(); master = null; reverb = null; }
  },
  toggle() { if (on) this.stop(); else this.start(); return on; },
  ding() { arpeggio([523.25, 659.25, 783.99], 0.09, 0.15); },
  fanfare() { arpeggio([261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5], 0.11, 0.17); },
  get on() { return on; },
};
