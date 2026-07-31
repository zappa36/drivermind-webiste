/*
 * Builds preview.html from index.html.
 *
 * index.html loads its typefaces from Google Fonts. Sandboxed preview hosts
 * (and the artifact CSP) block external font requests, which silently drops
 * Saira and JetBrains Mono to a generic sans and changes the whole page.
 * This inlines the four faces the page actually renders as woff2 data URIs
 * and strips the document shell, since the preview host supplies its own.
 *
 * Fonts come from the Fontsource npm packages (SIL Open Font License).
 * Usage: node build-preview.js <dir-with-extracted-fontsource-packages>
 */
const fs = require('fs');
const path = require('path');

const FONT_DIR = process.argv[2];
if (!FONT_DIR) {
  console.error('usage: node build-preview.js <fontsource-dir>');
  process.exit(1);
}

// Only the weights the stylesheet actually uses. Saira renders at 400 only,
// Saira Semi Condensed at 600/700 (h3/.btn and h1,h2/.wordmark), and
// JetBrains Mono at 400 for eyebrows, meta lines, and labels.
const FACES = [
  ['Saira', 400, 'fontsource-saira-5.3.0/package/files/saira-latin-400-normal.woff2'],
  ['Saira Semi Condensed', 600, 'fontsource-saira-semi-condensed-5.3.0/package/files/saira-semi-condensed-latin-600-normal.woff2'],
  ['Saira Semi Condensed', 700, 'fontsource-saira-semi-condensed-5.3.0/package/files/saira-semi-condensed-latin-700-normal.woff2'],
  ['JetBrains Mono', 400, 'fontsource-jetbrains-mono-5.3.0/package/files/jetbrains-mono-latin-400-normal.woff2'],
];

const faceCss = FACES.map(([family, weight, file]) => {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `  @font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;` +
         `src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('\n');

let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Drop the Google Fonts preconnects and stylesheet link.
html = html.replace(/^\s*<link rel="preconnect"[^>]*>\n/gm, '');
html = html.replace(/^\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n/gm, '');

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
