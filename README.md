# ukrmap

A small, fast SVG map of Ukraine's 25 regions, for websites, press and statistical reports.

**[Demo, and the files to download](https://keymasterr.com/micro/ukrmap/)** — the same page also works as the manual.

**The static file is the product.** Every region carries its ISO 3166-2 code and a `<title>`, so hover on real region edges, native tooltips and choropleth coloring all work from a stylesheet — with no JavaScript on the page. The component is optional, and only for what CSS cannot do.

**Nothing to generate.** Grab a file from [`dist/`](dist/):

<!-- files:start — written by build/dist.js; do not edit by hand -->
| | | |
|---|---|---:|
| [`ua.svg`](dist/ua.svg) | default — city labels, coastline, the Dnipro | 16.8 KB |
| [`ua-en.svg`](dist/ua-en.svg) | the same in English | 16.5 KB |
| [`ua-regions.svg`](dist/ua-regions.svg) | region names instead of centers | 16.6 KB |
| [`ua-blank.svg`](dist/ua-blank.svg) | geometry only, color it yourself | 13.3 KB |
| [`ua-flat.svg`](dist/ua-flat.svg) | colors baked on — for Figma, Keynote, Illustrator | 17.4 KB |
| [`ua-print.svg`](dist/ua-print.svg) | 700 m detail, every river | 33.7 KB |
| [`ua-small.svg`](dist/ua-small.svg) | coarsest of the three | 10.1 KB |
| [`dist/regions/`](dist/regions/) | one SVG per region + `regions.json` | 67 KB raw |
<!-- files:end -->

The CLI is for what those do not cover:

```bash
npx github:keymasterr/ukrmap --lang=en --water=all -o ua.svg
```

**Not on npm yet**, so the commands here run it straight from the repository — `npx` clones and runs, nothing is installed. To have it as a dependency, clone and `npm link`, or point your `package.json` at `github:keymasterr/ukrmap`. When it does go to npm, every command below shortens to `npx ukrmap`.

From a clone, the demo and the files are two commands: `npm run build` writes `dist/` and the demo's data, `npm test` checks the copy against the source. Neither needs the network, and there is nothing to install — the project has no dependencies.

<!-- sizes:start — written by build/dist.js; do not edit by hand -->
| | raw | gzip |
|---|---:|---:|
| geometry, default detail | 32.3 KB | **13.6 KB** |
| geometry, `--detail=2800` | 20.4 KB | 8.9 KB |
| areas + populations (separate) | 1.7 KB | 0.5 KB |
| `dist/ukrmap.js` — the component, optional | 52.4 KB | 14.8 KB |
| `dist/ukrmap-unfold.js` — opt-in on top | 10.5 KB | 3.1 KB |
| `src/ukrmap.js` — the same code, annotated | 91.2 KB | 30.1 KB |
| emitted SVG, default | 56.1 KB | 16.8 KB |
<!-- sizes:end -->

No dependencies, nothing to run at view time, no network requests.

**About the two copies of the code.** `src/` is written to be read — the comments are half the point, and they are why the awkward decisions in here are recoverable a year later. They are also 43% of its gzipped weight, which is a bad thing to put on the wire. So `build/dist.js` writes `dist/ukrmap.js`: the same program with the prose taken out, and the only transform in the project.

It is not taken on trust. The stripper is a small scanner, and the first one written for this quietly misread the quote inside `/["'<>&]/g` as the start of a string and ate the rest of the file. So every build — and the test suite — checks the copy against the source: every string and regex literal byte-identical and in the same order, stripping idempotent, and the output of every render path, at every detail level, compared byte for byte. A mismatch fails the build rather than shipping.

Serve `dist/`, read `src/`. Both are in the package.

---

## Three ways to use it

### 1 · A file and nothing else

```bash
npx github:keymasterr/ukrmap -o ua.svg                                   # 25 regions, city labels
npx github:keymasterr/ukrmap --water --detail=700 --lang=en -o ua.svg    # print quality, English
npx github:keymasterr/ukrmap --labels=none --style=none -o ua.svg        # bare geometry, style it yourself
npx github:keymasterr/ukrmap --kyiv-separate -o ua.svg                   # 26 regions, capital split out
```

Opens in a browser, in Illustrator, in InDesign. `--list` prints the region keys.

**Coloring from a table**, which is the job people actually have. Twenty-five `--fill` flags is how nobody uses a tool, so the table goes in a file:

```bash
npx github:keymasterr/ukrmap --data values.json -o ua.svg
```

```json
{
  "UA-46": "#c0392b",
  "Харківська область": { "fill": "#e8b04b", "title": "Харківська: 42 %" },
  "UA-30": { "fill": "#27ae60", "title": "Київ: 7 %" }
}
```

A bare string is a fill. `title` replaces that region's tooltip, so the **value shows on hover with no tooltip code at all**; `name` relabels it for a language that does not ship. Keys are ISO codes or any name the map answers to, and `UA-30` / `UA-40` land on the region actually drawn. Unknown keys are reported, not swallowed.

Building that file from a table of numbers is one call — see [Color by number](#color-by-number):

```js
const { fills } = UkrMap.colorData(values);
const out = {};
for (const key in fills) out[key] = { fill: fills[key], title: `${names[key]}: ${values[key]} %` };
require('fs').writeFileSync('values.json', JSON.stringify(out, null, 2));
```

**No terminal?** [The demo page](demo/index.html) is the CLI with buttons: set the language, labels, water and Kyiv, then **save** → SVG or PNG. The file that comes down is the map on screen.

### 2 · Interactive, still no JavaScript

**How you embed it decides whether your CSS reaches inside:**

```html
<!-- as an image: simplest, but your CSS canNOT get in.
     No :hover, no recoloring. <title> tooltips still work. -->
<img src="ua.svg" alt="Map of Ukraine" width="720">

<!-- inline: paste the file's contents into the markup.
     The only way :hover and data-driven color actually work. -->
<style>
  .ukr-map           { max-width: 720px }
  .ukr-region        { cursor: pointer }
  .ukr-region:hover  { --ukr-hover: 9% }
  [data-key="UA-46"] { --c: #c0392b }
</style>
<svg class="ukr-map" viewBox="…">…</svg>

<!-- <object>: styleable only by CSS inside the SVG -->
<object data="ua.svg" type="image/svg+xml" width="720"></object>
```

If you want interactivity, inline it — a one-line include in most template engines, or an SVG-as-component import in a bundled app.

Then let your stylesheet do the work. `--c` is a single custom property that sets a region's fill *and* the hairline stroke that keeps it flush with its neighbors, so the two cannot drift apart:

```css
.ukr-region:hover   { --ukr-hover: 9% }   /* a stronger hover, on true edges */
[data-key="UA-46"]  { --c: #c0392b }   /* Lviv */
[data-key="UA-63"]  { --c: #e8b04b }   /* Kharkiv */
```

Everything else is a custom property too:

```css
.ukr-map {
  --ukr-land:  #e3dfd5;  --ukr-line: #8a867b;  --ukr-outline: #5d5a52;
  --ukr-water: #5f96bb;                        /* one blue for everything wet… */
  --ukr-lake:  var(--ukr-water);               /* …and a knob per kind, if you want one */
  --ukr-river: var(--ukr-water);
  --ukr-coast: var(--ukr-water);
  --ukr-glow:  .34;                            /* the shallow band: that blue, softer */
  --ukr-waterop: 1;                            /* opacity of the water LAYER — see below */
  --ukr-edge:  17%;                            /* border = the fill, this much darker */
  --ukr-hover: 4%;                             /* hover  = the fill, this much darker */
  --ukr-hi:    #d7d3ca;                        /* .is-selected: a color of its own */
  --ukr-text:  #26241f;  --ukr-halo: #fdfdfb;  /* label halo — set to your page color */
  --ukr-font:  "Ubuntu Condensed", "Arial Narrow", sans-serif;
  --ukr-wscale: 1;                             /* multiplies every water stroke */
}
```

Set `--ukr-water` and the lake, the river and the shore all follow; set one of the three and only that one moves. None of them carries a literal color of its own, so the default cannot drift apart again.

Give `--ukr-font` a real fallback. Naming one webfont and nothing else means that if it does not arrive — offline, blocked, still loading — the labels fall all the way through to the page's body font, which on a serif page is very obvious.

### 3 · The component

```html
<div id="m"></div>
<script src="ukrmap.js"></script>       <!-- dist/ukrmap.js -->
<script src="data.js"></script>
<script src="facts.js"></script>
<script>
  const map = UkrMap('#m', { data: UKR_DATA, facts: UKR_FACTS });

  map.set({ 'UA-46': '#c0392b' });     // choropleth; pass null to clear
  map.mark({ 'UA-46': 'alert' });      // adds class .m-alert — style or animate it yourself
  map.update({ labels: 'region' });    // labels, water and lang change in place
  map.on('hover',  (key, unit) => {});
  map.on('select', (key, unit) => {});   // a click; `select: true` makes it stick
  map.name('UA-46');                   // "Львівська область"
  map.destroy();
</script>
```

The map ⇄ grid animation is a separate file, because it is the most expensive
thing here and the least often wanted:

```html
<script src="ukrmap-unfold.js"></script>
<script>
  UkrMap.unfold(map);      // adds map.view('map' | 'grid')
  map.view('grid');
</script>
```

`update()` is the point of the class-driven markup: labels, water and language are already in the DOM, so changing one flips a class or swaps text. The map does not blink, and the unfolded layout does not replay its animation. Only geometry options (`kyivSeparate`, `spread`, `gaps`, `prefix`, `defs`) rebuild.

A region's color is one custom property, and it takes anything **an SVG `fill` takes** — which is not the same set as a CSS `background`. This is the trap:

```css
[data-key="UA-46"] { --c: linear-gradient(#e8b04b, #a5402f) }   /* nothing happens */
[data-key="UA-46"] { --c: url(#g) }                             /* right */
```

`linear-gradient()` is a CSS *image*, and `fill` does not take images. It is not rejected loudly either — the property parses, the fill comes out invalid, and the region stays its default color with nothing in the console. A gradient or a pattern has to be an SVG one, declared in `defs` and referenced by id. **Hatching** is the one that keeps coming up: since 2022 the recurring need is a region shown as occupied or partly so, and a hatch reads as a qualifier where a color reads as another value on the scale.

```js
UkrMap('#m', {
  data: UKR_DATA,
  defs: '<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse"'
      + ' patternTransform="rotate(45)">'
      + '<rect width="10" height="10" fill="#e3dfd5"/>'
      + '<line x1="0" y1="0" x2="0" y2="10" stroke="#a5402f" stroke-width="4"/>'
      + '</pattern>',
}).set({ 'UA-43': 'url(#hatch)', 'UA-09': 'url(#hatch)' });
```

`patternUnits="userSpaceOnUse"` puts the stripe spacing in map units, so it scales with the map rather than with the screen — 10 units at a 700 px render is about 0.7 px, so size the pattern for the width you actually publish at. A gradient goes in the same way:

```js
defs: '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#e8b04b"/><stop offset="1" stop-color="#a5402f"/>'
    + '</linearGradient>'
```

### Names from somebody else's feed

Alert APIs, spreadsheets and CMS fields do not speak ISO. `resolve()` takes what they actually send:

```js
map.resolve('Львівська область');   // 'UA-46'
map.resolve('м. Київ');             // Kyiv City, or its oblast when merged
map.resolve('Kyiv Oblast');         // 'UA-32' — the marker word disambiguates
map.resolve('Odessa Oblast');       // 'UA-51'
map.resolve('kharkov');             // 'UA-63'
```

It matches every name in the data — region adjective, full name, administrative center, ISO code — plus the transliterations and legacy forms that turn up most often, and normalizes away *oblast* / *область* / *м.* / *city*. `UkrMap.key(data, name)` is the same thing without an instance.

### A class per region, for states

`set()` gives a region a color. `mark()` gives it a **class**, which is what you want when the state needs to do something a color cannot — pulse, hatch, carry an icon:

```js
map.mark({ 'UA-46': 'alert', 'UA-63': 'partial' });   // adds .m-alert, .m-partial
```

```css
.m-alert { --c: #c4302b; animation: pulse 1.5s infinite }
```

### If your table has 27 rows

Kyiv City (`UA-30`) and Sevastopol (`UA-40`) are their own administrative units in every statistical table, alert feed and Derzhstat export — whether or not this map draws them separately. By default it does not: they are merged into Kyiv Oblast and Crimea, and the map has 25 regions.

You do not have to care. `set()`, `mark()` and the `fills` option all take either shape: a value keyed to a merged child lands on the region actually drawn, and a value keyed to the parent wins if you pass both. Anything that matches no region at all is reported once, in the console, rather than dropped in silence.

```js
map.set({ 'UA-30': '#c0392b' });                 // paints Kyiv Oblast
map.update({ kyivSeparate: true });              // now paints Kyiv City
```

Pass `kyivSeparate` and `sevastopolSeparate` together when the two need to read apart — that is the honest choice for a 27-row table, even though the visual default stays 25.

### Labels in a third language

`lang` is a switch with two positions, which is no use to a newsroom whose readers read neither. `names` is the slot beside it — a layer over whichever language is selected, so you translate the handful you care about and everything else falls through instead of coming back blank:

```js
UkrMap.render(data, {
  lang: 'en',
  names: {
    'UA-46': { region: 'Lwowskie', city: 'Lwów' },
    'UA-21': 'Zakarpacie',                          // region name only
  },
});
```

The region name is what a `<title>` tooltip, `data-name` and `labels: 'region'` show; the city name is what the default label set shows — so a translation that sets only the region name changes the tooltips and not the visible labels. Names are display only: `resolve()` still matches what a feed actually sends.

### The value in the tooltip

Every choropleth has to say what its colors mean, and the browser already has a tooltip that works on hover, on a long press and under a screen reader. So `titles` takes a table as well as a boolean, and the number goes into the `<title>` that is being emitted anyway:

```js
map.set({ 'UA-46': '#c0392b' })
   .title({ 'UA-46': 'Львівська: 42 %' });     // native tooltip, no tooltip code
```

```js
UkrMap.render(data, { titles: { 'UA-46': 'Львівська: 42 %' } });   // static too
```

Anything missing from the table keeps its region name, so a partial table is a partial annotation rather than a partial map.

### Color by number

Picking thresholds by hand is the tedious half of a choropleth, and the half that goes wrong: you have to read the range off the data, decide the breaks, and interpolate between colors. `colorData()` does all three and hands back plain hex.

```js
const dens = { 'UA-30': 3518, 'UA-14': 153, 'UA-46': 113, /* … */ };

const s = UkrMap.colorData(dens);
map.set(s.fills);            // {'UA-30': '#7f2d1e', …}
s.domain                     // [30, 3518] — read off the data
s.at(0.5)                    // the color at the ramp's midpoint
s.valueAt(0.5)               // 62 — the value there, for labelling a legend
s.of(120)                    // the color any value would get
s.posOf(120)                 // 0…1 — where that value sits, for a legend mark
```

| | |
|---|---|
| `colors` | two or more hex stops, spaced evenly along the ramp. Default is a five-stop sand-to-rust. |
| `spread` | `rank` (default) · `log` · `linear`. How a value becomes a position. |
| `domain` | `[lo, hi]`. Implies `linear` unless `spread` says otherwise. |
| `steps` | number of classes. Omit for a continuous ramp; `breaks` then holds the class edges. |

**Position along the ramp is by rank, not by value** — and that is the whole point. Real tables are skewed: Kyiv City is 3,518 people per km² against a median of 60. Spread linearly, twenty-five of twenty-six regions land inside ten units of one color channel, indistinguishable, while one city takes the entire ramp. By rank, the point at `t` along the ramp is the `t`-quantile of the data: every region gets its own color, the ramp is used end to end, and no outlier can flatten it.

The cost is worth stating plainly: color then tells you the **order**, not the size of the gap. Kyiv sits one step above Donetsk rather than twenty times further along. When the gap is the point, pass `domain` — that is the linear reading, and asking for it explicitly is the right way round.

**`spread: 'log'` is the middle answer**, and the conventional one for quantities that are multiplicative rather than additive — densities, populations, incomes, areas. It keeps the magnitudes rank throws away without letting the outlier take everything. Measured on the density table above, how much of the ramp the twenty-five ordinary regions get, out of 176:

| | ordinary regions get | Kyiv |
|---|---:|---|
| `linear` | 10 | the other 166 |
| `log` | 92 | the top |
| `rank` | 173 | one step above Donetsk |

It needs every value above zero — a count, a percentage change or a net figure is not — and says so and falls back to linear rather than producing `-Infinity` quietly.

**Cap the domain to give the rest of the field more room.** One genuine outlier still takes the top of any ramp that ends at it; `domain` ends the ramp earlier and lets the outlier clamp there:

```js
UkrMap.colorData(dens, { spread: 'log', domain: [30, 400] });
```

On the density table that moves the other twenty-five regions from 92 units of color to 141, with Kyiv alone in the top swatch. Say so in the legend — a clamped scale that does not admit it is a scale that lies about its top end.

`log` also degrades gracefully, which matters more than the headline case: merge Kyiv back into its oblast and the spread drops from 117× to 5.5×, where `linear`, `log` and `rank` all produce 22 distinct colors over the whole ramp and differ only in where the median sits (0.22, 0.41, 0.50). The transform stops mattering exactly when it stops being needed.

`steps: n` cuts whichever reading you chose into `n` quantile classes, which is the conventional choropleth and easier to label. Asking for more classes than the data has distinct values quietly gives you as many as it can support, and a table with no variation at all gets the start of the ramp — one number is not a high number.

A key whose value is `null`, `''` or anything non-numeric is **left out** rather than painted at the bottom of the ramp — a gap in the table is not a zero, and a region with no fill keeps the default land color, which is how a map says "no data".

Interpolation is in OKLab, so a two-stop ramp across a hue keeps its chroma through the middle instead of passing through gray, and a ramp computed here lands on the same color as `color-mix(in oklab, …)` in a stylesheet.

### Hover follows the color a region already has

Hover is a shade of the region's own color — `--ukr-hover`, 4% of black in OKLab — rather than a color of its own. Two reasons, and the second is the one that bit:

```css
.ukr-map { --ukr-hover: 9% }      /* louder */
.ukr-map { --ukr-hover: 0% }      /* none */
```

A fixed highlight color throws away the data: hovering a region on a choropleth replaced its value with a swatch that means nothing. And it stopped working entirely on the maps that color their regions from a stylesheet — `#alerts .m-alert { --c: #c4302b }` carries an id, which outranks `.ukr-region:hover`, so the highlight silently lost. The states now write a **derived** property that the base paint reads, so they win whatever set the color and read it rather than replacing it.

One consequence worth knowing: darkening by a percentage compresses as the fill gets darker. On the land color the step is 12 sRGB units; on the darkest class of a five-step ramp it is 7. Raise `--ukr-hover` if your ramp runs dark.

### Clicking says which region; it does not keep it

A click fires `select` and nothing else. The map does not stay lit, because on almost every map that goes anywhere the click is a way *into* something — a panel opens, a table filters, a route loads — and the thing that changed is where the reader is now looking. A second highlight on the map is then a state to keep in step with the first, and on a choropleth it is worse than redundant: `--ukr-hi` replaces the region's own color, so the one region you are reading about is the one whose value you can no longer see.

When the map itself is the answer — a picker with nothing else on the page, one of several maps where the reader has to be able to find their place again — turn it on:

```js
const map = UkrMap('#m', { data, select: true });
map.on('select', key => {});   // the SELECTION now: null when the click cleared it
```

That adds `.is-selected` (`--ukr-hi`, a color of its own, because it is a state to find again rather than a passing hint), `aria-pressed`, and *selected* in the live region. The CSS ships either way, so a host that keeps selection somewhere else can put the class on a region itself.

### Borders on a colored map

**This one is automatic.** A fixed border color cannot be right against every fill: `--ukr-line` reads clearly against pale land and disappears into a mid-tone one, so one border looks like two different weights across a single map. So as soon as regions carry colors — `fills` at render time, or `set()` on a live map — the shared gray line steps aside and each region is outlined a step darker than **itself**. A map with no colors keeps the gray line, because there is nothing to derive from and 14% of the land color is fainter than the line it would replace.

The step is one custom property:

```css
.ukr-map { --ukr-edge: 22% }     /* default 14%; 0% for no border at all */
```

The mechanism is worth knowing about, because it is what stops the borders becoming a blur. Each region's stroke straddles its own edge, so at a boundary the visible line is whichever region is painted last — and when that is the lighter one, a dark region meets a light one through a mid-tone line, which reads as a soft gradient instead of an edge. The regions layer is therefore blended with `mix-blend-mode: darken`, which picks the darker of the two overlapping rims: **the line between two differently colored regions is always the darker one's.** `isolation: isolate` on that layer keeps the blending off whatever is behind the map.

Browsers without `color-mix` fall back to the gray line. Baked files (`style: 'attrs'`) get the same rims computed ahead of time, in the same color space, since a design tool reads neither custom properties nor blend modes.

### A legend

The project does not build one, because a legend is HTML and yours will not look like mine. But `colorData()` hands back everything it needs, so it cannot drift from the map it explains:

```js
const s = UkrMap.colorData(values, { steps: 5 });       // classed: one swatch per class
const edges = [s.domain[0], ...s.breaks, s.domain[1]];

legend.innerHTML = s.breaks.map((_, i) =>
  `<li><i style="--c:${s.at(i / s.breaks.length)}"></i>${Math.round(edges[i])}–${Math.round(edges[i + 1])}</li>`
).join('');
```

For the continuous default, draw a gradient bar and label the two ends. Anything in between is better marked than labelled: `posOf()` is the scale read backwards, so a tick for a real value lands exactly under its own color, and a row of them shows the distribution the ramp is answering to — which is the argument for `log` or `rank` made visible rather than asserted:

```js
const s = UkrMap.colorData(values, { spread: 'log' });
bar.style.background = `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map(s.at)})`;

for (const v of Object.values(values)) {           // one hairline per row
  const tick = bar.appendChild(document.createElement('i'));
  tick.style.left = s.posOf(v) * 100 + '%';
}
```

