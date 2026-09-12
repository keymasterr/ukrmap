#!/usr/bin/env bash
#
# Natural Earth  ->  build/cache/*.json  (intermediate GeoJSON/TopoJSON)
#
# Run this only when the geometry needs regenerating; `pack.js` turns the cache
# into data/ua-*.json, and that is what ships. Needs network on first run.
#
#   ./build/geo.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

CACHE=${UKRMAP_CACHE:-build/cache}
MS="npx -y mapshaper@0.6.111"

# Lambert Conformal Conic tuned to Ukraine. Standard parallels bracket the
# country's latitude range, so shape distortion is negligible across it.
PROJ='+proj=lcc +lat_1=44.5 +lat_2=52 +lat_0=48.4 +lon_0=31.5 +x_0=0 +y_0=0 +ellps=GRS80 +units=m'

# Detail levels, in meters of Visvalingam simplification interval.
#   700  print / large display    1400  screen default    2800  size-critical
LEVELS="${UKRMAP_LEVELS:-700 1400 2800}"

mkdir -p "$CACHE"

fetch() {  # $1 = basename, $2 = naturalearth category
  if [ ! -f "$CACHE/$1.shp" ]; then
    echo "fetching $1"
    curl -sSL --max-time 300 -o "$CACHE/$1.zip" \
      "https://naciscdn.org/naturalearth/10m/$2/$1.zip"
    unzip -oq "$CACHE/$1.zip" -d "$CACHE"
  fi
}
fetch ne_10m_admin_1_states_provinces cultural
fetch ne_10m_lakes                    physical
fetch ne_10m_rivers_lake_centerlines  physical
fetch ne_10m_coastline                physical

# ---------------------------------------------------------------------------
# 1. Coastal lagoons — these come OUT of the land.
#
# The Syvash is connected to the Sea of Azov through the Henichesk Strait, so
# cartographically it is coastline, not an inland lake. Erasing it is what
# restores the real shape between Kherson and Crimea: the Perekop neck on the
# west and the Arabat Spit on the east, with the lagoon between them. The
# Dniester Liman near Odesa is the same kind of feature.
# ---------------------------------------------------------------------------
$MS "$CACHE/ne_10m_lakes.shp" \
  -filter 'name === "Syvash" ||
           (this.bounds[0] > 30.0 && this.bounds[2] < 30.6 &&
            this.bounds[1] > 46.0 && this.bounds[3] < 46.5)' \
  -o "$CACHE/lagoons.json" format=geojson precision=0.0001

# ---------------------------------------------------------------------------
# 2. Inland water — these stay IN the land and are drawn on top as a layer.
#
# The Dnipro reservoirs at their pre-June-2023 extent, which is what Natural
# Earth carries. Kakhovka has since been drained by the destruction of the dam;
# no surveyed replacement geometry exists, so this is knowingly historical and
# labeled as such in the data and the docs.
# ---------------------------------------------------------------------------
$MS "$CACHE/ne_10m_lakes.shp" \
  -filter 'this.bounds[0] > 21 && this.bounds[2] < 41.5 &&
           this.bounds[1] > 43.5 && this.bounds[3] < 53 &&
           name !== "Syvash" &&
           !(this.bounds[0] > 30.0 && this.bounds[2] < 30.6 &&
             this.bounds[1] > 46.0 && this.bounds[3] < 46.5)' \
  -each '
    // Natural Earth leaves two of the Dnipro cascade unnamed, which would
    // punch holes in the river. Identified by bounds and verified against
    // their position in the chain; anything else keeps a generic label.
    nm = name
      || (this.bounds[0] > 31.4 && this.bounds[2] < 31.7 &&
          this.bounds[1] > 49.7 && this.bounds[3] < 50.1 ? "Kaniv Reservoir" : null)
      || (this.bounds[0] > 33.4 && this.bounds[2] < 34.7 &&
          this.bounds[1] > 48.4 && this.bounds[3] < 49.1 ? "Kamianske Reservoir" : null)
      || "Reservoir";
  ' \
  -o "$CACHE/reservoirs_ll.json" format=geojson precision=0.0001

# ---------------------------------------------------------------------------
# 3. Administrative units, 27 of them, keyed by ISO 3166-2.
#
# Kyiv City (UA-30) and Sevastopol (UA-40) stay SEPARATE here. pack.js unions
# them into their parent oblast for the default 25-region set simply by
# concatenating path data under fill-rule:nonzero, so both variants exist at
# no extra cost in the shipped file.
#
# Crimea (UA-43) and Sevastopol (UA-40) are Ukrainian. Natural Earth assigns
# them to RUS under a de-facto-control convention, so they are selected here by
# their own ISO 3166-2 codes rather than by adm0_a3, which restores them to
# Ukraine's 27 administrative units.
# ---------------------------------------------------------------------------
UNITS_FILTER='adm0_a3 === "UKR" || iso_3166_2 === "UA-43" || iso_3166_2 === "UA-40"'

