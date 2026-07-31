#!/usr/bin/env node
/*
 * Generates the royalty-free background music for the demo video as a WAV
 * file — synthesized from scratch so there is nothing to license.
 *
 * 41s, 44.1kHz stereo, 120 BPM, keyed to the video's scene timeline:
 *   0–4s    title     — pad swell only
 *   4–9s    problem   — bass enters on bar starts
 *   9–32s   the loop  — kick pulse + plucked arpeggio with ping-pong echo
 *           (voiceover sits on top at ~10.4s and ~25.3s; ducking happens in mix.cjs)
 *   32–36s  benefits  — fullest section
 *   36–41s  CTA       — pulses stop, chord resolves to C, fade out
 *
 * Usage:  node music.cjs [out.wav]
 */
const fs = require('fs');

const SR = 44100;
const DUR = 41.0;
const N = Math.round(SR * DUR);
const L = new Float64Array(N);
const R = new Float64Array(N);

const TAU = Math.PI * 2;

// deterministic phase source so every render is bit-identical
let seed = 0x5eed;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/* ---------- note helpers ---------- */
// chord schedule: [start, end, pad voicing (Hz), bass root (Hz), arp set (Hz)]
const A3 = 220.0, C4 = 261.63, E4 = 329.63, G4 = 392.0, B4 = 493.88;
const F3 = 174.61, G3 = 196.0, B3 = 246.94, D4 = 293.66;
const A4 = 440.0, C5 = 523.25, E5 = 659.26, D5 = 587.33, F4 = 349.23, G5 = 783.99;
const CHORDS = [
  [0,  4,  [A3, C4, E4, B4],      110.00, [A4, B4, C5, E5]], // Am9
  [4,  8,  [F3, A3, C4, E4],      87.31,  [A4, C5, E5, F4]], // Fmaj7
  [8,  12, [G3, C4, E4, D4],      130.81, [C5, D5, E5, G4]], // Cmaj9
  [12, 16, [G3, B3, D4, E4],      98.00,  [B4, D5, E5, G5]], // G6
  [16, 20, [A3, C4, E4, B4],      110.00, [A4, B4, C5, E5]],
  [20, 24, [F3, A3, C4, E4],      87.31,  [A4, C5, E5, F4]],
  [24, 28, [G3, C4, E4, D4],      130.81, [C5, D5, E5, G4]],
  [28, 32, [G3, B3, D4, E4],      98.00,  [B4, D5, E5, G5]],
  [32, 36, [F3, A3, C4, E4],      87.31,  [A4, C5, E5, F4]], // benefits
  [36, 41, [G3, C4, E4, D4],      130.81, [C5, D5, E5, G4]], // resolve on C
];

/* ---------- voices ---------- */
// pad note: warm additive tone, slow attack/release, slight L/R detune + slow shimmer
function pad(freq, start, end, gain) {
  const a = 1.1, rel = 1.9;
  const s0 = Math.max(0, Math.round(start * SR));
  const s1 = Math.min(N, Math.round((end + rel) * SR));
  const det = 1.0015; // cents-scale detune between channels
  const phL = rand() * TAU, phH = rand() * TAU, phR = rand() * TAU;
  for (let i = s0; i < s1; i++) {
    const t = i / SR - start;
    const tEnd = i / SR - end;
    let env = t < a ? t / a : 1;
    if (tEnd > 0) env *= Math.exp(-tEnd / (rel * 0.45));
    const shimmer = 1 + 0.12 * Math.sin(TAU * 0.31 * t + phH);
    const e = env * gain * shimmer;
    const wl = Math.sin(TAU * freq * t + phL) + 0.22 * Math.sin(TAU * freq * 2 * t + phH) + 0.10 * Math.sin(TAU * freq * 0.5 * t);
    const wr = Math.sin(TAU * freq * det * t + phR) + 0.22 * Math.sin(TAU * freq * det * 2 * t + phL) + 0.10 * Math.sin(TAU * freq * det * 0.5 * t);
    L[i] += wl * e;
    R[i] += wr * e;
  }
}

// bass note: sine + sub, rounded attack
function bass(freq, start, dur, gain) {
  const s0 = Math.max(0, Math.round(start * SR));
  const s1 = Math.min(N, Math.round((start + dur) * SR));
  for (let i = s0; i < s1; i++) {
    const t = i / SR - start;
    const attack = Math.min(1, t / 0.04);
    const decay = Math.exp(-t / (dur * 0.55));
    const e = attack * decay * gain;
    const w = Math.sin(TAU * freq * t) + 0.35 * Math.sin(TAU * freq * 0.5 * t);
    L[i] += w * e;
    R[i] += w * e;
  }
}

