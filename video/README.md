# velovox.ai demo marketing video

`velovox-demo.mp4` — 41s, 1920×1080, 30fps, H.264 + AAC stereo. A
kinetic-typography walkthrough of the product story in the site's own design
language, with a voiced-over tip (friendly female TTS voice) and an ambient
electronic music bed:

1. Title — wordmark + tagline
2. The problem — "The best route data isn't in your system. It's in your drivers' heads."
3. Capture — the driver says it (voice note at stop 24)
4. Check — AI structures it, a dispatcher approves in one tap
5. Inherit — the next driver hears it at exactly the right stop
6. Benefits — ramp-up, no repeated friction, compounding knowledge base
7. CTA — "See it on your routes" · velovox.ai

## Regenerating

The video is rendered from `source/demo.html`, a fixed 1920×1080 page where every
animation runs on one shared 37s timeline (CSS keyframes with absolute delays).
`source/render.cjs` pauses all animations and seeks them frame-by-frame with
Playwright, so the render is deterministic on any machine. Fonts are embedded in
`source/fonts.css` (Saira, Saira Semi Condensed, JetBrains Mono — latin subsets),
so no network is needed.

The music is synthesized from scratch by `source/music.cjs` (no samples, no
license needed): a 120 BPM ambient bed — pad chords (Am9 → Fmaj7 → Cmaj9 → G6,
resolving to C under the CTA), soft kick and bass pulses through the story
scenes, and a plucked 3-3-2 arpeggio with ping-pong echo.

The two spoken lines (the driver's voice note in Capture, the playback in
Inherit) live in `source/voice/` and were generated with [Piper
TTS](https://github.com/OHF-Voice/piper1-gpl) using the free `en_US-amy-medium`
voice — no license or attribution required:

```sh
pip install piper-tts
python3 -m piper.download_voices en_US-amy-medium --data-dir voices
echo "Front bell is broken. Ring at the side door in the yard. Code four seven one one." | \
  python3 -m piper -m voices/en_US-amy-medium.onnx --length-scale 0.8 --sentence-silence 0.05 -f source/voice/voice1.wav
echo "Heads up! The front bell is broken. Use the side door in the yard. Code four seven one one." | \
  python3 -m piper -m voices/en_US-amy-medium.onnx --length-scale 0.8 --sentence-silence 0.05 -f source/voice/voice2.wav
```

`source/mix.cjs` places the voices at 10.4s / 25.3s (matching the on-screen
word reveal) and ducks the music ≈7.5 dB under them with smooth ramps.

```sh
# 1. render frames (requires playwright + a chromium install)
node source/render.cjs source/demo.html frames 30 41000

# 2. generate the music bed and mix in the voiceover
node source/music.cjs music.wav
node source/mix.cjs music.wav audio.wav source/voice/voice1.wav@10.4 source/voice/voice2.wav@25.3

# 3. assemble
ffmpeg -framerate 30 -i frames/frame_%05d.jpg -i audio.wav \
  -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest \
  -movflags +faststart velovox-demo.mp4
```

To tweak timing or copy, edit the `--in`/`--out`/`--d`/`--wb`/`--ws` millisecond
values inline in `source/demo.html` — every element's delay is an absolute time
on the global timeline (`--ws` is the per-word caption pace, set to track the
spoken lines). The music's section boundaries live in the `CHORDS` table and
arrangement block of `source/music.cjs`. If you change a spoken line, regenerate
the voice WAV, then re-check the word pacing and voice start times.
