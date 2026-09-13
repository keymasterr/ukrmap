#!/usr/bin/env node
/*
 * Generates _tmp/check-labels.html — a harness for tuning the per-city label
 * offsets in build/meta.js.
 *
 *   node build/check-labels.js && open _tmp/check-labels.html
 *
 * Text metrics only exist in a browser, so the check runs there. For every
 * city label it takes the rendered text box and asks the region's own path
 * `isPointInFill()` for the four corners plus the edge midpoints. A label that
 * fails is sticking out of its region.
 *
 * You can also just DRAG the labels. Grab one and move it; the box turns red
 * the moment it leaves its region, arrow keys nudge the selected label by one
 * unit (shift = five), `a` cycles the anchor, and "Copy meta.js block" puts the
 * result on the clipboard in exactly the shape build/meta.js wants. Nothing is
 * written for you — the offsets stay in source, reviewable.
 *
 * In the console:
 *   checkLabels()        -> table of every label, worst offenders first
 *   checkLabels(true)    -> also draw the boxes, red where they spill
 *   autoTune()           -> search a grid of offsets and print a block
 *
 * The offsets are tuned against Ubuntu Condensed, which is what the demo
 * loads. Fallback stacks differ by a few percent in width; the checker keeps
 * a margin for that, but run it with `?font=fallback` to see the difference.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const detail = Number(process.argv[2] || 1400);

const lib = fs.readFileSync(path.join(HERE, 'src/ukrmap.js'), 'utf8');
const data = fs.readFileSync(path.join(HERE, 'data', `ukrmap-${detail}.json`), 'utf8');

const html = `<!doctype html>
<meta charset="utf-8">
<title>ukrmap · label check</title>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu+Condensed&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:16px;background:#fdfdfb;color:#1a1a18;
       font:400 13px/1.4 ui-sans-serif,-apple-system,sans-serif}
  #map{max-width:1400px}
  .ukr-map{--ukr-font:"Ubuntu Condensed"}
  .fallback .ukr-map{--ukr-font:"Arial Narrow","Liberation Sans Narrow",sans-serif}
  .probe{fill:none;stroke:#1a9850;stroke-width:6;pointer-events:none}
  .probe.bad{stroke:#d73027;stroke-width:10}
  p{margin:0 0 10px;color:#77746c}

  /* The component turns labels into decoration. Here they are the controls —
     and the id has to be in the selector: the skin lives in a <style> INSIDE
     the SVG, which is later in the document than this one, so a bare
     .ukr-label would tie on specificity and lose. */
  #map .ukr-label{pointer-events:auto;cursor:grab}
  #map .ukr-label.dragging{cursor:grabbing}
  #map .ukr-label.sel .ukr-city{fill:#1a5fb4}
  .bar{display:flex;gap:14px;align-items:center;margin:0 0 10px;flex-wrap:wrap}
  button{font:inherit;padding:3px 10px;border:1px solid #cfc9b8;border-radius:4px;
         background:#fff;cursor:pointer}
  button:hover{border-color:#1a5fb4;color:#1a5fb4}
  #status{color:#77746c}
  #status b{color:#d73027;font-weight:400}
  #out{width:100%;height:150px;margin-top:10px;display:none;
       font:12px/1.5 ui-monospace,Menlo,monospace;padding:8px;
       border:1px solid #e2ddcd;border-radius:4px;background:#fff}
</style>
<p>Label check · detail ${detail} m. <b>Drag a label</b> to move it; arrows nudge
   the selected one (shift = 5), <kbd>a</kbd> cycles its anchor.
   <code>checkLabels(true)</code> / <code>autoTune()</code> in the console.</p>
<div class="bar">
  <button id="copy">Copy meta.js block</button>
  <button id="show">Show block</button>
  <button id="boxes">Toggle boxes</button>
  <button id="revert">Revert all</button>
  <span id="status"></span>
</div>
<div id="map"></div>
<textarea id="out" spellcheck="false"></textarea>

<script>${lib}</script>
<script>
window.DATA = ${data};

if (location.search.indexOf('fallback') > -1) document.body.classList.add('fallback');

document.getElementById('map').innerHTML = UkrMap.render(DATA, {
  labels: 'city', water: false, detail: ${detail},
});

var svg = document.querySelector('svg');
var NS = 'http://www.w3.org/2000/svg';

window.checkLabels = function (draw) {
  var rows = [];
  var probes = svg.querySelectorAll('.probe');
  for (var i = 0; i < probes.length; i++) probes[i].remove();

  DATA.units.forEach(function (u) {
    if (u.parent) return;                       // merged in by default
    var label = svg.querySelector('.ukr-label[data-key="' + u.k + '"]');
    var region = svg.querySelector('.ukr-region[data-key="' + u.k + '"]');
    if (!label || !region) return;
    var text = label.querySelector('.ukr-city');
    if (!text) return;

    var b = text.getBBox();
    /* pull in slightly: a descender or side bearing touching the border is
       not a spill, and fallback fonts are a few percent wider */
    var inset = Math.min(b.height * 0.18, b.width * 0.02);
    var x0 = b.x + inset, x1 = b.x + b.width - inset;
    var y0 = b.y + inset, y1 = b.y + b.height - inset;

    var pts = [
      [x0, y0], [x1, y0], [x0, y1], [x1, y1],
      [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1],
      [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2],
    ];
    var out = 0;
    pts.forEach(function (p) {
      var pt = svg.createSVGPoint ? svg.createSVGPoint() : new DOMPoint();
      pt.x = p[0]; pt.y = p[1];
      if (!region.isPointInFill(pt)) out++;
    });

    var dist = Math.round(Math.hypot(u.off[0], u.off[1]) / 10);  // in 1000-wide units
    rows.push({
      key: u.k, city: u.cuk, outside: out + '/8',
      out: out, offset: '[' + (u.off[0] / 10) + ',' + (u.off[1] / 10) + ']',
      anchor: u.an, dist: dist,
      w: Math.round(b.width), h: Math.round(b.height),
    });

    if (draw) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', 'probe' + (out ? ' bad' : ''));
      r.setAttribute('x', b.x); r.setAttribute('y', b.y);
      r.setAttribute('width', b.width); r.setAttribute('height', b.height);
      svg.appendChild(r);
    }
  });

  rows.sort(function (a, b) { return b.out - a.out || b.dist - a.dist; });
  var bad = rows.filter(function (r) { return r.out; });
  var far = rows.filter(function (r) { return r.dist > 16; });
  console.table(rows);
  console.log('spilling: ' + bad.length + ' of ' + rows.length
    + (bad.length ? '  -> ' + bad.map(function (r) { return r.city; }).join(', ') : ''));
  if (far.length) console.log('offset further than 16 units from the dot: '
    + far.map(function (r) { return r.city + '(' + r.dist + ')'; }).join(', '));
  return { rows: rows, bad: bad.map(function (r) { return r.key; }), spilling: bad.length, total: rows.length };
};

/*
 * autoTune() — the same search the 2012 map did by hand, mechanically.
 *
 * For each city it tries offsets on a small grid around the dot, and the three
 * anchors, and keeps the cheapest placement whose text box is fully inside the
 * region. Cost prefers, in order: staying close to the dot, sitting above it
 * (the cartographic default), and a centered anchor. Prints a block ready to
 * paste into build/meta.js — the offsets stay in source, reviewable, not
 * recomputed at runtime.
 */
window.autoTune = function (maxR) {
  maxR = maxR || 16;
  var IDEAL = [0, -8];          // centered, just clear above the dot
  var lines = [], failed = [], placed = [];

  /* every city dot, so a label can be kept off its neighbors' dots too */
  var dots = DATA.units.filter(function (u) { return !u.parent; })
    .map(function (u) { return u.c; });

  var overlaps = function (a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height;
  };

  DATA.units.forEach(function (u) {
    if (u.parent) return;
    var label = svg.querySelector('.ukr-label[data-key="' + u.k + '"]');
    var region = svg.querySelector('.ukr-region[data-key="' + u.k + '"]');
    if (!label || !region) return;
    var text = label.querySelector('.ukr-city');
    if (!text) return;

    var orig = { x: text.getAttribute('x'), y: text.getAttribute('y'), a: text.getAttribute('text-anchor') };

    function spill(b) {
      var inset = Math.min(b.height * 0.18, b.width * 0.02);
      var x0 = b.x + inset, x1 = b.x + b.width - inset;
      var y0 = b.y + inset, y1 = b.y + b.height - inset;
      var pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1],
                 [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1],
                 [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]];
      for (var i = 0; i < pts.length; i++) {
        var pt = svg.createSVGPoint();
        pt.x = pts[i][0]; pt.y = pts[i][1];
        if (!region.isPointInFill(pt)) return true;
      }
      return false;
    }

    var best = null;
    ['m', 's', 'e'].forEach(function (an) {
      var anchor = an === 's' ? 'start' : an === 'e' ? 'end' : 'middle';
      text.setAttribute('text-anchor', anchor);
      for (var dy = -maxR; dy <= maxR; dy++) {
        for (var dx = -maxR; dx <= maxR; dx++) {
          text.setAttribute('x', u.c[0] + dx * 10);
          text.setAttribute('y', u.c[1] + dy * 10);
          var b = text.getBBox();

          if (spill(b)) continue;

          /* the text must clear its own dot, or the dot hides under it */
          var pad = 24;
          var box = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
          if (u.c[0] > box.x && u.c[0] < box.x + box.width
           && u.c[1] > box.y && u.c[1] < box.y + box.height) continue;

          var cost = Math.hypot(dx - IDEAL[0], dy - IDEAL[1])
            + (dy > 0 ? 3 : 0)              // above reads as belonging to the dot
            + (an === 'm' ? 0 : 1.5);       // centered unless a side genuinely helps

          /* keep off other cities' dots and off labels already placed */
          for (var i = 0; i < dots.length; i++)
            if (dots[i] !== u.c && dots[i][0] > b.x && dots[i][0] < b.x + b.width
             && dots[i][1] > b.y && dots[i][1] < b.y + b.height) cost += 8;
          for (var j = 0; j < placed.length; j++) if (overlaps(b, placed[j])) cost += 7;

          if (!best || cost < best.cost) {
            best = { dx: dx, dy: dy, an: an, cost: cost,
                     box: { x: b.x, y: b.y, width: b.width, height: b.height } };
          }
        }
      }
    });

    text.setAttribute('x', orig.x); text.setAttribute('y', orig.y);
    text.setAttribute('text-anchor', orig.a);

    if (!best) { failed.push(u.cuk + ' (' + u.k + ')'); return; }
    placed.push(best.box);
    lines.push("{ k: '" + u.k + "', off: [" + best.dx + ', ' + best.dy + "], anchor: '" + best.an + "' },"
      + '   // ' + u.cuk);
  });

  console.log(lines.join('\\n'));
  if (failed.length) console.log('NO placement fits inside: ' + failed.join(', '));
  return lines;
};

