/*!
 * ukrmap — a small map of Ukraine's regions.
 *
 * One file, no dependencies. Works in two places from the same code:
 *
 *   Node / build step        UkrMap.render(data, opts) -> SVG string
 *   Browser                  UkrMap(target, opts)      -> live instance
 *
 * The static SVG is the primary artifact. It carries `data-key` on every
 * region and a <title>, so hover on true region edges, native tooltips and
 * choropleth coloring all work from the consumer's stylesheet with no
 * JavaScript on the page. The browser wrapper only adds things CSS cannot do:
 * switching to the unfolded layout, and recoloring from live data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UkrMap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var DEFAULTS = {
    lang: 'uk',          // 'uk' | 'en'
    labels: 'city',      // 'city' | 'region' | 'none' ('all' emits both sets,
                         // which is how the component switches without re-rendering)
    water: true,         // true = coastline + the Dnipro; see normWater()
    borders: true,       // internal region boundaries
    outline: true,       // national boundary: land frontier + coast
    kyivSeparate: false, // split Kyiv City out of Kyiv Oblast
    sevastopolSeparate: false,
    titles: true,        // <title> per region -> native tooltip. Also takes a
                         // {key: text} map: same tooltips, carrying your data
    select: false,       // click and Enter leave the region visibly selected.
                         // Off by default: the click fires the `select` event
                         // either way, and a sticky highlight is a second
                         // color system fighting whatever set() or a
                         // stylesheet put on that region
    width: 0,            // px. Declares the file's own size, and in 'attrs'
                         // mode retunes the baked line weights for it — see
                         // the note on WF below. 0 leaves both alone
    style: 'inline',     // 'inline' — carry the default skin as CSS
                         // 'attrs'  — bake colors onto elements (design tools)
                         // 'none'   — no styling at all
    defs: '',            // raw <defs> content: gradients, patterns, filters
    names: null,         // {key: 'Name'} or {key: {region, city}} over `lang`
    palette: null,       // partial override of the default colors
    fills: null,         // {key: color} baked in at render time
    link: '',            // wrap regions in <a href>, e.g. '/regions/{key}'
    prefix: 'ukr',
    pad: 80,             // margin around the map, in map units (map is 10000 wide)
    labelScale: 'map',   // browser: 'map' scales with the map | 'fixed' screen px
  };

  /* The default palette. `skin()` writes these into CSS custom properties;
     style:'attrs' writes them straight onto the elements instead, because
     custom properties do not survive an import into Figma, Keynote or
     PowerPoint — such a file arrives gray.

     Everything wet DEFAULTS to one color, but keeps its own token. A river,
     the reservoirs strung along it and the sea are the same substance, and
     giving each its own blue made the Dnipro read as a thread laid over a
     chain of separate lakes. So `lake`, `river` and `coast` are each defined
     as `var(--ukr-water)`: set `--ukr-water` and all three follow, set one of
     them and only that one moves. Custom properties resolve at use, so the
     indirection costs nothing and the default cannot drift.

     `glowAlpha` is how much of that color the shallow band under the shore
     carries; `waterOp` is the opacity of the water LAYER — see `waterink`. */
  var PALETTE = {
    land: '#e3dfd5', line: '#8a867b', outline: '#5d5a52',
    water: '#5f96bb', glowAlpha: '.34', waterOp: '.5',
    hi: '#d7d3ca', text: '#26241f', halo: '#fdfdfb',
    /* how much black goes into a region's own color to make its border, once
       there are colors to derive from — see the w-fills rules in skin() */
    edge: '17%',
    /* hover darkens the color a region already has rather than replacing it,
       so it works whatever set() or a stylesheet put there */
    hover: '4%',
    font: '"Ubuntu Condensed","Roboto Condensed","Arial Narrow",'
        + '"Liberation Sans Narrow",system-ui,sans-serif',
  };

  /* No dark mode ships. The map used to follow `prefers-color-scheme`, and on
     a deliberately light page — the demo is cream, #fffff8 — a viewer in dark
     mode got a charcoal map in the middle of it. Guessing the host's intent
     from the OS is the wrong default for a component that is dropped into
     someone else's design; the host knows, and it is four lines of CSS:

       @media (prefers-color-scheme: dark) {
         .ukr-map:not([data-theme="light"]) {
           --ukr-land: #333733;  --ukr-line: #6d6a61;  --ukr-outline: #9b968b;
           --ukr-water: #74a9c7; --ukr-hi:   #5b95e8;
           --ukr-text: #e7e4dc;  --ukr-halo: #191a18;   <- your page color
         }
       }

     Scope that to the container the map is in, not to `.ukr-map` globally, and
     it inverts exactly the maps you meant. README: "Dark mode". */

  /* Line weights, shared by both style modes so they cannot drift apart.
     Two groups, and the difference matters:

       device px   the seam-killer, region borders, the national outline and
                   the label halo. These are furniture, not features: they must
                   stay the same weight whatever size the map is drawn at, or
                   a 200 px map turns into a mesh of borders.
       map units   everything wet, out of the map's 10000-unit width. Water is
                   a feature, so it scales with the map. Pinned to device px it
                   was wrong at both ends — a fat blue smear round Crimea on a
                   240 px map, and an invisible thread at 1200 px. `--ukr-u`
                   (set by the component; absent in a static file) puts a
                   device-pixel FLOOR under it so a thread never quite vanishes.

     At a 700 px render 1 CSS px ≈ 14.5 map units, which is where these were
     picked; `--ukr-wscale` multiplies all of them if you want water louder. */
  var W = { seam: 1.3, border: 0.7, outline: 1, halo: 24, city: 110, dot: 9 };

  /* The same three lines in MAP units, for attrs mode. Device pixels are right
     for the browser — a 200 px map whose borders hold at 0.7 px is legible
     where proportional ones are a mesh — but design tools ignore vector-effect
     and read 0.7 against a 10000-unit map, so a 1000 px import gets 0.07 px:
     nothing. The rivers were moved to map units when they vanished in
     Illustrator; these three were left behind, and ukrmap-baked.svg opened as a
     country with no internal boundaries. Same widths at 10 units per pixel, so
     the ratios stay as the browser draws them. */
  var WF = { seam: 13, border: 7, outline: 10 };

  /* Those numbers are right at ONE size: ten map units to the pixel, which is
     a 1016 px render of the default box. That is the trap in a baked file —
     it cannot be re-sized without re-thinking its own lines, and a design tool
     will happily scale it either way. So `width` re-tunes them: at 1600 px a
     border is 4.4 units, which is the same 0.7 px on screen. Water is not in
     here on purpose. Those widths are cartographic — the Dnipro is as wide as
     the Dnipro — and they are supposed to scale with the map. */
  function bakedWidths(vbW, width) {
    if (!width) return WF;
    var k = vbW / (10 * width);
    var out = {};
    for (var key in WF) out[key] = Math.round(WF[key] * k * 100) / 100;
    return out;
  }

  /* map units, at the standard 10000-wide map */
  var WU = { glow: 80, river: 32, riverMinor: 20, lake: 12 };

  /* device-pixel floor for each of the above, so small maps keep their water */
  var WMIN = { glow: 4, river: 1.15, riverMinor: .8, lake: .5 };

  /* stroke-width that is proportional to the map but never thinner than a
     device-pixel floor. --ukr-u is user units per CSS px; a static file has no
     JavaScript to set it, falls to 0, and gets the proportional width. */
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

  /* ------------------------------------------------------------------ *
   * Color by number
   *
   * The README used to say "thresholds are yours, ten lines, no scale library
   * in the package". The ten lines are easy; what is not easy is picking the
   * range off a real table and then classing it, and skewed data punishes the
   * obvious answer — Kyiv City is 3,518 people per km² against a median of 60,
   * and five equal slices of that range put twenty-five regions in the bottom
   * one and call it a map. That is what this is for.
   *
   * The interpolation is in OKLab rather than sRGB. The gain is modest on a
   * ramp whose stops are already close — a few points of chroma through the
   * middle — and obvious on a two-stop one across a hue: blue to yellow in
   * sRGB goes through a dead gray at the midpoint. The deciding reason is
   * agreement: `color-mix(in oklab, …)` is what CSS does, so a ramp computed
   * here and a ramp written in a stylesheet land on the same color.
   *
   * It stays a pure function of numbers to colors. No DOM, no lifecycle, no
   * opinion about legends or axes: it hands back the fills, the domain it
   * settled on, and the ramp itself, and what you draw with them is yours.
   * ------------------------------------------------------------------ */
  var RAMP = ['#f2ddc9', '#e0a882', '#c76a4a', '#a5402f', '#7f2d1e'];

  function hexToRgb(h) {
    var m = String(h).trim().replace(/^#/, '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    if (!/^[0-9a-fA-F]{6}$/.test(m)) {
      throw new Error('ukrmap: colorData() takes hex colors, got "' + h + '"');
    }
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }

  /* sRGB <-> OKLab (Björn Ottosson). Round-trips to the same byte. */
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

  /* What `color-mix(in oklab, c, #000 P%)` does, for the places CSS cannot
     reach: attrs mode, which has neither custom properties nor blend modes.
     Same space, so a baked file and a live one land on the same color. */
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
      /* A gap in the table is not a zero. Number(null) is 0 and Number('') is
         0, so the obvious coercion paints every missing row at the bottom of
         the ramp, where it reads as the lowest value rather than as no value.
         Skipped keys get no fill at all and keep the default land color,
         which is how a choropleth says "no data". */
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

    /* Where a value sits along the ramp, 0 to 1.
     *
     * Not `(v - lo) / (hi - lo)`, which is the obvious answer and the wrong
     * one for almost every real table. Kyiv City is 3,518 people per km²
     * against a median of 60: spread linearly, twenty-five of twenty-six
     * regions land inside ten units of one color channel — no visible
     * difference at all — and one city takes the whole ramp. The arithmetic
     * is right and the picture is useless.
     *
     * So position is by RANK: the t-th point along the ramp is the t-quantile
     * of the data. Every region gets a distinct color, the ramp is used end
     * to end, and no outlier can flatten it, because ranks count rather than
     * measure. The cost is real and worth stating — color then tells you the
     * ORDER, not the size of the gap, and Kyiv sits one step above Donetsk
     * rather than twenty times further along. Pass `domain` when the gap is
     * the point; that is the linear reading, and asking for it explicitly is
     * the right way round.
     *
     * Ties take the middle of their run, so equal values get equal colors. */
    var n = sorted.length, i;
    var pos = {};
    for (i = 0; i < n;) {
      var j = i;
      while (j < n && sorted[j] === sorted[i]) j++;
      pos[sorted[i]] = n === 1 ? 0 : (i + (j - 1 - i) / 2) / (n - 1);
      i = j;
    }

    /* for a value that is not in the table — a legend probing the ramp —
       interpolate between the two present values that bracket it */
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

    /* How position is read off a value. Rank by default, because it is the
       only one that needs nothing to be true of the data. `domain` implies
       linear — naming the endpoints is how you say the distance between them
       is the point. `log` is the third answer, and the conventional one for
       quantities that are multiplicative rather than additive: densities,
       populations, incomes, areas. It keeps the magnitudes that rank throws
       away — on this project's own density table it gives the twenty-five
       ordinary regions about half the ramp instead of the six per cent a
       linear reading leaves them — at the price of needing every value above
       zero, which a count or a percentage change is not. */
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

    /* Classes, when asked for, are quantiles — the same argument as above,
       one step coarser. More classes than the data has distinct values and
       the breaks land on top of each other; since a value falls into a class
       by `v >= break`, a table of one number came out at the DARKEST end
       rather than the lightest. So cap them, and a table with no variation at
       all gets none: one number is not a high number. */
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

    /* the inverse, so a legend can label a gradient bar: with rank spread,
       the value at position t is the t-quantile */
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
      /* valueAt() read backwards: where a value sits on the ramp, 0 to 1. A
         legend that wants to mark a real value — the median, or every row in
         the table — cannot work it out from the outside without redoing the
         spread, and a legend that redoes the spread is one that can disagree
         with the map it explains. */
      posOf: function (v) { return isFinite(v) ? where(v) : null; },
    };
  };

  /* a region name as an XML id: valid, and still readable in a layer list */
  function layerId(name) {
    return esc(String(name).trim().replace(/\s+/g, '-').replace(/["'<>&]/g, ''));
  }

  function palette(o) {
    var P = {}, k;
    for (k in PALETTE) P[k] = PALETTE[k];
    for (k in (o.palette || {})) P[k] = o.palette[k];
    return P;
  }

  /* water: true | false | {coast, lakes, rivers:'main'|'all'} */
  function normWater(w) {
    if (w === true || w == null) return { coast: true, lakes: true, rivers: 'main' };
    if (w === false) return { coast: false, lakes: false, rivers: null };
    return {
      coast: w.coast !== false,
      lakes: w.lakes !== false,
      rivers: w.rivers === undefined ? 'main' : w.rivers,
    };
  }

  /* ------------------------------------------------------------------ *
   * Coordinates are integers in a 10000-unit-wide space, so path data can use
   * relative commands with no decimal points. That is lossless — every delta
   * is an exact difference of two integers — which is why a shared boundary
   * cannot drift even when written twice (once in each neighbor's ring, once
   * in the borders path).
   * ------------------------------------------------------------------ */
  function n(v) { return String(Math.round(v)); }

  /* "3 -2 5 -1" -> "3-2 5-1": a minus sign is its own separator in SVG */
  function tight(nums) { return nums.join(' ').replace(/ -/g, '-'); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ *
   * decode
   * ------------------------------------------------------------------ */
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

    /* coast is a list of "arc:from-to" vertex runs, because one arc can be
       part shore and part land frontier — see build/pack.js */
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

  /* a ring, as a signed arc-index list -> "M x y l dx dy … Z" */
  function ringPath(dec, ring) {
    var head = null, d = [], cx = 0, cy = 0;
    for (var r = 0; r < ring.length; r++) {
      var i = ring[r], rev = i < 0, a = dec.arcs[rev ? ~i : i];
      var k = rev ? a.length - 1 : 0;
      var end = rev ? -1 : a.length;
      var step = rev ? -1 : 1;
      if (head) k += step;                      // consecutive arcs share an endpoint
      for (; k !== end; k += step) {
        var pt = a[k];
        if (!head) head = 'M' + pt[0] + ' ' + pt[1];
        else d.push(pt[0] - cx, pt[1] - cy);
        cx = pt[0]; cy = pt[1];
      }
    }
    return head ? head + (d.length ? 'l' + tight(d) : '') + 'Z' : '';
  }

  /* a whole arc, or the vertex span from..to of it */
  function arcPath(dec, i, from, to) {
    var a = dec.arcs[i];
    var lo = from === undefined ? 0 : Math.max(0, from);
    var hi = to === undefined ? a.length - 1 : Math.min(a.length - 1, to);
    if (hi <= lo) return '';
    var d = [];
    for (var k = lo + 1; k <= hi; k++) d.push(a[k][0] - a[k - 1][0], a[k][1] - a[k - 1][1]);
    return 'M' + a[lo][0] + ' ' + a[lo][1] + (d.length ? 'l' + tight(d) : '');
  }

  /* Split one boundary arc into its shore runs and the land frontier between,
     and remember which region each shore run belongs to — an unfolded tile
     needs its own piece of coastline, since the shared path is hidden. */
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

  /* ------------------------------------------------------------------ *
   * Merging a region with its child
   *
   * Concatenating the two path strings fills correctly under fill-rule
   * nonzero, but it leaves the child's ring inside the path — invisible while
   * the stroke matches the fill, and a stray line across Crimea the moment the
   * unfolded view strokes each tile. So the union is stitched properly: drop
   * every arc used twice inside the group (that is their shared boundary),
   * then walk the remaining arcs end-to-end back into closed rings.
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ *
   * grouping
   * ------------------------------------------------------------------ */
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
      /* null rather than 0 when no facts are attached, so a caller can tell
         "no figures loaded" from "genuinely zero" */
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

  /* ------------------------------------------------------------------ *
   * boundaries, all derived from arc usage
   *
   *   >= 2 distinct active regions   internal border
   *   1 distinct, 1 raw user         national boundary — coast or land frontier
   *   1 distinct, >= 2 raw users     interior to a merged region, draw nothing
   * ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ *
   * names
   * ------------------------------------------------------------------ */
  function kindOf(u) { return u.parent ? 'city' : u.ar ? 'ar' : 'oblast'; }

  function fullName(u, lang) {
    var k = kindOf(u);
    if (k === 'ar') return lang === 'uk' ? 'Автономна Республіка Крим' : 'Autonomous Republic of Crimea';
    if (k === 'city') return lang === 'uk' ? u.uk : u.en;
    return lang === 'uk' ? u.uk + ' область' : u.en + ' Oblast';
  }
  function shortName(u, lang) { return lang === 'uk' ? u.uk : u.en; }
  function cityName(u, lang) { return lang === 'uk' ? u.cuk : u.cen; }

  /* Two languages ship, and a newsroom in a third has nowhere to go: `lang` is
     a switch, not a slot. `names` is that slot — a layer over whichever
     language is selected, so you translate the handful you care about and the
     rest fall through rather than coming back blank.

       names: { 'UA-46': 'Lwowskie' }                       region name only
       names: { 'UA-46': { region: 'Lwowskie', city: 'Lwów' } }

     The region name is what a <title> tooltip, `data-name` and `labels:
     'region'` show; the city name is what the default label set shows, so a
     translation that sets only the region name changes the tooltips and not
     the visible labels. Keyed by the region drawn: under the default merge
     that is UA-32, not UA-30.

     Display only. resolve() still matches what a feed actually sends, which is
     Ukrainian or English, not your labels. */
  /* `titles` is a switch that also takes a table. A choropleth needs the value
     readable somewhere, and the browser already has a tooltip that works on
     touch, on hover and under a screen reader — so the number goes in the
     <title> that is being emitted anyway rather than into a tooltip library.

       titles: true
       titles: { 'UA-46': 'Львівська: 42 %' }      the rest keep their names
       titles: false

     Anything missing from the table falls back to the region's own name, so a
     partial table is a partial annotation, not a partial map. */
  function normTitles(v) {
    if (v === false || v == null) return null;
    return (v === true || typeof v !== 'object') ? {} : v;
  }

  /* Re-key a caller's table onto the regions actually drawn. A table keyed by
     ISO codes carries UA-30 and UA-40 whether or not this map splits them out;
     merged, their entries belong to the parent. An explicit entry on the parent
     is the unambiguous one and wins, from either position in the object. */
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

  /* ------------------------------------------------------------------ *
   * default skin
   *
   * Every color is a custom property, so a host restyles without touching
   * markup. `--c` is the single knob for a region's color: it sets the fill
   * and the hairline stroke together, so they cannot fall out of step. It
   * accepts anything a fill accepts, `url(#myGradient)` included.
   *
   * Visibility is driven by classes on the root rather than by what is
   * emitted, so the browser wrapper can toggle labels and water without
   * re-rendering — which is what stops a settings change from replaying the
   * animation or blinking the map.
   * ------------------------------------------------------------------ */
  function skin(p, P) {
    P = P || PALETTE;
    return (
      '.' + p + 'map{' +
        '--' + p + 'land:' + P.land + ';--' + p + 'line:' + P.line + ';' +
        '--' + p + 'outline:' + P.outline + ';--' + p + 'water:' + P.water + ';' +
        /* one color by default, three knobs if you want them */
        '--' + p + 'lake:var(--' + p + 'water);--' + p + 'river:var(--' + p + 'water);' +
        '--' + p + 'coast:var(--' + p + 'water);' +
        '--' + p + 'glow:' + P.glowAlpha + ';--' + p + 'waterop:' + P.waterOp + ';' +
        '--' + p + 'hi:' + P.hi + ';--' + p + 'text:' + P.text + ';--' + p + 'halo:' + P.halo + ';' +
        '--' + p + 'edge:' + P.edge + ';--' + p + 'hover:' + P.hover + ';' +
        'display:block}' +

      /* The seam killer: each region stroked in its own fill color, dilating
         it just enough that neighbors composite to full coverage instead of
         leaving an antialiasing hairline.

         The width belongs in DEVICE pixels, because that is where the
         antialiasing happens — and `stroke-width` is in CSS pixels, which are
         not the same thing on a 2x screen. One value cannot be right for both:
         1.3 is the measured-safe dilation at 1x and twice the needed weight at
         2x, where it reads as a soft edge; 0.5 looks crisp at 2x and leaves
         real seams at 1x. Measured, rasterising at 1:1 and counting interior
         pixels the fills miss (see DESIGN.md), 1.3 leaves single digits and
         0.5 leaves thousands.

         So the same ~1.3 device pixels is held at every density. */
      /* --cc is the color a region is ACTUALLY painted, and everything else
         derives from it: the fill, the seam stroke, the border in w-fills mode.
         The point of the indirection is the interactive states below. */
      '.' + p + 'region{--cc:var(--c,var(--' + p + 'land));fill:var(--cc);stroke:var(--cc);' +
        'stroke-width:' + W.seam + ';vector-effect:non-scaling-stroke;stroke-linejoin:round}' +
      '@media(min-resolution:2dppx),(-webkit-min-device-pixel-ratio:2){' +
        '.' + p + 'region{stroke-width:' + (W.seam / 2) + '}}' +
      '@media(min-resolution:3dppx),(-webkit-min-device-pixel-ratio:3){' +
        '.' + p + 'region{stroke-width:' + +(W.seam / 3).toFixed(2) + '}}' +
      /* ----------------------------------------------------------------
         Borders on a colored map.

         A fixed border color cannot be right against every fill: the gray
         reads clearly on pale land and disappears into a mid-tone, so one
         border looks like two weights across one map. When regions carry
         colors, each is outlined a step darker than ITSELF instead, and the
         shared gray line steps aside. The switch is the `w-fills` class, set
         when fills are actually present — a plain map has no color to derive
         from, and 14% of the land color is fainter than the gray line it
         would replace.

         `darken` is what stops it becoming a blur. Each region's stroke
         straddles its own edge, so at a boundary the visible line is whichever
         region happens to be painted last — and when that is the light one,
         a dark region meets a light one through a mid-tone line, which reads
         as a soft gradient rather than an edge. Blending picks the darker of
         the two, so the line is always the darker region's own rim.

         `isolation` on the group keeps that blending off the page behind it:
         without it, darken against a dark background would eat the map. */
      '.' + p + 'regions{isolation:isolate}' +
      /* :not(.is-unfolded) is load-bearing twice over. The grid spreads the
         tiles apart, so nothing overlaps and there is nothing to blend — 25
         blended layers in flight would be a cost for nothing. And the unfolded
         view gives each tile its own outline, in a rule of exactly this
         specificity that loses on source order, since its stylesheet is
         inserted ahead of this one. */
      '.' + p + 'map.w-fills .' + p + 'borders{display:none}' +
      '.' + p + 'map.w-fills:not(.is-unfolded) .' + p + 'region{mix-blend-mode:darken;' +
        'stroke:color-mix(in oklab,var(--cc),#000 var(--' + p + 'edge))}' +
      /* ----------------------------------------------------------------
         Hover, focus, selection.

         These set --cc, not --c, and the difference is not cosmetic. A host
         coloring regions from a stylesheet writes something like
         `#alerts .m-alert { --c: #c4302b }` — an id, so it outranks
         `.ukr-region:hover` and the hover simply stopped happening on exactly
         the maps that most need it. Writing to the derived property instead
         means the state wins whatever set the color, and hover reads the
         host's color rather than replacing it: a shade darker than whatever
         is there. Selection takes a color of its own instead, because it is
         a state the reader has to be able to find, not a passing highlight —
         which is also why it is opt-in (`select:true`): it overrides whatever
         color the region was carrying. The rule stays here either way, so
         `.is-selected` works when a host puts the class on itself. */
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
      /* Borders and the national outline are furniture: pinned to device
         pixels, so a small map does not turn into a mesh of lines. */
      '.' + p + 'borders,.' + p + 'outline{vector-effect:non-scaling-stroke}' +
      '.' + p + 'borders{stroke:var(--' + p + 'line);stroke-width:' + W.border + '}' +
      '.' + p + 'outline{stroke:var(--' + p + 'outline);stroke-width:' + W.outline + '}' +
      /* The shore is drawn at the national outline's weight, pinned to device
         pixels like it — the same line continued, and with water on it only
         changes color. As a proportional stroke it could not be right twice:
         at 1100 px it came out two and a half pixels against the outline's
         one, and at 300 px it was thinner than the outline it continues.
         Bevel, because a shoreline turns on itself at angles a miter answers
         with spikes. */
      '.' + p + 'coast{stroke:var(--' + p + 'outline);stroke-width:' + W.outline + ';' +
        'vector-effect:non-scaling-stroke;stroke-linejoin:bevel}' +

      /* The pale band sits UNDER the regions, so the land covers its inland
         half and only the seaward half shows — which is what makes it read as
         shallow water rather than as a fat border. Same color as the shore it
         belongs to; only the alpha and the width differ. */
      /* stroke-opacity, not opacity: the unfolded view animates `opacity` on
         these same layers, and one property cannot both carry the tint and
         carry the fade. */
      '.' + p + 'coastglow{stroke:var(--' + p + 'coast);' +
        'stroke-opacity:calc(var(--' + p + 'glow) * var(--' + p + 'waterop));' +
        'stroke-width:' + wpx(p, 'glow') + ';' +
        'stroke-linejoin:round;stroke-linecap:round;display:none}' +
      '.' + p + 'map.w-on .' + p + 'coastglow{display:block}' +
      /* The shore fades with the rest of the water, and that is the point: it
         IS water, drawn in the water color, and a shore that held its opacity
         while every river went pale would be a second water color nobody
         asked for. The country's silhouette going soft along the sea is the
         price, and it is the right way round — --ukr-waterop is a deliberate
         act, and one that says "make the water quieter". */
      '.' + p + 'map.w-on .' + p + 'coast{stroke:var(--' + p + 'coast);' +
        'stroke-opacity:var(--' + p + 'waterop)}' +

      '.' + p + 'water{pointer-events:none;display:none}' +
      '.' + p + 'map.w-on .' + p + 'water{display:block}' +
      /* See-through water, without the seams.
         Alpha put into the COLOR is applied per shape, so the Dnipro's thread
         double-darkens where it crosses its own reservoirs and every lake
         gains a darker rim from its own stroke — the river stops reading as
         one object. Group opacity composites the layer opaquely into a buffer
         first and blends it once, so the overlaps disappear. Hence its own
         token, and its own <g>: the unfolded view already animates `opacity`
         on .water, and one property cannot carry both. At the default 1 the
         buffer is skipped, so this costs nothing until it is used. */
      '.' + p + 'waterink{opacity:var(--' + p + 'waterop)}' +
      /* A reservoir is the river, widened. Same fill as the thread that runs
         through it, or the Dnipro reads as a line laid over separate lakes. */
      '.' + p + 'lakes{fill:var(--' + p + 'lake);stroke:var(--' + p + 'lake);' +
        'stroke-width:' + wpx(p, 'lake') + '}' +
      '.' + p + 'rivers{fill:none;stroke:var(--' + p + 'river);' +
        'stroke-width:' + wpx(p, 'river') + ';' +
        'stroke-linecap:round;stroke-linejoin:round}' +
      /* .minor is everything outside the default set: the tributaries, and the
         one reservoir that is not on the Dnipro. Always emitted so the
         component can toggle it; shown only under .w-all. */
      '.' + p + 'lakes .minor,.' + p + 'rivers .minor{display:none}' +
      /* a tributary is de-emphasised by WIDTH alone. It used to also carry
         opacity:.8, which is a second alpha inside the layer — and with
         --ukr-waterop set, every crossing of a tributary and the Dnipro
         darkened, which is the exact seam this design is avoiding. */
      '.' + p + 'rivers .minor{stroke-width:' + wpx(p, 'riverMinor') + '}' +
      '.' + p + 'map.w-all .' + p + 'lakes .minor,' +
      '.' + p + 'map.w-all .' + p + 'rivers .minor{display:inline}' +

      /* Scoped to the label GROUP, not to the layer that holds it: the
         unfolded view moves each label inside its region's tile, out of
         .ukr-labels, and a descendant selector silently stopped matching —
         which is how the labels lost their font and their halo. */
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

      /* Hover changes fill, and a fill transition is exactly what makes a map
         feel unresponsive — so there is none. The highlight lands with the
         pointer. Movement lives in ukrmap-unfold.js, which brings its own. */
    );
  }

  /* ------------------------------------------------------------------ *
   * render — pure, returns an SVG string
   * ------------------------------------------------------------------ */
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
    /* the three pixel-pinned lines, in map units, tuned for whatever size this
       file is about to declare it is */
    var LW = bakedWidths(data.size[0] + pad * 2, o.width);

    /* In attrs mode every paint is written onto the element; in inline mode
       the stylesheet does it and a per-region color is one custom property. */
    function regionPaint(key) {
      var c = fills[key];
      if (!bake) return c ? ' style="--c:' + esc(c) + '"' : '';
      var rim = c || P.land;
      /* Baked, the browser's two tricks are both unavailable: no custom
         property to mix from and no blend mode to resolve a shared edge. So
         the darkening is done here, and the shared border layer is dropped
         the same way the w-fills rules drop it. Which side of an edge wins is
         then paint order rather than luminance — a design tool is a place to
         edit the result, not to read a boundary off. */
      c = c || P.land;
      if (fillsGiven) rim = darken(c, P.edge);
      return ' fill="' + esc(c) + '" stroke="' + esc(rim) + '" stroke-width="' + LW.seam + '"'
        + ' stroke-linejoin="round"';
    }
    /* `scaling` = the width is in MAP units and must scale with the map, so no
       non-scaling-stroke. That is every wet line: design tools ignore
       vector-effect, and a 1.3-unit stroke on a 10000-unit map imports as
       nothing at all — which is what made the rivers vanish in Illustrator. */
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

    /* --- regions: the land itself, one path each --- */
    body += '<g class="' + p + 'regions">';
    g.groups.forEach(function (u) {
      var name = N.full(u.head);
      /* No id in the browser modes: nothing here refers to one — regions are
         reached by class and data-key — and emitting 25 meant a page with two
         maps, or a map beside its own tiles, shared every id in the document.
         A <use href="#ukr-UA-43"> resolved to whichever came first and worked
         only because the geometry happened to match. The unfolded view does
         need them, so it sets them itself; see ukrmap-unfold.js.

         attrs mode wants the opposite: Figma and Illustrator name a layer after
         its id, and a file without them imports as 25 layers called "Vector".
         Nothing in a baked file resolves an id, so these are pure labels and
         can be the region's name — minus the spaces, invalid in an XML id. */
      var path = '<path class="' + p + 'region"' + (bake ? ' id="' + layerId(name) + '"' : '')
        + ' data-key="' + u.key + '"'
        + ' data-name="' + esc(name) + '" pointer-events="fill"' + regionPaint(u.key)
        + ' d="' + u.d + '">'
        + titleOf(u.key, name)
        + '</path>';
      /* an <a> wrapper makes a static map navigable with no JavaScript */
      var cell = o.link
        ? '<a href="' + esc(o.link.replace(/\{key\}/g, u.key)) + '">' + path + '</a>'
        : path;

      body += cell;
    });
    body += '</g>';

    /* --- water, above the fills so a highlight cannot swallow the river ---
       Two nested groups on purpose: .water is the one the unfolded view fades
       with `opacity`, .waterink is the one --ukr-waterop tints, and putting
       both on one element would make them fight. */
    if (w.lakes || w.rivers) {
      body += '<g class="' + p + 'water"><g class="' + p + 'waterink">';
      if (w.lakes && data.water.lakes.length) {
        body += '<g class="' + p + 'lakes">';
        data.water.lakes.forEach(function (l) {
          /* `main` is the default set — the Dnipro cascade. The one reservoir
             that is not on the Dnipro is a stray blob in a view that is
             otherwise the river and the sea, so it waits for --water=all. */
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
        + linePaint(w.coast ? P.water : P.outline, LW.outline, true)
        + ' d="' + e.coast + '"/>';

    /* --- labels last, so nothing can paint over them --- */
    if (wantCity || wantName) {
      /* Two active regions can share an administrative center: split Kyiv City
         out and its oblast is still run from Kyiv, which is no longer inside
         it. Mark the point once, preferring the city itself. */
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

    /* A file with no size of its own is a file every tool sizes differently:
       Figma reads the viewBox as pixels — ten thousand of them — and then
       every resize becomes a decision about stroke weight that nobody meant
       to make. Declaring the size is what makes the widths above mean
       something. */
    var dim = o.width
      ? ' width="' + n(o.width) + '" height="' + n(Math.round(o.width * vbH / vbW)) + '"'
      : '';

    return '<svg xmlns="' + NS + '" class="' + cls.join(' ') + '"'
      + ' viewBox="' + (-pad) + ' ' + (-pad) + ' ' + n(vbW) + ' ' + n(vbH) + '"' + dim
      + ' role="img" aria-label="'
      + esc(o.lang === 'uk' ? 'Регіони України' : 'Regions of Ukraine') + '"'
      + ' data-detail="' + data.detail + '" data-version="' + mount.version + '">'
      /* An SVG is passed around for years, detached from wherever it came from,
         and by then nobody can tell which vintage of the borders it holds.
         <desc> travels with the file and is read after the aria-label, so it is
         a footnote for a screen reader rather than a wall in front of the map. */
      + '<desc>' + esc(descOf(data, o)) + '</desc>'
      + (o.style === 'inline' ? '<style>' + skin(p, P) + '</style>' : '')
      + (defs ? '<defs>' + defs + '</defs>' : '')
      + body
      + '</svg>';
  }

  /* ------------------------------------------------------------------ *
   * regionSvg — one region on its own
   *
   * For a list or table with a shape beside each row. Returning a separate
   * small SVG per region beats an SVG "list view": the surrounding text stays
   * plain HTML, so it is styleable, selectable, translatable and accessible in
   * the ordinary way, and you can put whatever you like beside each shape.
   *
   * Sizing, three ways — and they answer different questions:
   *
   *   scale: 42          pixels per 1000 map units. One shared scale, so the
   *                      shapes stay COMPARABLE: Chernivtsi really is smaller
   *                      than Crimea. Rows end up different heights.
   *   fit: {height: 64}  every region 64 px tall. Rows line up, widths vary,
   *                      and the shapes are no longer comparable in size.
   *   fit: {width: 96}   the same, the other way round.
   *   (nothing)          no width/height at all: fills its container.
   *
   * Water follows the same clip trick the unfolded tiles use, so a region can
   * carry its own stretch of river and shore.
   * ------------------------------------------------------------------ */
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

    var per = null;                          /* pixels per map unit */
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

    /* The region's own water, clipped to its own shape — and only the features
       whose bounding box actually reaches it. Including every river in every
       region SVG tripled the size of a split set for nothing. Built before the
       land path because it is the only thing here that needs an id to point at:
       no water, no clipPath, no id, nothing to collide with. */
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
        + (bake ? ' fill="none" stroke="' + P.water + '" stroke-width="' + WF.outline + '"' : '') + '/>';
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

    /* the tile's own outline replaces the shared border layer here, exactly as
       it does in the unfolded view */
    /* w-on / w-all are what the shared skin keys its water rules off. Without
       them a region tile rendered in inline mode drew its coast in the land
       frontier's color and dropped the shallow band entirely. */
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

  /* ------------------------------------------------------------------ *
   * lon/lat -> map units
   *
   * The map is a Lambert Conformal Conic fitted to Ukraine, and the forward
   * transform was already written — in build/pack.js, to place the city dots.
   * It ran once at build time and the result was thrown away, so a caller
   * holding real coordinates had no way onto the map at all.
   *
   * Two halves. The LCC itself is fixed and its constants ride in the data file
   * so a file projected some other way can be refused rather than silently
   * misplaced. The affine that follows is NOT fixed: the bounding box is taken
   * over the simplified geometry, so it shifts by a few hundred meters between
   * detail levels, which is why it has to come from the file too.
   *
   * Agreement with PROJ is checked at build time and is under a meter.
   * ------------------------------------------------------------------ */
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
      /* Longitude first is the order every geo format uses and roughly half of
         all callers get wrong, and for Ukraine the two are never confusable by
         range: latitude is ~44-53, longitude ~22-41. A point far outside the
         region this projection was fitted to is still computed — a neighboring
         capital is a fair thing to want — but it is worth saying once. */
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

  /* ------------------------------------------------------------------ *
   * Who borders whom, and which way
   *
   * The adjacency is already in the topology — an arc used by two regions is
   * the border between them — and its length falls out of the same walk. Both
   * are wanted for arrow-key navigation, and both are useful on their own:
   * "which regions touch Poltava", "color no two neighbors alike".
   *
   * toward() is the arrow-key rule. It used to walk the three geographic
   * bands: left and right along a band, up and down between them, keeping the
   * index. That is a grid, and the country is not one — pressing down from
   * Lviv landed on Chernivtsi because it sat at index 1 of the next band,
   * skipping Ivano-Frankivsk, and right from Dnipropetrovsk and Zaporizhzhia
   * went wherever the index pointed rather than to Donetsk, which both border.
   *
   * So: real neighbors only, within 75° of the direction pressed. Outside
   * that cone nothing happens — at the edge of the country there IS nothing
   * that way, and a dead end reads better than a sideways jump to the
   * least-bad candidate.
   *
   * Ties are settled by the length of the shared border, and they are not
   * close calls. From Lviv, Zakarpattia lies 29° off straight down and
   * Ivano-Frankivsk 30°: noise. But Lviv shares 1314 units of edge with
   * Ivano-Frankivsk and 526 with Zakarpattia, over the Carpathian ridge. The
   * longer border is the one a reader means by "below".
   * ------------------------------------------------------------------ */
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
      if (keys.length < 2) return;              /* a national boundary arc */
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

  /* the label anchor, not a bounding-box center: it is guaranteed to be inside
     the shape, which a box center is not for Odesa or Crimea */
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
      if (dot <= 0) continue;                   /* behind us */
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

  /* ------------------------------------------------------------------ *
   * name -> key
   *
   * Feeds rarely speak ISO. Alert APIs, spreadsheets and CMS fields carry
   * "Львівська область", "м. Київ", "Odessa Oblast", "Zaporizhia". This
   * normalizes and matches against every name in the data, plus the
   * transliterations and legacy forms that turn up most often.
   * ------------------------------------------------------------------ */
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

    /* Normalising drops the words that carry no identity, token by token — a
     bare regex would strip a stray "м" out of the middle of real words. */
  var STOP = {
    'область': 1, 'обл': 1, 'області': 1, 'обласна': 1, 'рада': 1,
    'oblast': 1, 'region': 1, 'province': 1,
    'автономна': 1, 'республіка': 1, 'autonomous': 1, 'republic': 1, 'of': 1,
    'ар': 1, 'ar': 1, 'м': 1, 'місто': 1, 'misto': 1, 'city': 1, 'the': 1,
  };

  /* "Kyiv" and "Kyiv Oblast" both normalize to "kyiv", so the discarded word
     is what disambiguates: an oblast marker means the region, a city marker
     means the city, and a bare name means the city if one bears it. */
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

    /* Cities claim their own bare name first, so "Київ" and "Kyiv" land on the
       same unit in either language. Under the default merging they resolve to
       the parent oblast anyway; the distinction only bites once Kyiv is split
       out, which is exactly when you want it. */
    data.units.forEach(function (u) {
      if (!u.parent) return;
      put(ix, u.uk, u.k); put(ix, u.en, u.k);
      put(city, u.uk, u.k); put(city, u.en, u.k);
      put(city, u.cuk, u.k); put(city, u.cen, u.k);
    });
    /* then each region's own adjective and code */
    data.units.forEach(function (u) {
      put(ix, u.k, u.k); put(ix, u.uk, u.k); put(ix, u.en, u.k);
      put(ix, fullName(u, 'uk'), u.k); put(ix, fullName(u, 'en'), u.k);
      if (u.parent) return;
      put(oblast, u.k, u.k); put(oblast, u.uk, u.k); put(oblast, u.en, u.k);
      put(oblast, fullName(u, 'uk'), u.k); put(oblast, fullName(u, 'en'), u.k);
      put(oblast, u.cuk, u.k); put(oblast, u.cen, u.k);
    });
    /* center names last: they are shared, so they must not override anything */
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

  /* ------------------------------------------------------------------ *
   * browser instance
   * ------------------------------------------------------------------ */
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

    /* Everything CSS can toggle is always present in the markup, so changing a
       setting never re-renders: no blink, and the unfolded layout does not
       replay its animation. */
    function liveOptions() {
      var out = {};
      for (var k in o) out[k] = o[k];
      out.labels = 'all';
      out.water = { coast: true, lakes: true, rivers: 'all' };
      return out;
    }

    /* reading order: the geographic bands, with a split-out child beside its
       parent, which is also the order the unfolded grid uses */
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
      nbr = null;                 /* merging can change who borders whom */
      el.innerHTML = render(data, liveOptions());
      svg = el.querySelector('svg');
      regions = {}; labels = {};

      /* One tab stop into the map, then arrow keys between regions — 25 tab
         stops ahead of the rest of the page is not navigation, it is a wall.
         The SVG becomes a group rather than an image, because an image is not
         allowed interactive children. */
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

    /* --- classes carry every toggleable setting --- */
    function syncClasses() {
      var w = normWater(o.water);
      svg.classList.toggle('w-on', !!(w.coast || w.lakes || w.rivers));
      svg.classList.toggle('w-all', w.rivers === 'all');
      svg.classList.toggle('l-city', o.labels === 'city' || o.labels === 'all');
      svg.classList.toggle('l-region', o.labels === 'region' || o.labels === 'all');
    }

    /* --- language is a text swap, not a re-render --- */
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
          /* data-name stays the region's name — that is its identity, and the
             hover readout reads it. The <title> is the tooltip, and a value
             put there by title() outweighs the name. */
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

    /* --- events. No transition on hover: the reaction is the point. --- */
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
    /* A click always says which region was clicked; whether that click also
       LEAVES something behind is the host's call. Most maps are a way into
       something else — a panel, a filter, a route — and there the highlight
       belongs to the thing that changed, not to the map. Selection is a state
       of its own, so with `select:true` the event carries the selection
       (null when the click cleared it) rather than the region hit. */
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

    /* Focus alone tells a screen reader the region's name; this adds what the
       host has put on the map, so a choropleth is not silent. */
    function announce(key) {
      if (!live || !key) return;
      var u = byRK[key];
      if (!u) return;
      var bits = [namer(o).full(u.head)];
      if (state.select === key) bits.push(o.lang === 'uk' ? 'вибрано' : 'selected');
      if (marks && marks[key]) bits.push(marks[key]);
      live.textContent = bits.join(', ');
    }

    /* --u is user units per CSS pixel: the one number that lets a stylesheet
       talk in screen pixels inside a scaled viewBox. Water uses it as a
       device-pixel FLOOR under its otherwise proportional stroke, and
       labelScale:'fixed' uses it to pin labels to screen pixels. A static file
       has no JavaScript to set it, so every rule that reads it carries a
       fallback that degrades to the purely proportional behavior. */
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

    /* A table keyed by ISO codes has 27 rows: Kyiv City (UA-30) and Sevastopol
       (UA-40) are their own units whether or not this map draws them apart.
       Merged, their values have to travel to the parent — they used to hit
       `if (regions[j])`, fail, and vanish. Twenty-five regions colored, the
       map looked complete, and nothing said two rows had been dropped. */
    function resolveKeys(values, what) {
      var out = {}, from = {}, unknown = [], clash = [], k;
      for (k in values) {
        var rk = regions[k] ? k : g.renderKey[k];
        if (!rk || !regions[rk]) { unknown.push(k); continue; }
        if (from.hasOwnProperty(rk) && out[rk] !== values[k]) {
          clash.push(from[rk] + ' and ' + k + ' both land on ' + rk);
          /* the value written for the region actually drawn is the unambiguous
             one, so it wins whichever order the object happened to be in —
             render() resolves fills by the same rule */
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

    /* Borders derive from the fills once there are fills to derive from — the
       same switch render() makes from its `fills` option, kept in step as
       set() and mark() come and go. mark() counts: a class per region is how
       you color from a stylesheet, and the alert map is exactly that. If you
       color regions some other way again, put `w-fills` on the <svg> yourself
       — the class is the whole interface. */
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

    /* Resizing does NOT rebuild: nothing about the markup depends on the pixel
       width, only --u does. It used to call onRebuild() here, which handed a
       DOM-restructuring plugin an unchanged DOM to restructure again — every
       resize wrapped the unfolded view's tiles in one more <g>, duplicated its
       <style>, and re-declared 25 clip-path ids. */
    var onResize = function () { resize(); };
    window.addEventListener('resize', onResize);

    build();

    /* options that change the markup, and so need a rebuild */
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
      /* a plugin that restructures the DOM needs to redo it after a rebuild */
      onRebuild: function (fn) { onRebuild = fn; return this; },

      /* labels, water and language are class and text changes only, so the
         map neither blinks nor replays the unfolded animation */
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

      /* choropleth: one custom property per region keeps the fill and its
         seam-covering stroke in step. Accepts any fill value, url(#grad) too. */
      set: function (values) { colors = values || null; applyColors(); return this; },

      /* a class per region — for states you want to style or animate yourself,
         e.g. {'UA-46':'alert'} adds .m-alert */
      mark: function (values) { marks = values || null; applyMarks(); return this; },

      /* The number, in the tooltip the map already has. A choropleth has to
         say what the color means somewhere, and <title> is read on hover, on
         a long press and by a screen reader without this project owning a
         tooltip layer. Pass null to put the region names back.

           map.set({ 'UA-46': colorData(v) }).title({ 'UA-46': 'Львівська: ' + v + ' %' }); */
      title: function (values) { titles = values || null; paintText(); return this; },

      /* Where a coordinate lands: {x, y} in map units, and {left, top} in CSS
         pixels relative to map.el, which is what you need to put your own HTML
         over the map. getScreenCTM() is the exact user-space -> screen matrix,
         so this survives any CSS width, any preserveAspectRatio and any scroll
         without this file knowing about any of them.

         It answers for the MAP layout. In the unfolded grid every region has
         moved and a point does not follow it — deliberately: making it follow
         means hanging off each tile's animated transform, and an extra reader
         of that transform is exactly what the unfolded view is careful not to
         have. Pin things in map view, or hide them while the grid is up. */
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

      /* a feed's own name -> the key actually being drawn (merging applied) */
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
  /* the plugin needs each region's own stretch of coastline, which is derived
     from arc usage rather than stored */
  /* Areas and populations ship separately from the geometry, because they age
     at completely different rates. Attach them when you want them. */
  mount.facts = function (data, facts) {
    var dec = decode(data);
    var by = (facts && facts.units) || facts || {};
    data.units.forEach(function (u) {
      var f = by[u.k];
      if (!f) return;
      if (f.area != null) u.area = f.area;
      if (f.pop != null) u.pop = f.pop;
    });
    dec.cache = {};              /* group() sums these, so its cache is stale */
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
  /* {key: {key: shared border length in map units}} — the adjacency graph the
     arrow keys walk, and `toward` is that walk. Merging is applied, so under
     the default 25 regions Kyiv City's borders belong to Kyiv Oblast. */
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
  /* [x, y] in map units — the same space the paths and u.c centers are in, so
     it composes with everything else here and needs no DOM. */
  mount.project = function (data, lon, lat) { return projector(data)(lon, lat); };
  /* numbers -> colors; the implementation sits with its OKLab helpers above.
     Not `scale`: that word is already taken here for pixels per 1000 map units
     (regionSvg's option, the CLI's --scale), and one name for two unrelated
     things is a name that has to be explained every time. */
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
  mount.version = '3.0.0';   /* keep in step with package.json */
  return mount;
}));
