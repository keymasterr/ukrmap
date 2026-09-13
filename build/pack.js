#!/usr/bin/env node
/*
 * build/cache/*.json  ->  data/ukrmap-<detail>.json
 *
 *   node build/pack.js
 *
 * The shipped file is a topology, not a set of polygons. Every boundary is
 * stored once, in `arcs`; a unit is a list of signed arc indices. Three
 * consequences, all of them load-bearing:
 *
 *   1. ~2.5x fewer coordinates than shipping each ring separately.
 *   2. Internal borders and the national outline are not stored at all. They
 *      fall out of how many active units use each arc, which is also why
 *      splitting Kyiv City back out correctly grows its border.
 *   3. A shared boundary is physically one list of numbers, so no amount of
 *      rounding can drift two neighbors apart. Gaps are unrepresentable.
 */

const fs = require('fs');
const path = require('path');
const { UNITS, BANDS, WATER } = require('./meta.js');

const HERE = path.join(__dirname, '..');
const CACHE = process.env.UKRMAP_CACHE || path.join(HERE, 'build/cache');
const LEVELS = (process.env.UKRMAP_LEVELS || '700 1400 2800').trim().split(/\s+/).map(Number);

// The map is 10000 units across. Integers throughout, which is what lets the
// emitted SVG use relative path commands with no decimal points and no risk of
// accumulated rounding: every delta is an exact difference of two integers.
const MAP_W = 10000;

/* ------------------------------------------------------------------ *
 * Lambert Conformal Conic, two standard parallels, GRS80.
 * Must match the -proj string in build/geo.sh, so the city dots land in the
 * same space as the polygons. Verified against mapshaper's own output.
 * ------------------------------------------------------------------ */
const LAT0 = 48.4, LON0 = 31.5, LAT1 = 44.5, LAT2 = 52;
const LCC = (() => {
  const a = 6378137, f = 1 / 298.257222101;
  const e = Math.sqrt(2 * f - f * f);
  const rad = Math.PI / 180;
  const lat0 = LAT0 * rad, lon0 = LON0 * rad, lat1 = LAT1 * rad, lat2 = LAT2 * rad;
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const n = Math.log(m(lat1) / m(lat2)) / Math.log(t(lat1) / t(lat2));
  const F = m(lat1) / (n * t(lat1) ** n);
  const rho0 = a * F * t(lat0) ** n;
  return (lon, lat) => {
    const rho = a * F * t(lat * rad) ** n;
    const th = n * (lon * rad - lon0);
    return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
  };
})();

/* ------------------------------------------------------------------ *
 * Pole of inaccessibility (Mapbox polylabel) — the region-name anchor, and
 * the reason a label stays inside a shape as concave as Odesa or Crimea.
 * ------------------------------------------------------------------ */
function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const s = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (s > 1) { x = b[0]; y = b[1]; } else if (s > 0) { x += dx * s; y += dy * s; }
  }
  return (px - x) ** 2 + (py - y) ** 2;
}
function signedDist(x, y, rings) {
  let inside = false, minSq = Infinity;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i], q = ring[j];
      if ((p[1] > y) !== (q[1] > y) && x < ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]) + p[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, p, q));
    }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}
function polylabel(rings, precision = 0.5) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of rings[0]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = x1 - x0, h = y1 - y0, cell = Math.min(w, h);
  if (!cell) return [x0, y0];
  const mk = (x, y, hh) => {
    const d = signedDist(x + hh, y + hh, rings);
    return { x: x + hh, y: y + hh, h: hh, d, max: d + hh * Math.SQRT2 };
  };
  const q = [];
  for (let x = x0; x < x1; x += cell) for (let y = y0; y < y1; y += cell) q.push(mk(x, y, cell / 2));
  let best = mk(x0 + w / 2 - cell / 2, y0 + h / 2 - cell / 2, cell / 2);
  while (q.length) {
    q.sort((p, r) => p.max - r.max);
    const c = q.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.h / 2;
    q.push(mk(c.x - c.h, c.y - c.h, hh), mk(c.x, c.y - c.h, hh), mk(c.x - c.h, c.y, hh), mk(c.x, c.y, hh));
  }
  return [best.x, best.y];
}

/* ------------------------------------------------------------------ *
 * Sea or land frontier?
 *
 * The national outline falls out of the topology, but nothing in admin-1 says
 * which parts of it are coast. So it is decided by distance to Natural Earth's
 * coastline layer: a simplified outline arc lying on the Black Sea or Azov
 * shore stays within roughly the simplification interval of it, while a land
 * frontier is hundreds of kilometers away. A coarse grid keeps it quick.
 * ------------------------------------------------------------------ */
