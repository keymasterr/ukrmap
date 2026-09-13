/*! ukrmap 3.0.0 · ukrmap.js · MIT · comments stripped; the annotated source is src/ukrmap.js */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UkrMap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var DEFAULTS = {
    lang: 'uk',
    labels: 'city',
    water: true,
    borders: true,
    outline: true,
    kyivSeparate: false,
    sevastopolSeparate: false,
    titles: true,
    select: false,
    width: 0,
    style: 'inline',
    defs: '',
    names: null,
    palette: null,
    fills: null,
    link: '',
    prefix: 'ukr',
    pad: 80,
    labelScale: 'map',
  };
  var PALETTE = {
    land: '#e3dfd5', line: '#8a867b', outline: '#5d5a52',
    water: '#5f96bb', glowAlpha: '.34', waterOp: '.5',
    hi: '#d7d3ca', text: '#26241f', halo: '#fdfdfb',
    edge: '17%',
    hover: '4%',
    font: '"Ubuntu Condensed","Roboto Condensed","Arial Narrow",'
        + '"Liberation Sans Narrow",system-ui,sans-serif',
  };
  var W = { seam: 1.3, border: 0.7, outline: 1, halo: 24, city: 110, dot: 9 };
  var WF = { seam: 13, border: 7, outline: 10 };
  function bakedWidths(vbW, width) {
    if (!width) return WF;
    var k = vbW / (10 * width);
    var out = {};
    for (var key in WF) out[key] = Math.round(WF[key] * k * 100) / 100;
    return out;
  }
  var WU = { coast: 23, glow: 116, river: 32, riverMinor: 20, lake: 12 };
  var WMIN = { coast: 1.1, glow: 4, river: 1.15, riverMinor: .8, lake: .5 };
  function wpx(p, k) {
    return 'max(calc(' + WU[k] + 'px * var(--' + p + 'wscale,1)),'
         + 'calc(' + WMIN[k] + 'px * var(--' + p + 'u,0)))';
  }
  function descOf(data, o) {
    var uk = o.lang === 'uk';
    return (uk ? 'Карта регіонів України, ukrmap ' : 'Map of Ukraine by region, ukrmap ')
      + mount.version + ', MIT. '
      + (data.src || '') + '. '
      + (uk
          ? 'Водні об’єкти та адміністративні межі — стан до 2023 року.'
          : 'Water features and administrative boundaries are pre-2023.');
  }
  var RAMP = ['#f2ddc9', '#e0a882', '#c76a4a', '#a5402f', '#7f2d1e'];
  function hexToRgb(h) {
    var m = String(h).trim().replace(/^#/, '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    if (!/^[0-9a-fA-F]{6}$/.test(m)) {
      throw new Error('ukrmap: colorData() takes hex colors, got "' + h + '"');
    }
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  function toLin(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function toSrgb(c) {
    var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  function oklab(rgb) {
    var r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function unOklab(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2], 3);
    return '#' + [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ].map(function (v) {
      var h = toSrgb(v).toString(16);
      return h.length < 2 ? '0' + h : h;
    }).join('');
  }
  function darken(color, pct) {
    var k = parseFloat(pct) / 100;
    if (!(k > 0)) return color;
    var lab;
    try { lab = oklab(hexToRgb(color)); } catch (e) { return color; }
    return unOklab([lab[0] * (1 - k), lab[1] * (1 - k), lab[2] * (1 - k)]);
  }
  function ramp(colors) {
    var lab = colors.map(function (c) { return oklab(hexToRgb(c)); });
    return function (t) {
      t = t < 0 ? 0 : t > 1 ? 1 : (t || 0);
      var x = t * (lab.length - 1), i = Math.min(lab.length - 2, Math.floor(x));
      if (lab.length === 1) return colors[0];
      var f = x - i, a = lab[i], b = lab[i + 1];
      return unOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    };
  }
  var warned = {};
  function warnOnce(msg) {
    if (warned[msg]) return;
    warned[msg] = 1;
    if (typeof console !== 'undefined' && console.warn) console.warn('ukrmap: ' + msg);
  }
  function colorData(values, options) {
    var o = options || {};
    var at = ramp(o.colors || RAMP);
    var keys = [], nums = [], k;
    for (k in (values || {})) {
      var raw = values[k];
      if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') continue;
      var v = Number(raw);
      if (!isFinite(v)) continue;
      keys.push(k); nums.push(v);
    }
    if (!keys.length) {
      return {
        fills: {}, domain: [0, 0], breaks: null, at: at,
        of: function () { return at(0); }, valueAt: function () { return 0; },
      };
    }
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var lo = o.domain ? o.domain[0] : sorted[0];
    var hi = o.domain ? o.domain[1] : sorted[sorted.length - 1];
    var n = sorted.length, i;
    var pos = {};
    for (i = 0; i < n;) {
      var j = i;
      while (j < n && sorted[j] === sorted[i]) j++;
      pos[sorted[i]] = n === 1 ? 0 : (i + (j - 1 - i) / 2) / (n - 1);
      i = j;
    }
    function posOf(v) {
      if (pos[v] !== undefined) return pos[v];
      if (v <= sorted[0]) return 0;
      if (v >= sorted[n - 1]) return 1;
      var k = 0;
      while (k < n && sorted[k] < v) k++;
      var a1 = sorted[k - 1], b1 = sorted[k];
      var f = b1 === a1 ? 0 : (v - a1) / (b1 - a1);
      return pos[a1] + (pos[b1] - pos[a1]) * f;
    }
    var mode = o.spread || (o.domain ? 'linear' : 'rank');
    if (mode === 'log' && !(lo > 0)) {
      warnOnce('colorData(): log needs every value above zero, and the smallest here is '
        + lo + ' — falling back to linear');
      mode = 'linear';
    }
    var lg = mode === 'log' ? [Math.log(lo), Math.log(hi)] : null;
    var byRank = mode === 'rank';
    var where = byRank ? posOf : lg ? function (v) {
      return lg[1] === lg[0] ? 0 : (Math.log(Math.max(v, lo)) - lg[0]) / (lg[1] - lg[0]);
    } : function (v) {
      return hi === lo ? 0 : (v - lo) / (hi - lo);
    };
    var distinct = 1;
    for (i = 1; i < n; i++) if (sorted[i] !== sorted[i - 1]) distinct++;
    var steps = o.steps || 0;
    if (steps > distinct) steps = distinct;
    if (hi === lo) steps = 0;
    var breaks = null;
    if (steps > 1) {
      breaks = [];
      for (i = 1; i < steps; i++) {
        var q = (i / steps) * (n - 1);
        var f2 = q - Math.floor(q), a2 = sorted[Math.floor(q)], b2 = sorted[Math.ceil(q)];
        breaks.push(a2 + (b2 - a2) * f2);
      }
    }
    var of = function (v) {
      if (!isFinite(v)) return null;
      if (breaks) {
        var cls = 0;
        while (cls < breaks.length && v >= breaks[cls]) cls++;
        return at(cls / breaks.length);
      }
      return at(where(v));
    };
    var valueAt = function (t) {
      t = t < 0 ? 0 : t > 1 ? 1 : (t || 0);
      if (lg) return Math.exp(lg[0] + (lg[1] - lg[0]) * t);
      if (!byRank) return lo + (hi - lo) * t;
      var q2 = t * (n - 1), f3 = q2 - Math.floor(q2);
      return sorted[Math.floor(q2)] + (sorted[Math.ceil(q2)] - sorted[Math.floor(q2)]) * f3;
    };
    var fills = {};
    keys.forEach(function (key, i) { fills[key] = of(nums[i]); });
    return {
      fills: fills, domain: [lo, hi], breaks: breaks,
      at: at, of: of, valueAt: valueAt,
      posOf: function (v) { return isFinite(v) ? where(v) : null; },
    };
  };
  function layerId(name) {
    return esc(String(name).trim().replace(/\s+/g, '-').replace(/["'<>&]/g, ''));
  }
  function palette(o) {
    var P = {}, k;
    for (k in PALETTE) P[k] = PALETTE[k];
    for (k in (o.palette || {})) P[k] = o.palette[k];
    return P;
  }
  function normWater(w) {
    if (w === true || w == null) return { coast: true, lakes: true, rivers: 'main' };
    if (w === false) return { coast: false, lakes: false, rivers: null };
    return {
      coast: w.coast !== false,
      lakes: w.lakes !== false,
      rivers: w.rivers === undefined ? 'main' : w.rivers,
    };
  }
  function n(v) { return String(Math.round(v)); }
  function tight(nums) { return nums.join(' ').replace(/ -/g, '-'); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
  function decode(data) {
    if (data.__dec) return data.__dec;
    if (!data || data.v !== 2) throw new Error('ukrmap: unrecognized data file (expected v2)');
    var arcs = data.arcs.split(';').map(function (s) {
      var a = s.split(' '), pts = new Array(a.length >> 1);
      var x = +a[0], y = +a[1];
      pts[0] = [x, y];
      for (var i = 2, j = 1; i < a.length; i += 2, j++) {
        x += +a[i]; y += +a[i + 1];
        pts[j] = [x, y];
      }
      return pts;
    });
    var use = data.use.split(';').map(function (s) {
      return s ? s.split(',').map(Number) : [];
    });
    var coast = {};
    (data.coast ? data.coast.split(' ') : []).forEach(function (tok) {
      var bits = tok.split(':'), span = bits[1].split('-');
      var i = +bits[0];
      (coast[i] = coast[i] || []).push([+span[0], +span[1]]);
    });
    var byKey = {};
    data.units.forEach(function (u, i) { u.i = i; byKey[u.k] = u; });
    var dec = { arcs: arcs, use: use, coast: coast, byKey: byKey, cache: {} };
    try { Object.defineProperty(data, '__dec', { value: dec }); } catch (e) { data.__dec = dec; }
    return dec;
  }
  function ringPath(dec, ring) {
    var head = null, d = [], cx = 0, cy = 0;
    for (var r = 0; r < ring.length; r++) {
      var i = ring[r], rev = i < 0, a = dec.arcs[rev ? ~i : i];
      var k = rev ? a.length - 1 : 0;
      var end = rev ? -1 : a.length;
      var step = rev ? -1 : 1;
      if (head) k += step;
      for (; k !== end; k += step) {
        var pt = a[k];
        if (!head) head = 'M' + pt[0] + ' ' + pt[1];
        else d.push(pt[0] - cx, pt[1] - cy);
        cx = pt[0]; cy = pt[1];
      }
    }
    return head ? head + (d.length ? 'l' + tight(d) : '') + 'Z' : '';
  }
  function arcPath(dec, i, from, to) {
    var a = dec.arcs[i];
    var lo = from === undefined ? 0 : Math.max(0, from);
    var hi = to === undefined ? a.length - 1 : Math.min(a.length - 1, to);
    if (hi <= lo) return '';
    var d = [];
    for (var k = lo + 1; k <= hi; k++) d.push(a[k][0] - a[k - 1][0], a[k][1] - a[k - 1][1]);
    return 'M' + a[lo][0] + ' ' + a[lo][1] + (d.length ? 'l' + tight(d) : '');
  }
  function splitBoundary(dec, i, out, key) {
    var runs = dec.coast[i];
    if (!runs) { out.frontier += arcPath(dec, i); return; }
    var last = 0;
    runs.forEach(function (r) {
      if (r[0] > last) out.frontier += arcPath(dec, i, last, r[0]);
      var d = arcPath(dec, i, r[0], r[1]);
      out.coast += d;
      out.coastBy[key] = (out.coastBy[key] || '') + d;
      last = r[1];
    });
    var end = dec.arcs[i].length - 1;
    if (last < end) out.frontier += arcPath(dec, i, last, end);
  }
  function ringsOf(u) {
    return u.r.split(';').map(function (s) { return s.split(' ').map(Number); });
  }
  function stitch(dec, members) {
    var count = {}, refs = [];
    members.forEach(function (m) {
      ringsOf(m).forEach(function (ring) {
        ring.forEach(function (i) {
          var a = i < 0 ? ~i : i;
          count[a] = (count[a] || 0) + 1;
        });
      });
    });
    members.forEach(function (m) {
      ringsOf(m).forEach(function (ring) {
        ring.forEach(function (i) { if (count[i < 0 ? ~i : i] === 1) refs.push(i); });
      });
    });
    function ends(i) {
      var a = dec.arcs[i < 0 ? ~i : i];
      return i < 0 ? [a[a.length - 1], a[0]] : [a[0], a[a.length - 1]];
    }
    var byStart = {};
    refs.forEach(function (i, k) {
      var key = ends(i)[0].join(',');
      (byStart[key] = byStart[key] || []).push(k);
    });
    var used = [], rings = [];
    for (var k = 0; k < refs.length; k++) {
      if (used[k]) continue;
      var ring = [], cur = k;
      while (cur != null && !used[cur]) {
        used[cur] = 1;
        ring.push(refs[cur]);
        var cands = byStart[ends(refs[cur])[1].join(',')] || [];
        cur = null;
        for (var c = 0; c < cands.length; c++) if (!used[cands[c]]) { cur = cands[c]; break; }
      }
      rings.push(ring);
    }
    return rings;
  }
  function group(data, opts) {
    var dec = decode(data);
    var ck = (opts.kyivSeparate ? 'k' : '-') + (opts.sevastopolSeparate ? 's' : '-');
    if (dec.cache[ck]) return dec.cache[ck];
    var sep = {};
    if (opts.kyivSeparate) sep['UA-30'] = 1;
    if (opts.sevastopolSeparate) sep['UA-40'] = 1;
    var renderKey = {};
    data.units.forEach(function (u) {
      renderKey[u.k] = (u.parent && !sep[u.k]) ? u.parent : u.k;
    });
    var order = [], seen = {};
    data.units.forEach(function (u) {
      var k = renderKey[u.k];
      if (!seen[k]) { seen[k] = { key: k, members: [] }; order.push(seen[k]); }
      seen[k].members.push(u);
    });
    order.forEach(function (gr) {
      var head = gr.members.filter(function (m) { return m.k === gr.key; })[0] || gr.members[0];
      var rings = gr.members.length === 1 ? ringsOf(head) : stitch(dec, gr.members);
      gr.head = head;
      gr.d = rings.map(function (r) { return ringPath(dec, r); }).join('');
      var has = gr.members.some(function (m) { return m.area != null; });
      gr.area = has ? gr.members.reduce(function (s, m) { return s + (m.area || 0); }, 0) : null;
      gr.pop = has ? gr.members.reduce(function (s, m) { return s + (m.pop || 0); }, 0) : null;
      gr.bb = head.bb; gr.c = head.c; gr.off = head.off; gr.an = head.an; gr.lp = head.lp;
      gr.capital = gr.members.some(function (m) { return m.capital; });
    });
    var res = { dec: dec, groups: order, renderKey: renderKey, byRenderKey: seen };
    dec.cache[ck] = res;
    return res;
  }
  function edges(data, g) {
    var dec = g.dec, out = { border: '', coast: '', frontier: '', coastBy: {} };
    for (var i = 0; i < dec.use.length; i++) {
      var users = dec.use[i];
      if (!users.length) continue;
      var keys = {}, count = 0, only = null;
      for (var j = 0; j < users.length; j++) {
        var rk = g.renderKey[data.units[users[j]].k];
        if (!keys[rk]) { keys[rk] = 1; count++; only = rk; }
      }
      if (count >= 2) out.border += arcPath(dec, i);
      else if (users.length === 1) splitBoundary(dec, i, out, only);
    }
    return out;
  }
  function kindOf(u) { return u.parent ? 'city' : u.ar ? 'ar' : 'oblast'; }
  function fullName(u, lang) {
    var k = kindOf(u);
    if (k === 'ar') return lang === 'uk' ? 'Автономна Республіка Крим' : 'Autonomous Republic of Crimea';
    if (k === 'city') return lang === 'uk' ? u.uk : u.en;
    return lang === 'uk' ? u.uk + ' область' : u.en + ' Oblast';
  }
  function shortName(u, lang) { return lang === 'uk' ? u.uk : u.en; }
  function cityName(u, lang) { return lang === 'uk' ? u.cuk : u.cen; }
  function normTitles(v) {
    if (v === false || v == null) return null;
    return (v === true || typeof v !== 'object') ? {} : v;
  }
  function onDrawn(src, g) {
    var out = {}, k;
    for (k in (src || {})) {
      var rk = g.renderKey[k] || k;
      if (rk === k || !(rk in src)) out[rk] = src[k];
    }
    return out;
  }
  function namer(o) {
    var by = o.names || {};
    var pick = function (u, which) {
      var v = by[u.k];
      if (v == null) return null;
      if (typeof v === 'string') return which === 'region' ? v : null;
      return v[which] == null ? null : v[which];
    };
    return {
      full: function (u) { return pick(u, 'region') || fullName(u, o.lang); },
      short: function (u) { return pick(u, 'region') || shortName(u, o.lang); },
      city: function (u) { return pick(u, 'city') || cityName(u, o.lang); },
    };
  }
  function skin(p, P) {
    P = P || PALETTE;
    return (
      '.' + p + 'map{' +
        '--' + p + 'land:' + P.land + ';--' + p + 'line:' + P.line + ';' +
        '--' + p + 'outline:' + P.outline + ';--' + p + 'water:' + P.water + ';' +
        '--' + p + 'lake:var(--' + p + 'water);--' + p + 'river:var(--' + p + 'water);' +
        '--' + p + 'coast:var(--' + p + 'water);' +
        '--' + p + 'glow:' + P.glowAlpha + ';--' + p + 'waterop:' + P.waterOp + ';' +
        '--' + p + 'hi:' + P.hi + ';--' + p + 'text:' + P.text + ';--' + p + 'halo:' + P.halo + ';' +
        '--' + p + 'edge:' + P.edge + ';--' + p + 'hover:' + P.hover + ';' +
        'display:block}' +
      '.' + p + 'region{--cc:var(--c,var(--' + p + 'land));fill:var(--cc);stroke:var(--cc);' +
        'stroke-width:' + W.seam + ';vector-effect:non-scaling-stroke;stroke-linejoin:round}' +
      '@media(min-resolution:2dppx),(-webkit-min-device-pixel-ratio:2){' +
        '.' + p + 'region{stroke-width:' + (W.seam / 2) + '}}' +
      '@media(min-resolution:3dppx),(-webkit-min-device-pixel-ratio:3){' +
        '.' + p + 'region{stroke-width:' + +(W.seam / 3).toFixed(2) + '}}' +
      '.' + p + 'regions{isolation:isolate}' +
      '.' + p + 'map.w-fills .' + p + 'borders{display:none}' +
      '.' + p + 'map.w-fills:not(.is-unfolded) .' + p + 'region{mix-blend-mode:darken;' +
        'stroke:color-mix(in oklab,var(--cc),#000 var(--' + p + 'edge))}' +
      '.' + p + 'region:hover,.' + p + 'region:focus{' +
        '--cc:color-mix(in oklab,var(--c,var(--' + p + 'land)),#000 var(--' + p + 'hover))}' +
      '.' + p + 'region:focus{outline:none}' +
      '.' + p + 'region.is-selected{--cc:var(--' + p + 'hi)}' +
      '@supports not (color:color-mix(in oklab,#000,#fff)){' +
        '.' + p + 'map.w-fills .' + p + 'borders{display:inline}' +
        '.' + p + 'map.w-fills:not(.is-unfolded) .' + p + 'region{mix-blend-mode:normal;' +
          'stroke:var(--cc)}' +
        '.' + p + 'region:hover,.' + p + 'region:focus{--cc:var(--' + p + 'hi)}}' +
      '.' + p + 'borders,.' + p + 'outline,.' + p + 'coast,.' + p + 'coastglow{fill:none;' +
        'pointer-events:none}' +
      '.' + p + 'borders,.' + p + 'outline{vector-effect:non-scaling-stroke}' +
      '.' + p + 'borders{stroke:var(--' + p + 'line);stroke-width:' + W.border + '}' +
      '.' + p + 'outline{stroke:var(--' + p + 'outline);stroke-width:' + W.outline + '}' +
      '.' + p + 'coast{stroke:var(--' + p + 'outline);stroke-width:' + W.outline + ';' +
        'vector-effect:non-scaling-stroke}' +
      '.' + p + 'coastglow{stroke:var(--' + p + 'coast);' +
        'stroke-opacity:calc(var(--' + p + 'glow) * var(--' + p + 'waterop));' +
        'stroke-width:' + wpx(p, 'glow') + ';' +
        'stroke-linejoin:round;stroke-linecap:round;display:none}' +
      '.' + p + 'map.w-on .' + p + 'coastglow{display:block}' +
      '.' + p + 'map.w-on .' + p + 'coast{stroke:var(--' + p + 'coast);' +
        'stroke-opacity:var(--' + p + 'waterop);' +
        'stroke-width:' + wpx(p, 'coast') + ';vector-effect:none}' +
      '.' + p + 'water{pointer-events:none;display:none}' +
      '.' + p + 'map.w-on .' + p + 'water{display:block}' +
      '.' + p + 'waterink{opacity:var(--' + p + 'waterop)}' +
      '.' + p + 'lakes{fill:var(--' + p + 'lake);stroke:var(--' + p + 'lake);' +
        'stroke-width:' + wpx(p, 'lake') + '}' +
      '.' + p + 'rivers{fill:none;stroke:var(--' + p + 'river);' +
        'stroke-width:' + wpx(p, 'river') + ';' +
        'stroke-linecap:round;stroke-linejoin:round}' +
      '.' + p + 'lakes .minor,.' + p + 'rivers .minor{display:none}' +
      '.' + p + 'rivers .minor{stroke-width:' + wpx(p, 'riverMinor') + '}' +
      '.' + p + 'map.w-all .' + p + 'lakes .minor,' +
      '.' + p + 'map.w-all .' + p + 'rivers .minor{display:inline}' +
      '.' + p + 'label{pointer-events:none}' +
      '.' + p + 'label text{font-family:var(--' + p + 'font,' + PALETTE.font + ');' +
        'font-size:calc(' + W.city + 'px * var(--' + p + 'lscale,1));fill:var(--' + p + 'text);' +
        'paint-order:stroke;stroke:var(--' + p + 'halo);stroke-width:' + W.halo + ';' +
        'stroke-linejoin:round}' +
      '.' + p + 'dot{fill:var(--' + p + 'text);stroke:var(--' + p + 'halo);stroke-width:' + W.dot + '}' +
      '.' + p + 'label.is-capital text{font-weight:700}' +
      '.' + p + 'city,.' + p + 'dot,.' + p + 'name{display:none}' +
      '.' + p + 'map.l-city .' + p + 'city,.' + p + 'map.l-city .' + p + 'dot{display:inline}' +
      '.' + p + 'map.l-region .' + p + 'name{display:inline}'
    );
  }
  function render(data, options) {
    var o = {}, key;
    for (key in DEFAULTS) o[key] = DEFAULTS[key];
    for (key in (options || {})) o[key] = options[key];
    var p = o.prefix + '-';
    var g = group(data, o);
    var e = edges(data, g);
    var w = normWater(o.water);
    var pad = o.pad;
    var P = palette(o);
    var bake = o.style === 'attrs';
    var N = namer(o);
    var T = normTitles(o.titles);
    var titles = T && onDrawn(T, g);
    var titleOf = function (key, name) {
      if (!T) return '';
      return '<title>' + esc(titles[key] == null ? name : titles[key]) + '</title>';
    };
    var fills = onDrawn(o.fills, g);
    var fillsGiven = false;
    for (var fk in fills) { fillsGiven = true; break; }
    var NSS = ' vector-effect="non-scaling-stroke"';
    var LW = bakedWidths(data.size[0] + pad * 2, o.width);
    function regionPaint(key) {
      var c = fills[key];
      if (!bake) return c ? ' style="--c:' + esc(c) + '"' : '';
      var rim = c || P.land;
      c = c || P.land;
      if (fillsGiven) rim = darken(c, P.edge);
      return ' fill="' + esc(c) + '" stroke="' + esc(rim) + '" stroke-width="' + LW.seam + '"'
        + ' stroke-linejoin="round"';
    }
    function linePaint(color, width, scaling) {
      return bake ? ' fill="none" stroke="' + color + '" stroke-width="' + width + '"'
        + (scaling ? '' : NSS) : '';
    }
    function glowPaint() {
      return bake ? ' fill="none" stroke="' + P.water + '" stroke-opacity="' + P.glowAlpha + '"'
        + ' stroke-width="' + WU.glow + '" stroke-linejoin="round" stroke-linecap="round"' : '';
    }
    function textPaint(weight) {
      return bake
        ? ' font-family=\'' + P.font + '\' font-size="' + W.city + '" fill="' + P.text + '"'
          + ' stroke="' + P.halo + '" stroke-width="' + W.halo + '" stroke-linejoin="round"'
          + ' paint-order="stroke"' + (weight ? ' font-weight="700"' : '')
        : '';
    }
    var wantCity = o.labels === 'city' || o.labels === 'all';
    var wantName = o.labels === 'region' || o.labels === 'all';
    var cls = [p + 'map'];
    if (fillsGiven) cls.push('w-fills');
    if (w.coast || w.lakes || w.rivers) cls.push('w-on');
    if (w.rivers === 'all') cls.push('w-all');
    if (wantCity) cls.push('l-city');
    if (wantName) cls.push('l-region');
    var defs = o.defs || '';
    var body = '';
    if (o.outline && w.coast && e.coast) {
      body += '<path class="' + p + 'coastglow" d="' + e.coast + '"' + glowPaint() + '/>';
    }
    body += '<g class="' + p + 'regions">';
    g.groups.forEach(function (u) {
      var name = N.full(u.head);
      var path = '<path class="' + p + 'region"' + (bake ? ' id="' + layerId(name) + '"' : '')
        + ' data-key="' + u.key + '"'
        + ' data-name="' + esc(name) + '" pointer-events="fill"' + regionPaint(u.key)
        + ' d="' + u.d + '">'
        + titleOf(u.key, name)
        + '</path>';
      var cell = o.link
        ? '<a href="' + esc(o.link.replace(/\{key\}/g, u.key)) + '">' + path + '</a>'
        : path;
      body += cell;
    });
    body += '</g>';
    if (w.lakes || w.rivers) {
      body += '<g class="' + p + 'water"><g class="' + p + 'waterink">';
      if (w.lakes && data.water.lakes.length) {
        body += '<g class="' + p + 'lakes">';
        data.water.lakes.forEach(function (l) {
          if (w.rivers !== 'all' && !l.main) return;
          body += '<path' + (l.main ? '' : ' class="minor"') + ' data-water="' + esc(l.n) + '"'
            + (l.until ? ' data-until="' + l.until + '"' : '')
            + (bake ? ' fill="' + P.water + '" stroke="' + P.water + '" stroke-width="'
                    + WU.lake + '"' : '')
            + ' d="' + l.d + '">'
            + '<title>' + esc(o.lang === 'uk' ? l.uk : l.n)
            + (l.until ? (o.lang === 'uk' ? ' (до ' + l.until + ')' : ' (until ' + l.until + ')') : '')
            + '</title></path>';
        });
        body += '</g>';
      }
      if (w.rivers) {
        body += '<g class="' + p + 'rivers">';
        data.water.rivers.forEach(function (r) {
          if (w.rivers === 'main' && !r.main) return;
          body += '<path class="' + (r.main ? 'main' : 'minor') + '" data-water="' + esc(r.n) + '"'
            + (bake ? ' fill="none" stroke="' + P.water + '" stroke-width="'
                    + (r.main ? WU.river : WU.riverMinor) + '" stroke-linecap="round"'
                    + ' stroke-linejoin="round"' : '')
            + ' d="' + r.d + '"><title>' + esc(o.lang === 'uk' ? r.uk : r.n) + '</title></path>';
        });
        body += '</g>';
      }
      body += '</g></g>';
    }
    if (o.borders && e.border && !(bake && fillsGiven))
      body += '<path class="' + p + 'borders"' + linePaint(P.line, LW.border, true) + ' d="' + e.border + '"/>';
    if (o.outline && e.frontier)
      body += '<path class="' + p + 'outline"' + linePaint(P.outline, LW.outline, true) + ' d="' + e.frontier + '"/>';
    if (o.outline && e.coast)
      body += '<path class="' + p + 'coast"'
        + linePaint(w.coast ? P.water : P.outline, w.coast ? WU.coast : LW.outline, true)
        + ' d="' + e.coast + '"/>';
    if (wantCity || wantName) {
      var owner = {};
      g.groups.forEach(function (u) {
        var pt = u.c[0] + ',' + u.c[1];
        if (!owner[pt] || u.head.parent) owner[pt] = u.key;
      });
      body += '<g class="' + p + 'labels">';
      g.groups.forEach(function (u) {
        var anchor = u.an === 's' ? 'start' : u.an === 'e' ? 'end' : 'middle';
        body += '<g class="' + p + 'label' + (u.capital ? ' is-capital' : '')
          + '" data-key="' + u.key + '">';
        if (wantCity && owner[u.c[0] + ',' + u.c[1]] === u.key) {
          body += '<circle class="' + p + 'dot" cx="' + n(u.c[0]) + '" cy="' + n(u.c[1])
            + '" r="' + (u.capital ? 26 : 19) + '"'
            + (bake ? ' fill="' + P.text + '" stroke="' + P.halo + '" stroke-width="' + W.dot + '"' : '')
            + '/>'
            + '<text class="' + p + 'city" x="' + n(u.c[0] + u.off[0]) + '" y="' + n(u.c[1] + u.off[1])
            + '" text-anchor="' + anchor + '"' + textPaint(u.capital) + '>'
            + esc(N.city(u.head)) + '</text>';
        }
        if (wantName) {
          body += '<text class="' + p + 'name" x="' + n(u.lp[0]) + '" y="' + n(u.lp[1])
            + '" text-anchor="middle" dominant-baseline="middle"' + textPaint(u.capital) + '>'
            + esc(N.short(u.head)) + '</text>';
        }
        body += '</g>';
      });
      body += '</g>';
    }
    var vbW = data.size[0] + pad * 2;
    var vbH = data.size[1] + pad * 2;
    var dim = o.width
      ? ' width="' + n(o.width) + '" height="' + n(Math.round(o.width * vbH / vbW)) + '"'
      : '';
    return '<svg xmlns="' + NS + '" class="' + cls.join(' ') + '"'
      + ' viewBox="' + (-pad) + ' ' + (-pad) + ' ' + n(vbW) + ' ' + n(vbH) + '"' + dim
      + ' role="img" aria-label="'
      + esc(o.lang === 'uk' ? 'Регіони України' : 'Regions of Ukraine') + '"'
      + ' data-detail="' + data.detail + '" data-version="' + mount.version + '">'
      + '<desc>' + esc(descOf(data, o)) + '</desc>'
      + (o.style === 'inline' ? '<style>' + skin(p, P) + '</style>' : '')
      + (defs ? '<defs>' + defs + '</defs>' : '')
      + body
      + '</svg>';
  }
  function regionSvg(data, key, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) o[k] = options[k];
    var p = o.prefix + '-';
    var g = group(data, o);
    var u = g.byRenderKey[key];
    if (!u) throw new Error('ukrmap: no region ' + key);
    var P = palette(o);
    var bake = o.style === 'attrs';
    var pad = o.pad;
    var NSS = ' vector-effect="non-scaling-stroke"';
    var vb = [u.bb[0] - pad, u.bb[1] - pad, u.bb[2] + pad * 2, u.bb[3] + pad * 2];
    var per = null;
    if (o.fit && o.fit.height) per = o.fit.height / vb[3];
    else if (o.fit && o.fit.width) per = o.fit.width / vb[2];
    else if (o.scale) per = o.scale / 1000;
    var dim = per
      ? ' width="' + (vb[2] * per).toFixed(1) + '" height="' + (vb[3] * per).toFixed(1) + '"'
      : '';
    var color = (o.fills || {})[key] || P.land;
    var N = namer(o);
    var T = normTitles(o.titles);
    var name = N.full(u.head);
    var w = normWater(o.water);
    var e = (w.coast || w.lakes || w.rivers) ? edges(data, g) : null;
    var shore = e && w.coast ? e.coastBy[key] : '';
    var clipId = p + 'clip-' + key;
    var body = '';
    var touches = function (f) {
      if (!f.bb) return true;
      return f.bb[0] <= u.bb[0] + u.bb[2] && f.bb[0] + f.bb[2] >= u.bb[0]
          && f.bb[1] <= u.bb[1] + u.bb[3] && f.bb[1] + f.bb[3] >= u.bb[1];
    };
    var wd = '';
    if (w.lakes || w.rivers) {
      var nearLakes = data.water.lakes.filter(function (l) {
        return touches(l) && (w.rivers === 'all' || l.main);
      });
      if (w.lakes && nearLakes.length) {
        wd += '<path class="' + p + 'lakes" d="'
          + nearLakes.map(function (l) { return l.d; }).join('') + '"'
          + (bake ? ' fill="' + P.water + '" stroke="' + P.water + '" stroke-width="' + WU.lake + '"' : '')
          + '/>';
      }
      if (w.rivers) {
        var rd = '';
        data.water.rivers.forEach(function (r) {
          if (w.rivers === 'main' && !r.main) return;
          if (!touches(r)) return;
          rd += r.d;
        });
        if (rd) wd += '<g class="' + p + 'rivers"><path d="' + rd + '"'
          + (bake ? ' fill="none" stroke="' + P.water + '" stroke-width="' + WU.river + '"'
                  + ' stroke-linecap="round" stroke-linejoin="round"' : '') + '/></g>';
      }
    }
    if (shore) {
      body += '<path class="' + p + 'coastglow" d="' + shore + '"'
        + (bake ? ' fill="none" stroke="' + P.water + '" stroke-opacity="' + P.glowAlpha + '"'
                + ' stroke-width="' + WU.glow + '" stroke-linejoin="round"'
                + ' stroke-linecap="round"' : '') + '/>';
    }
    body += '<path class="' + p + 'region"' + (wd ? ' id="' + p + key + '"' : '')
      + ' data-key="' + key + '" pointer-events="fill"'
      + (bake
          ? ' fill="' + esc(color) + '" stroke="' + esc(P.line) + '" stroke-width="' + WF.border + '"'
            + ' stroke-linejoin="round"'
          : (o.fills && o.fills[key] ? ' style="--c:' + esc(o.fills[key]) + '"' : ''))
      + ' d="' + u.d + '">'
      + (T ? '<title>' + esc(T[key] == null ? name : T[key]) + '</title>' : '')
      + '</path>';
    if (wd) {
      body += '<clipPath id="' + clipId + '"><use href="#' + p + key + '"/></clipPath>'
        + '<g class="' + p + 'water" clip-path="url(#' + clipId + ')">'
        + '<g class="' + p + 'waterink">' + wd + '</g></g>';
    }
    if (shore) {
      body += '<path class="' + p + 'coast" d="' + shore + '"'
        + (bake ? ' fill="none" stroke="' + P.water + '" stroke-width="' + WU.coast + '"' : '') + '/>';
    }
    if (o.labels === 'city' || o.labels === 'all') {
      var anchor = u.an === 's' ? 'start' : u.an === 'e' ? 'end' : 'middle';
      body += '<g class="' + p + 'label">'
        + '<circle class="' + p + 'dot" cx="' + n(u.c[0]) + '" cy="' + n(u.c[1]) + '" r="19"'
        + (bake ? ' fill="' + P.text + '" stroke="' + P.halo + '" stroke-width="' + W.dot + '"' : '') + '/>'
        + '<text class="' + p + 'city" x="' + n(u.c[0] + u.off[0]) + '" y="' + n(u.c[1] + u.off[1])
        + '" text-anchor="' + anchor + '"'
        + (bake ? ' font-family=\'' + P.font + '\' font-size="' + W.city + '" fill="' + P.text + '"' : '')
        + '>' + esc(N.city(u.head)) + '</text></g>';
    }
    var wcls = p + 'map ' + p + 'one'
      + ((w.coast || w.lakes || w.rivers) ? ' w-on' : '')
      + (w.rivers === 'all' ? ' w-all' : '');
    return '<svg xmlns="' + NS + '" class="' + wcls + '" data-key="' + key + '"'
      + ' viewBox="' + vb.join(' ') + '"' + dim
      + ' role="img" aria-label="' + esc(name) + '">'
      + (o.style === 'inline'
          ? '<style>' + skin(p, P) + '.' + p + 'one .' + p + 'region{stroke:var(--' + p + 'line);'
            + 'stroke-width:' + W.border + '}</style>'
          : '')
      + body + '</svg>';
  }
  function projector(data) {
    if (data.__proj) return data.__proj;
    var p = data.proj;
    if (!p || !p.lcc) {
      throw new Error('ukrmap: this data file carries no projection — rebuild it with build/pack.js');
    }
    var rad = Math.PI / 180;
    var A = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f);
    var lat0 = p.lcc[0] * rad, lon0 = p.lcc[1] * rad, lat1 = p.lcc[2] * rad, lat2 = p.lcc[3] * rad;
    var t = function (v) {
      return Math.tan(Math.PI / 4 - v / 2)
        / Math.pow((1 - e * Math.sin(v)) / (1 + e * Math.sin(v)), e / 2);
    };
    var m = function (v) { return Math.cos(v) / Math.sqrt(1 - e * e * Math.sin(v) * Math.sin(v)); };
    var n = Math.log(m(lat1) / m(lat2)) / Math.log(t(lat1) / t(lat2));
    var F = m(lat1) / (n * Math.pow(t(lat1), n));
    var rho0 = A * F * Math.pow(t(lat0), n);
    var warned = false;
    var fn = function (lon, lat) {
      if (!(lon >= -180 && lon <= 180 && lat > -90 && lat < 90)) {
        throw new Error('ukrmap: project(lon, lat) wants degrees, longitude first — got '
          + lon + ', ' + lat);
      }
      if (!warned && (lon < 10 || lon > 55 || lat < 40 || lat > 58)) {
        warned = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('ukrmap: project(' + lon + ', ' + lat + ') is far outside Ukraine.'
            + ' Longitude comes first — did the two get swapped?');
        }
      }
      var rho = A * F * Math.pow(t(lat * rad), n);
      var th = n * (lon * rad - lon0);
      return [
        (rho * Math.sin(th) - p.o[0]) * p.s,
        (p.o[1] - (rho0 - rho * Math.cos(th))) * p.s,
      ];
    };
    data.__proj = fn;
    return fn;
  }
  var NAV_CONE = 75, NAV_TIE = 12;
  function neighbors(data, g) {
    var dec = g.dec, out = {}, live = g.byRenderKey;
    var lenOf = function (pts) {
      var L = 0, i;
      for (i = 1; i < pts.length; i++) {
        L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      return L;
    };
    dec.use.forEach(function (users, ai) {
      var keys = [], seen = {};
      users.forEach(function (ui) {
        var k = g.renderKey[data.units[ui].k];
        if (k && !seen[k] && live[k]) { seen[k] = 1; keys.push(k); }
      });
      if (keys.length < 2) return;
      var L = lenOf(dec.arcs[ai]);
      keys.forEach(function (a) {
        keys.forEach(function (b) {
          if (a === b) return;
          out[a] = out[a] || {};
          out[a][b] = (out[a][b] || 0) + L;
        });
      });
    });
    return out;
  }
  function navAnchor(g, key) {
    var u = g.byRenderKey[key];
    return (u && u.lp) || (u && u.c) || null;
  }
  function toward(data, g, nbrs, key, dx, dy) {
    var from = navAnchor(g, key), near = nbrs[key];
    if (!from || !near) return null;
    var pick = [], k;
    for (k in near) {
      var to = navAnchor(g, k);
      if (!to) continue;
      var vx = to[0] - from[0], vy = to[1] - from[1];
      var len = Math.hypot(vx, vy) || 1;
      var dot = (vx * dx + vy * dy) / len;
      if (dot <= 0) continue;
      var ang = Math.acos(Math.min(1, dot)) * 180 / Math.PI;
      if (ang > NAV_CONE) continue;
      pick.push({ k: k, ang: ang, share: near[k] });
    }
    if (!pick.length) return null;
    var best = Infinity;
    pick.forEach(function (c) { if (c.ang < best) best = c.ang; });
    return pick.filter(function (c) { return c.ang <= best + NAV_TIE; })
      .sort(function (a, b) { return b.share - a.share; })[0].k;
  }
  var ALIASES = {
    'kievskaya': 'UA-32', 'kyivska': 'UA-32', 'kiev': 'UA-30',
    'odessa': 'UA-51', 'odesskaya': 'UA-51',
    'zaporizhia': 'UA-23', 'zaporozhye': 'UA-23', 'zaporizhzhya': 'UA-23',
    'chernigov': 'UA-74', 'chernihivska': 'UA-74',
    'dnepropetrovsk': 'UA-12', 'dnipro': 'UA-12', 'dnepr': 'UA-12',
    'lugansk': 'UA-09', 'luhanska': 'UA-09',
    'nikolaev': 'UA-48', 'mykolayiv': 'UA-48',
    'ternopol': 'UA-61', 'khmelnitsky': 'UA-68', 'khmelnytsky': 'UA-68',
    'ivano frankovsk': 'UA-26', 'ivanofrankivsk': 'UA-26',
    'transcarpathia': 'UA-21', 'zakarpattya': 'UA-21', 'uzhgorod': 'UA-21',
    'kirovograd': 'UA-35', 'kropivnitsky': 'UA-35',
    'kharkov': 'UA-63', 'lvov': 'UA-46',
    'krym': 'UA-43', 'ar krym': 'UA-43', 'crimea': 'UA-43',
    'kherson': 'UA-65', 'sumska': 'UA-59', 'rivnenska': 'UA-56',
  };
  var STOP = {
    'область': 1, 'обл': 1, 'області': 1, 'обласна': 1, 'рада': 1,
    'oblast': 1, 'region': 1, 'province': 1,
    'автономна': 1, 'республіка': 1, 'autonomous': 1, 'republic': 1, 'of': 1,
    'ар': 1, 'ar': 1, 'м': 1, 'місто': 1, 'misto': 1, 'city': 1, 'the': 1,
  };
  var OBLAST_MARK = /(область|обл\.|області|обласна|oblast|region|province)/i;
  var CITY_MARK = /(^|[\s.,])(м\.?|місто|misto|city)([\s.,]|$)/i;
  function norm(str) {
    return String(str).toLowerCase()
      .replace(/[’'`ʼ]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(function (t) { return t && !STOP[t]; })
      .join(' ');
  }
  function nameIndex(data) {
    var dec = decode(data);
    if (dec.names) return dec.names;
    var ix = {}, city = {}, oblast = {};
    var put = function (into, v, k) { if (v) { var q = norm(v); if (q && !into[q]) into[q] = k; } };
    data.units.forEach(function (u) {
      if (!u.parent) return;
      put(ix, u.uk, u.k); put(ix, u.en, u.k);
      put(city, u.uk, u.k); put(city, u.en, u.k);
      put(city, u.cuk, u.k); put(city, u.cen, u.k);
    });
    data.units.forEach(function (u) {
      put(ix, u.k, u.k); put(ix, u.uk, u.k); put(ix, u.en, u.k);
      put(ix, fullName(u, 'uk'), u.k); put(ix, fullName(u, 'en'), u.k);
      if (u.parent) return;
      put(oblast, u.k, u.k); put(oblast, u.uk, u.k); put(oblast, u.en, u.k);
      put(oblast, fullName(u, 'uk'), u.k); put(oblast, fullName(u, 'en'), u.k);
      put(oblast, u.cuk, u.k); put(oblast, u.cen, u.k);
    });
    data.units.forEach(function (u) { put(ix, u.cuk, u.k); put(ix, u.cen, u.k); });
    for (var a in ALIASES) if (!ix[norm(a)]) ix[norm(a)] = ALIASES[a];
    dec.names = { any: ix, city: city, oblast: oblast };
    return dec.names;
  }
  function keyOf(data, name) {
    var ix = nameIndex(data), q = norm(name), raw = String(name);
    if (OBLAST_MARK.test(raw)) return ix.oblast[q] || ix.any[q] || null;
    if (CITY_MARK.test(raw)) return ix.city[q] || ix.any[q] || null;
    return ix.city[q] || ix.oblast[q] || ix.any[q] || null;
  }
  function mount(target, options) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('ukrmap: target not found');
    var o = {}, key;
    for (key in DEFAULTS) o[key] = DEFAULTS[key];
    for (key in (options || {})) o[key] = options[key];
    if (!o.data) throw new Error('ukrmap: pass the parsed data file as options.data');
    if (o.facts) mount.facts(o.data, o.facts);
    var data = o.data;
    var p = o.prefix + '-';
    var listeners = { hover: [], select: [], view: [] };
    var state = { view: 'map', hover: null, select: null };
    var colors = null, marks = null, titles = null, onRebuild = null, onDestroy = null;
    var nbr = null;
    var svg, regions, labels, g, byRK, live, order;
    function liveOptions() {
      var out = {};
      for (var k in o) out[k] = o[k];
      out.labels = 'all';
      out.water = { coast: true, lakes: true, rivers: 'all' };
      return out;
    }
    function navOrder() {
      var flat = [], bands = [], live = {};
      group(data, o).groups.forEach(function (u) { live[u.key] = 1; });
      data.bands.forEach(function (band) {
        var row = [];
        band.forEach(function (key) {
          data.units.forEach(function (u) {
            if (u.parent === key && live[u.k]) row.push(u.k);
          });
          if (live[key]) row.push(key);
        });
        bands.push(row);
        flat = flat.concat(row);
      });
      return { flat: flat, bands: bands };
    }
    function step(key, dx, dy) {
      if (!nbr) nbr = neighbors(data, g);
      return toward(data, g, nbr, key, dx, dy);
    }
    function focusKey(key) {
      if (!regions[key]) return;
      for (var j in regions) regions[j].setAttribute('tabindex', j === key ? '0' : '-1');
      regions[key].focus();
    }
    function build() {
      nbr = null;
      el.innerHTML = render(data, liveOptions());
      svg = el.querySelector('svg');
      regions = {}; labels = {};
      svg.setAttribute('role', 'group');
      order = navOrder();
      Array.prototype.forEach.call(svg.querySelectorAll('.' + p + 'region'), function (r) {
        var key = r.getAttribute('data-key');
        regions[key] = r;
        r.setAttribute('role', 'button');
        r.setAttribute('tabindex', key === order.flat[0] ? '0' : '-1');
      });
      Array.prototype.forEach.call(svg.querySelectorAll('.' + p + 'label'), function (l) {
        labels[l.getAttribute('data-key')] = l;
      });
      g = group(data, o);
      byRK = g.byRenderKey;
      if (!live) {
        live = document.createElement('div');
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;'
          + 'clip:rect(0 0 0 0);white-space:nowrap';
        el.appendChild(live);
      } else {
        el.appendChild(live);
      }
      wire();
      syncClasses();
      paintText();
      applyColors();
      applyMarks();
      if (o.select && state.select) paintSelect();
      resize();
      if (onRebuild) onRebuild();
    }
    function syncClasses() {
      var w = normWater(o.water);
      svg.classList.toggle('w-on', !!(w.coast || w.lakes || w.rivers));
      svg.classList.toggle('w-all', w.rivers === 'all');
      svg.classList.toggle('l-city', o.labels === 'city' || o.labels === 'all');
      svg.classList.toggle('l-region', o.labels === 'region' || o.labels === 'all');
    }
    function paintText() {
      var N = namer(o);
      var custom = titles && resolveKeys(titles, 'title');
      g.groups.forEach(function (u) {
        var lab = labels[u.key];
        if (lab) {
          var city = lab.querySelector('.' + p + 'city');
          var name = lab.querySelector('.' + p + 'name');
          if (city) city.textContent = N.city(u.head);
          if (name) name.textContent = N.short(u.head);
        }
        var r = regions[u.key];
        if (r) {
          var full = N.full(u.head);
          r.setAttribute('data-name', full);
          var t = r.querySelector('title');
          if (t) t.textContent = (custom && custom[u.key] != null) ? custom[u.key] : full;
        }
      });
      Array.prototype.forEach.call(svg.querySelectorAll('[data-water]'), function (node) {
        var name = node.getAttribute('data-water');
        var rec = data.water.rivers.concat(data.water.lakes).filter(function (x) { return x.n === name; })[0];
        var t = node.querySelector('title');
        if (rec && t) {
          t.textContent = (o.lang === 'uk' ? rec.uk : rec.n)
            + (rec.until ? (o.lang === 'uk' ? ' (до ' + rec.until + ')' : ' (until ' + rec.until + ')') : '');
        }
      });
      svg.setAttribute('aria-label', o.lang === 'uk' ? 'Регіони України' : 'Regions of Ukraine');
    }
    function fire(name, k) {
      var u = k ? byRK[k] : null;
      listeners[name].forEach(function (f) { f(k, u); });
    }
    function hit(ev) { return ev.target.closest ? ev.target.closest('.' + p + 'region') : null; }
    function wire() {
      svg.addEventListener('pointerover', function (ev) {
        var r = hit(ev); if (!r) return;
        state.hover = r.getAttribute('data-key'); fire('hover', state.hover);
      });
      svg.addEventListener('pointerout', function (ev) {
        var r = hit(ev);
        if (!r || (ev.relatedTarget && r.contains(ev.relatedTarget))) return;
        state.hover = null; fire('hover', null);
      });
      svg.addEventListener('click', select);
      svg.addEventListener('focusin', function (ev) {
        var r = hit(ev); if (!r) return;
        state.hover = r.getAttribute('data-key');
        announce(state.hover);
        fire('hover', state.hover);
      });
      svg.addEventListener('focusout', function () { state.hover = null; fire('hover', null); });
      svg.addEventListener('keydown', function (ev) {
        var r = hit(ev);
        if (!r) return;
        var key = r.getAttribute('data-key'), next = null;
        switch (ev.key) {
          case 'Enter': case ' ': ev.preventDefault(); select(ev); return;
          case 'ArrowRight': next = step(key, 1, 0); break;
          case 'ArrowLeft': next = step(key, -1, 0); break;
          case 'ArrowDown': next = step(key, 0, 1); break;
          case 'ArrowUp': next = step(key, 0, -1); break;
          case 'Home': next = order.flat[0]; break;
          case 'End': next = order.flat[order.flat.length - 1]; break;
          default: return;
        }
        ev.preventDefault();
        if (next) focusKey(next);
      });
    }
    function select(ev) {
      var r = hit(ev); if (!r) return;
      var k = r.getAttribute('data-key');
      if (o.select) {
        state.select = state.select === k ? null : k;
        paintSelect();
      }
      announce(state.select || k);
      fire('select', o.select ? state.select : k);
    }
    function paintSelect() {
      for (var j in regions) {
        regions[j].classList.toggle('is-selected', j === state.select);
        regions[j].setAttribute('aria-pressed', String(j === state.select));
      }
    }
    function clearSelect() {
      state.select = null;
      for (var j in regions) {
        regions[j].classList.remove('is-selected');
        regions[j].removeAttribute('aria-pressed');
      }
    }
    function announce(key) {
      if (!live || !key) return;
      var u = byRK[key];
      if (!u) return;
      var bits = [namer(o).full(u.head)];
      if (state.select === key) bits.push(o.lang === 'uk' ? 'вибрано' : 'selected');
      if (marks && marks[key]) bits.push(marks[key]);
      live.textContent = bits.join(', ');
    }
    function resize() {
      if (!svg) return;
      var vbW = svg.viewBox.baseVal.width || (data.size[0] + o.pad * 2);
      var px = el.clientWidth || svg.clientWidth || 1;
      var u = vbW / px;
      svg.style.setProperty('--' + p + 'u', u.toFixed(3));
      if (o.labelScale === 'fixed') {
        var k = u / 10;
        svg.style.setProperty('--' + p + 'lscale', k);
        Array.prototype.forEach.call(svg.querySelectorAll('.' + p + 'dot'), function (c) {
          c.setAttribute('r', Math.round(19 * k * 10) / 10);
        });
      } else {
        svg.style.removeProperty('--' + p + 'lscale');
      }
    }
    function warn(msg) {
      if (typeof console !== 'undefined' && console.warn) console.warn('ukrmap: ' + msg);
    }
    function resolveKeys(values, what) {
      var out = {}, from = {}, unknown = [], clash = [], k;
      for (k in values) {
        var rk = regions[k] ? k : g.renderKey[k];
        if (!rk || !regions[rk]) { unknown.push(k); continue; }
        if (from.hasOwnProperty(rk) && out[rk] !== values[k]) {
          clash.push(from[rk] + ' and ' + k + ' both land on ' + rk);
          if (from[rk] === rk) continue;
        }
        from[rk] = k;
        out[rk] = values[k];
      }
      if (unknown.length) warn(what + '(): no region for ' + unknown.join(', '));
      if (clash.length) {
        warn(what + '(): ' + clash.join('; ') + '. Pass kyivSeparate or'
          + ' sevastopolSeparate to draw them apart.');
      }
      return out;
    }
    function syncFillClass() {
      if (!svg) return;
      var any = false, k;
      for (k in (colors || {})) { any = true; break; }
      if (!any) for (k in (marks || {})) { if (marks[k]) { any = true; break; } }
      svg.classList.toggle('w-fills', any);
    }
    function applyColors() {
      for (var k in regions) regions[k].style.removeProperty('--c');
      var v = colors ? resolveKeys(colors, 'set') : {};
      for (var j in v) regions[j].style.setProperty('--c', v[j]);
      syncFillClass();
    }
    function applyMarks() {
      for (var k in regions) {
        var r = regions[k];
        Array.prototype.slice.call(r.classList).forEach(function (c) {
          if (c.indexOf('m-') === 0) r.classList.remove(c);
        });
      }
      syncFillClass();
      if (!marks) return;
      var v = resolveKeys(marks, 'mark');
      for (var j in v) if (v[j]) regions[j].classList.add('m-' + v[j]);
    }
    var onResize = function () { resize(); };
    window.addEventListener('resize', onResize);
    build();
    var GEOMETRY = {
      kyivSeparate: 1, sevastopolSeparate: 1, prefix: 1, style: 1, defs: 1,
      pad: 1, titles: 1, borders: 1, outline: 1,
    };
    return {
      el: el,
      prefix: p,
      get svg() { return svg; },
      data: data,
      get options_() { return o; },
      get units() { return g.groups; },
      regionEl: function (k) { return regions[k] || null; },
      labelEl: function (k) { return labels[k] || null; },
      onRebuild: function (fn) { onRebuild = fn; return this; },
      update: function (patch) {
        var geo = false;
        for (var k in (patch || {})) {
          if (o[k] === patch[k]) continue;
          o[k] = patch[k];
          if (GEOMETRY[k]) geo = true;
        }
        if (!o.select && state.select) clearSelect();
        if (geo) build();
        else { syncClasses(); paintText(); resize(); }
        return this;
      },
      set: function (values) { colors = values || null; applyColors(); return this; },
      mark: function (values) { marks = values || null; applyMarks(); return this; },
      title: function (values) { titles = values || null; paintText(); return this; },
      project: function (lon, lat) {
        var xy = projector(data)(lon, lat);
        var out = { x: xy[0], y: xy[1], left: null, top: null };
        var ctm = svg && svg.getScreenCTM && svg.getScreenCTM();
        if (ctm) {
          var pt = svg.createSVGPoint ? svg.createSVGPoint() : new DOMPoint();
          pt.x = xy[0]; pt.y = xy[1];
          var at = pt.matrixTransform(ctm), box = el.getBoundingClientRect();
          out.left = at.x - box.left;
          out.top = at.y - box.top;
        }
        return out;
      },
      resolve: function (name) {
        var k = keyOf(data, name);
        return k ? (g.renderKey[k] || null) : null;
      },
      on: function (name, fn) { if (listeners[name]) listeners[name].push(fn); return this; },
      name: function (k, lang) {
        var u = byRK[k];
        if (!u) return null;
        return lang ? fullName(u.head, lang) : namer(o).full(u.head);
      },
      options: function () {
        var c = {}; for (var k in o) if (k !== 'data') c[k] = o[k]; return c;
      },
      destroy: function () {
        window.removeEventListener('resize', onResize);
        if (onDestroy) onDestroy();
        el.innerHTML = '';
      },
      onDestroy: function (fn) { onDestroy = fn; return this; },
    };
  }
  mount.render = render;
  mount.regionSvg = regionSvg;
  mount.facts = function (data, facts) {
    var dec = decode(data);
    var by = (facts && facts.units) || facts || {};
    data.units.forEach(function (u) {
      var f = by[u.k];
      if (!f) return;
      if (f.area != null) u.area = f.area;
      if (f.pop != null) u.pop = f.pop;
    });
    dec.cache = {};
    return data;
  };
  mount.edges = function (data, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) o[k] = options[k];
    return edges(data, group(data, o));
  };
  mount.units = function (data, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) o[k] = options[k];
    return group(data, o).groups;
  };
  mount.key = keyOf;
  mount.neighbors = function (data, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) o[k] = options[k];
    var g = group(data, o);
    var nbrs = neighbors(data, g);
    return {
      of: function (key) { return nbrs[key] || null; },
      toward: function (key, dx, dy) { return toward(data, g, nbrs, key, dx, dy); },
    };
  };
  mount.project = function (data, lon, lat) { return projector(data)(lon, lat); };
  mount.colorData = colorData;
  mount.palette = function () {
    var c = {}, k;
    for (k in PALETTE) c[k] = PALETTE[k];
    return c;
  };
  mount.css = function (prefix, pal) { return skin((prefix || 'ukr') + '-', pal); };
  mount.fullName = fullName;
  mount.shortName = shortName;
  mount.cityName = cityName;
  mount.defaults = DEFAULTS;
  mount.version = '3.0.0';
  return mount;
}));