`valueAt()` is the other direction — the value at a position — for when you do want a number partway along. On a rank scale those are the quantiles of your data; on `log` or `linear` the midpoint of the bar is not the middle of the data, so a number printed there will claim more than it means.

```css
.legend { display: flex; gap: 1rem; list-style: none; padding: 0 }
.legend li { display: flex; align-items: center; gap: .4rem }
.legend i  { width: .85rem; height: .85rem; border-radius: 2px; background: var(--c) }
```

### Your own elements, by coordinate

The map is a Lambert Conformal Conic fitted to Ukraine, and it now carries its own projection, so a lon/lat can be put on it:

```js
const p = map.project(30.5234, 50.4501);      // longitude first — see below
pin.style.left = p.left + 'px';               // pixels, relative to map.el
pin.style.top  = p.top  + 'px';
```

```js
UkrMap.project(data, 30.5234, 50.4501);       // [x, y] in map units, no DOM
```

**Longitude first, which is the opposite of how you have seen coordinates written.** Both orders are standard, in different worlds. People write latitude first — `50.4501, 30.5234` is what Google Maps shows you and what a phone puts on the clipboard. Data formats write longitude first, because it is the x of an x/y pair: GeoJSON, WKT, PostGIS, shapefiles, and `dist/ua-wgs84.geo.json` in this very package all do. This function returns an x and a y and reads a GeoJSON-shaped pair, so it follows the format rather than the phone. If you are pasting from a map, swap them.