function coastIndex(features, cell) {
  const grid = new Map();
  const segs = [];
  const put = (gx, gy, i) => {
    const k = gx + ':' + gy;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  };
  for (const f of features) {
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates]
      : g.type === 'MultiLineString' ? g.coordinates
      : g.type === 'Polygon' ? g.coordinates          /* rings read as lines */
      : g.coordinates.flat(1);
    for (const line of lines)
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const idx = segs.push([a, b]) - 1;
        const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
        const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) put(gx, gy, idx);
      }
  }
  return function nearest(x, y, limit) {
    const r = Math.ceil(limit / cell);
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let best = Infinity;
    for (let i = gx - r; i <= gx + r; i++)
      for (let j = gy - r; j <= gy + r; j++) {
        const a = grid.get(i + ':' + j);
        if (!a) continue;
        for (const si of a) best = Math.min(best, Math.sqrt(segDistSq(x, y, segs[si][0], segs[si][1])));
      }
    return best;
  };
}

/* ------------------------------------------------------------------ */

const byKey = new Map(UNITS.map((u) => [u.k, u]));
const report = [];

for (const detail of LEVELS) {
  const topo = JSON.parse(fs.readFileSync(path.join(CACHE, `units-${detail}.json`), 'utf8'));
  const layer = topo.objects[Object.keys(topo.objects)[0]];
  const tr = topo.transform; // quantised ints -> projected meters

  /* arcs: delta ints -> absolute meters */
  const arcsM = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  });

  /* bbox over everything that will be drawn, so land and water register */
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = ([x, y]) => {
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y;
    if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
  };
  arcsM.forEach((a) => a.forEach(grow));

  const scale = MAP_W / (bb[2] - bb[0]);
  const MAP_H = Math.round((bb[3] - bb[1]) * scale);
  const dx = (x) => Math.round((x - bb[0]) * scale);
  const dy = (y) => Math.round((bb[3] - y) * scale);          // flip: SVG y down
  const disp = ([x, y]) => [dx(x), dy(y)];

  /* arcs in display space, delta-encoded */
  const arcsI = arcsM.map((a) => a.map(([x, y]) => [dx(x), dy(y)]));
  const arcStr = arcsI.map((a) => {
    const out = [a[0][0], a[0][1]];
    for (let i = 1; i < a.length; i++) out.push(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]);
    return out.join(' ');
  }).join(';');

  /* which arcs each unit uses, and each unit's rings as signed index lists */
  const unitRings = new Map();
  const arcUsers = arcsM.map(() => new Set());
  for (const g of layer.geometries) {
    const k = g.properties.key;
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    const rings = [];
    for (const poly of polys)
      for (const ring of poly) {
        rings.push(ring);
        for (const i of ring) arcUsers[i < 0 ? ~i : i].add(k);
      }
    unitRings.set(k, rings);
  }

  /* assemble a ring's point list; consecutive arcs share an endpoint */
  const ringPts = (ring) => {
    const pts = [];
    for (const i of ring) {
      const a = i < 0 ? arcsI[~i].slice().reverse() : arcsI[i];
      for (let j = pts.length ? 1 : 0; j < a.length; j++) pts.push(a[j]);
    }
    return pts;
  };

  const idx = new Map(UNITS.map((u, i) => [u.k, i]));
  const units = [];
  for (const u of UNITS) {
    const rings = unitRings.get(u.k);
    if (!rings) throw new Error(`no geometry for ${u.k} at ${detail} m`);

    const pts = rings.map(ringPts);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let biggest = pts[0], bigA = 0;
    for (const r of pts) {
      let A = 0;
      for (let i = 0; i < r.length - 1; i++) A += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      if (Math.abs(A) > bigA) { bigA = Math.abs(A); biggest = r; }
      for (const [x, y] of r) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    const r1 = Math.round;

    units.push({
      k: u.k,
      r: rings.map((ring) => ring.join(' ')).join(';'),
      uk: u.uk, en: u.en, cuk: u.cuk, cen: u.cen,
      c: disp(LCC(u.lon, u.lat)),
      off: [u.off[0] * 10, u.off[1] * 10],   // meta is in 1000-wide units
      an: u.anchor,
      lp: polylabel([biggest]).map(r1),
      bb: [r1(x0), r1(y0), r1(x1 - x0), r1(y1 - y0)],
      ...(u.parent ? { parent: u.parent } : {}),
      ...(u.capital ? { capital: 1 } : {}),
      ...(u.ar ? { ar: 1 } : {}),
      ...(u.renamed ? { renamed: u.renamed } : {}),
    });
  }

  /* arc -> unit indices. The renderer turns this into borders and outline for
     whichever unit set is active, so nothing about boundaries is baked in. */
  const use = arcUsers.map((s) => [...s].map((k) => idx.get(k)).sort((a, b) => a - b).join(',')).join(';');

  /* Which parts of the national boundary are sea shore rather than land
     frontier — decided per VERTEX, not per arc.
     
     An arc only ends where regions meet, so Odesa's entire outer boundary is
     one arc: it runs along Moldova, down the Danube, along the Black Sea and
     back to the Mykolaiv junction with no junction in between. Judging that
     arc as a whole loses almost all of Odesa's coast, because most of its
     length really is land frontier. So each vertex is tested, runs of coast
     are extracted, and the arc is shipped as ranges. */
  const coastFeatures = [
    ...JSON.parse(fs.readFileSync(path.join(CACHE, `coastline-${detail}.json`), 'utf8')).features,
    ...JSON.parse(fs.readFileSync(path.join(CACHE, `lagoons-${detail}.json`), 'utf8')).features,
  ];
  const nearCoast = coastIndex(coastFeatures, 20000);
  const tol = Math.max(3000, detail * 2.5);

  const coast = [];
  let coastPts = 0, boundaryPts = 0;
  arcsM.forEach((arc, i) => {
    if (arcUsers[i].size !== 1) return;              // interior arcs cannot be coast
    boundaryPts += arc.length;

    const near = arc.map(([x, y]) => nearCoast(x, y, tol * 3) < tol);
    /* majority-of-three smoothing, so one stray vertex cannot chop a run */
    const flag = near.map((v, k) => {
      const a = near[k - 1], b = near[k + 1];
      const votes = [a === undefined ? v : a, v, b === undefined ? v : b].filter(Boolean).length;
      return votes >= 2;
    });

    const ranges = [];
    let start = -1;
    for (let k = 0; k <= flag.length; k++) {
      if (k < flag.length && flag[k]) { if (start < 0) start = k; continue; }
      if (start >= 0) {
        if (k - start >= 3) ranges.push([start, k - 1]);   // ignore specks
        start = -1;
      }
    }
    ranges.forEach(([a, b]) => { coast.push(`${i}:${a}-${b}`); coastPts += b - a + 1; });
  });

  /* ------------------------------------------------------------------ *
   * River mouths.
   *
   * The rivers and the outline are simplified independently — different
   * layers, different sources — so the point where a river meets the sea
   * drifts apart by however much each side happened to lose. Measured, the
   * Southern Buh ends 4 units from the shore at detail 700, 316 at 1400 and
   * 468 at 2800: at the coarse levels the Buh visibly stops short of the
   * Black Sea somewhere north of Mykolaiv, hanging in the middle of the land.
   * The Dnipro and the Dniester do the same thing on a smaller scale.
   *
   * So a mouth that has drifted is put back on the shore. The threshold is
   * wide of every real mouth (468 at worst) and nowhere near the next-closest
   * endpoint, the Donets leaving for Russia at 1433 — a gap of a factor of
   * three, which is what makes this a rule and not a special case for one
   * river. The end is EXTENDED to the shore, never moved onto it: no vertex
   * the source put there is touched.
   * ------------------------------------------------------------------ */
  const MOUTH_GAP = 600;

  const coastPoints = [];
  for (const run of coast) {
    const [ai, span] = run.split(':');
    const [a, b] = span.split('-').map(Number);
    for (let k = a; k <= b; k++) coastPoints.push(arcsI[+ai][k]);
  }

  /* nearest point ON the shoreline, not the nearest vertex of it — landing
     between two vertices is what puts the mouth on the water's edge rather
     than at whichever corner survived simplification */
  function nearestOnCoast(q) {
    let best = Infinity, at = null;
    for (let i = 1; i < coastPoints.length; i++) {
      const p1 = coastPoints[i - 1], p2 = coastPoints[i];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((q[0] - p1[0]) * dx + (q[1] - p1[1]) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = p1[0] + t * dx, cy = p1[1] + t * dy;
      const d2 = (q[0] - cx) ** 2 + (q[1] - cy) ** 2;
      if (d2 < best) { best = d2; at = [Math.round(cx), Math.round(cy)]; }
    }
    return { dist: Math.sqrt(best), at };
  }

  /* Which way the line is running as it arrives at `end`, measured back over
     a stretch rather than off the final segment, which at these simplification
     levels is short enough to be noise. */
  function heading(pts, fromStart) {
    const seq = fromStart ? pts : pts.slice().reverse();
    const end = seq[0];
    let back = end, run = 0;
    for (let i = 1; i < seq.length; i++) {
      run += Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]);
      back = seq[i];
      if (run >= 200) break;
    }
    return [end[0] - back[0], end[1] - back[1]];
  }

  let mouthsJoined = 0, worstMouth = 0;
  function joinMouth(pts) {
    if (pts.length < 2) return pts;
    /* only the end that is actually near the sea, and only one per line */
    const head = nearestOnCoast(pts[0]);
    const tail = nearestOnCoast(pts[pts.length - 1]);
    const atStart = head.dist < tail.dist;
    const pick = atStart ? head : tail;
    /* under a unit is already on the shore — rounding, not drift */
    if (pick.dist < 1 || pick.dist > MOUTH_GAP) return pts;

    /* A mouth continues the way the river was already going. Anything that has
       to double back to reach the water is not a mouth, and this is the guard
       that would have caught the reservoir axis being dragged across dry land
       to the estuary: it arrived heading inland, away from the sea entirely. */
    const end = atStart ? pts[0] : pts[pts.length - 1];
    const h = heading(pts, atStart);
    const vx = pick.at[0] - end[0], vy = pick.at[1] - end[1];
    const hl = Math.hypot(h[0], h[1]), vl = Math.hypot(vx, vy);
    if (hl && vl && (h[0] * vx + h[1] * vy) / (hl * vl) < 0) return pts;
    mouthsJoined++;
    worstMouth = Math.max(worstMouth, pick.dist);
    if (process.env.UKRMAP_MOUTHS) {
      console.log(`   mouth: ${end.join(',')} -> ${pick.at.join(',')}  (${pick.dist.toFixed(0)} units)`);
    }
    return atStart ? [pick.at, ...pts] : [...pts, pick.at];
  }

  /* --- water: plain paths, no shared topology to exploit --- */
  /* bounding box of an emitted path, so a single-region SVG can include only
     the water it actually touches instead of all of it */
  const pathBox = (d) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of d.matchAll(/[ML]?(-?\d+) (-?\d+)/g)) {
      const x = +m[1], y = +m[2];
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    return [x0, y0, x1 - x0, y1 - y0];
  };

  /* Clip crumbs.
   *
   * geo.sh clips the rivers to the country, and where a river weaves in and
   * out of the border — the Dnipro along Belarus, the Dniester along Moldova —
   * that leaves a scatter of two-point stubs behind. Simplification then
   * collapses some of them to zero length, and `stroke-linecap: round` paints
   * a zero-length subpath as a DOT: eight of them sat on Chernihiv's western
   * edge, unattached to anything.
   *
   * So a subpath has to be long enough to read as a river. 50 units is 0.5% of
   * the map's width, about 6 km on the ground and 3.5 px at a 700 px render.
   * Measured along the path, not across its box, so a tight meander survives.
   */
  const MIN_RUN = 50;
  const runLength = (pts) => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };

  let dropped = 0;
  const waterPath = (geom, close) => {
    const lines = geom.type === 'LineString' ? [geom.coordinates]
      : geom.type === 'MultiLineString' ? geom.coordinates
      : geom.type === 'Polygon' ? geom.coordinates
      : geom.coordinates.flat(1);
    return lines.map((l) => l.map(disp)).filter((pts) => {
      /* a closed shape is measured round its perimeter, which is the same call */
      if (runLength(pts) >= MIN_RUN) return true;
      dropped++;
      return false;
    }).map((pts) => (close ? pts : joinMouth(pts)))
      .map((pts) => 'M' + pts.map((p) => p.join(' ')).join('L') + (close ? 'Z' : '')).join('');
  };
  const readWater = (file, close) => {
    const g = JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8'));
    const merged = new Map();
    for (const f of g.features) {
      const n = f.properties.nm || f.properties.name || '';
      if (!n) continue;
      merged.set(n, (merged.get(n) || '') + waterPath(f.geometry, close));
    }
    return [...merged].filter(([, d]) => d).map(([n, d]) => ({
      n, uk: (WATER[n] || {}).uk || n,
      ...((WATER[n] || {}).main ? { main: 1 } : {}),
      ...((WATER[n] || {}).until ? { until: WATER[n].until } : {}),
      bb: pathBox(d), d,
    }));
  };

  const out = {
    v: 2,
    detail,
    size: [MAP_W, MAP_H],
    /* Everything needed to put a lon/lat on this map, which until now was
       computed here and thrown away. The LCC constants are fixed and also live
       in src/, but writing them down makes the file self-describing and lets
       the renderer refuse a data file projected some other way. The affine is
       NOT fixed: the bbox is taken over the simplified geometry, so it shifts a
       little with the detail level — which is exactly why it has to travel in
       the file rather than be a constant in the code. */
    proj: {
      lcc: [LAT0, LON0, LAT1, LAT2],
      o: [+bb[0].toFixed(1), +bb[3].toFixed(1)],
      s: Number(scale.toPrecision(12)),
    },
    arcs: arcStr,
    use,
    coast: coast.join(' '),
    units,
    bands: BANDS,
    water: {
      rivers: readWater(`rivers-${detail}.json`, false),
      lakes: readWater(`reservoirs-${detail}.json`, true),
    },
    /* dropped is counted inside waterPath, so read it after both calls */
    src: `Natural Earth 10m admin-1 · LCC (lat_1=44.5 lat_2=52 lon_0=31.5) · Visvalingam ${detail} m · water pre-2023`,
  };

  const dest = path.join(HERE, 'data', `ukrmap-${detail}.json`);
  fs.writeFileSync(dest, JSON.stringify(out));
  const zlib = require('zlib');
  const raw = fs.statSync(dest).size;
  report.push({
    detail: detail + ' m',
    arcs: topo.arcs.length,
    coastRuns: coast.length,
    'coast pts': `${coastPts}/${boundaryPts}`,
    points: arcsI.reduce((s, a) => s + a.length, 0),
    'crumbs cut': dropped,
    'mouths joined': `${mouthsJoined} (max ${worstMouth.toFixed(0)}u)`,
    'file KB': +(raw / 1024).toFixed(1),
    'gzip KB': +(zlib.gzipSync(fs.readFileSync(dest)).length / 1024).toFixed(1),
  });
}

