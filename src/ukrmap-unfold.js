/*!
 * ukrmap-unfold — the map ⇄ grid animation, as an opt-in layer.
 *
 *   <script src="ukrmap.js"></script>
 *   <script src="ukrmap-unfold.js"></script>
 *   <script>
 *     const map = UkrMap('#m', { data: UKR_DATA });
 *     UkrMap.unfold(map);          // adds map.view('map' | 'grid')
 *   </script>
 *
 * Separate because it is the most expensive thing in the project and the least
 * often wanted: the wrappers, clip paths, flow measurement, per-tile water and
 * coastline, and the class choreography all exist for one transition. The core
 * map, its labels, water and static export do not need any of it.
 *
 * Three things make the movement smooth, all of them learned the hard way:
 *
 *   1. ONE animated element per LAYER per region — two in total, and no more.
 *      The label used to ride inside the tile wrapper, which kept it perfectly
 *      in step but also buried it in the regions layer, underneath the shared
 *      water: in map view the Dnipro painted straight over Kyiv and Cherkasy.
 *      So labels get their own wrapper in the labels layer, which is drawn
 *      last. Both wrappers carry the same class, the same transition and the
 *      same will-change, and both transforms are written in the same loop of
 *      the same task, so they start on the same frame and are interpolated by
 *      the same timing function. That is what keeps them from shimmering —
 *      not being one element, but being started identically and both
 *      promoted. A label on an unpromoted layer is what used to jiggle.
 *   2. NO animated ancestor. The centring offset is folded into each tile's
 *      own translate rather than applied to a parent group; an animated
 *      ancestor stops the browser compositing its descendants independently,
 *      so every frame re-rasterises.
 *   3. will-change is set once and left alone. Toggling it promotes and
 *      demotes layers mid-flight, which re-rasterises text — the visible
 *      jiggle. Clipping is also suspended while moving, since re-applying 25
 *      clip paths every frame is what made it feel heavy.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ukrmap.js'));
  else factory(root.UkrMap);
}(typeof self !== 'undefined' ? self : this, function (UkrMap) {
  'use strict';

  if (!UkrMap) throw new Error('ukrmap-unfold: load ukrmap.js first');

  var NS = 'http://www.w3.org/2000/svg';

  var DEFAULTS = {
    spread: 1.62,   // grid width ÷ map width. 1.62 keeps the three geographic
                    // bands on one row each, as the 2012 map did, and centers
                    // the map in the wider box. 1 makes the grid as wide as the
                    // map, so the bands wrap instead.
    gapX: 150,      // grid gaps, in map units (the map is 10000 wide)
    gapY: 210,
    duration: 500,
  };

  var n = function (v) { return String(Math.round(v)); };

  /* Ids are namespaced per unfolded map, separately from the class prefix.
     Two maps on one page share a prefix by design — that is what makes one
     stylesheet cover both — but they must not share an id, or the second
     map's <use> and clip-path both resolve into the first one's defs. */
  var SEQ = 0;

  /* the layers that only mean anything while the map is assembled; § is the
     prefix, so one list serves both the transition and the reduced-motion rule */
  var SHARED = '§borders,§outline,§coast,§coastglow,§water';

  function css(p) {
    return (
      '.' + p + 'stage{overflow:hidden;transition:height var(--' + p + 'dur,.5s) ' +
        'var(--' + p + 'ease,cubic-bezier(.62,0,.28,1))}' +

      /* One transform per tile, declared once, promoted once. */
      '.' + p + 'unit{transition:transform var(--' + p + 'dur,.5s) ' +
        'var(--' + p + 'ease,cubic-bezier(.62,0,.28,1));will-change:transform}' +

      /* Coming back, the shared furniture fades up into place. Going out it
         must leave almost at once, or a ghost contour of the whole country
         hangs in the air while the tiles are already halfway gone.
         The child combinator matters: the shared layers are direct children of
         the <svg>, the per-tile copies below carry the same classes so they
         inherit color and weight, and only these must fade out. */
      SHARED.replace(/§/g, '.' + p) + '{transition:opacity .34s linear}' +
      SHARED.replace(/§/g, '.' + p + 'map.is-unfolded>.' + p) +
        '{opacity:0;transition-duration:.09s}' +

      /* Each tile's own outline takes over from the shared border layer, at the
         same width, so no line thickens or thins as the view changes. */
      '.' + p + 'map.is-unfolded .' + p + 'region{stroke:var(--' + p + 'line);stroke-width:.7}' +

      /* A tile's own water and shore. Hidden while assembled (the shared
         layers cover them exactly) and while moving (re-applying 25 clip paths
         per frame is what made this feel heavy), then faded in once settled. */
      '.' + p + 'tilewater,.' + p + 'tilecoast,.' + p + 'tileglow{' +
        'opacity:0;pointer-events:none;transition:opacity .25s linear}' +
      '.' + p + 'map.w-on.is-unfolded:not(.is-moving) .' + p + 'tilewater,' +
      '.' + p + 'map.w-on.is-unfolded:not(.is-moving) .' + p + 'tilecoast,' +
      '.' + p + 'map.w-on.is-unfolded:not(.is-moving) .' + p + 'tileglow{opacity:1}' +
      '.' + p + 'map.is-moving .' + p + 'tilewater{visibility:hidden}' +


      '@media (prefers-reduced-motion:reduce){' +
        '.' + p + 'stage,.' + p + 'unit,' + SHARED.replace(/§/g, '.' + p) + ',' +
        '.' + p + 'tilewater,.' + p + 'tilecoast,.' + p + 'tileglow{transition:none}}'
    );
  }

  UkrMap.unfold = function (map, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (options || {})) o[k] = options[k];

    var p = map.prefix;
    var ns = p + 'u' + (++SEQ) + '-';
    var data = map.data;
    var el = map.el;
    var svg, stage, units, flow = null, gridCache = null, timer = null;
    var view = 'map';
    var mapW = data.size[0], mapH = data.size[1];
    var pad = map.options_.pad;
    var boxW = Math.round(mapW * o.spread) + pad * 2;
    var center = (mapW * o.spread - mapW) / 2;

    /* ---------------------------------------------------------------- setup */

    function restructure() {
      svg = map.svg;
      units = {};

      /* build() replaces the whole SVG, so a rebuild always arrives clean. If
         it ever does not, wrapping a second time would nest the tiles and
         duplicate every clip-path id — cheap to refuse, expensive to debug. */
      if (svg.querySelector('.' + p + 'unit')) return;
      units = {};

      var style = document.createElementNS(NS, 'style');
      style.textContent = css(p);
      svg.insertBefore(style, svg.firstChild);

      /* stage crops the taller of the two views, so the viewBox can stay put */
      if (!el.querySelector('.' + p + 'stage')) {
        var st = document.createElement('div');
        st.className = p + 'stage';
        el.insertBefore(st, svg);
        st.appendChild(svg);
      }
      stage = el.querySelector('.' + p + 'stage');

      var defs = svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS(NS, 'defs');
        svg.insertBefore(defs, svg.firstChild.nextSibling);
      }

      var shores = UkrMap.edges(data, map.options_).coastBy;
      var water = svg.querySelector('.' + p + 'water');
      var waterDefs = '';
      if (water) {
        var lakes = water.querySelector('.' + p + 'lakes');
        var joinD = function (nodes) {
          return Array.prototype.map.call(nodes, function (x) { return x.getAttribute('d'); }).join('');
        };
        /* main and minor are kept apart here exactly as they are in the
           shared layer, or a tile would carry water the map itself hides:
           the tributaries, and the one reservoir off the Dnipro. */
        if (lakes) {
          var lakeMain = joinD(lakes.querySelectorAll('path:not(.minor)'));
          var lakeMinor = joinD(lakes.querySelectorAll('path.minor'));
          if (lakeMain) waterDefs += '<path id="' + ns + 'wl" d="' + lakeMain + '"/>';
          if (lakeMinor) waterDefs += '<path id="' + ns + 'wln" d="' + lakeMinor + '"/>';
        }
        var mainD = joinD(svg.querySelectorAll('.' + p + 'rivers .main'));
        var minorD = joinD(svg.querySelectorAll('.' + p + 'rivers .minor'));
        if (mainD) waterDefs += '<path id="' + ns + 'wrm" d="' + mainD + '"/>';
        if (minorD) waterDefs += '<path id="' + ns + 'wrn" d="' + minorD + '"/>';
      }

      /* render() emits no ids — nothing in a plain map refers to one. The
         clip paths below do, so the ids are put on here, namespaced to this
         map, and they live exactly as long as the restructured DOM does. */
      var clipDefs = '';
      map.units.forEach(function (u) {
        var region = map.regionEl(u.key);
        if (!region) return;
        region.id = ns + u.key;
        clipDefs += '<clipPath id="' + ns + 'clip-' + u.key + '"><use href="#' + ns + u.key + '"/></clipPath>';
      });
      defs.insertAdjacentHTML('beforeend', waterDefs + clipDefs);

      /* Labels are drawn last, in their own layer, so nothing — least of all
         the shared water — can paint over a city name. */
      var labelLayer = svg.querySelector('.' + p + 'labels');
      if (!labelLayer) {
        labelLayer = document.createElementNS(NS, 'g');
        labelLayer.setAttribute('class', p + 'labels');
        svg.appendChild(labelLayer);
      } else {
        svg.appendChild(labelLayer);          /* make sure it really is last */
      }

      /* Wrap each region; its label gets a matching wrapper in the layer above. */
      map.units.forEach(function (u) {
        var region = map.regionEl(u.key);
        if (!region) return;
        var host = region.parentNode.tagName === 'a' ? region.parentNode : region;
        var g = document.createElementNS(NS, 'g');
        g.setAttribute('class', p + 'unit');
        g.setAttribute('data-key', u.key);
        host.parentNode.insertBefore(g, host);

        var shore = shores[u.key];
        if (shore) g.insertAdjacentHTML('beforeend', '<path class="' + p + 'coastglow ' + p + 'tileglow" d="' + shore + '"/>');
        g.appendChild(host);
        if (waterDefs) {
          var inner = '';
          if (waterDefs.indexOf(ns + 'wl"') > -1)
            inner += '<g class="' + p + 'lakes"><use href="#' + ns + 'wl"/></g>';
          if (waterDefs.indexOf(ns + 'wln"') > -1)
            inner += '<g class="' + p + 'lakes"><use class="minor" href="#' + ns + 'wln"/></g>';
          if (waterDefs.indexOf(ns + 'wrm"') > -1)
            inner += '<g class="' + p + 'rivers"><use class="main" href="#' + ns + 'wrm"/></g>';
          if (waterDefs.indexOf(ns + 'wrn"') > -1)
            inner += '<g class="' + p + 'rivers"><use class="minor" href="#' + ns + 'wrn"/></g>';
          /* .waterink so a tile's water tints exactly like the shared layer */
          g.insertAdjacentHTML('beforeend',
            '<g class="' + p + 'tilewater" clip-path="url(#' + ns + 'clip-' + u.key + ')">'
            + '<g class="' + p + 'waterink">' + inner + '</g></g>');
        }
        if (shore) g.insertAdjacentHTML('beforeend', '<path class="' + p + 'coast ' + p + 'tilecoast" d="' + shore + '"/>');

        var pair = [g];
        var label = map.labelEl(u.key);
        if (label) {
          var lg = document.createElementNS(NS, 'g');
          lg.setAttribute('class', p + 'unit');
          lg.setAttribute('data-key', u.key);
          lg.appendChild(label);
          labelLayer.appendChild(lg);
          pair.push(lg);
        }

        units[u.key] = pair;
      });

      /* The shared furniture only ever shows in map view, so its centring
         offset is static — nothing about it animates.
         `:scope >` is load-bearing. Each tile's own shore carries the shared
         classes so it inherits their color and weight from one place, so a
         bare '.ukr-coast' selector here reaches inside the tiles and adds the
         centring offset ON TOP of the tile's own transform — which slides
         every coastline out of its region and strings them across the grid
         as one detached ribbon. Only direct children are shared layers. */
      Array.prototype.forEach.call(
        svg.querySelectorAll(SHARED.replace(/§/g, ':scope>.' + p)),
        function (node) { node.setAttribute('transform', 'translate(' + n(center) + ' 0)'); });

      gridCache = null;
      apply(view, false);
    }

    /* --------------------------------------------------------------- layout
     *
     * The 2012 version got this for free: it let the browser flow the region
     * boxes and read the positions back. Same trick — a hidden flow of
     * inline-block boxes, one per region, sized to each region's bounding box
     * in map units, with a line break between the geographic bands. Whatever
     * the browser does with them IS the grid. No packing algorithm.
     */
    function flowOrder() {
      var seq = [];
      var live = {};
      map.units.forEach(function (u) { live[u.key] = 1; });
      data.bands.forEach(function (band, bi) {
        band.forEach(function (key) {
          /* a split-out child belongs beside its parent — Kyiv City goes just
             before Kyiv Oblast, not wherever the unit list happens to put it */
          data.units.forEach(function (u) {
            if (u.parent === key && live[u.k]) seq.push(u.k);
          });
          seq.push(key);
        });
        if (bi < data.bands.length - 1) seq.push(null);
      });
      return seq;
    }

    function measureGrid() {
      if (!flow) {
        flow = document.createElement('div');
        flow.setAttribute('aria-hidden', 'true');
        flow.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;'
          + 'font-size:0;line-height:0';
        document.body.appendChild(flow);
      }
      flow.style.width = Math.round(mapW * o.spread) + 'px';

      var byKey = {};
      map.units.forEach(function (u) { byKey[u.key] = u; });

      var html = '';
      flowOrder().forEach(function (key) {
        if (key === null) { html += '<br>'; return; }
        var u = byKey[key];
        if (!u) return;
        /* vertical-align:top matters: inline-blocks sit on the text baseline by
           default, so boxes of differing heights stagger and rows overlap. */
        html += '<i data-key="' + u.key + '" style="display:inline-block;vertical-align:top;'
          + 'width:' + (u.bb[2] + o.gapX) + 'px;height:' + (u.bb[3] + o.gapY) + 'px"></i>';
      });
      flow.innerHTML = html;

      var pos = {}, bottom = 0;
      Array.prototype.forEach.call(flow.children, function (b) {
        if (b.tagName !== 'I') return;
        var u = byKey[b.getAttribute('data-key')];
        pos[u.key] = [b.offsetLeft + o.gapX / 2 - u.bb[0], b.offsetTop + o.gapY / 2 - u.bb[1]];
        bottom = Math.max(bottom, b.offsetTop + b.offsetHeight);
      });
      return { pos: pos, h: bottom };
    }

    var grid = function () { return (gridCache = gridCache || measureGrid()); };

    function resize() {
      if (!stage) return;
      var px = stage.clientWidth || 1;
      var h = (view === 'map' ? mapH : grid().h) + pad * 2;
      stage.style.height = (h / boxW * px).toFixed(1) + 'px';
    }

    function apply(next, animate) {
      view = next;
      var pos = next === 'grid' ? grid().pos : null;

      for (var key in units) {
        var t = pos && pos[key]
          ? 'translate(' + n(pos[key][0]) + ' ' + n(pos[key][1]) + ')'
          : 'translate(' + n(center) + ' 0)';
        /* shape and label, same value, same task — see the note at the top */
        for (var i = 0; i < units[key].length; i++) units[key][i].setAttribute('transform', t);
      }

      /* the viewBox covers the taller view, so nothing is clipped mid-flight;
         the stage animates down to whichever one is showing */
      var maxH = Math.max(mapH, grid().h);
      svg.setAttribute('viewBox', (-pad) + ' ' + (-pad) + ' ' + n(boxW) + ' ' + n(maxH + pad * 2));
      resize();

      clearTimeout(timer);
      if (next !== 'map') svg.classList.add('is-unfolded');
      else if (!animate) svg.classList.remove('is-unfolded');

      if (animate) {
        svg.classList.add('is-moving');
        /* drop is-unfolded a little before the tiles land, so the borders and
           coastline fade up into place rather than appearing after the fact */
        timer = setTimeout(function () {
          if (view === 'map') svg.classList.remove('is-unfolded');
          timer = setTimeout(function () { svg.classList.remove('is-moving'); }, 240);
        }, o.duration - 60);
      } else {
        svg.classList.remove('is-moving');
      }
    }

    restructure();
    map.onRebuild(restructure);

    var onResize = function () { gridCache = null; apply(view, false); };
    window.addEventListener('resize', onResize);
    map.onDestroy(function () {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
      if (flow && flow.parentNode) flow.parentNode.removeChild(flow);
    });

    /* the whole reason this exists */
    map.view = function (v) {
      if (v === undefined) return view;
      apply(v, true);
      return map;
    };

    return map;
  };

  UkrMap.unfold.defaults = DEFAULTS;
  return UkrMap.unfold;
}));
