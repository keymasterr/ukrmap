/*! ukrmap 3.0.0 · ukrmap-unfold.js · MIT · comments stripped; the annotated source is src/ukrmap-unfold.js */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ukrmap.js'));
  else factory(root.UkrMap);
}(typeof self !== 'undefined' ? self : this, function (UkrMap) {
  'use strict';
  if (!UkrMap) throw new Error('ukrmap-unfold: load ukrmap.js first');
  var NS = 'http://www.w3.org/2000/svg';
  var DEFAULTS = {
    spread: 1.62,
    gapX: 150,
    gapY: 210,
    duration: 500,
  };
  var n = function (v) { return String(Math.round(v)); };
  var SEQ = 0;
  var SHARED = '§borders,§outline,§coast,§coastglow,§water';
  function css(p) {
    return (
      '.' + p + 'stage{overflow:hidden;transition:height var(--' + p + 'dur,.5s) ' +
        'var(--' + p + 'ease,cubic-bezier(.62,0,.28,1))}' +
      '.' + p + 'unit{transition:transform var(--' + p + 'dur,.5s) ' +
        'var(--' + p + 'ease,cubic-bezier(.62,0,.28,1));will-change:transform}' +
      SHARED.replace(/§/g, '.' + p) + '{transition:opacity .34s linear}' +
      SHARED.replace(/§/g, '.' + p + 'map.is-unfolded>.' + p) +
        '{opacity:0;transition-duration:.09s}' +
      '.' + p + 'map.is-unfolded .' + p + 'region{stroke:var(--' + p + 'line);stroke-width:.7}' +
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
    function restructure() {
      svg = map.svg;
      units = {};
      if (svg.querySelector('.' + p + 'unit')) return;
      units = {};
      var style = document.createElementNS(NS, 'style');
      style.textContent = css(p);
      svg.insertBefore(style, svg.firstChild);
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
      var clipDefs = '';
      map.units.forEach(function (u) {
        var region = map.regionEl(u.key);
        if (!region) return;
        region.id = ns + u.key;
        clipDefs += '<clipPath id="' + ns + 'clip-' + u.key + '"><use href="#' + ns + u.key + '"/></clipPath>';
      });
      defs.insertAdjacentHTML('beforeend', waterDefs + clipDefs);
      var labelLayer = svg.querySelector('.' + p + 'labels');
      if (!labelLayer) {
        labelLayer = document.createElementNS(NS, 'g');
        labelLayer.setAttribute('class', p + 'labels');
        svg.appendChild(labelLayer);
      } else {
        svg.appendChild(labelLayer);
      }
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
      Array.prototype.forEach.call(
        svg.querySelectorAll(SHARED.replace(/§/g, ':scope>.' + p)),
        function (node) { node.setAttribute('transform', 'translate(' + n(center) + ' 0)'); });
      gridCache = null;
      apply(view, false);
    }
    function flowOrder() {
      var seq = [];
      var live = {};
      map.units.forEach(function (u) { live[u.key] = 1; });
      data.bands.forEach(function (band, bi) {
        band.forEach(function (key) {
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
        for (var i = 0; i < units[key].length; i++) units[key][i].setAttribute('transform', t);
      }
      var maxH = Math.max(mapH, grid().h);
      svg.setAttribute('viewBox', (-pad) + ' ' + (-pad) + ' ' + n(boxW) + ' ' + n(maxH + pad * 2));
      resize();
      clearTimeout(timer);
      if (next !== 'map') svg.classList.add('is-unfolded');
      else if (!animate) svg.classList.remove('is-unfolded');
      if (animate) {
        svg.classList.add('is-moving');
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
