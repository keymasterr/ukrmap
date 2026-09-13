# ukrmap · design notes

Why the thing is shaped the way it is. Nothing here is needed to use the map — [README.md](README.md) is the whole of that. This is for anyone changing the geometry, the build or the renderer, and for the version of me that comes back in a year having forgotten why any of it was decided.

The short version: the static SVG is the product, the component is optional, and almost every decision below follows from putting those in that order.

---

## What ships, and why it is shaped this way

### The data file is a topology, not polygons

Every boundary is stored **once**, in `arcs`; a region is a list of signed arc indices. Three things follow:

1. **~2.5× fewer coordinates** than storing each ring separately.
2. **Internal borders and the national boundary are not stored at all.** They are derived from how many *active* regions use each arc: two or more → internal border, exactly one → national boundary (coast or land frontier), and one distinct region but two raw users → interior to a merged region, so nothing is drawn. That last case is what makes `--kyiv-separate` correctly grow Kyiv City's boundary and hide it again when merged.

   Merging also stitches: the arcs shared *inside* a group are dropped and the rest are walked back into closed rings, so a merged Crimea is one outline with no Sevastopol line across it. Concatenating the two paths would fill correctly but leave that stray ring, invisible until the unfolded view strokes each tile.
3. **Gaps are unrepresentable.** A shared boundary is physically one list of numbers. No amount of rounding can drift two neighbors apart.

Coordinates are integers in a 10000-unit-wide space, which lets the emitted path data use relative commands with no decimal points — lossless here, because every delta is an exact difference of two integers.

### No seams, and it is measured

Topology removes *geometric* gaps. The other cause is antialiasing: two abutting fills each cover about half the boundary pixel and composite to ~75%, not 100% — the classic hairline. So each region is stroked in **its own fill color** (`vector-effect: non-scaling-stroke`), dilating it just enough that neighbors overlap and composite to full coverage. Same color as the fill, so it is invisible.

**The width belongs in device pixels, and `stroke-width` is in CSS pixels.** Those are the same thing at 1x and a factor of two apart at 2x, so no single constant is right for both — which is easy to get wrong in the flattering direction, because a value tuned on a Retina screen looks crisp there and seams on everyone else's. Rasterised at 1:1 and counting interior pixels the fills miss, against a control stroked wide enough to guarantee coverage:

| render width | interior px | 0.5 | 0.7 | 1.0 | **1.3** |
|---:|---:|---:|---:|---:|---:|
| 700 | 153,933 | 3,854 | 3,618 | 818 | **51** |
| 1000 | 318,430 | 5,440 | 5,115 | 800 | **33** |
| 1400 | 630,264 | 7,677 | 7,220 | 1,091 | **47** |
| 2000 | 1,296,819 | 10,902 | 10,253 | 1,204 | **5** |

1.3 is the first width that closes the seams; the residue is the control's own erosion at the coastline, where the real shore is a sand spit thinner than a pixel. So 1.3 is held **in device pixels** — `1.3` at 1x, `0.65` at 2x, `0.43` at 3x, through two media queries. The same ink everywhere, and on a Retina screen the edge is half the CSS weight it used to be.

### Labels are placed by hand

Each administrative center sits at its true projected coordinate, and its label carries a hand-tuned offset and anchor in `build/meta.js`, so it falls inside its own region — the way the 2012 original did it.

**To move one, drag it.** Describing where a label should go is harder than putting it there:

```bash
npm run check-labels      # then open _tmp/check-labels.html
```

Grab a label and move it. The readout names anything that has left its region the moment it does; arrow keys nudge the selected label by one unit (shift by five), <kbd>a</kbd> cycles its anchor, and **Copy meta.js block** puts every offset on the clipboard in exactly the shape `build/meta.js` wants. Nothing is written for you — the offsets stay in source, in review, not in a state file. **Revert all** puts them back.

Offsets are in thousandths of the map's width, so they stay readable and stay valid at every detail level. Keep them small: a label that wanders far from its dot stops reading as belonging to it, and the readout warns past 16.

The same page checks placement mechanically. `checkLabels()` takes each rendered text box and asks the region's own path `isPointInFill()` for its corners and edge midpoints; `checkLabels(true)` draws the boxes. `autoTune()` searches a small grid of offsets and anchors and prints a block ready to paste into `meta.js` — preferring, in order, to stay near the dot, sit above it, and keep a centered anchor. Currently **0 of 25 spill**.

