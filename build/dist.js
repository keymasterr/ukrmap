#!/usr/bin/env node
/*
 * Writes dist/ — ready-made files, so nobody has to run a build to get a map.
 *
 *   node build/dist.js
 *
 * The CLI exists for the cases these do not cover; most people just want a
 * file they can download and drop in.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const UkrMap = require('../src/ukrmap.js');
const { strip, verify, sampler } = require('./strip.js');

const HERE = path.join(__dirname, '..');
const DIST = path.join(HERE, 'dist');
const FACTS = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'ukrmap-facts.json'), 'utf8'));
const load = (d) => UkrMap.facts(
  JSON.parse(fs.readFileSync(path.join(HERE, 'data', `ukrmap-${d}.json`), 'utf8')), FACTS);

const FILES = [
  ['ukrmap.svg',           1400, {}, 'default — city labels, coastline, the Dnipro'],
  ['ukrmap-en.svg',        1400, { lang: 'en' }, 'same, English'],
  ['ukrmap-regions.svg',   1400, { labels: 'region' }, 'region names instead of centers'],
  ['ukrmap-blank.svg',     1400, { labels: 'none', water: false }, 'geometry only — color it yourself'],
  ['ukrmap-print.svg',      700, { water: { rivers: 'all' } }, 'print detail, every river'],
  ['ukrmap-small.svg',     2800, {}, 'coarse geometry, smallest file'],
  /* The one file whose whole job is to be opened in a design tool, so it is
     the one file that states its own size: 1600 px, with the baked line
     weights tuned to match. Imported, it arrives ready instead of ten
     thousand pixels wide with everything to re-decide. */
  ['ukrmap-baked.svg',      1400, { style: 'attrs', width: 1600 }, 'colors baked on, 1600 px — for Figma, Keynote, Illustrator'],
  ['ukrmap-baked-en.svg',   1400, { style: 'attrs', lang: 'en', width: 1600 }, 'same, English'],
];

fs.mkdirSync(DIST, { recursive: true });

const rows = [];
for (const [name, detail, opts, note] of FILES) {
  const svg = UkrMap.render(load(detail), opts) + '\n';
  fs.writeFileSync(path.join(DIST, name), svg);
  rows.push({
    file: name,
    detail: detail + ' m',
    KB: +(Buffer.byteLength(svg) / 1024).toFixed(1),
    gzip: +(zlib.gzipSync(Buffer.from(svg), { level: 9 }).length / 1024).toFixed(1),
    note,
  });
}

/* one SVG per region, at a shared scale so the shapes stay comparable */
const REG = path.join(DIST, 'regions');
fs.rmSync(REG, { recursive: true, force: true });
fs.mkdirSync(REG, { recursive: true });

const data = load(1400);
const index = [];
let regBytes = 0;
for (const u of data.units) {
  if (u.parent) continue;
  const svg = UkrMap.regionSvg(data, u.k, { scale: 160, style: 'attrs' }) + '\n';
  fs.writeFileSync(path.join(REG, u.k + '.svg'), svg);
  regBytes += Buffer.byteLength(svg);
  index.push({
    key: u.k,
    file: u.k + '.svg',
    name: { uk: UkrMap.fullName(u, 'uk'), en: UkrMap.fullName(u, 'en') },
    center: { uk: u.cuk, en: u.cen },
    area: u.area,
    pop: u.pop,
    bbox: u.bb,
  });
}
fs.writeFileSync(path.join(REG, 'regions.json'), JSON.stringify(index, null, 2) + '\n');
fs.copyFileSync(path.join(HERE, 'data', 'ukrmap-facts.json'), path.join(DIST, 'ukrmap-facts.json'));