$MS "$CACHE/ne_10m_admin_1_states_provinces.shp" \
  -filter "$UNITS_FILTER" \
  -each 'key = iso_3166_2' \
  -dissolve2 key \
  -o "$CACHE/units_ll.json" format=geojson precision=0.0001

# National outline, for clipping the rivers to the country
$MS "$CACHE/units_ll.json" -dissolve2 -o "$CACHE/country_ll.json" format=geojson precision=0.0001

# ---------------------------------------------------------------------------
# 4. Rivers, clipped to Ukraine.
#
# Filtering by feature bounds would drop the Dnipro entirely (it runs on into
# Belarus and Russia, so its bounding box leaves the country), hence -clip.
# ---------------------------------------------------------------------------
# featurecla "Lake Centerline" is Natural Earth's axis THROUGH a reservoir, and
# every reservoir it runs through is already drawn as a filled shape from the
# lakes layer — "the river as a thread, its reservoirs as shapes" is the whole
# rule here, and a centerline is the same water twice. Harmless while it stayed
# inside its own polygon; not harmless once anything reached for its endpoint,
# which is how the Kakhovka axis ended up being extended across dry land to the
# Dnipro estuary and reading as a canal that does not exist.
$MS "$CACHE/ne_10m_rivers_lake_centerlines.shp" \
  -clip "$CACHE/country_ll.json" \
  -filter 'featurecla !== "Lake Centerline" &&
           (name === "Dnipro" || name === "Dniester" || name === "Southern Bug" ||
            name === "Donets" || name === "Pripyat" || name === "Prut" ||
            name === "Seym" || name === "Mukhavyets")' \
  -each 'nm = name' \
  -o "$CACHE/rivers_ll.json" format=geojson precision=0.0001

# ---------------------------------------------------------------------------
# 4b. Coastline, for telling sea from land frontier.
#
# The national outline falls out of the topology, but nothing in admin-1 says
# which parts of it are coast. pack.js decides that by distance: an outline arc
# lying on the Black Sea or Azov shore is within a few hundred meters of this
# layer, a land frontier is hundreds of kilometers away. Clipped to a box well
# outside Ukraine so the box edges cannot be mistaken for shore.
# ---------------------------------------------------------------------------
$MS "$CACHE/ne_10m_coastline.shp" \
  -clip bbox=20,42,43,54 \
  -o "$CACHE/coastline_ll.json" format=geojson precision=0.0001

# ---------------------------------------------------------------------------
# 5. Per level: erase lagoons, project, simplify, emit TopoJSON.
#
# TopoJSON is deliberate. Neighboring units share one arc, so (a) the payload
# is roughly half of what separate rings cost, (b) internal borders and the
# national outline fall out of arc usage counts instead of being shipped again,
# and (c) a shared boundary is physically one list of coordinates, so no
# rounding can ever drift two neighbors apart. Simplification runs on the
# topology, so shared arcs are simplified once for both sides.
# ---------------------------------------------------------------------------
for IV in $LEVELS; do
  echo "--- level ${IV} m"
  $MS "$CACHE/units_ll.json" \
    -erase source="$CACHE/lagoons.json" \
    -proj "$PROJ" \
    -simplify interval="$IV" keep-shapes \
    -clean \
    -o "$CACHE/units-$IV.json" format=topojson quantization=1e5

  # water in the same projection and simplified consistently, so it registers
  $MS "$CACHE/reservoirs_ll.json" \
    -proj "$PROJ" -simplify interval="$IV" keep-shapes \
    -o "$CACHE/reservoirs-$IV.json" format=geojson precision=1

  $MS "$CACHE/rivers_ll.json" \
    -proj "$PROJ" -simplify interval="$IV" keep-shapes \
    -o "$CACHE/rivers-$IV.json" format=geojson precision=1

  # Same geometry back in lon/lat, for anyone who wants to apply their own
  # projection (d3 and friends). Simplification still happens in the projected
  # space, where a meter is a meter, and only then is it unprojected.
  $MS "$CACHE/units_ll.json" \
    -erase source="$CACHE/lagoons.json" \
    -proj "$PROJ" \
    -simplify interval="$IV" keep-shapes \
    -clean \
    -proj wgs84 \
    -o "$CACHE/units-$IV-wgs84.json" format=geojson precision=0.00001

  # Distance references only, so not simplified. The erased lagoons count as
  # coast too: the Syvash shore is a water's edge, but it is a lagoon, so the
  # open-sea coastline layer does not cover it.
  $MS "$CACHE/coastline_ll.json" \
    -proj "$PROJ" \
    -o "$CACHE/coastline-$IV.json" format=geojson precision=10

  $MS "$CACHE/lagoons.json" \
    -proj "$PROJ" \
    -o "$CACHE/lagoons-$IV.json" format=geojson precision=10
done

echo
echo "cache ready:"
ls -1 "$CACHE"/units-*.json "$CACHE"/rivers-*.json "$CACHE"/reservoirs-*.json "$CACHE"/coastline-*.json
