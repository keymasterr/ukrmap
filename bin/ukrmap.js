#!/usr/bin/env node
/*
 * ukrmap — emit a standalone SVG map of Ukraine's regions.
 *
 *   ukrmap                              default map to stdout
 *   ukrmap -o ua.svg                    …to a file
 *   ukrmap --water=all --labels=region  every river, region names
 *   ukrmap --detail=700 --lang=en       print-quality, English
 *   ukrmap --kyiv-separate              Kyiv City as its own region
 *   ukrmap --labels=none --style=none   bare geometry for your own styling
 *
 * The emitted file needs no JavaScript. Every region carries data-key (the
 * ISO 3166-2 code) and a <title>, so hover, tooltips and choropleth coloring
 * all work from a stylesheet:
 *
 *   .ukr-region:hover        { --c: #2f6fd0 }
 *   [data-key="UA-46"]       { --c: #c0392b }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const UkrMap = require('../src/ukrmap.js');

const DETAILS = [700, 1400, 2800];

/* Twenty-five --fill flags is how nobody uses a tool. Coloring a map from a
   table is the ordinary job, so the ordinary job takes a file. Resolution of
   the keys is deferred until the geometry is loaded, because a name like
   "Харківська область" needs the data to be looked up in. */
function applyTable(data, table, opts, file) {
  const unknown = [];
  for (const raw of Object.keys(table)) {
    const key = UkrMap.key(data, raw);
    if (!key) { unknown.push(raw); continue; }
    const v = table[raw];
    const entry = (v && typeof v === 'object') ? v : { fill: v };
    if (entry.fill != null) (opts.fills = opts.fills || {})[key] = String(entry.fill);
    if (entry.title != null) {
      if (opts.titles === false) opts.titles = {};
      else if (typeof opts.titles !== 'object') opts.titles = {};
      opts.titles[key] = String(entry.title);
    }
    if (entry.name != null || entry.city != null) {
      const n = (opts.names = opts.names || {});
      n[key] = entry.city != null ? { region: entry.name, city: entry.city } : entry.name;
    }
  }
  if (unknown.length) {
    process.stderr.write(`ukrmap: ${file} has ${unknown.length} key(s) this map does not know: `
      + `${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ', …' : ''}\n`);
  }
}

const HELP = `ukrmap ${UkrMap.version} — SVG map of Ukraine's regions

  ukrmap [options]

  --detail=N         geometry level: ${DETAILS.join(' | ')} (meters). default 1400
                     700 for print, 2800 when bytes matter
  --lang=uk|en       label and <title> language. default uk
  --labels=WHICH     city | region | none. default city
  --water[=WHICH]    on by default: coastline + the Dnipro and its reservoirs.
                     coast | lakes | rivers | all | none
                     all adds the Dniester, Buh, Donets, Prypiat, Prut, Seym
  --kyiv-separate    split Kyiv City out of Kyiv Oblast (26 regions)
  --sevastopol-separate
  --no-borders       omit internal region boundaries
  --no-outline       omit the national outline
  --no-water         no coastline, rivers or reservoirs
  --no-titles        omit <title>, i.e. no native tooltips
  --style=WHICH      inline  default: colors as CSS custom properties, so a
                             stylesheet can restyle and hover works
                     attrs   colors baked onto the elements — what you want
                             for Figma, Keynote, PowerPoint or Illustrator,
                             which ignore CSS custom properties
                     none    no styling at all
  --fill KEY=COLOR   color one region, repeatable:
                     --fill UA-46=#c0392b --fill UA-63=#e8b04b
  --data FILE.json   the same thing for a whole table, which is what a real
                     job looks like. Keys are ISO 3166-2 codes or any name
                     the map answers to; UA-30 and UA-40 land on the region
                     actually drawn:

                       { "UA-46": "#c0392b",
                         "Харківська область": {
                           "fill": "#e8b04b",
                           "title": "Харківська: 42 %",
                           "name":  "Charkowskie" } }

                     A bare string is a fill. "title" replaces the region's
                     tooltip, so the value shows on hover with no tooltip
                     code; "name" relabels it, for a language that does not
                     ship. Later --fill flags win over the file.
  --palette K=V,…    override the default colors, e.g.
                     --palette land=#e7e3d6,water=#5891b6,text=#302c24
                     Keys are the custom-property names without the --ukr-
                     prefix: land line outline water hi text halo font,
                     plus glowAlpha waterOp edge hover
  --link=PATTERN     wrap each region in <a href>, {key} substituted:
                     --link=/regions/{key}
  --split DIR        write one SVG per region into DIR, plus regions.json.
                     Use with --scale so the shapes stay comparable.
  --scale=N          pixels per 1000 map units, for --split
  --pad=N            margin around the map, in map units (map is 10000 wide).
                     default 80
  --prefix=NAME      class-name prefix. default ukr
  -o, --out FILE     write here instead of stdout
  --list             print the region keys and names, then exit
  -h, --help

  Data: Natural Earth 10m admin-1, Lambert Conformal Conic. Water is at its
  pre-June-2023 extent; the Kakhovka reservoir has since been drained and
  carries data-until="2023".
`;

