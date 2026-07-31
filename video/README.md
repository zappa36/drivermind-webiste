# velovox.ai demo marketing video

`velovox-demo.mp4` — 37s, 1920×1080, 30fps, H.264, silent. A kinetic-typography
walkthrough of the product story in the site's own design language:

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

```sh
# 1. render frames (requires playwright + a chromium install)
node source/render.cjs source/demo.html frames 30 37000

# 2. assemble
ffmpeg -framerate 30 -i frames/frame_%05d.jpg \
  -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p \
  -movflags +faststart velovox-demo.mp4
```

To tweak timing or copy, edit the `--in`/`--out`/`--d`/`--wb` millisecond values
inline in `source/demo.html` — every element's delay is an absolute time on the
global timeline.