Getting it wrong is not silent: a swapped pair still lands inside the valid range for both, so it cannot be rejected, but anything far outside Ukraine logs a warning once saying so.

`left`/`top` come from the SVG's own `getScreenCTM()`, so they survive any CSS width, any `preserveAspectRatio` and any scroll position. Agreement with PROJ is under a meter; a point checked against the admin-center dots lands within about five map units of them, and that residual is the two coordinate sources disagreeing, not the projection.

**What you hang there is yours.** Put a `position: relative` wrapper round the map and absolutely position ordinary HTML into it — the map returns a point and owns nothing else: not the markup, not the styling, not the z-index, not the behavior. Reposition on `resize`.

One limit, deliberately: `project()` answers for the **map** layout. In the unfolded grid every region has moved and a pinned element does not follow it. Making it follow would mean hanging off each tile's animated transform, and an extra reader of that transform is exactly what the unfolded view is careful not to have — so pin things in map view, or hide them while the grid is up.

### Areas and populations ship separately

The geometry will be right for decades; the population estimates were already historical when they were written down. Welding them together meant you could not update one without reissuing the other, and made the map look as current as its least current field.

```js
UkrMap.facts(data, UKR_FACTS);   // or pass facts: UKR_FACTS to UkrMap()
```

`data/ua-facts.json` carries `asOf` and `source`, and without it `unit.area` is `null` rather than `0` — so you can tell "no figures loaded" from "genuinely zero". The CLI picks the file up on its own.