const die = (msg) => { process.stderr.write(`ukrmap: ${msg}\n`); process.exit(2); };

const argv = process.argv.slice(2);
const opts = { detail: 1400 };
let out = null;
let waterArg = null;
let split = null;
let dataFile = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.indexOf('=');
  const flag = eq > 0 ? a.slice(0, eq) : a;
  const val = eq > 0 ? a.slice(eq + 1) : null;

  switch (flag) {
    case '-h': case '--help': process.stdout.write(HELP); process.exit(0); break;
    case '--detail': opts.detail = Number(val); break;
    case '--lang': opts.lang = val; break;
    case '--labels': opts.labels = val; break;
    case '--water': waterArg = val === null ? 'on' : val; break;
    case '--no-water': waterArg = 'none'; break;
    case '--kyiv-separate': opts.kyivSeparate = true; break;
    case '--sevastopol-separate': opts.sevastopolSeparate = true; break;
    case '--no-borders': opts.borders = false; break;
    case '--no-outline': opts.outline = false; break;
    case '--no-titles': opts.titles = false; break;
    case '--style': opts.style = val; break;
    case '--pad': opts.pad = Number(val); break;
    case '--prefix': opts.prefix = val; break;
    case '--link': opts.link = val; break;
    case '--scale': opts.scale = Number(val); break;
    case '--split': split = val === null ? argv[++i] : val; break;
    case '--data': {
      const file = val === null ? argv[++i] : val;
      let table;
      try {
        table = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        die(`--data could not read ${file}: ${e.message}`);
      }
      if (!table || typeof table !== 'object' || Array.isArray(table)) {
        die('--data expects a JSON object of key -> color, or key -> {fill, title, name}');
      }
      dataFile = { file, table };
      break;
    }
    case '--fill': {
      const spec = val === null ? argv[++i] : val;
      const eqi = String(spec).indexOf('=');
      if (eqi < 1) die(`--fill expects KEY=COLOR, got "${spec}"`);
      opts.fills = opts.fills || {};
      opts.fills[spec.slice(0, eqi).toUpperCase()] = spec.slice(eqi + 1);
      break;
    }
    /* The demo's palette presets, from a terminal. Keys are the palette's own
       names, which are also the custom-property names without the prefix, so
       what you read in a stylesheet is what you type here. */
    case '--palette': {
      const spec = String(val === null ? argv[++i] : val);
      opts.palette = opts.palette || {};
      for (const part of spec.split(',')) {
        const eqi = part.indexOf('=');
        if (eqi < 1) die(`--palette expects KEY=VALUE[,KEY=VALUE…], got "${part}"`);
        const key = part.slice(0, eqi).trim();
        if (!(key in UkrMap.palette())) {
          die(`--palette: no such color "${key}". Try: ${Object.keys(UkrMap.palette()).join(', ')}`);
        }
        opts.palette[key] = part.slice(eqi + 1).trim();
      }
      break;
    }
    case '--list': opts.list = true; break;
    case '-o': case '--out': out = val === null ? argv[++i] : val; break;
    default:
      process.stderr.write(`ukrmap: unknown option "${a}"\n\n${HELP}`);
      process.exit(2);
  }
}

