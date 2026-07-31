#!/usr/bin/env python3
"""Generates the demo video's voiceover WAVs with Piper TTS.

Uses the Python API instead of the CLI because the CLI's float -> int16
conversion wraps around when the model output exceeds +/-1.0, which produces
loud static bursts mid-sentence. Here the float audio is normalized and
clamped before quantization.

Usage:
    pip install piper-tts numpy
    python3 -m piper.download_voices en_US-amy-medium --data-dir voices
    python3 tts.py voices/en_US-amy-medium.onnx voice/
"""
import sys
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

LINES = [
    ("voice1.wav", "Front bell is broken. Ring at the side door in the yard. "
                   "Code four seven one one."),
    ("voice2.wav", "Heads up! The front bell is broken. Use the side door in "
                   "the yard. Code four seven one one."),
]
SENTENCE_SILENCE = 0.05  # seconds between sentence chunks
PEAK = 0.9

model = sys.argv[1]
outdir = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else "."
voice = PiperVoice.load(model)
cfg = SynthesisConfig(length_scale=0.8, normalize_audio=True)
rate = voice.config.sample_rate
gap = np.zeros(int(SENTENCE_SILENCE * rate), dtype=np.float32)

for name, text in LINES:
    chunks = [c.audio_float_array for c in voice.synthesize(text, cfg)]
    joined = []
    for i, c in enumerate(chunks):
        if i:
            joined.append(gap)
        joined.append(c)
    audio = np.concatenate(joined)
    peak = float(np.max(np.abs(audio)))
    audio = audio / peak * PEAK
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(f"{outdir}/{name}", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    print(f"{name}: {len(pcm) / rate:.2f}s @ {rate}Hz, source peak {peak:.3f}")