/*
 * drag to place
 *
 * The offsets in meta.js are the one part of this map that no algorithm gets
 * right, because "inside its own region and obviously belonging to that dot"
 * is a judgement. autoTune() searches; this lets you overrule it by hand and
 * still leave source, not state, as the record.
 *
 * 'off' is in units of a 1000-wide map — thousandths of the map's width — so
 * the numbers stay readable and stay valid at every detail level. The data
 * file is 10000 wide, hence the factor of ten.
 */
var UNITS = DATA.units.filter(function (u) { return !u.parent; });
var live = {};                       // key -> {off:[x,y], an:'m'|'s'|'e'}
var orig = {};
UNITS.forEach(function (u) {
  orig[u.k] = { off: [u.off[0] / 10, u.off[1] / 10], an: u.an };
  live[u.k] = { off: orig[u.k].off.slice(), an: u.an };
});

var ANCHORS = { m: 'middle', s: 'start', e: 'end' };
var sel = null, drawing = false;

function place(key) {
  var u = UNITS.filter(function (x) { return x.k === key; })[0];
  var lab = svg.querySelector('.ukr-label[data-key="' + key + '"]');
  var text = lab && lab.querySelector('.ukr-city');
  if (!text) return;
  text.setAttribute('x', Math.round(u.c[0] + live[key].off[0] * 10));
  text.setAttribute('y', Math.round(u.c[1] + live[key].off[1] * 10));
  text.setAttribute('text-anchor', ANCHORS[live[key].an]);
}