### One SVG per region

For a list or table with a shape beside each row. Better than an SVG "list view": everything around the shape stays ordinary HTML, so it is styleable, selectable, translatable and accessible in the usual way, and you put whatever you like beside it.

```js
el.innerHTML = UkrMap.regionSvg(UKR_DATA, 'UA-46', { scale: 160 });
```

```bash
npx github:keymasterr/ukrmap --split ./regions --scale=160 --style=attrs   # + regions.json
```

Three ways to size them, answering different questions:

| | |
|---|---|
| `scale: 42` | pixels per 1000 map units. One shared scale, so shapes stay **comparable** — Chernivtsi really is smaller than Crimea. Rows end up different heights. |
| `fit: {height: 64}` | every region 64 px **tall**. Rows line up, widths vary, and the shapes are no longer comparable — flat Chernivtsi becomes the *widest* tile. |
| `fit: {width: 96}` | the same, the other way round. |
| *(nothing)* | no `width`/`height`: fills its container. |

Each region carries its own water and its own stretch of coastline, clipped to its shape — filtered by bounding box, so a region only includes the rivers it actually touches.

### Baking colors in, for design tools

Figma, Keynote, PowerPoint and Illustrator ignore CSS custom properties, so the default file imports gray. `style: 'attrs'` writes every color onto the elements instead:

```bash
npx github:keymasterr/ukrmap --style=attrs --fill UA-46=#c0392b --fill UA-63=#e8b04b -o hl.svg
```

The background is transparent either way — nothing paints a sea fill.

Two things are different in a baked file, both because a design tool is not a browser. **Every stroke is in map units**, including the region borders, the national outline and the seam-covering stroke: design tools ignore `vector-effect`, so a browser-sized `0.7` on a 10000-unit map imports as 0.07 px and the boundaries disappear. **Every region carries its name as its `id`**, because Figma and Illustrator name a layer after the element's id — `Львівська область`, or `Lviv Oblast` under `lang: 'en'`, instead of twenty-five layers called `Vector`.

In Node, the same file exports the pure renderer:

```js
const UkrMap = require('ukrmap');
const data = require('ukrmap/data/ua-1400.json');
fs.writeFileSync('ua.svg', UkrMap.render(data, { water: true }));
UkrMap.css();      // the default skin, if you want it in your own stylesheet
```

### PNG, for everything that will not take an SVG

Google Slides, Word, most CMS editors and every social platform take PNG only, and that is most of the people who need a map of Ukraine. [The demo page](demo/index.html) will hand you one: configure the map, **save → PNG**, 2400 px wide, transparent background.

On a server — a bot posting a map every few minutes — render and rasterise:

