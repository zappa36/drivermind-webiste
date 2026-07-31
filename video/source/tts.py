#!/usr/bin/env python3
"""Generates the demo video's voiceover WAVs with Piper TTS.

Two speakers: the driver's voice note (male, en_US-ryan-medium) and the app's
playback at the next stop (friendly female, en_US-hfc_female-medium).

Uses the Python API instead of the CLI because the CLI's float -> int16
conversion wraps around when the model output exceeds +/-1.0, which produces
loud static bursts mid-sentence. Here the float audio is normalized and
clamped before quantization. The lines are phrased with commas instead of
full stops (same words as the on-screen captions) so the delivery flows
instead of pausing hard at each sentence break.

Usage:
    pip install piper-tts numpy
    python3 -m piper.download_voices en_US-ryan-medium --data-dir voices
    python3 -m piper.download_voices en_US-hfc_female-medium --data-dir voices
    python3 tts.py voices/ voice/
"""
import sys
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

VOICES = {
    # speaker -> (model name, length_scale)
    "driver": ("en_US-ryan-medium", 0.95),
    "app": ("en_US-hfc_female-medium", 0.85),
}
LINES = [
    ("voice1.wav", "driver", "Front bell is broken, ring at the side door in "
                             "the yard — code four seven one one."),
    ("voice2.wav", "app", "Heads up! The front bell is broken, use the side "
                          "door in the yard, code four seven one one."),
]
SENTENCE_SILENCE = 0.05  # seconds between sentence chunks
PEAK = 0.9

model_dir = sys.argv[1].rstrip("/")
outdir = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else "."
loaded = {}

for name, speaker, text in LINES:
    model, length_scale = VOICES[speaker]
    if speaker not in loaded:
        loaded[speaker] = PiperVoice.load(f"{model_dir}/{model}.onnx")
    voice = loaded[speaker]
    cfg = SynthesisConfig(length_scale=length_scale, normalize_audio=True)
    rate = voice.config.sample_rate
    gap = np.zeros(int(SENTENCE_SILENCE * rate), dtype=np.float32)
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
    print(f"{name} ({speaker}/{model}): {len(pcm) / rate:.2f}s @ {rate}Hz")
