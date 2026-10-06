/**
 * SoundSynth: generates tiny placeholder WAVs as data URIs so the audio
 * pipeline works before real assets exist. Each synth returns a base64 WAV
 * URI (8kHz mono 8-bit) — small enough to embed, real enough to trigger.
 */

const SR = 8000;

function toWav(samples) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, Math.max(0, Math.min(255, Math.round((samples[i] + 1) * 127.5))));
  // Base64
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

const t = (ms) => Math.floor((ms / 1000) * SR);

/** Noise burst with exponential decay envelope. */
function burst({ ms = 200, freq = 400, q = 2, decay = 8, gain = 0.9 } = {}) {
  const n = t(ms);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-decay * i / n);
    // Cheap low-pass filtered noise ("body" of the sound)
    lp += (Math.random() * 2 - 1 - lp) * (freq / SR) * 2;
    out[i] = lp * env * gain;
  }
  return out;
}

/** Pitched tone with attack + decay (for bleeps). */
function tone({ ms = 150, from = 440, to = 220, gain = 0.6 } = {}) {
  const n = t(ms);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = from + (to - from) * (i / n);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.min(1, i / t(5)) * Math.exp(-4 * i / n);
    out[i] = Math.sin(phase) * env * gain;
  }
  shortSilence(out);
  return out;
}

function shortSilence(out) {
  // 5ms tail silence to avoid clicks at the end
  const pad = t(5);
  for (let i = out.length - pad; i < out.length; i++) out[i] = 0;
}

const C = 261.6, E = 329.6, G = 392, Cs = 277.2, Fs = 370;

export const SOUNDS = {
  gunshot: () => toWav(burst({ ms: 220, freq: 900, decay: 10, gain: 1.0 })),
  hit: () => toWav([...burst({ ms: 60, freq: 2200, decay: 14, gain: 0.8 }), ...tone({ ms: 90, from: Fs, to: C, gain: 0.4 })]),
  footstep: () => toWav(burst({ ms: 70, freq: 500, decay: 16, gain: 0.5 })),
  jump: () => toWav(tone({ ms: 120, from: C, to: G * 2, gain: 0.45 })),
  land: () => toWav(burst({ ms: 110, freq: 300, decay: 12, gain: 0.7 })),
  slide: () => toWav(burst({ ms: 420, freq: 700, decay: 3, gain: 0.55 }))
};

export function synthAll() {
  const manifest = {};
  for (const [name, fn] of Object.entries(SOUNDS)) manifest[name] = fn();
  return manifest;
}