```js
const UkrMap = require('ukrmap');
const data = require('ukrmap/data/ua-1400.json');
const { Resvg } = require('@resvg/resvg-js');          // or sharp, or rsvg-convert

const svg = UkrMap.render(data, { style: 'attrs', fills });
require('fs').writeFileSync('ua.png',
  new Resvg(svg, { fitTo: { mode: 'width', value: 2400 } }).render().asPng());
```

`style: 'attrs'` is not optional here — a rasteriser is not a browser and will not resolve CSS custom properties. **The labels need the font installed on the machine doing the rasterising**, or they fall back down the stack (`Ubuntu Condensed` → `Roboto Condensed` → `Arial Narrow` → `Liberation Sans Narrow`); `--labels=none` sidesteps it entirely. The rasteriser is a dependency of yours, not of this package.

### Small screens

Labels are sized in map units, so they scale with the map: at 360 px wide a city label is about four pixels tall, which is decoration rather than text. Either hide them or use the blank map there.

```css
@media (max-width: 500px) { .ukr-label { display: none } }
```

`labelScale: 'fixed'` is the other answer — it pins labels to screen pixels — but on a phone-width map twenty-five legible labels do not fit anyway.

### Bringing your own tools

`dist/ua-wgs84.geo.json` is the same geometry in lon/lat, simplified identically, with the names and ISO codes on each feature. `dist/ua-facts.csv` is the areas and populations as a plain table.

```python
import geopandas as gpd, pandas as pd
ua = gpd.read_file('dist/ua-wgs84.geo.json').set_index('key')
ua = ua.join(pd.read_csv('dist/ua-facts.csv').set_index('key')[['area_km2', 'pop_k']])
ua.assign(dens=ua.pop_k * 1000 / ua.area_km2).plot(column='dens', legend=True)
```

```r
ua <- sf::read_sf("dist/ua-wgs84.geo.json")
ua <- dplyr::left_join(ua, readr::read_csv("dist/ua-facts.csv"), by = "key")
```

Note that the GeoJSON carries all 27 units — Kyiv City and Sevastopol are separate features there, because merging is a rendering decision and has no business in the data you take elsewhere.

### What this is not

