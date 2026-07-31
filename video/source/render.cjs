#!/usr/bin/env node
/*
 * Renders demo.html to JPEG frames by pausing every CSS animation and
 * seeking the shared timeline frame-by-frame, so output is deterministic
 * regardless of machine speed.
 *
 * Usage:
 *   node render.cjs [demo.html] [framesDir] [fps] [durationMs]
 *
 * Then assemble with ffmpeg:
 *   ffmpeg -framerate 30 -i frames/frame_%05d.jpg \
 *     -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p \
 *     -movflags +faststart velovox-demo.mp4
 *
 * Requires playwright (any install; browsers via PLAYWRIGHT_BROWSERS_PATH).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const html = path.resolve(process.argv[2] || path.join(__dirname, 'demo.html'));
  const outDir = path.resolve(process.argv[3] || 'frames');
  const fps = Number(process.argv[4] || 30);
  const durationMs = Number(process.argv[5] || 37000);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('file://' + html);
  await page.evaluate(() => document.fonts.ready);
  const count = await page.evaluate(() => {
    const anims = document.getAnimations();
    anims.forEach((a) => a.pause());
    return anims.length;
  });
  console.log(`paused ${count} animations`);

  const totalFrames = Math.round((durationMs / 1000) * fps);
  for (let f = 0; f < totalFrames; f++) {
    const t = (f * 1000) / fps;
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) a.currentTime = ms;
    }, t);
    await page.screenshot({
      path: path.join(outDir, `frame_${String(f).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 92,
    });
    if (f % 150 === 0) console.log(`frame ${f}/${totalFrames}`);
  }
  await browser.close();
  console.log(`done: ${totalFrames} frames -> ${outDir}`);
})();