/* The same table as CSV. An analyst arriving with pandas or R wants to join on
   a key and does not want to flatten JSON first, and this is two lines to
   write. Semicolon-free, UTF-8, ISO code first so it lines up with the SVG. */
{
  const rows = [['key', 'name_uk', 'name_en', 'center_uk', 'center_en', 'area_km2', 'pop_k']];
  for (const u of data.units) {
    rows.push([
      u.k, UkrMap.fullName(u, 'uk'), UkrMap.fullName(u, 'en'), u.cuk, u.cen,
      u.area == null ? '' : u.area, u.pop == null ? '' : u.pop,
    ]);
  }
  const csv = rows.map((r) => r.map((v) => {
    const t = String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(DIST, 'ukrmap-facts.csv'), csv);
}

/* lon/lat GeoJSON, with the names attached, for anyone bringing their own
   projection. Simplified identically to data/ukrmap-1400.json. */
const { UNITS } = require('./meta.js');
const byKey = new Map(UNITS.map((m) => [m.k, m]));
const src = path.join(process.env.UKRMAP_CACHE || path.join(HERE, 'build/cache'), 'units-1400-wgs84.json');
if (fs.existsSync(src)) {
  const geo = JSON.parse(fs.readFileSync(src, 'utf8'));
  for (const f of geo.features) {
    const m = byKey.get(f.properties.key) || {};
    f.properties = {
      key: f.properties.key,
      name_uk: m.uk, name_en: m.en,
      center_uk: m.cuk, center_en: m.cen,
      ...(m.parent ? { parent: m.parent } : {}),
    };
  }
  geo.note = 'Natural Earth 10m admin-1, coastal lagoons erased, simplified at '
    + '1400 m in Lambert Conformal Conic then unprojected. Crimea (UA-43) and '
    + 'Sevastopol (UA-40) are Ukrainian.';
  const out = path.join(DIST, 'ukrmap-wgs84.geo.json');
  fs.writeFileSync(out, JSON.stringify(geo));
  rows.push({
    file: 'ukrmap-wgs84.geo.json', detail: '1400 m',
    KB: +(fs.statSync(out).size / 1024).toFixed(1),
    gzip: +(zlib.gzipSync(fs.readFileSync(out), { level: 9 }).length / 1024).toFixed(1),
    note: 'lon/lat GeoJSON — bring your own projection (d3 etc.)',
  });
} else {
  console.warn('dist: no wgs84 cache yet — run ./build/geo.sh');
}

/* ------------------------------------------------------------------ *
 * The code, with the prose taken out.
 *
 * src/ is written to be read: 43% of its gzipped weight is comment. That is
 * the right shape for the file you learn from and the wrong one for the file
 * you serve, and the README used to apologise for the difference rather than
 * fix it. Stripping is the only transform in the project, it is verified
 * against the annotated source every time it runs, and src/ still ships — so
 * nothing is hidden, it is just not on the wire.
 * ------------------------------------------------------------------ */
const CODE = [
  ['ukrmap.js', 'src/ukrmap.js', 'the map itself'],
  ['ukrmap-unfold.js', 'src/ukrmap-unfold.js', 'the map ⇄ grid animation, opt-in'],
];

const sample = sampler(
  (d) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', `ukrmap-${d}.json`), 'utf8')), FACTS);

const codeRows = [];
for (const [name, from, note] of CODE) {
  const src2 = fs.readFileSync(path.join(HERE, from), 'utf8');
  const banner = `/*! ukrmap ${UkrMap.version} · ${name} · MIT · comments stripped;`
    + ` the annotated source is ${from} */`;
  const out = verify(src2, strip(src2, banner), name === 'ukrmap.js' ? sample : null);
  fs.writeFileSync(path.join(DIST, name), out);
  codeRows.push({
    file: name,
    'src KB': +(Buffer.byteLength(src2) / 1024).toFixed(1),
    'src gzip': +(zlib.gzipSync(Buffer.from(src2), { level: 9 }).length / 1024).toFixed(1),
    KB: +(Buffer.byteLength(out) / 1024).toFixed(1),
    gzip: +(zlib.gzipSync(Buffer.from(out), { level: 9 }).length / 1024).toFixed(1),
    note,
  });
}

/* ------------------------------------------------------------------ *
 * The README quotes sizes, and every one of them had drifted: it advertised a
 * 17.0 KB component that was 19.1, and 14.3 KB of geometry that was 13.8. The
 * numbers are the pitch, so they are written from the files rather than typed.
 * ------------------------------------------------------------------ */
const NOTES = {
  'ukrmap.svg': 'default — city labels, coastline, the Dnipro',
  'ukrmap-en.svg': 'the same in English',
  'ukrmap-regions.svg': 'region names instead of centers',
  'ukrmap-blank.svg': 'geometry only, color it yourself',
  'ukrmap-baked.svg': 'colors baked on, 1600 px — for Figma, Keynote, Illustrator',
  'ukrmap-print.svg': '700 m detail, every river',
  'ukrmap-small.svg': 'coarsest of the three',
};
/* one decimal always: a bare "13 KB" next to "16.8 KB" reads as a rounding */
const kb1 = (n) => Number(n).toFixed(1);
const kbOf = (f) => kb1(zlib.gzipSync(fs.readFileSync(path.join(HERE, f)), { level: 9 }).length / 1024);
const rawOf = (f) => kb1(fs.statSync(path.join(HERE, f)).size / 1024);

const filesTable = ['| | | |', '|---|---|---:|']
  .concat(Object.keys(NOTES).map((f) => {
    const r = rows.find((x) => x.file === f);
    return `| [\`${f}\`](dist/${f}) | ${NOTES[f]} | ${kb1(r.gzip)} KB |`;
  }))
  .concat(`| [\`dist/regions/\`](dist/regions/) | one SVG per region + \`regions.json\` | ${(regBytes / 1024).toFixed(0)} KB raw |`)
  .join('\n');

const core = codeRows[0], expl = codeRows[1];
const sizesTable = [
  '| | raw | gzip |', '|---|---:|---:|',
  `| geometry, default detail | ${rawOf('data/ukrmap-1400.json')} KB | **${kbOf('data/ukrmap-1400.json')} KB** |`,
  `| geometry, \`--detail=2800\` | ${rawOf('data/ukrmap-2800.json')} KB | ${kbOf('data/ukrmap-2800.json')} KB |`,
  `| areas + populations (separate) | ${rawOf('data/ukrmap-facts.json')} KB | ${kbOf('data/ukrmap-facts.json')} KB |`,
  `| \`dist/ukrmap.js\` — the component, optional | ${kb1(core.KB)} KB | ${kb1(core.gzip)} KB |`,
  `| \`dist/ukrmap-unfold.js\` — opt-in on top | ${kb1(expl.KB)} KB | ${kb1(expl.gzip)} KB |`,
  `| \`src/ukrmap.js\` — the same code, annotated | ${kb1(core['src KB'])} KB | ${kb1(core['src gzip'])} KB |`,
  `| emitted SVG, default | ${kb1(rows[0].KB)} KB | ${kb1(rows[0].gzip)} KB |`,
].join('\n');

const readme = path.join(HERE, 'README.md');
let md = fs.readFileSync(readme, 'utf8');
const before = md;
for (const [tag, body] of [['files', filesTable], ['sizes', sizesTable]]) {
  const re = new RegExp(`(<!-- ${tag}:start[^>]*-->)[\\s\\S]*?(<!-- ${tag}:end -->)`);
  if (!re.test(md)) throw new Error(`dist: README has no ${tag} block`);
  md = md.replace(re, `$1\n${body}\n$2`);
}
if (md !== before) fs.writeFileSync(readme, md);

console.table(rows);
console.log(`dist/regions/  ${index.length} files + regions.json  ${(regBytes / 1024).toFixed(0)} KB total`);
console.table(codeRows);
console.log(`README.md      size tables ${md === before ? 'already current' : 'updated'}`);