/* Areas and populations live in their own dated file.
 *
 * The geometry will be right for decades; the population estimates were
 * already historical when they were written down. Welding the two together
 * meant you could not update one without reissuing the other, and made the
 * map look as current as its least current field. */
const facts = {
  v: 1,
  area: { unit: 'km2', source: 'official figures, stable' },
  pop: {
    unit: 'thousands',
    asOf: '2022-01-01',
    source: 'State Statistics Service of Ukraine',
    note: 'Before the full-scale invasion. Crimea (UA-43) and Sevastopol '
        + '(UA-40) are 2014, the last figures Ukraine published. Indicative.',
  },
  units: {},
};
for (const u of UNITS) facts.units[u.k] = { area: u.area, pop: u.pop };
const factFile = path.join(HERE, 'data', 'ukrmap-facts.json');
fs.writeFileSync(factFile, JSON.stringify(facts, null, 1) + '\n');
console.log(`data/ukrmap-facts.json  ${(fs.statSync(factFile).size / 1024).toFixed(1)} KB  `
  + `(areas + populations, ${Object.keys(facts.units).length} units)`);

console.table(report);

/* Sanity: our hand-written LCC against PROJ's, via mapshaper. These five were
   projected once by `mapshaper -proj` with the string at the top of geo.sh and
   frozen here, so the check no longer depends on a scratch file in a sibling
   directory that has since been archived. If LCC is ever touched, this is what
   says whether the city dots still land where the polygons do. */
const PROJ_REF = {
  'UA-07': [-434124.0, 278008.0],
  'UA-32': [-69290.0, 228008.0],
  'UA-09': [574626.0, 48599.0],
  'UA-43': [205036.0, -379210.0],
  'UA-46': [-535380.0, 186116.0],
};
let worst = 0;
for (const [k, ref] of Object.entries(PROJ_REF)) {
  const u = byKey.get(k);
  if (!u) continue;
  const [x, y] = LCC(u.lon, u.lat);
  worst = Math.max(worst, Math.hypot(x - ref[0], y - ref[1]));
}
console.log(`LCC vs mapshaper: worst disagreement ${worst.toFixed(1)} m`);
if (worst > 1) throw new Error(`LCC drifted from PROJ by ${worst.toFixed(1)} m`);