Oblasts and nothing below. There is no raion or hromada geometry here and there will not be: the 2020 reform redrew every raion boundary, the shapes need their own simplification budget, and the file would be an order of magnitude larger for an audience this project does not have. If that is what you came for, start from [Natural Earth](https://www.naturalearthdata.com/) at admin-2, or from OpenStreetMap via [Geofabrik](https://download.geofabrik.de/europe/ukraine.html).

---

## Options

Shared by `render()`, `UkrMap()` and the CLI.

| option | CLI | default | |
|---|---|---|---|
| `lang` | `--lang` | `uk` | `uk` \| `en` |
| `labels` | `--labels` | `city` | `city` \| `region` \| `none`. The two sets are alternatives with one type style; `all` exists only so the component can switch without re-rendering |
| `water` | `--water` | **`true`** | coastline + the Dnipro. `{rivers:'all'}` adds the rest, `false` none |
| `borders` | `--no-borders` | `true` | internal region boundaries |
| `outline` | `--no-outline` | `true` | national boundary — land frontier and coast, as separate paths |
| `defs` | — | `''` | raw `<defs>`: gradients, patterns, filters |
| `fills` | `--fill K=C` · `--data` | — | `{key: color}` baked in at render time |
| `names` | `--data` | — | `{key: 'Name'}` or `{key: {region, city}}`, layered over `lang` |
| `link` | `--link` | — | wrap regions in `<a href>`, `{key}` substituted |
| `palette` | `--palette K=V,…` | — | partial override of the default colors |
| `scale` | `--scale` | — | `regionSvg`: pixels per 1000 map units |
| `kyivSeparate` | `--kyiv-separate` | `false` | Kyiv City as its own region |
| `sevastopolSeparate` | `--sevastopol-separate` | `false` | |
| `titles` | `--no-titles` · `--data` | `true` | `<title>` per region → native tooltip. Also takes `{key: text}`, so the tooltip carries your value |
| `style` | `--style` | `inline` | `inline` colors as CSS custom properties · `attrs` baked onto elements · `none` |
| `pad` | `--pad` | `80` | margin, in map units (map is 10000 wide) |
| `prefix` | `--prefix` | `ukr` | class-name prefix |
| `facts` | auto | — | the separate areas/populations file |
| `labelScale` | — | `map` | browser: `map` scales with the map, `fixed` pins to screen pixels |
| `select` | — | `false` | browser: a click also leaves the region selected. Off by default — the `select` event fires either way |

`--data FILE.json` is the CLI's way into `fills`, `titles` and `names` at once: one object keyed by ISO code or region name, each entry a color string or `{fill, title, name}`. Explicit `--fill` flags override it.

`UkrMap.unfold(map, opts)` takes `spread` (default `1.62` — keeps the three bands on one row each; `1` makes the grid as wide as the map so bands wrap), `gapX`/`gapY` (grid gaps in map units) and `duration`.

Labels scale with the map by default, so a static export and a live one look identical. `labelScale: 'fixed'` keeps them at a constant on-screen size instead.

**An inlined map's `<style>` is not scoped to it.** An SVG `<style>` inside an HTML document is a document stylesheet like any other, so two inlined maps do not each get their own — the second one's rules apply to the first as well. That is harmless while both are the default skin, and it is why `prefix` exists: give each map its own class prefix and their stylesheets cannot reach each other.

```js
UkrMap.render(data, { prefix: 'left' });    // .left-region, .left-borders, …
```

`prefix` renames classes, not ids: a rendered map emits **no ids at all**, so any number of maps and region tiles can share a page without colliding. Style regions by `.ukr-region[data-key="UA-46"]`, never by id. The two places an id is unavoidable both namespace their own — a region tile that clips water to its shape, and the unfolded view's clip paths — and `attrs` mode emits region names as ids on purpose, for design tools.

Every rendered file carries a `<desc>` with the version, license, source and simplification level, and the note that the water and boundaries are pre-2023. Files outlive the page they were downloaded from.

### Dark mode is not built in, on purpose

The map used to follow `prefers-color-scheme` on its own. That is the wrong default for something dropped into somebody else's design: this project's own demo page is deliberately cream, `#fffff8`, at every OS setting, and a viewer in dark mode got a charcoal map sitting in the middle of it. The OS preference says what the *viewer* wants; only the host knows what the *page* is.

So it is yours to add, and it is one block, because every color is already a custom property and every rule is written once:

```css
@media (prefers-color-scheme: dark) {
  #where-my-map-lives .ukr-map {
    --ukr-land: #333733;  --ukr-line: #6d6a61;  --ukr-outline: #9b968b;
    --ukr-water: #74a9c7; --ukr-hi:   #5b95e8;
    --ukr-text: #e7e4dc;  --ukr-halo: #191a18;   /* your page's dark background */
  }
}
```

Scope it to the container the map is in rather than to `.ukr-map` globally, and it inverts exactly the maps you meant it to. Swap the media query for `[data-theme="dark"]` if your page carries its own toggle.

### Keyboard

One tab stop into the map, then arrow keys between regions — 25 tab stops ahead of the rest of the page is a wall, not navigation. <kbd>Home</kbd>/<kbd>End</kbd> jump to the ends of the reading order, <kbd>Enter</kbd> is the click. A polite live region announces the focused region, whether it is selected, and any class `mark()` has put on it, so a choropleth is not silent.

**An arrow goes to a region that really lies that way, and really touches.** Only neighbors are candidates, and only within 75° of the direction pressed; outside that cone nothing happens, because at the edge of the country there is nothing that way and a dead end reads better than a sideways jump. Ties are settled by the length of the shared border — from Lviv, Zakarpattia sits 29° off straight down and Ivano-Frankivsk 30°, which is noise, but Lviv shares 1,314 units of edge with Ivano-Frankivsk and 526 with Zakarpattia over the Carpathian ridge, and the longer border is the one a reader means by "below".

The graph this walks is public, because it is useful for more than arrow keys — which regions touch Poltava, or coloring no two neighbors alike:

```js
const nav = UkrMap.neighbors(data, { kyivSeparate: true });
nav.of('UA-46');              // { 'UA-26': 1314, 'UA-07': 789, … } shared border, map units
nav.toward('UA-46', 0, 1);    // 'UA-26' — one step down
```

**Nothing ever scales between views.** The viewBox width is fixed, so the on-screen scale is fixed too: a region is exactly the same size in the map and in the grid. Switching views is a pure translation per region, plus one translation of the whole scene to center the map in the wider box. The grid runs taller than the map, and only the container's height animates.

### Water and coastline

`water: true` is the default and means **coastline plus the Dnipro** — the river as a thread, its reservoir cascade as shapes, and the sea shore picked out from the land frontier. Nothing paints a sea fill, so the background stays transparent.

That rule is followed strictly: Natural Earth also ships a `Lake Centerline` axis running *through* each reservoir, and none of them are drawn. They are the same water twice, and once anything reached for one of their endpoints — the mouth-joining below does — the Kakhovka axis got extended across dry land to the Dnipro estuary and read as a canal that has never existed.

```bash
ukrmap --water=all        # + Dniester, Southern Buh, Donets, Prypiat, Prut, Seym
ukrmap --water=coast      # shoreline only
ukrmap --no-water
```

`--water=all` also adds the one reservoir that is *not* on the Dnipro — an untitled Natural Earth feature on the Southern Buh east of Khmelnytskyi. It is out of the default set because in a view that is otherwise the river and the sea it reads as a stray blob rather than as part of anything.

**A river that reaches the sea is drawn reaching it.** The rivers and the national outline come from different layers and are simplified independently, so the point where they meet drifts apart by whatever each side lost: the Southern Buh ended 316 map units short of the Black Sea at the default detail and 468 at the coarsest, visibly stopping in mid-land north of Mykolaiv. A mouth that has drifted is extended back to the shore — extended, never moved, so no vertex from the source is touched — provided the gap is under 600 units and the extension continues the way the river was already heading. Every real mouth is inside 468; the next-nearest endpoint is the Donets leaving for Russia at 1,433.

Below Mykolaiv the Buh is not a river at all but the Bug estuary, and it is drawn as what it is: an inlet of the sea, with coastline on both banks. The river line ends where the estuary begins.

Rivers are clipped to the country at build time, and where one weaves in and out of the border — the Dnipro along Belarus, the Dniester along Moldova — that leaves two-point stubs behind. Simplification collapses some of them to zero length, and `stroke-linecap: round` paints a zero-length subpath as a **dot**: eight of them used to sit on Chernihiv's western edge, attached to nothing. `pack.js` now drops any subpath shorter than 50 units measured along the path — about 6 km, 3.5 px at a 700 px render — and reports the count.

**Everything wet is one color.** A river, the reservoirs strung along it and the sea are the same substance; giving each its own blue made the Dnipro read as a thread laid across a chain of unrelated lakes rather than as one river with wide places in it. Role is carried by alpha instead. The coastline is drawn the way the 2012 map drew it: a fine line, with a wider band of the same blue at `--ukr-glow` (`.34`) **underneath the land**, so the land covers its inland half and only the seaward half shows — which is what makes it read as shallow water rather than as a fat border. One token, `--ukr-water`, recolors all of it, and the shore band cannot drift out of hue with the shore it belongs to.

The coast is not stored. It is worked out at build time by distance from Natural Earth's coastline layer, plus the lagoons the build erases — which is why the Syvash shore reads as water rather than as a land border. The classification is **per vertex, not per arc**: an arc only ends where regions meet, so Odesa's entire outer boundary is a single arc running along Moldova, down the Danube, along the Black Sea and back to the Mykolaiv junction. Judging that arc as a whole loses almost all of Odesa's coast.

### See-through water

Water is drawn above the region fills, so a hover or a choropleth color stops at the river's edge. Making the water semi-transparent fixes that — but **put the alpha in `--ukr-waterop`, not in the color**:

```css
.ukr-map { --ukr-waterop: .45 }          /* right */
.ukr-map { --ukr-water: rgba(95,150,187,.45) }   /* wrong */
```

Alpha inside a color is applied per shape. The Dnipro is a thread *plus* the reservoirs it runs through, and each reservoir is a fill plus a stroke, so a transparent color double-darkens wherever they overlap: the river shows as a stripe down the middle of its own reservoirs and every lake gains a darker rim. `--ukr-waterop` is a group opacity — the layer is composited opaquely into a buffer first and blended once, so the overlaps disappear and the Dnipro stays one object. At the default `1` no buffer is allocated, so it costs nothing until you use it.

**Water scales with the map; furniture does not.** Region borders, the national outline and the seam-killing stroke are pinned to device pixels — they are furniture, and a 200 px map whose borders stay 0.7 px is legible where one with proportional borders is a mesh. Water is a feature, so its widths are in map units, out of the map's 10000-unit width: `32` for a main river, `23` for the shoreline, `116` for the shallow band. Pinned to device pixels these were wrong at both ends — a fat blue smear round Crimea at 240 px, an invisible thread at 1200 px — and in Illustrator or Figma, which ignore `vector-effect`, a 1.8-unit stroke on a 10000-unit map imported as nothing at all.

Under that sits a device-pixel floor, so a thread never quite vanishes on a small map:

```css
stroke-width: max(32px, calc(1.15px * var(--ukr-u, 0)));
```

`--ukr-u` is user units per CSS pixel. The component sets it on every resize; a static file has no JavaScript to set it, falls to the `0` default and gets the purely proportional width, which is what you want in print anyway. `--ukr-wscale` multiplies all of them at once if you want the water louder or quieter.

---

## Why it is shaped this way

The reasoning — the topology format, how borders are derived rather than stored, the seam measurements, hand-placed labels, the unfolded view's ordering, and how to rebuild the geometry from Natural Earth — is in **[DESIGN.md](DESIGN.md)**. None of it is needed to use the map.

---

## Data provenance and caveats

- **Water is at its pre-June-2023 extent.** The Kakhovka reservoir has since been drained by the destruction of the dam. No surveyed replacement geometry exists, so rather than invent a channel the reservoir is drawn as it was and tagged `data-until="2023"` — style or hide it accordingly. Natural Earth leaves two of the Dnipro cascade (Kaniv, Kamianske) unnamed; `geo.sh` names them by bounds, or the river would have holes in it.
- **Population figures predate the full-scale invasion** — 1 January 2022, State Statistics Service; Crimea and Sevastopol are 2014, the last Ukraine published. They are there for scale, not currency.
- **Areas** are official and stable. They sum to 603,568 km² against Ukraine's 603,628 — a 60 km² gap from rounding the per-region table, not from the geometry.
- **Crimea and Sevastopol are Ukrainian**, and are drawn as Ukrainian regions with their ISO 3166-2 codes `UA-43` and `UA-40`. Natural Earth files them under Russia, following a de-facto-control convention; the build corrects that.
- **Kirovohrad's center is Kropyvnytskyi and Dnipropetrovsk's is Dnipro** — both renamed in 2016, after the original version of this map.

## Layout

```
ukrmap/
  src/ukrmap.js         renderer + browser component, one UMD file, no deps
  src/ukrmap-unfold.js the map <-> grid animation, opt-in
                        src/ is the annotated original — read this one
  bin/ukrmap.js       CLI
  data/ua-*.json      geometry, one file per detail level   (generated)
  demo/               the demo and how-to page              (generated)
  dist/               ready-made files, so nobody has to run a build
    ukrmap.js         src/ with the comments stripped — serve this one
    ukrmap-unfold.js   (both generated and verified against src/)
  test/test.js        checks: names, stitching, facts, every render path,
                      and that the stripped copy is the same program
  build/
    geo.sh            Natural Earth -> cache
    pack.js           cache -> data/
    meta.js           names, centers, areas, populations, label offsets, bands
    check-labels.js   label placement — drag, check, autotune
    strip.js          the comment stripper, and the checks that police it
    dist.js           data + src -> dist/, and the size tables in this README
    demo.js           refresh demo/ from dist/
```

`dist/ua-wgs84.geo.json` is the same geometry in lon/lat, simplified identically, for anyone bringing their own projection.

Known gaps: no per-district (raion) geometry, by design; the `region` label set is not offset-tuned the way `city` is, so `labels=both` collides in the crowded west; and the grid's gap is uniform between bounding *boxes*, which cannot make the gap between *shapes* uniform — tune `gapX`/`gapY` to taste.

---

MIT, and the geometry is derived from [Natural Earth](https://www.naturalearthdata.com/), which is in the public domain. The regions' names, areas and populations are facts, not authorship. See [LICENSE](LICENSE).