if (waterArg !== null) {
  if (waterArg === 'on' || waterArg === 'both') opts.water = true;
  else if (waterArg === 'none' || waterArg === 'off') opts.water = false;
  else if (waterArg === 'all') opts.water = { rivers: 'all' };
  else if (waterArg === 'coast') opts.water = { coast: true, lakes: false, rivers: null };
  else if (waterArg === 'lakes') opts.water = { coast: false, lakes: true, rivers: null };
  else if (waterArg === 'rivers') opts.water = { coast: false, lakes: false, rivers: 'main' };
  else die(`--water must be one of on, none, all, coast, lakes, rivers (got "${waterArg}")`);
}
if (!DETAILS.includes(opts.detail)) die(`--detail must be one of ${DETAILS.join(', ')}`);
if (opts.labels && !['city', 'region', 'none'].includes(opts.labels))
  die('--labels must be city, region or none');
if (opts.lang && !['uk', 'en'].includes(opts.lang)) die('--lang must be uk or en');
if (opts.style && !['inline', 'attrs', 'none'].includes(opts.style))
  die('--style must be inline, attrs or none');
if (opts.scale !== undefined && !(opts.scale > 0)) die('--scale must be a positive number');
if (opts.pad !== undefined && !Number.isFinite(opts.pad)) die('--pad must be a number');

const file = path.join(__dirname, '..', 'data', `ua-${opts.detail}.json`);
if (!fs.existsSync(file)) {
  process.stderr.write(`ukrmap: missing ${path.relative(process.cwd(), file)} — run build/geo.sh then build/pack.js\n`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

/* areas and populations live in their own dated file; load it if it is there */
const factFile = path.join(__dirname, '..', 'data', 'ua-facts.json');
if (fs.existsSync(factFile)) UkrMap.facts(data, JSON.parse(fs.readFileSync(factFile, 'utf8')));

/* The table is applied after the geometry is in hand — its keys may be names,
   which only the data can resolve — and before the explicit flags, so a --fill
   on the command line overrides the file it is being used to spot-check. */
if (dataFile) {
  const flagFills = opts.fills;
  opts.fills = null;
  applyTable(data, dataFile.table, opts, dataFile.file);
  if (flagFills) opts.fills = Object.assign(opts.fills || {}, flagFills);
}

if (opts.list) {
  const lang = opts.lang === 'en' ? 'en' : 'uk';
  for (const u of data.units) {
    const tag = u.parent ? `  (merged into ${u.parent} unless split)` : '';
    process.stdout.write(
      `${u.k}  ${UkrMap.fullName(u, lang).padEnd(34)} `
      + `${u.area == null ? '     ?' : String(u.area).padStart(6)} km²${tag}\n`
    );
  }
  process.exit(0);
}

if (opts.fills) {
  const known = new Set(data.units.map((u) => u.k));
  for (const k of Object.keys(opts.fills))
    if (!known.has(k)) die(`--fill: no region "${k}" (try --list)`);
}

/* one file per region, for a list or table with a shape beside each row */
if (split) {
  fs.mkdirSync(split, { recursive: true });
  const index = [];
  let bytes = 0;
  for (const u of data.units) {
    if (u.parent && !(u.k === 'UA-30' ? opts.kyivSeparate : opts.sevastopolSeparate)) continue;
    const svg = UkrMap.regionSvg(data, u.k, opts);
    const file = `${u.k}.svg`;
    fs.writeFileSync(path.join(split, file), svg + '\n');
    bytes += Buffer.byteLength(svg);
    index.push({
      key: u.k, file,
      name: { uk: UkrMap.fullName(u, 'uk'), en: UkrMap.fullName(u, 'en') },
      center: { uk: u.cuk, en: u.cen },
      area: u.area, pop: u.pop, bbox: u.bb,
    });
  }
  fs.writeFileSync(path.join(split, 'regions.json'), JSON.stringify(index, null, 2) + '\n');
  process.stderr.write(
    `ukrmap: wrote ${index.length} region SVGs + regions.json to ${split}/  `
    + `${(bytes / 1024).toFixed(0)} KB total\n`);
  process.exit(0);
}

const svg = UkrMap.render(data, opts);
if (out) {
  fs.writeFileSync(out, svg + '\n');
  const kb = (Buffer.byteLength(svg) / 1024).toFixed(1);
  process.stderr.write(`ukrmap: wrote ${out}  ${kb} KB  (detail ${opts.detail} m)\n`);
} else {
  process.stdout.write(svg + '\n');
}
