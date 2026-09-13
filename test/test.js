#!/usr/bin/env node
/*
 * node test/test.js
 *
 * No dependencies, no framework. Covers the things that have actually broken:
 * name resolution, the merged-region stitch, and every render path emitting
 * clean markup.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const UkrMap = require('../src/ukrmap.js');

const LEVELS = [700, 1400, 2800];
const FACTS = require(path.join(__dirname, '..', 'data', 'ua-facts.json'));
const loadRaw = (d) => require(path.join(__dirname, '..', 'data', `ua-${d}.json`));
const load = (d) => UkrMap.facts(loadRaw(d), FACTS);

/* A real nesting check beats counting tags: it catches an unclosed <a> or a
   stray </g> that arithmetic on '<path' vs '/>' happily misses. */
function wellFormed(xml) {
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, guard = 0;
  while ((m = re.exec(xml))) {
    if (++guard > 500000) throw new Error('scanner runaway');
    const [, close, tag, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== tag) throw new Error(`</${tag}> closes <${open}>`);
    } else if (!selfClose) {
      stack.push(tag);
    }
  }
  if (stack.length) throw new Error(`unclosed <${stack.join('>, <')}>`);
  return true;
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; process.stdout.write(`  ok    ${name}\n`); }
  catch (e) { fail++; process.stdout.write(`  FAIL  ${name}\n        ${e.message}\n`); }
}

/* ------------------------------------------------------------------ data */

for (const detail of LEVELS) {
  test(`data ${detail}: shape`, () => {
    const d = load(detail);
    assert.strictEqual(d.v, 2, 'version');
    assert.strictEqual(d.units.length, 27, '27 administrative units');
    assert.strictEqual(d.size[0], 10000, 'map is 10000 units wide');
    assert.ok(d.arcs.length > 0 && d.use.length > 0 && d.coast.length > 0);
    for (const u of d.units) {
      for (const f of ['k', 'uk', 'en', 'cuk', 'cen', 'r', 'bb', 'c', 'lp', 'off', 'an'])
        assert.ok(u[f] !== undefined, `${u.k} missing ${f}`);
      assert.ok(/^UA-\d\d$/.test(u.k), `${u.k} looks like an ISO 3166-2 code`);
    }
  });

  test(`data ${detail}: coast runs are inside their arcs`, () => {
    const d = load(detail);
    const lens = d.arcs.split(';').map((s) => s.split(' ').length >> 1);
    for (const tok of d.coast.split(' ')) {
      const [i, span] = tok.split(':');
      const [a, b] = span.split('-').map(Number);
      assert.ok(a >= 0 && b < lens[+i] && b > a, `bad run ${tok}`);
    }
  });
}

test('facts file is separate, dated, and complete', () => {
  assert.strictEqual(FACTS.v, 1);
  assert.ok(FACTS.pop.asOf && FACTS.pop.source, 'population figures carry a date and a source');
  const geom = loadRaw(1400);
  assert.strictEqual(Object.keys(FACTS.units).length, geom.units.length);
  for (const u of geom.units) assert.ok(FACTS.units[u.k], `no facts for ${u.k}`);
  const total = Object.values(FACTS.units).reduce((s, f) => s + f.area, 0);
  assert.ok(Math.abs(total - 603628) < 200, `areas sum to ${total}`);
});

test('geometry alone carries no figures; attaching facts supplies them', () => {
  /* straight off disk: require() caches, and an earlier load() has already
     mutated that cached object by attaching facts to it */
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ua-2800.json'), 'utf8'));
  assert.ok(raw.units.every((u) => u.area === undefined), 'geometry file has no areas');
  const bare = UkrMap.units(raw, {});
  assert.strictEqual(bare[0].area, null, 'null, not 0, when no facts are attached');
  UkrMap.facts(raw, FACTS);
  const withFacts = UkrMap.units(raw, {});
  assert.ok(withFacts[0].area > 0, 'facts attach');
});

/* ------------------------------------------------- name -> key resolution */

test('name resolution', () => {
  const d = load(1400);
  const cases = {
    'м. Київ': 'UA-30', 'м Київ': 'UA-30', 'Київ': 'UA-30',
    'Kyiv': 'UA-30', 'Kyiv City': 'UA-30',
    'Київська область': 'UA-32', 'Kyiv Oblast': 'UA-32', 'Київська': 'UA-32',
    'Львівська область': 'UA-46', 'Odessa Oblast': 'UA-51', 'Zaporizhia': 'UA-23',
    'Автономна Республіка Крим': 'UA-43', 'Autonomous Republic of Crimea': 'UA-43',
    'Севастополь': 'UA-40', 'kharkov': 'UA-63', 'Суми': 'UA-59', 'UA-63': 'UA-63',
    'Kropyvnytskyi': 'UA-35', 'Ужгород': 'UA-21', 'Івано-Франківська область': 'UA-26',
    'Донецька область': 'UA-14', 'Chernivtsi Oblast': 'UA-77',
    'нонсенс': null, '': null,
  };
  for (const [q, want] of Object.entries(cases))
    assert.strictEqual(UkrMap.key(d, q), want, `${JSON.stringify(q)} -> ${UkrMap.key(d, q)}`);
});

test('every unit resolves from each of its own names', () => {
  const d = load(1400);
  for (const u of d.units)
    for (const nm of [u.k, u.uk, u.en, u.cuk, u.cen])
      assert.ok(UkrMap.key(d, nm), `${u.k} unresolvable via "${nm}"`);
});

/* ---------------------------------------------------------------- render */