Offsets are measured against Ubuntu Condensed, which is why the harness waits for `document.fonts.ready` before it measures anything — metrics taken before the webfont lands are the fallback's. No font ships with the component: labels ask for `--ukr-font` and fall back to a condensed system stack.

### The unfolded view keeps its 2012 order

Regions fly out in three west-to-east bands. Measured across the whole transition, that is the only ordering whose region overlap falls monotonically to zero:

| order | mean overlap | peak |
|---|---:|---:|
| **geographic** (three bands) | **13.5%** | **36.3%** |
| alphabetical | 50.6% | 94.9% |
| by area | 45.4% | 82.5% |
| by population | 61.2% | 123% |

36.3% is the overlap of the assembled map itself — interlocking bounding boxes overlap by definition — so geographic is the only order that never makes the picture busier than the map already was.

The grid is not computed. The component flows 25 hidden inline-block boxes, one per region, with a line break between bands, and reads the positions back — the same trick the 2012 version used, and it reflows on resize for free.

Three details make it behave:

- **Only `transform` is ever transitioned**, and only ever a translation. A fill transition on hover is exactly what makes a map feel unresponsive, so there isn't one — the highlight lands on the same frame as the pointer.
- **Two animated layers per region, not one and not three.** The shape, its own water and its own shore travel in one wrapper inside the regions layer; the label travels in a matching wrapper inside the labels layer, which is drawn last. Labels used to ride inside the tile, which kept them perfectly in step and also buried them under the shared water — in map view the Dnipro painted over Kyiv and Cherkasy. Both wrappers carry the same class, so the same transition and the same `will-change`, and both transforms are written in the same loop of the same task: they start on the same frame and are interpolated identically. What makes text shimmer against a shape is one of them not being promoted, not the fact that there are two.
- **Once the regions come apart, the shared border, outline and water paths are hidden**, because they would otherwise hang in the air as a ghost of the assembled map. Each tile's own outline takes over, at the same 0.7 device pixels the borders use, so no line thickens or thins as the view changes.
- **Water is absent for the half-second the tiles are in flight**, and that is a deliberate trade. The shared layers are the assembled map's water and would be wrong the instant anything moves; a tile's own water is correct but has to be clipped to that tile's shape, and re-evaluating 25 clip paths every frame is what made this feel heavy. So the shared layers fade out in 90 ms, the per-tile ones fade in over 250 ms once the tiles land, and nothing is clipped while a transform is running. The tiles' outlines carry the shape through the gap. If you would rather have continuous water than a guaranteed-smooth transition, delete the `.is-moving` rule in `ukrmap-unfold.js` and measure it on your slowest target.
- **A split-out child sits beside its parent** in the flow order, so Kyiv City lands immediately before Kyiv Oblast rather than wherever the unit list happens to put it.

---

## Rebuilding the geometry

```bash
./build/geo.sh          # Natural Earth -> build/cache/  (downloads ~53 MB once)
node build/pack.js      # cache -> data/ukrmap-*.json
node build/demo.js      # refresh demo/
```

Sources: Natural Earth 10m admin-1, lakes, and river centerlines — public domain. Projected to Lambert Conformal Conic with standard parallels at 44.5° and 52°, simplified **on the topology** so a shared arc is simplified once for both sides.

Three detail levels, in meters of Visvalingam interval:

| | points | gzip | |
|---|---:|---:|---|
| `--detail=700` | 4,783 | 20.5 KB | print, large display |
| `--detail=1400` | 2,717 | 13.9 KB | default |
| `--detail=2800` | 1,339 | 9.4 KB | when bytes matter |

At a 300 px render, 700 and 1400 are indistinguishable. The difference only shows at the Syvash; below 2800 the lagoon shoreline flattens, though `keep-shapes` preserves the Arabat Spit even at 5000.

### The shape between Kherson and Crimea

Most small maps show that join as a solid isthmus. It is not. The Syvash is a lagoon open to the Sea of Azov through the Henichesk Strait, so cartographically it is coastline, not an inland lake — and there are only two land routes across it, the Perekop neck in the west and the Arabat Spit in the east. `build/geo.sh` erases coastal lagoons (the Syvash and the Dniester Liman) from the land, which is what recovers that shape. Inland reservoirs are *not* erased; they are drawn on top as a toggleable layer, so turning water off leaves a clean, correct coastline.

---