function spills(key) {
  var region = svg.querySelector('.ukr-region[data-key="' + key + '"]');
  var text = svg.querySelector('.ukr-label[data-key="' + key + '"] .ukr-city');
  if (!region || !text) return false;
  var b = text.getBBox();
  var inset = Math.min(b.height * 0.18, b.width * 0.02);
  var x0 = b.x + inset, x1 = b.x + b.width - inset;
  var y0 = b.y + inset, y1 = b.y + b.height - inset;
  var pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1],
             [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1],
             [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]];
  for (var i = 0; i < pts.length; i++) {
    var pt = svg.createSVGPoint();
    pt.x = pts[i][0]; pt.y = pts[i][1];
    if (!region.isPointInFill(pt)) return true;
  }
  return false;
}

function status() {
  var bad = UNITS.filter(function (u) { return spills(u.k); });
  var moved = UNITS.filter(function (u) {
    return live[u.k].off[0] !== orig[u.k].off[0]
        || live[u.k].off[1] !== orig[u.k].off[1]
        || live[u.k].an !== orig[u.k].an;
  });
  var far = UNITS.filter(function (u) {
    return Math.hypot(live[u.k].off[0], live[u.k].off[1]) > 16;
  });
  document.getElementById('status').innerHTML =
    (bad.length ? '<b>' + bad.length + ' spilling: '
       + bad.map(function (u) { return u.cuk; }).join(', ') + '</b>'
     : 'none spilling')
    + ' · ' + moved.length + ' moved'
    + (far.length ? ' · far from the dot: '
       + far.map(function (u) { return u.cuk; }).join(', ') : '');
  if (drawing) checkLabels(true);
}