const OPTIONS = {
  'defaults': {},
  'no water': { water: false },
  'every river': { water: { rivers: 'all' } },
  'coast only': { water: { coast: true, lakes: false, rivers: null } },
  'region labels': { labels: 'region' },
  'no labels': { labels: 'none' },
  'kyiv split': { kyivSeparate: true },
  'sevastopol split': { sevastopolSeparate: true },
  'both split': { kyivSeparate: true, sevastopolSeparate: true },
  'attrs': { style: 'attrs' },
  'no style': { style: 'none' },
  'english': { lang: 'en' },
  'fills': { fills: { 'UA-46': '#c0392b' } },
  'links': { link: '/r/{key}' },
  'gradient': { defs: '<linearGradient id="g"/>', fills: { 'UA-46': 'url(#g)' } },
};

for (const detail of LEVELS) {
  for (const [name, opt] of Object.entries(OPTIONS)) {
    test(`render ${detail} · ${name}`, () => {
      const svg = UkrMap.render(load(detail), opt);
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'well-formed wrapper');
      assert.ok(!/NaN|undefined|Infinity|\bnull\b/.test(svg), 'no stray tokens');
      const expect = opt.kyivSeparate && opt.sevastopolSeparate ? 27
        : opt.kyivSeparate || opt.sevastopolSeparate ? 26 : 25;
      assert.strictEqual((svg.match(/class="ukr-region"/g) || []).length, expect, 'region count');
      wellFormed(svg);
    });
  }
}

test('attrs mode carries paint and no stylesheet', () => {
  const svg = UkrMap.render(load(1400), { style: 'attrs' });
  assert.ok(!svg.includes('<style>'), 'no <style>');
  assert.ok(/class="ukr-region"[^>]*fill="#e3dfd5"/.test(svg), 'region fill baked');
  assert.ok(/font-family=/.test(svg), 'label font baked');
  assert.ok(!/var\(--/.test(svg), 'no custom properties left');
});

test('inline mode keeps colors in custom properties', () => {
  const svg = UkrMap.render(load(1400), {});
  assert.ok(svg.includes('<style>'));
  assert.ok(svg.includes('--ukr-land'));
});

/* ------------------------------------------------ merged region stitching */

test('merging leaves no interior ring', () => {
  const d = load(1400);
  const merged = UkrMap.render(d, { labels: 'none', water: false, style: 'none' });
  const crimea = merged.match(/data-key="UA-43"[^>]*d="([^"]+)"/)[1];
  assert.strictEqual((crimea.match(/M/g) || []).length, 1,
    'merged Crimea is one ring — Sevastopol’s boundary is stitched out');

  const split = UkrMap.render(d, { sevastopolSeparate: true, labels: 'none', water: false, style: 'none' });
  assert.ok(/data-key="UA-40"/.test(split), 'Sevastopol drawn when split');
});

test('kyiv city is a hole only when split', () => {
  const d = load(1400);
  const merged = UkrMap.render(d, { labels: 'none', water: false, style: 'none' });
  const kyiv = merged.match(/data-key="UA-32"[^>]*d="([^"]+)"/)[1];
  assert.strictEqual((kyiv.match(/M/g) || []).length, 1, 'merged Kyiv Oblast has no hole ring');
});

/* -------------------------------------------------------------- regionSvg */

test('regionSvg', () => {
  const d = load(1400);
  for (const u of d.units) {
    if (u.parent) continue;
    const svg = UkrMap.regionSvg(d, u.k, { scale: 120 });
    wellFormed(svg);
    assert.ok(svg.startsWith('<svg') && svg.includes(`data-key="${u.k}"`));
    assert.ok(/width="[\d.]+" height="[\d.]+"/.test(svg), 'shared scale gives explicit size');
    assert.ok(!/NaN|undefined/.test(svg));
  }
  assert.throws(() => UkrMap.regionSvg(d, 'UA-99', {}), /no region/);
});

test('regionSvg shared scale is comparable across regions', () => {
  const d = load(1400);
  const px = (k) => {
    const m = UkrMap.regionSvg(d, k, { scale: 100 }).match(/width="([\d.]+)"/);
    return +m[1];
  };
  const vb = (k) => {
    const m = UkrMap.regionSvg(d, k, { scale: 100 }).match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/);
    return +m[1];
  };
  for (const k of ['UA-46', 'UA-43', 'UA-77']) {
    assert.ok(Math.abs(px(k) / vb(k) - 0.1) < 1e-6, `${k}: px per unit is constant`);
  }
});

test('the nesting scanner actually rejects bad markup', () => {
  assert.throws(() => wellFormed('<g><path/></svg>'), /closes|unclosed/);
  assert.throws(() => wellFormed('<g><path/>'), /unclosed/);
  assert.ok(wellFormed('<svg><g><path d="M0 0"/><a href="x"><path/></a></g></svg>'));
});

/* ------------------------------------------------------------ skin + water
 *
 * These three are all regressions that shipped once, and none of them throws:
 * a wrong selector, a stroke nobody outside a browser honors, and a theme the
 * host never asked for. They only show up in a picture, so assert on the CSS.
 */

test('labels are styled by their own group, not by the layer holding them', () => {
  /* the unfolded view moves each label into its region's tile, out of
     .ukr-labels — a descendant selector silently stops matching there */
  const css = UkrMap.css();
  assert.ok(/\.ukr-label text\{[^}]*font-family/.test(css), 'font-family keys off .ukr-label');
  assert.ok(/\.ukr-label text\{[^}]*paint-order:stroke/.test(css), 'so does the halo');
  assert.ok(!/\.ukr-labels text/.test(css), 'nothing keys off the labels layer');
});

