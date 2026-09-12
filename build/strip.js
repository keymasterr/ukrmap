/*
 * Comment stripper — the one transform that runs over src/.
 *
 * The annotated source is 43% comments by gzipped size. That is the right
 * trade for a file people read and the wrong one for a file people serve, so
 * dist/ gets a copy with the prose taken out.
 *
 * A regex-aware scanner is the whole job, and it is easy to get quietly wrong:
 * the first attempt at this treated the quote inside `/["'<>&]/g` as the start
 * of a string and ate the next few hundred lines without complaining. So the
 * scanner is paired with checks that would have caught exactly that — see
 * verify() below, which is run by build/dist.js and again by the test suite.
 */
'use strict';

/* `/` after any of these is a regex literal; after an identifier, a number,
   `)` or `]` it is division. `}` is genuinely ambiguous — block end (regex may
   follow) versus object literal end (division may follow) — and is treated as
   regex-allowed, which is what every real occurrence in this source needs. */
const REGEX_OK_AFTER = new Set('([{,;=:!&|?+-*/%<>~^'.split(''));
const REGEX_OK_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/;

/* One scan, several consumers: strip() drops the comment spans, literals()
   keeps the quoted ones. Both have to agree about where the boundaries are,
   which is the point of deriving them from the same walk. */
function scan(src) {
  const out = [];
  let i = 0, code = '';
  const push = (kind, start, end) => out.push({ kind, start, end, text: src.slice(start, end) });

  const regexAllowed = () => {
    const t = code.replace(/\s+$/, '');
    if (!t) return true;
    if (REGEX_OK_AFTER.has(t[t.length - 1])) return true;
    return REGEX_OK_KEYWORDS.test(t);
  };

  while (i < src.length) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      push('block', i, end); i = end; continue;
    }
    if (c === '/' && d === '/') {
      let e = src.indexOf('\n', i);
      if (e < 0) e = src.length;
      push('line', i, e); i = e; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, cls = false, closed = false;
      while (j < src.length) {
        const q = src[j];
        if (q === '\\') { j += 2; continue; }
        if (q === '\n') break;
        if (q === '[') cls = true;
        else if (q === ']') cls = false;
        else if (q === '/' && !cls) { j++; closed = true; break; }
        j++;
      }
      if (!closed) throw new Error(`strip: unterminated regex at offset ${i}`);
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      push('regex', i, j); code += src.slice(i, j); i = j; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, closed = false;
      while (j < src.length) {
        const q = src[j];
        if (q === '\\') { j += 2; continue; }
        if (q === c) { j++; closed = true; break; }
        if (q === '\n' && c !== '`') break;
        j++;
      }
      if (!closed) throw new Error(`strip: unterminated string at offset ${i}`);
      push('string', i, j); code += src.slice(i, j); i = j; continue;
    }
    push('code', i, i + 1); code += c; i++;
  }
  return out;
}

/* The comments come out; a short banner goes back on, because a file with no
   provenance is the problem this project just fixed in its SVGs. */
function strip(src, banner) {
  const body = scan(src)
    .map((t) => (t.kind === 'line' || t.kind === 'block' ? '' : t.text))
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .join('\n');
  return (banner ? banner + '\n' : '') + body + '\n';
}

/* Every quoted or regex literal, in order. If the scanner ever loses its place
   this sequence changes, which is the cheapest possible tripwire. */
function literals(src) {
  return scan(src).filter((t) => t.kind === 'string' || t.kind === 'regex').map((t) => t.text);
}

/*
 * Four checks, none of which the broken first attempt would have survived:
 *
 *   1. it parses at all;
 *   2. every literal survived byte-identical, in the same order — a scanner
 *      that mistakes a quote for a string start loses or merges these;
 *   3. stripping the result changes nothing, so no comment leaked through as
 *      code and no code was left looking like a comment;
 *   4. whatever `sample` does, both modules do identically. dist.js passes a
 *      renderer here, so this is a byte comparison of real output.
 */
function verify(src, out, sample) {
  const load = (code, label) => {
    const m = { exports: {} };
    try {
      new Function('module', 'exports', 'require', code)(m, m.exports, require);
    } catch (e) {
      throw new Error(`strip: ${label} does not run — ${e.message}`);
    }
    return m.exports;
  };

  const a = literals(src), b = literals(out);
  if (a.length !== b.length) {
    throw new Error(`strip: ${a.length} literals in, ${b.length} out`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`strip: literal ${i} changed\n  in:  ${a[i]}\n  out: ${b[i]}`);
    }
  }

  const again = strip(out).trim();
  if (again !== out.replace(/^\/\*![\s\S]*?\*\/\n/, '').trim()) {
    throw new Error('strip: not idempotent — a comment boundary is being misread');
  }

  if (sample) {
    const want = sample(load(src, 'the annotated source'));
    const got = sample(load(out, 'the stripped copy'));
    if (want !== got) {
      const at = [...want].findIndex((ch, i) => ch !== got[i]);
      throw new Error(`strip: output differs at offset ${at}\n  want: ${want.slice(at, at + 80)}\n  got:  ${got.slice(at, at + 80)}`);
    }
  }
  return out;
}

/* The exercise both modules are put through: everything the renderer can be
   asked to do, joined into one string and compared byte for byte. Shared with
   the test suite so the guarantee lives there too, not only in the build.
   `loadRaw(detail)` must hand back a freshly parsed data file each call —
   facts() writes into it. */
function sampler(loadRaw, facts) {
  return function (mod) {
    const out = [mod.version, mod.css(), JSON.stringify(mod.palette()),
      JSON.stringify(mod.defaults)];
    for (const d of [700, 1400, 2800]) {
      const geo = mod.facts(loadRaw(d), facts);
      for (const opts of [
        {}, { lang: 'en' }, { labels: 'region' }, { labels: 'none' }, { labels: 'all' },
        { water: false }, { water: { rivers: 'all' } }, { water: 'coast' },
        { style: 'attrs' }, { style: 'none' }, { style: 'attrs', lang: 'en' },
        { kyivSeparate: true }, { sevastopolSeparate: true },
        { kyivSeparate: true, sevastopolSeparate: true },
        { fills: { 'UA-46': '#c0392b', 'UA-30': '#27ae60' } },
        { link: '/r/{key}' }, { prefix: 'x' }, { titles: false }, { borders: false },
        { outline: false }, { pad: 0 }, { labelScale: 'fixed' },
        { defs: '<linearGradient id="g"/>', fills: { 'UA-46': 'url(#g)' } },
      ]) out.push(mod.render(geo, opts));
      for (const k of ['UA-46', 'UA-32', 'UA-43', 'UA-21'])
        out.push(mod.regionSvg(geo, k, { scale: 160 }), mod.regionSvg(geo, k, { style: 'attrs' }));
      for (const n of ['Львівська область', 'м. Київ', 'Kyiv Oblast', 'kharkov', 'nonsense'])
        out.push(String(mod.key(geo, n)));
      out.push(JSON.stringify(mod.units(geo)), JSON.stringify(mod.edges(geo)));
    }
    return out.join('\u0000');
  };
}

module.exports = { strip, literals, verify, sampler };