function block() {
  return UNITS.map(function (u) {
    var l = live[u.k];
    return "{ k: '" + u.k + "', off: [" + l.off[0] + ', ' + l.off[1]
      + "], anchor: '" + l.an + "' },   // " + u.cuk;
  }).join('\\n');
}

/* one user unit per CSS pixel, so a drag moves the label under the pointer */
function perPx() {
  return svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
}

function select(key) {
  if (sel) {
    var was = svg.querySelector('.ukr-label[data-key="' + sel + '"]');
    if (was) was.classList.remove('sel');
  }
  sel = key;
  if (sel) svg.querySelector('.ukr-label[data-key="' + sel + '"]').classList.add('sel');
}

svg.addEventListener('pointerdown', function (ev) {
  var lab = ev.target.closest && ev.target.closest('.ukr-label');
  if (!lab) return;
  var key = lab.getAttribute('data-key');
  if (!live[key]) return;
  select(key);
  lab.classList.add('dragging');
  lab.setPointerCapture(ev.pointerId);

  var k = perPx();
  var sx = ev.clientX, sy = ev.clientY;
  var from = live[key].off.slice();

  function move(e) {
    /* whole units: the offsets are meant to be readable in source, and half a
       thousandth of the map is below what anyone can see anyway */
    live[key].off = [
      Math.round(from[0] + (e.clientX - sx) * k / 10),
      Math.round(from[1] + (e.clientY - sy) * k / 10),
    ];
    place(key);
  }
  function up() {
    lab.classList.remove('dragging');
    lab.removeEventListener('pointermove', move);
    lab.removeEventListener('pointerup', up);
    status();
  }
  lab.addEventListener('pointermove', move);
  lab.addEventListener('pointerup', up);
  ev.preventDefault();
});

document.addEventListener('keydown', function (ev) {
  if (!sel || ev.target.tagName === 'TEXTAREA') return;
  var step = ev.shiftKey ? 5 : 1, l = live[sel], hit = true;
  if (ev.key === 'ArrowLeft') l.off[0] -= step;
  else if (ev.key === 'ArrowRight') l.off[0] += step;
  else if (ev.key === 'ArrowUp') l.off[1] -= step;
  else if (ev.key === 'ArrowDown') l.off[1] += step;
  else if (ev.key === 'a') l.an = l.an === 'm' ? 's' : l.an === 's' ? 'e' : 'm';
  else if (ev.key === 'Escape') { select(null); hit = false; }
  else hit = false;
  if (!hit) return;
  ev.preventDefault();
  if (sel) place(sel);
  status();
});

document.getElementById('copy').onclick = function () {
  navigator.clipboard.writeText(block()).then(function () {
    document.getElementById('copy').textContent = 'Copied';
    setTimeout(function () {
      document.getElementById('copy').textContent = 'Copy meta.js block';
    }, 1200);
  });
};
document.getElementById('show').onclick = function () {
  var out = document.getElementById('out');
  out.style.display = out.style.display === 'block' ? 'none' : 'block';
  out.value = block();
};
document.getElementById('boxes').onclick = function () {
  drawing = !drawing;
  if (drawing) checkLabels(true);
  else Array.prototype.forEach.call(svg.querySelectorAll('.probe'), function (r) { r.remove(); });
};
document.getElementById('revert').onclick = function () {
  UNITS.forEach(function (u) {
    live[u.k] = { off: orig[u.k].off.slice(), an: orig[u.k].an };
    place(u.k);
  });
  status();
};

document.fonts.ready.then(function () {
  /* Metrics before the webfont lands are the fallback's, and every offset here
     is tuned against Ubuntu Condensed — so wait, then measure. */
  UNITS.forEach(function (u) { place(u.k); });
  status();
  console.log('fonts ready — drag the labels, or checkLabels(true) / autoTune()');
});
</script>
`;

fs.mkdirSync(path.join(HERE, '_tmp'), { recursive: true });
const dest = path.join(HERE, '_tmp/check-labels.html');
fs.writeFileSync(dest, html);
console.log('wrote', path.relative(process.cwd(), dest));