test('hover shades the color a region has, instead of replacing it', () => {
  /* A host coloring regions from a stylesheet writes `#alerts .m-alert
     { --c: … }`, and an id outranks `.ukr-region:hover` — so a hover that set
     --c simply stopped happening on the maps that color their regions, which
     is most of the interesting ones. Writing to the derived property wins
     whatever set the color. */
  const css = UkrMap.css();
  const rule = (sel) => (css.match(new RegExp(sel.replace(/[.:()]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || '';

  const base = rule('.ukr-region');
  assert.ok(/--cc:var\(--c,var\(--ukr-land\)\)/.test(base), 'there is a derived color');
  assert.ok(/fill:var\(--cc\)/.test(base) && /stroke:var\(--cc\)/.test(base),
    'and the paint comes from it, not straight from --c');

  const hover = rule('.ukr-region:hover,.ukr-region:focus');
  assert.ok(hover, 'hover and focus share a rule');
  assert.ok(/^--cc:/.test(hover), `hover writes the derived property (got "${hover}")`);
  assert.ok(!/--c:/.test(hover.replace(/--cc:/g, '')), 'and never --c, which a host outranks');
  assert.ok(/color-mix\(in oklab,var\(--c,var\(--ukr-land\)\),#000 var\(--ukr-hover\)\)/.test(hover),
    'it is a shade of the color already there');
  assert.ok(/--ukr-hover:\d+%/.test(css), 'and the amount is a token');

  /* the border in w-fills mode derives from the same place, so hovering a
     colored region darkens its rim with it instead of stranding it */
  assert.ok(/stroke:color-mix\(in oklab,var\(--cc\),#000 var\(--ukr-edge\)\)/.test(css),
    'the rim follows the derived color too');

  /* selection keeps a color of its own: it is a state to find, not a hint.
     The rule ships whether or not the component hands the class out, because
     a host that keeps selection elsewhere sets .is-selected itself. */
  assert.ok(/\.ukr-region\.is-selected\{--cc:var\(--ukr-hi\)\}/.test(css));
  assert.equal(UkrMap.defaults.select, false,
    'but a click does not stick unless the host asks for it');
});

test('borders derive from the fills, but only once there are fills', () => {
  const d = load(1400);
  const plain = UkrMap.render(d, {});
  const colored = UkrMap.render(d, { fills: { 'UA-46': '#c0392b' } });
  const cls = (svg) => svg.match(/<svg[^>]*class="([^"]*)"/)[1];

  assert.ok(!/\bw-fills\b/.test(cls(plain)), 'a map with no colors does not claim to have them');
  assert.ok(/\bw-fills\b/.test(cls(colored)), 'one with colors does');
  assert.ok(plain.includes('class="ukr-borders"'), 'and the gray line is still there for it');

  const css = UkrMap.css();
  assert.ok(/\.ukr-map\.w-fills \.ukr-borders\{display:none\}/.test(css),
    'the shared line steps aside when the fills can carry the border');
  assert.ok(/\.ukr-map\.w-fills:not\(\.is-unfolded\) \.ukr-region\{mix-blend-mode:darken/.test(css),
    'darken is what makes a two-color edge take the darker side');
  assert.ok(/\.ukr-regions\{isolation:isolate\}/.test(css),
    'and the blending is isolated from whatever is behind the map');
  assert.ok(/--ukr-edge:\d+%/.test(css), 'the amount is a custom property');

  /* baked: no custom properties and no blend modes to rely on, so the same
     darkening is computed up front and the shared line is dropped the same way */
  const bakedPlain = UkrMap.render(d, { style: 'attrs' });
  const bakedFill = UkrMap.render(d, { style: 'attrs', fills: { 'UA-46': '#c0392b' } });
  assert.ok(bakedPlain.includes('class="ukr-borders"'), 'a baked plain map keeps its line');
  assert.ok(!bakedFill.includes('class="ukr-borders"'), 'a baked colored one does not');
  const rim = (bakedFill.match(/fill="#c0392b" stroke="(#[0-9a-f]{6})"/) || [])[1];
  assert.ok(rim && rim !== '#c0392b', `the rim is darker than the fill (got ${rim})`);
  const lum = (h) => [1, 3, 5].reduce((t, i) => t + parseInt(h.substr(i, 2), 16), 0);
  assert.ok(lum(rim) < lum('#c0392b'), 'darker, not merely different');
});

test('the seam killer holds its width in device pixels, not CSS ones', () => {
  /* Antialiasing happens per device pixel, so the dilation that defeats it has
     to be measured there. stroke-width is in CSS pixels, which are half a
     device pixel on a 2x screen — one constant cannot be right for both.
     Rasterising at 1:1 and counting interior pixels the fills miss: 1.3 leaves
     single digits at every render width, 1.0 leaves ~1,000 and 0.5 ~8,000. */
  const css = UkrMap.css();
  const base = Number((css.match(/\.ukr-region\{--cc[^}]*stroke-width:([\d.]+)/) || [])[1]);
  assert.ok(base >= 1.2, `1x keeps the measured-safe width (got ${base})`);
  for (const [dppx, want] of [[2, base / 2], [3, base / 3]]) {
    const rule = new RegExp('@media\\(min-resolution:' + dppx
      + 'dppx\\)[^{]*\\{\\.ukr-region\\{stroke-width:([\\d.]+)\\}\\}');
    const got = Number((css.match(rule) || [])[1]);
    assert.ok(Math.abs(got - want) < 0.02,
      `at ${dppx}x the stroke is ${want.toFixed(2)} CSS px, the same ink (got ${got})`);
  }
  /* and the baked file is unaffected: it has no device pixels to speak of */
  const flat = UkrMap.render(load(1400), { style: 'attrs' });
  assert.ok(!/@media/.test(flat), 'no media queries in a design-tool export');
});

test('water scales with the map, furniture does not', () => {
  const css = UkrMap.css();
  const rule = (sel) => (css.match(new RegExp('\\' + sel + '\\{([^}]*)\\}')) || [])[1] || '';
  /* borders and the seam-killer stay put; rivers and the shore scale */
  assert.ok(/vector-effect:non-scaling-stroke/.test(rule('.ukr-borders,.ukr-outline')
    || rule('.ukr-region')), 'furniture is pinned to device pixels');
  assert.ok(/stroke-width:max\(calc\(\d+px \* var\(--ukr-wscale/.test(rule('.ukr-rivers')),
    'rivers are proportional, with a floor');
  assert.ok(/var\(--ukr-u,0\)/.test(css), 'the floor degrades to proportional with no JS');

  /* attrs mode is for design tools, which ignore vector-effect entirely: every
     wet stroke there must be in map units or it imports as nothing */
  const flat = UkrMap.render(load(1400), { style: 'attrs', water: { rivers: 'all' } });
  const rivers = flat.match(/<path class="main"[^>]*stroke-width="(\d+)"/);
  assert.ok(rivers && Number(rivers[1]) > 10, `baked river stroke is in map units (got ${rivers && rivers[1]})`);
  assert.ok(!/class="ukr-rivers"[^>]*vector-effect/.test(flat));

  /* The rivers were moved to map units when they vanished in Illustrator; the
     borders, the outline and the seam-killer were left on device pixels, so a
     designer imported a country with no internal boundaries at all. */
  assert.strictEqual(flat.match(/vector-effect/g), null,
    'nothing in a baked file relies on vector-effect');
  const wOf = (cls) => Number((flat.match(new RegExp(`class="ukr-${cls}"[^>]*stroke-width="(\\d+)"`)) || [])[1]);
  assert.ok(wOf('borders') >= 5, `baked border is in map units (got ${wOf('borders')})`);
  assert.ok(wOf('outline') >= wOf('borders'), 'the frontier is not thinner than a region edge');
  const seam = Number((flat.match(/class="ukr-region"[^>]*stroke-width="(\d+)"/) || [])[1]);
  assert.ok(seam > wOf('borders'), 'and the seam-killer still hides under the border it fills');

  /* a tile is imported the same way */
  const tile = UkrMap.regionSvg(load(1400), 'UA-32', { style: 'attrs' });
  assert.strictEqual(tile.match(/vector-effect/g), null, 'tiles too');
});

test('every water token defaults to --ukr-water, so one knob still moves all', () => {
  const css = UkrMap.css();
  /* separate tokens, but none of them carries a literal color of its own —
     that is what stops the lake, the river and the shore drifting apart */
  for (const k of ['lake', 'river', 'coast'])
    assert.ok(css.includes(`--ukr-${k}:var(--ukr-water)`), `--ukr-${k} derives from --ukr-water`);
  assert.ok(/\.ukr-lakes\{[^}]*fill:var\(--ukr-lake\)/.test(css));
  assert.ok(/\.ukr-rivers\{[^}]*stroke:var\(--ukr-river\)/.test(css));
  assert.ok(/\.ukr-coastglow\{[^}]*stroke:var\(--ukr-coast\)/.test(css));
});

test('see-through water is a layer opacity, not a color alpha', () => {
  /* alpha in the color double-darkens wherever the river crosses its own
     reservoirs; group opacity blends the whole layer once */
  const css = UkrMap.css();
  assert.ok(/\.ukr-waterink\{opacity:var\(--ukr-waterop\)\}/.test(css));
  const svg = UkrMap.render(load(1400), {});
  assert.ok(/<g class="ukr-water"><g class="ukr-waterink">/.test(svg),
    'the tint group is nested inside the one the unfolded view fades');

  /* the shore is part of it: it is drawn in the water color, so it has to
     fade with the water or the two drift into being two different blues */
  const coast = (css.match(/\.ukr-map\.w-on \.ukr-coast\{([^}]*)\}/) || [])[1] || '';
  assert.ok(/stroke-opacity:var\(--ukr-waterop\)/.test(coast), 'the shore fades with the water');
  assert.ok(/stroke:var\(--ukr-coast\)/.test(coast), 'and follows its color');
});

test('the default water set is the Dnipro and the sea, nothing else', () => {
  const on = UkrMap.render(load(1400), {});
  const all = UkrMap.render(load(1400), { water: { rivers: 'all' } });
  const lakes = (s) => (s.match(/<path[^>]*data-water="[^"]*"/g) || [])
    .filter((m) => /Reservoir|Водосховище/.test(m)).length;
  assert.ok(lakes(all) > lakes(on), 'the off-Dnipro reservoir waits for --water=all');
  assert.ok(!/class="minor" data-water/.test(on));
  assert.ok(/class="minor" data-water/.test(all));
});

test('no theme the host did not ask for', () => {
  const css = UkrMap.css();
  assert.ok(!/prefers-color-scheme/.test(css), 'no dark mode ships; the host adds it');
  assert.ok(!/data-theme/.test(css));
});

test('no clip crumbs: every water subpath is long enough to read as water', () => {
  /* -clip along the Belarus and Moldova borders used to leave two-point
     stubs, and a zero-length one paints as a DOT under stroke-linecap:round */
  for (const d of LEVELS.map(load)) {
    for (const f of d.water.rivers.concat(d.water.lakes)) {
      for (const sub of f.d.split('M').filter(Boolean)) {
        const nums = sub.match(/-?\d+/g).map(Number);
        let L = 0;
        for (let i = 2; i < nums.length; i += 2)
          L += Math.hypot(nums[i] - nums[i - 2], nums[i + 1] - nums[i - 1]);
        assert.ok(L >= 50, `${f.n} has a ${L.toFixed(0)}-unit fragment`);
      }
    }
  }
});

test('a rendered map claims no id, so two of them can share a page', () => {
  /* Every region used to carry id="ukr-UA-46". Nothing referred to it, but the
     demo puts three maps and five region tiles on one page, and a tile's
     <use href="#ukr-UA-43"> resolved into the first map in the document. It
     drew correctly only because the geometry was identical in the same user
     space — a coincidence, not a design. */
  for (const d of LEVELS.map(load)) {
    for (const style of ['inline', 'none']) {
      const svg = UkrMap.render(d, { style });
      assert.deepStrictEqual(svg.match(/ id="[^"]*"/g), null, `${style} emits no id`);
      assert.deepStrictEqual(svg.match(/href="#[^"]*"/g), null, 'and nothing to point at one');
    }
  }
});

test('attrs mode names its layers, because a design tool reads the id', () => {
  /* The opposite requirement, and safe here: a baked file has no <use> and no
     clip path, so an id is a label and nothing resolves through it. */
  const svg = UkrMap.render(load(1400), { style: 'attrs' });
  const ids = (svg.match(/ id="([^"]*)"/g) || []).map((x) => x.slice(5, -1));
  assert.strictEqual(ids.length, 25, 'one per region');
  assert.ok(ids.includes('Львівська-область'), `named, not coded (got ${ids[0]})`);
  assert.ok(ids.every((x) => !/[\s"'<>&]/.test(x)), 'and still a valid XML id');
  const en = UkrMap.render(load(1400), { style: 'attrs', lang: 'en' });
  assert.ok(/ id="Lviv-Oblast"/.test(en), 'follows lang');
});

test('a region tile carries an id only when something points at one', () => {
  const d = load(1400);
  /* Lviv has no Dnipro, so no clipped water, so nothing to reference */
  assert.strictEqual(UkrMap.regionSvg(d, 'UA-46', { scale: 160 }).match(/ id="/g), null);
  const kyiv = UkrMap.regionSvg(d, 'UA-32', { scale: 160 });
  const ids = (kyiv.match(/ id="([^"]*)"/g) || []).map((x) => x.slice(5, -1));
  assert.deepStrictEqual(ids, ['ukr-UA-32', 'ukr-clip-UA-32'], 'the clip and its target');
  assert.ok(kyiv.includes('href="#ukr-UA-32"'), 'and the reference is local');
});

test('a value keyed to a merged region reaches the region actually drawn', () => {
  /* A Derzhstat table has 27 rows: Kyiv City and Sevastopol are their own
     units whether or not this map draws them apart. Under the default merge
     the value used to be dropped without a word, and 25 of 27 rows painted a
     map that looked complete. */
  const d = load(1400);
  const merged = UkrMap.render(d, { fills: { 'UA-30': '#c0392b' } });
  assert.ok(merged.includes('#c0392b'), 'UA-30 paints Kyiv Oblast when merged');
  const split = UkrMap.render(d, { fills: { 'UA-30': '#c0392b' }, kyivSeparate: true });
  assert.ok(split.includes('#c0392b'), 'and paints Kyiv City when split');
  assert.ok(UkrMap.render(d, { fills: { 'UA-40': '#c0392b' } }).includes('#c0392b'),
    'same for Sevastopol');
  /* An explicit value on the region actually drawn is the unambiguous one, so
     it wins — and it has to win from either position, or the result depends on
     what order the caller happened to build the object in. */
  for (const fills of [{ 'UA-30': '#c0392b', 'UA-32': '#27ae60' },
                       { 'UA-32': '#27ae60', 'UA-30': '#c0392b' }]) {
    const both = UkrMap.render(d, { fills });
    assert.ok(both.includes('#27ae60') && !both.includes('#c0392b'),
      `parent beats merged child, keys given as ${Object.keys(fills)}`);
  }
});

test('every file says what it is and how old its borders are', () => {
  for (const d of LEVELS.map(load)) {
    const desc = UkrMap.render(d, {}).match(/<desc>([^<]*)<\/desc>/);
    assert.ok(desc, 'there is a <desc>');
    assert.ok(desc[1].includes(UkrMap.version), 'with the version');
    assert.ok(desc[1].includes('MIT'), 'the license');
    assert.ok(desc[1].includes('Natural Earth'), 'the source');
    assert.ok(/2023/.test(desc[1]), 'and the water caveat');
  }
  assert.ok(/Natural Earth/.test(UkrMap.render(load(700), { lang: 'en' }).match(/<desc>([^<]*)</)[1]));
});

test('lon/lat lands where the map says it should', () => {
  /* The projection was written for build/pack.js and thrown away every build.
     These five are checked against the city dots pack.js placed with it, which
     came from Natural Earth rather than from these coordinates — so a handful
     of units of disagreement is the two sources differing, not the maths. */
  const cities = {
    'UA-32': [30.5234, 50.4501], 'UA-46': [24.0297, 49.8397],
    'UA-63': [36.2304, 49.9935], 'UA-21': [22.2879, 48.6208],
    'UA-43': [34.1044, 44.9521],
  };
  for (const d of LEVELS) {
    const data = load(d);
    for (const [k, ll] of Object.entries(cities)) {
      const [x, y] = UkrMap.project(data, ...ll);
      const u = data.units.find((z) => z.k === k);
      const off = Math.hypot(x - u.c[0], y - u.c[1]);
      assert.ok(off < 12, `${k} at detail ${d} is ${off.toFixed(1)} units from its dot`);
    }
    /* the affine is per detail level, so it has to come from the file */
    assert.ok(data.proj && data.proj.s > 0 && data.proj.lcc.length === 4);
  }
  /* corners of the country stay inside the drawn box */
  const d = load(1400);
  for (const ll of [[22.15, 48.4], [40.2, 49.1], [33.5, 44.4], [30.5, 52.3]]) {
    const [x, y] = UkrMap.project(d, ...ll);
    assert.ok(x > -400 && x < d.size[0] + 400 && y > -400 && y < d.size[1] + 400,
      `${ll} projects to ${x.toFixed(0)},${y.toFixed(0)}, outside the map`);
  }
  assert.throws(() => UkrMap.project(d, 30, 120), /degrees, longitude first/);
  assert.throws(() => UkrMap.project({ v: 2, units: [] }, 30, 50), /no projection/);
  /* swapped coordinates are in range for both, so this is a warning, not a
     throw — and the point is still computed, because a neighbor's capital is
     a fair thing to ask for */
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const swapped = UkrMap.project(load(700), 50.4501, 30.5234);
    assert.ok(Number.isFinite(swapped[0]), 'still answers');
  } finally { console.warn = ow; }
  assert.ok(/swapped/.test(warns.join(' ')), `said so (got ${JSON.stringify(warns)})`);
});

test('names layer over the language, they do not replace it', () => {
  const d = load(1400);
  const names = { 'UA-46': { region: 'Lwowskie', city: 'Lwów' }, 'UA-21': 'Zakarpacie' };
  const svg = UkrMap.render(d, { lang: 'en', names, labels: 'all' });
  assert.ok(svg.includes('Lwowskie') && svg.includes('Lwów'), 'both halves land');
  assert.ok(svg.includes('Zakarpacie'), 'the string form sets the region name');
  assert.ok(svg.includes('Uzhhorod'), 'and leaves the city label alone');
  assert.ok(svg.includes('Kyiv'), 'untranslated regions fall through to lang');
  assert.ok(UkrMap.regionSvg(d, 'UA-46', { names }).includes('Lwowskie'), 'tiles too');
  /* display only: a feed still sends what a feed sends */
  assert.strictEqual(UkrMap.key(d, 'Lviv Oblast'), 'UA-46');
});

test('titles carry data, or fall back to the region name', () => {
  const d = load(1400);
  const svg = UkrMap.render(d, { titles: { 'UA-46': 'Львівська: 42 %', 'UA-30': 'Київ: 7 %' } });
  assert.ok(svg.includes('<title>Львівська: 42 %</title>'), 'the value is the tooltip');
  assert.ok(svg.includes('<title>Київ: 7 %</title>'), 'a merged key reaches the region drawn');
  assert.ok(svg.includes('<title>Харківська область</title>'), 'a partial table is partial');
  assert.ok(!/<title>[^<]*область<\/title>/.test(UkrMap.render(d, { titles: false })),
    'false still means no region titles');
  assert.ok(UkrMap.regionSvg(d, 'UA-46', { titles: { 'UA-46': 'x' } }).includes('<title>x</title>'));
});

test('a river that reaches the sea is drawn reaching it', () => {
  /* The rivers and the outline come from different layers and are simplified
     independently, so the point where they meet drifts apart by whatever each
     side lost. The Southern Buh ended 316 units short of the Black Sea at the
     default detail and 468 at the coarsest — visibly stopping in mid-land north
     of Mykolaiv. pack.js now extends a drifted mouth back to the shore. */
  const walk = (dstr) => {
    const tok = dstr.match(/[MmLlZz]|-?\d*\.?\d+/g) || [];
    const out = []; let cmd = 'M', x = 0, y = 0, i = 0;
    while (i < tok.length) {
      if (/[MmLlZz]/.test(tok[i])) { cmd = tok[i++]; continue; }
      const a2 = +tok[i++], b2 = +tok[i++];
      if (cmd === 'M') { x = a2; y = b2; cmd = 'L'; }
      else if (cmd === 'm') { x += a2; y += b2; cmd = 'l'; }
      else if (cmd === 'L') { x = a2; y = b2; }
      else { x += a2; y += b2; }
      out.push([x, y]);
    }
    return out;
  };

  for (const detail of LEVELS) {
    const data = load(detail);
    const coast = walk(UkrMap.edges(data, {}).coast || '');
    assert.ok(coast.length > 100, 'there is a coastline to measure against');
    /* distance to the shoreline, not to its nearest vertex — the mouth is put
       on the segment between two vertices, which is the whole point of it */
    const toCoast = (q) => {
      let best = Infinity;
      for (let i = 1; i < coast.length; i++) {
        const p1 = coast[i - 1], p2 = coast[i];
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len2 = dx * dx + dy * dy;
        let t = len2 ? ((q[0] - p1[0]) * dx + (q[1] - p1[1]) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = Math.min(best, Math.hypot(q[0] - (p1[0] + t * dx), q[1] - (p1[1] + t * dy)));
      }
      return best;
    };

    const gapOf = (name) => {
      const r = data.water.rivers.find((x) => x.n === name);
      assert.ok(r, `${name} is in the data`);
      return Math.min(...r.d.split('M').filter(Boolean).map((sub) => {
        const p = walk('M' + sub);
        return Math.min(toCoast(p[0]), toCoast(p[p.length - 1]));
      }));
    };

    for (const river of ['Southern Bug', 'Dnipro', 'Dniester']) {
      const gap = gapOf(river);
      assert.ok(gap <= 2, `${river} meets the sea at detail ${detail} (gap ${gap.toFixed(0)} units)`);
    }

    /* and the rule did not drag a river that has no business at the sea: the
       Donets leaves for Russia, and its nearest end sat 1433 units away — the
       margin that makes a 600-unit threshold safe */
    const donets = gapOf('Donets');
    assert.ok(donets > 900, `the Donets was left alone (${donets.toFixed(0)} units from the coast)`);
  }
});

test('arrow keys go to a neighbor that is really that way', () => {
  /* The old rule walked three geographic bands and kept the index across them,
     which is a grid imposed on a country that is not one. These five are the
     cases that gave it away. */
  for (const detail of LEVELS) {
    const nav = UkrMap.neighbors(load(detail), {});
    const R = [1, 0], L = [-1, 0], D = [0, 1], U = [0, -1];
    const want = [
      ['UA-12', R, 'UA-14', 'Dnipropetrovsk right to Donetsk'],
      ['UA-23', R, 'UA-14', 'Zaporizhzhia right to Donetsk, the same neighbor'],
      ['UA-46', D, 'UA-26', 'Lviv down to Ivano-Frankivsk, not past it'],
      ['UA-61', D, 'UA-77', 'Ternopil down to Chernivtsi'],
      ['UA-68', D, 'UA-77', 'Khmelnytskyi down to Chernivtsi as well'],
      ['UA-43', U, 'UA-65', 'Crimea up to Kherson, its only neighbor'],
    ];
    for (const [from, [dx, dy], to, why] of want) {
      assert.strictEqual(nav.toward(from, dx, dy), to, `${why} (detail ${detail})`);
    }

    /* Lviv down is a 1° call between Zakarpattia and Ivano-Frankivsk, settled
       by which border is longer. If that margin ever narrows, the case above
       starts flipping on rounding — so guard the premise, not just the result. */
    const lviv = nav.of('UA-46');
    assert.ok(lviv['UA-26'] > lviv['UA-21'] * 2,
      `the Ivano-Frankivsk border outweighs the Carpathian one (${lviv['UA-26'].toFixed(0)} vs ${lviv['UA-21'].toFixed(0)})`);

    /* every move lands on a real neighbor, and no region is a trap */
    const keys = UkrMap.units(load(detail), {}).map((u) => u.key);
    for (const k of keys) {
      let out = 0;
      for (const [dx, dy] of [R, L, U, D]) {
        const n = nav.toward(k, dx, dy);
        if (n === null) continue;
        out++;
        assert.ok(nav.of(k)[n], `${k} -> ${n} is a shared border, not a leap`);
        assert.notStrictEqual(n, k, `${k} does not step onto itself`);
      }
      assert.ok(out > 0, `${k} has somewhere to go`);
    }
  }

  /* splitting the enclaves out rewires the graph rather than stranding them */
  const split = UkrMap.neighbors(load(1400), { kyivSeparate: true, sevastopolSeparate: true });
  assert.strictEqual(split.toward('UA-30', 0, 1), 'UA-32', 'Kyiv City can be left');
  assert.strictEqual(split.toward('UA-32', 0, -1), 'UA-30', 'and reached');
  assert.strictEqual(split.toward('UA-40', 1, 0), 'UA-43', 'Sevastopol likewise');
  /* merged, the child's borders belong to the parent and the child is not there */
  assert.strictEqual(UkrMap.neighbors(load(1400), {}).of('UA-30'), null);
});

test('colorData() turns numbers into colors without being told the range', () => {
  const hex = /^#[0-9a-f]{6}$/;

  /* the stops come back exactly where they were put */
  const ramp = ['#f2ddc9', '#e0a882', '#c76a4a', '#a5402f', '#7f2d1e'];
  const even = UkrMap.colorData({ a: 0, b: 25, c: 50, d: 75, e: 100 },
    { colors: ramp, domain: [0, 100] });
  assert.deepStrictEqual(Object.values(even.fills), ramp, 'and the conversion round-trips');
  assert.deepStrictEqual(even.domain, [0, 100], 'the domain is read off the data');

  /* explicit domain wins, and values outside it clamp rather than wrap */
  const fixed = UkrMap.colorData({ a: -50, b: 50, c: 999 },
    { domain: [0, 100], colors: ramp });
  assert.strictEqual(fixed.fills.a, ramp[0]);
  assert.strictEqual(fixed.fills.c, ramp[ramp.length - 1]);

  /* Skew is the whole reason this exists. Spread linearly, a table with one
     big value gives that value the ramp and leaves everyone else inside a few
     units of one channel. Spread by RANK — which is the default — the ramp is
     used end to end and the outlier is simply the last step. */
  const skewed = {};
  for (let i = 0; i < 25; i++) skewed['r' + i] = 30 + i * 5;
  skewed.outlier = 3518;

  const chan = (h, i) => parseInt(h.substr(1 + i * 2, 2), 16);
  const spread = (list) => Math.max(...[0, 1, 2].map((i) => {
    const vals = list.map((h) => chan(h, i));
    return Math.max(...vals) - Math.min(...vals);
  }));
  const ordinary = (f) => Object.entries(f).filter(([k]) => k !== 'outlier').map((e) => e[1]);

  const rank = UkrMap.colorData(skewed);
  assert.strictEqual(rank.breaks, null, 'the default is a continuous ramp');
  assert.ok(spread(ordinary(rank.fills)) > 140,
    `rank spreads the ordinary values across the ramp (got ${spread(ordinary(rank.fills))})`);
  assert.ok(new Set(Object.values(rank.fills)).size > 20, 'and keeps them apart');

  /* the linear reading is still there, and it is what `domain` asks for */
  const linear = UkrMap.colorData(skewed, { domain: [30, 3518] });
  assert.ok(spread(ordinary(linear.fills)) < 24,
    `linear collapses the field, which is why it is opt-in (got ${spread(ordinary(linear.fills))})`);

  /* classes, when you want them, are quantiles for the same reason */
  const classed = UkrMap.colorData(skewed, { steps: 5 });
  const counts = {};
  for (const c of Object.values(classed.fills)) counts[c] = (counts[c] || 0) + 1;
  assert.strictEqual(Object.keys(counts).length, 5, 'five classes when asked for five');
  assert.ok(Math.max(...Object.values(counts)) <= 8,
    `quantile classes stay balanced despite the outlier (got ${JSON.stringify(counts)})`);
  assert.strictEqual(classed.breaks.length, 4, 'n classes means n-1 breaks');
  assert.strictEqual(UkrMap.colorData(skewed, { steps: 3 }).breaks.length, 2, 'steps is honored');

  /* ties get the middle of their run, so equal values are equal colors */
  const tied = UkrMap.colorData({ a: 1, b: 5, c: 5, d: 9 });
  assert.strictEqual(tied.fills.b, tied.fills.c, 'equal values, equal color');
  assert.notStrictEqual(tied.fills.a, tied.fills.d, 'unequal ones are not');

  /* log is the third reading: it keeps the magnitudes rank throws away, for
     the quantities that are multiplicative — densities, populations, incomes */
  const log = UkrMap.colorData(skewed, { spread: 'log' });
  const logSpread = spread(ordinary(log.fills));
  assert.ok(logSpread > 60 && logSpread < 140,
    `log sits between linear and rank (got ${logSpread})`);
  assert.strictEqual(Math.round(log.valueAt(0.5)), Math.round(Math.sqrt(30 * 3518)),
    'and its midpoint is the geometric one');

  /* it needs positive values, and says so rather than producing -Infinity */
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let zero;
  try { zero = UkrMap.colorData({ a: 0, b: 10, c: 100 }, { spread: 'log' }); } finally { console.warn = ow; }
  assert.ok(/above zero/.test(warns.join(' ')), 'log warns when it cannot be used');
  assert.ok(Object.values(zero.fills).every((c) => /^#[0-9a-f]{6}$/.test(c)),
    'and falls back to linear rather than emitting NaN');

  /* capping the domain is how one outlier stops eating the ramp: it clamps
     at the top and everyone else gets the room back */
  const capped = UkrMap.colorData(skewed, { spread: 'log', domain: [30, 400] });
  assert.ok(spread(ordinary(capped.fills)) > spread(ordinary(log.fills)),
    'a capped domain widens the field it leaves behind');
  assert.strictEqual(capped.fills.outlier, capped.at(1), 'and the outlier clamps to the top');

  /* and it degrades gracefully: with a mild spread the transform stops
     mattering, which is what makes it safe to reach for */
  const mild = {};
  for (let i = 0; i < 25; i++) mild['r' + i] = 30 + i * 5;
  const mildSpread = (opt) => spread(Object.values(UkrMap.colorData(mild, opt).fills));
  assert.ok(Math.abs(mildSpread({ spread: 'log' }) - mildSpread({ spread: 'linear' })) < 40,
    'on evenly spread data log and linear land close together');

  /* valueAt is the inverse, so a legend can label the bar it draws */
  assert.strictEqual(Math.round(rank.valueAt(0)), 30, 'position 0 is the smallest value');
  assert.strictEqual(Math.round(rank.valueAt(1)), 3518, 'position 1 the largest');
  assert.strictEqual(rank.of(rank.valueAt(0.5)), rank.at(0.5), 'and it round-trips through of()');

  /* every output is a color, and the ramp gets darker the whole way */
  const lum = (h) => [1, 3, 5].reduce((s2, i) => s2 + parseInt(h.substr(i, 2), 16), 0);
  let last = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const c = even.at(t);
    assert.ok(hex.test(c), `${c} is a hex color`);
    assert.ok(lum(c) <= last + 2, `the ramp does not brighten again at t=${t.toFixed(1)}`);
    last = lum(c);
  }

  /* the awkward inputs */
  assert.deepStrictEqual(UkrMap.colorData({}).fills, {}, 'nothing in, nothing out');
  assert.deepStrictEqual(UkrMap.colorData({ a: 5, b: null, c: 'x' }).fills, { a: '#f2ddc9' },
    'values that are not numbers are left alone rather than painted black');
  assert.strictEqual(UkrMap.colorData({ a: 1, b: 1 }).fills.a, UkrMap.colorData({ a: 1, b: 1 }).fills.b,
    'a flat table is one color, not a divide by zero');
  assert.throws(() => UkrMap.colorData({ a: 1 }, { colors: ['rebeccapurple', '#000'] }), /hex colors/);

  /* it composes with the rest: fills straight into render() */
  const d = load(1400);
  const dens = {};
  for (const u of UkrMap.units(d, {})) dens[u.key] = u.pop / u.area;
  const svg = UkrMap.render(d, { fills: UkrMap.colorData(dens).fills });
  assert.ok(!/NaN|undefined/.test(svg) && (svg.match(/--c:#/g) || []).length === 25);
});

/* ----------------------------------------------------- the one build step */

test('dist/ukrmap.js is the same program as src/ukrmap.js', () => {
  /* The only transform in the project, and the one most able to break quietly:
     the first stripper written for this read the quote inside /["'<>&]/g as the
     start of a string and swallowed the rest of the file. So the stripped copy
     is not trusted, it is checked — every literal, and then the byte-for-byte
     output of every render path there is. */
  const { strip, verify, sampler } = require('../build/strip.js');
  const sample = sampler(loadRaw, FACTS);
  for (const f of ['ukrmap.js', 'ukrmap-unfold.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    verify(src, strip(src), f === 'ukrmap.js' ? sample : null);
  }
});

test('the stripper survives the things that break strippers', () => {
  const { strip, literals } = require('../build/strip.js');
  const cases = {
    'a quote inside a regex class': 'var a = x.replace(/["\'<>&]/g, "");',
    'a slash inside a regex class': 'var a = /[/*]/.test(s);',
    'division that is not a regex': 'var a = (b) / 2, c = d[0] / 3, e = f / 4;',
    'a comment marker inside a string': 'var a = "/* not a comment */", b = 1;',
    'a quote inside a comment': "/* the region's own name */ var a = 1;",
    'a regex after return': 'function f() { return /x/.test(s); }',
    'an escaped quote in a string': 'var a = "he said \\"no\\"", b = 1;',
    'a line comment at end of file': 'var a = 1; // done',
  };
  for (const [name, src] of Object.entries(cases)) {
    const out = strip(src);
    assert.deepStrictEqual(literals(out), literals(src), `${name}: literals survive`);
    assert.ok(!/\/\*|\/\//.test(out.replace(/(["'])(?:\\.|(?!\1).)*\1|\/(?:\\.|\[[^\]]*\]|[^/\\])+\/[a-z]*/g, '')),
      `${name}: no comment left behind`);
    assert.strictEqual(strip(out).trim(), out.trim(), `${name}: idempotent`);
  }
  /* and it refuses rather than guesses when the source is not valid JS */
  assert.throws(() => strip('var a = "unterminated'), /unterminated string/);
});

/* ----------------------------------------------------------------- report */

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
