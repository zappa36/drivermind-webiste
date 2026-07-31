#!/usr/bin/env node
/*
 * Mixes the music bed with the voiceover lines for the demo video.
 * The music is ducked ~7.5dB under each voice line with smooth ramps.
 *
 * Usage:
 *   node mix.cjs music.wav out.wav voice1.wav@10.4 voice2.wav@25.3 ...
 *
 * Accepts 16-bit PCM WAV inputs; voice files may be mono and/or a different
 * sample rate (piper outputs 22.05kHz mono) — they are resampled to the
 * music's rate and centered in the stereo field.
 */
const fs = require('fs');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`${file}: not a WAV`);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') data = b.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt/data chunk`);
  if (fmt.bits !== 16) throw new Error(`${file}: expected 16-bit PCM`);
  const frames = Math.floor(data.length / 2 / fmt.channels);
  const L = new Float64Array(frames), R = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = data.readInt16LE(i * 2 * fmt.channels) / 32768;
    L[i] = l;
    R[i] = fmt.channels > 1 ? data.readInt16LE(i * 2 * fmt.channels + 2) / 32768 : l;
  }
  return { rate: fmt.rate, L, R };
}

const [musicFile, outFile, ...voiceArgs] = process.argv.slice(2);
const music = readWav(musicFile);
const SR = music.rate;
const N = music.L.length;

const VOICE_RMS = 0.2;      // ≈ -14 dBFS speech loudness in the mix
const VOICE_PEAK_CAP = 0.95;
const DUCK = 0.42;        // music gain under speech (~ -7.5dB)
const RAMP = 0.3;         // seconds
const duck = new Float64Array(N).fill(1);
const VL = new Float64Array(N), VR = new Float64Array(N);

for (const arg of voiceArgs) {
  const at = arg.lastIndexOf('@');
  const file = arg.slice(0, at);
  const start = parseFloat(arg.slice(at + 1));
  const v = readWav(file);
  const ratio = v.rate / SR;
  const outFrames = Math.floor(v.L.length / ratio);
  // normalize by loudness (RMS), not peak — takes with one sharp consonant
  // would otherwise land several dB quieter than smoother takes
  let peak = 0, sum = 0;
  for (let i = 0; i < v.L.length; i++) {
    peak = Math.max(peak, Math.abs(v.L[i]));
    sum += v.L[i] * v.L[i];
  }
  const rms = Math.sqrt(sum / v.L.length);
  let g = VOICE_RMS / rms;
  if (peak * g > VOICE_PEAK_CAP) g = VOICE_PEAK_CAP / peak;
  const s0 = Math.round(start * SR);
  for (let i = 0; i < outFrames && s0 + i < N; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src), frac = src - i0;
    const s = v.L[i0] * (1 - frac) + (v.L[i0 + 1] ?? v.L[i0]) * frac;
    VL[s0 + i] += s * g;
    VR[s0 + i] += s * g;
  }
  // duck window with linear ramps on both sides
  const dur = outFrames / SR;
  const d0 = start - 0.2, d1 = start + dur + 0.2;
  for (let i = Math.max(0, Math.round((d0 - RAMP) * SR)); i < Math.min(N, Math.round((d1 + RAMP) * SR)); i++) {
    const t = i / SR;
    let gDuck = DUCK;
    if (t < d0) gDuck = 1 - (1 - DUCK) * (t - (d0 - RAMP)) / RAMP;
    else if (t > d1) gDuck = DUCK + (1 - DUCK) * (t - d1) / RAMP;
    duck[i] = Math.min(duck[i], gDuck);
  }
  console.log(`${file} @ ${start}s, ${dur.toFixed(2)}s, gain ${g.toFixed(2)}`);
}

const L = new Float64Array(N), R = new Float64Array(N);
for (let i = 0; i < N; i++) {
  L[i] = music.L[i] * duck[i] + VL[i];
  R[i] = music.R[i] * duck[i] + VR[i];
}
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = Math.min(1, 0.89 / peak);
console.log(`mix peak ${peak.toFixed(3)}, scaling by ${norm.toFixed(3)}`);

const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
fs.writeFileSync(outFile, out);
console.log(`wrote ${outFile}`);
