#!/usr/bin/env node
/*
 * Writes demo/data.js — the default geometry as a global, so demo/index.html
 * opens straight from disk with no server. (file:// blocks fetch, but a
 * <script src> from the same directory is fine.)
 *
 *   node build/demo.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const detail = Number(process.argv[2] || 1400);

const json = fs.readFileSync(path.join(HERE, 'data', `ua-${detail}.json`), 'utf8');
const demo = path.join(HERE, 'demo');
fs.mkdirSync(demo, { recursive: true });

fs.writeFileSync(path.join(demo, 'data.js'), 'window.UKR_DATA = ' + json + ';\n');
fs.writeFileSync(path.join(demo, 'facts.js'),
  'window.UKR_FACTS = ' + fs.readFileSync(path.join(HERE, 'data', 'ua-facts.json'), 'utf8') + ';\n');
/* The demo serves what a user would serve — dist/, not src/ — so the page is a
   working sample of the shipped file and the sizes it quotes are the real ones.
   Run build/dist.js first; `npm run build` does. */
for (const f of ['ukrmap.js', 'ukrmap-unfold.js']) {
  const from = path.join(HERE, 'dist', f);
  if (!fs.existsSync(from)) {
    console.error(`demo: dist/${f} is missing — run \`node build/dist.js\` first`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(demo, f));
}

/* The size table on the page used to be typed by hand and drifted every time
   the geometry changed. Measure it instead. */
const zlib = require('zlib');
const sizes = [700, 1400, 2800].map((d) => {
  const file = path.join(HERE, 'data', `ua-${d}.json`);
  const buf = fs.readFileSync(file);
  const parsed = JSON.parse(buf);
  const points = parsed.arcs.split(';').reduce((s2, a) => s2 + (a.split(' ').length >> 1), 0);
  return {
    detail: d,
    points,
    kb: +(buf.length / 1024).toFixed(1),
    gzip: +(zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(1),
  };
});
/* The page quoted "9.4 KB gzipped" for a component that had been 17.8 KB for
   some time. Anything the copy states as a number is measured here and read
   from UKR_SIZES, so it cannot drift again. */
const gz = (f) => +(zlib.gzipSync(fs.readFileSync(path.join(HERE, f)), { level: 9 }).length / 1024).toFixed(1);
const code = { core: gz('dist/ukrmap.js'), unfold: gz('dist/ukrmap-unfold.js') };
code.total = +(code.core + code.unfold).toFixed(1);
code.geo = sizes.find((s2) => s2.detail === detail).gzip;
fs.writeFileSync(path.join(demo, 'sizes.js'),
  'window.UKR_SIZES = ' + JSON.stringify(sizes) + ';\n'
  + 'window.UKR_CODE = ' + JSON.stringify(code) + ';\n');

const kb = (f) => (fs.statSync(path.join(demo, f)).size / 1024).toFixed(1) + ' KB';
console.log(`demo/data.js    ${kb('data.js')}  (detail ${detail} m)`);
console.log(`demo/ukrmap.js  ${kb('ukrmap.js')}`);
console.log(`demo/ukrmap-unfold.js  ${kb('ukrmap-unfold.js')}`);
console.log(`quoted in the copy: geometry ${code.geo} KB, core ${code.core} KB, `
  + `core+unfold ${code.total} KB (all gzip)`);