// kick: quick pitch drop, soft
function kick(start, gain) {
  const s0 = Math.max(0, Math.round(start * SR));
  const s1 = Math.min(N, s0 + Math.round(0.28 * SR));
  let phase = 0;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const f = 42 + 85 * Math.exp(-t / 0.045);
    phase += (TAU * f) / SR;
    const e = Math.exp(-t / 0.085) * gain;
    const w = Math.sin(phase) * e;
    L[i] += w;
    R[i] += w;
  }
}

// pluck for the arpeggio, rendered into its own buffer so it can be echoed
const AL = new Float64Array(N);
const AR = new Float64Array(N);
function pluck(freq, start, gain, pan) {
  const s0 = Math.max(0, Math.round(start * SR));
  const s1 = Math.min(N, s0 + Math.round(0.5 * SR));
  const gl = gain * (1 - pan) * 0.5 + gain * 0.5;
  const gr = gain * (1 + pan) * 0.5 + gain * 0.5;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const e = Math.exp(-t * 7.5) * Math.min(1, t / 0.004);
    const w = (Math.sin(TAU * freq * t) + 0.25 * Math.sin(TAU * freq * 2 * t) * Math.exp(-t * 12)) * e;
    AL[i] += w * gl * 0.5;
    AR[i] += w * gr * 0.5;
  }
}

/* ---------- arrangement ---------- */
const PAD_G = 0.070, BASS_G = 0.17, KICK_G = 0.16, ARP_G = 0.16;

for (const [cs, ce, notes, root, arpSet] of CHORDS) {
  for (const f of notes) pad(f, cs, ce - 0.25, PAD_G);

  // bass: bar starts only during "problem", then a half-time pulse; long resolve at 36s
  if (cs >= 36) {
    bass(root, cs, 4.6, BASS_G * 1.1);
  } else {
    for (let t = cs; t < Math.min(ce, 36); t += 1.0) {
      if (t < 4) continue;
      if (t < 9 && t % 2 !== 0) continue; // sparse (bar starts) before the story begins
      bass(root, t, 0.92, BASS_G);
    }
  }
}

// kick pulse through the story + benefits (9–36s), half-time
for (let t = 9; t < 36; t += 1.0) kick(t, KICK_G);

// arpeggio: 3-3-2 rhythm in eighths (hits at 0, .75, 1.5 in each 2s bar), 9–36s
let arpIdx = 0;
for (let bar = 8; bar < 36; bar += 2) {
  for (const off of [0, 0.75, 1.5]) {
    const t = bar + off;
    if (t < 9 || t >= 36) continue;
    const chord = CHORDS.find(([cs, ce]) => t >= cs && t < ce);
    if (!chord) continue;
    const set = chord[4];
    const note = set[arpIdx % set.length];
    const pan = (arpIdx % 2 === 0 ? -0.55 : 0.55);
    // second voice an octave down joins for the inherit + benefits scenes
    pluck(note, t, ARP_G, pan);
    if (t >= 25) pluck(note / 2, t, ARP_G * 0.55, -pan);
    arpIdx++;
  }
}

// ping-pong echo on the arp bus: dotted eighth (0.375s), decaying, channels swapped
const D = Math.round(0.375 * SR);
for (let i = D; i < N; i++) {
  AL[i] += AR[i - D] * 0.38;
  AR[i] += AL[i - D] * 0.38;
}
for (let i = 0; i < N; i++) { L[i] += AL[i]; R[i] += AR[i]; }

/* ---------- master envelope, normalize, write ---------- */
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t < 1.5) g *= t / 1.5;                       // fade in
  if (t > 39.0) g *= Math.max(0, (DUR - t) / 2.0); // fade out
  L[i] *= g;
  R[i] *= g;
}
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = 0.84 / peak;
console.log(`peak ${peak.toFixed(3)} -> normalizing by ${norm.toFixed(3)}`);

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
const file = process.argv[2] || 'music.wav';
fs.writeFileSync(file, out);
console.log(`wrote ${file}: ${DUR}s, ${(out.length / 1024 / 1024).toFixed(1)}MB`);
