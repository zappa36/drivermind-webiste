/*
 * Builds preview.html from index.html.
 *
 * index.html loads DM Sans (the Milevox design-system face) from fonts/.
 * Sandboxed preview hosts (and the artifact CSP) block that relative request,
 * which silently drops the page to a generic sans. This inlines the variable
 * DM Sans Latin face as a woff2 data URI and strips the document shell, since
 * the preview host supplies its own.
 *
 * Fonts: fonts/DMSans-*.woff2 (Google Fonts v17, SIL Open Font License).
 * Usage: node build-preview.js
 */
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, 'fonts');

// One variable file covers every weight the stylesheet uses (400 body,
// 500 kickers, 600 headings/buttons, 700 display). The page has no italics,
// and Latin Extended is only needed for accented names, so the preview
// carries just the basic Latin subset to stay small.
const FACES = [
  ['DM Sans', 'normal', '100 1000', 'DMSans-Latin.woff2'],
];

const faceCss = FACES.map(([family, style, weight, file]) => {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `  @font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;` +
         `src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('\n');

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// The artifact CSP blocks outbound requests, so the preview ships with the
// Google Analytics id blanked — no cookie bar, no gtag load in previews —
// and the ElevenLabs agent ids blanked, which keeps the try section hidden.
html = html.replace(/var GA_ID = '[^']*'/, "var GA_ID = ''");
html = html.replace(/var AGENTS = \[[\s\S]*?\];/, (m) => m.replace(/', '[^']*'\]/g, "', '']"));

// Drop the local font stylesheet link; the faces are inlined below.
html = html.replace(/^\s*<link href="fonts\/[^"]*\.css"[^>]*>\n/gm, '');

// Inline the faces at the top of the existing stylesheet.
html = html.replace('<style>\n', `<style>\n${faceCss}\n`);

// Strip the document shell — the preview host wraps content in its own.
html = html
  .replace(/<!DOCTYPE html>\n/i, '')
  .replace(/<html lang="en">\n/i, '')
  .replace(/<head>\n/i, '')
  .replace(/<\/head>\n/i, '')
  .replace(/<body>\n/i, '')
  .replace(/<\/body>\n/i, '')
  .replace(/<\/html>\n?/i, '')
  .replace(/^\s*<meta charset[^>]*>\n/gm, '')
  .replace(/^\s*<meta name="viewport"[^>]*>\n/gm, '')
  .replace(/^\s*<meta name="description"[^>]*>\n/gm, '');

fs.writeFileSync(path.join(__dirname, 'preview.html'), html.trim() + '\n');

const kb = (s) => Math.round(s / 1024) + ' KB';
console.log('preview.html written:', kb(fs.statSync(path.join(__dirname, 'preview.html')).size));
