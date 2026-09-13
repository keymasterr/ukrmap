#!/usr/bin/env node
/*
 * Assembles ./site — the demo and the 2012 original as one folder you can
 * upload as it stands.
 *
 *   node build/site.js            (npm run site; run `npm run build` first)
 *
 * The demo is written to be opened from disk, so it reaches sideways for the
 * files it offers: ../dist/. That path does not survive being served from a
 * URL, so it is rewritten here rather than in the page — the page keeps
 * working from disk, which is how it is developed. The 2012 page is linked by
 * its address on the site instead, so that link holds wherever the page is
 * opened: from a clone, from disk, or from the site itself.
 *
 *   site/
 *     index.html        the demo
 *     ukrmap.js …       the component and the data it loads
 *     files/            what the copy links to: the ready-made SVGs
 *     2012/             the original page, if ../page-2012 is next to the repo
 *
 * The 2012 page is not in the repository — it is one folder up, outside it,
 * because it belongs to the site rather than to the component. If it is not
 * there, everything else is still assembled and the run says so.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const SITE = path.join(HERE, 'site');
const ORIGINAL = path.join(HERE, '..', 'page-2012');

/* Editor droppings and working files are not part of the deliverable. The
   sublime workspace in particular carries local paths from another machine. */
const SKIP = /^\.DS_Store$|\.sublime-|\.psd$/;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.test(name)) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function need(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`site: ${what} is missing at ${p}`);
    process.exit(1);
  }
}

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });

/* --- the demo, with its sideways links brought inside ------------------- */
need(path.join(HERE, 'demo', 'data.js'), 'demo/data.js — run `npm run build`');
let page = fs.readFileSync(path.join(HERE, 'demo', 'index.html'), 'utf8');
page = page.split('../dist/').join('files/');

/* Analytics belongs to the site, not to the project: a clone of the repository
   should not phone anybody's home. The tag lives at the site root and is added
   to the copy that goes there. */
page = page.replace('</head>', '<script async src="/gtag.js"></script>\n</head>');
fs.writeFileSync(path.join(SITE, 'index.html'), page);

for (const f of ['ukrmap.js', 'ukrmap-unfold.js', 'data.js', 'facts.js', 'sizes.js']) {
  need(path.join(HERE, 'demo', f), `demo/${f} — run \`npm run build\``);
  fs.copyFileSync(path.join(HERE, 'demo', f), path.join(SITE, f));
}

/* --- the files the page offers ----------------------------------------- */
const files = path.join(SITE, 'files');
fs.mkdirSync(files, { recursive: true });
for (const f of fs.readdirSync(path.join(HERE, 'dist'))) {
  const src = path.join(HERE, 'dist', f);
  if (fs.statSync(src).isDirectory()) continue;      /* dist/regions/ is a CLI recipe */
  if (f.endsWith('.js')) continue;                   /* already at the site root */
  fs.copyFileSync(src, path.join(files, f));
}

/* --- the 2012 page, if it is here ------------------------------------- */
if (fs.existsSync(ORIGINAL)) copyDir(ORIGINAL, path.join(SITE, '2012'));
else console.log('site:  ../page-2012 is not here, so site/2012/ is not in this build');

/* --- what came out ------------------------------------------------------ */
let bytes = 0, count = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else { bytes += fs.statSync(p).size; count++; }
  }
}(SITE));

const unresolved = (page.match(/(?:src|href)="\.\.\/[^"]*"/g) || []);
if (unresolved.length) {
  console.error('site: the page still points outside itself:\n  ' + unresolved.join('\n  '));
  process.exit(1);
}

console.log(`site/  ${count} files, ${(bytes / 1024).toFixed(0)} KB`);
console.log('       index.html · files/ · 2012/');
