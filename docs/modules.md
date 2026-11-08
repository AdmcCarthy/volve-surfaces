# Modules

How this repo fits with SubScout, Relief, Wildcat and the other mapping repos, so that a surface, a wellbore symbol or a fault line each have one owner and can be used
without the others. Written 2026-11-08, after reviewing the Sodir Geostandard ([geostandard.md](geostandard.md)).

## Decisions (2026-11-08)

1. **Well symbols live in SubScout.** SubScout is the style authority, every mapping repo already vendors from it, and this repo already copies its tokens.
2. **One canonical coordinate system: ETRS89 / UTM zone 31N (EPSG:25831).** Everything is converted at the edge, by adapters. No layer ever receives ED50.
3. **Ownership: this repo is the home of contour-based subsurface interpretation display** (surfaces, faults and barriers, contact lines and fills, and their line styles). SubScout owns tokens, the style guide and point symbols (wells, installations). (2026-11-08)
4. **The Sodir Geostandard (v22.00) is the authority for map-type names, title-box metadata, symbols and standard colours.** SubScout's style guide decides what the standard is silent on;
   conflicts are listed in [geostandard.md](geostandard.md) section 7. Fjord stays the default ramp; the standard's own scales are selectable alternatives.

## The modules

| Module | Owns | Never knows about | Lives in |
|---|---|---|---|
| **Tokens and style** | colour, type, spacing, motion, the data ramps, the style guide | any data, any renderer | SubScout (exists) |
| **Symbols** | the symbol vocabulary (Geostandard 3.4, 1.3): classification, shapes, sizes, legend entries; `classify()` and `draw()` | surfaces, files, CRS conversion, d3-contour | **SubScout**, new: `symbols.toml` + `runtime/js/symbols.js` |
| **Surface layer** | grid to contours, stepped and linear fill, shading, edge-preserving smoothing, fault-trend lighting, surface legend, readout | wells, faults, Volve | this repo, `site/js/surface/` |
| **Vector overlays** | styled lines and polygons: faults, licence outlines, boundaries, contact lines | what the features mean, where they came from | this repo first, `site/js/layers/`; Relief already has a vector page |
| **Well layer** | placing well symbols and trajectories from normalised well records, labels, leader lines | surfaces; how symbols are drawn (asks Symbols) | this repo first, `site/js/layers/` |
| **Adapters** | one per source: parse, validate, convert CRS and vocabulary, write normalised records | drawing | `scripts/adapters/<source>/`: `volve`, `sodir` |
| **Host** | composes layers on one view, owns theme, controls, title box, scale bar, location map, URL state | how any layer draws | viewer here; SubScout stories elsewhere |

Dependency direction: **host → layers → symbols and tokens**, and **adapters → files**. Layers never import each other. Adapters never import drawing code. A symbol never imports d3-contour,
a grid or a CRS library. This is what lets Wildcat or Tulip use well symbols without pulling in surfaces, and this viewer use a surface without wells.

## The layer contract

Every layer is a small object. The host builds one **view** and hands it to every layer; no layer computes its own transform.

```js
// view: one transform for all layers
{ crs: "EPSG:25831", bounds: [xmin, ymin, xmax, ymax],   // metres
  width, height, dpr, scheme: "light" | "dark",
  project: (x, y) => [px, py] }                           // metres to device pixels, north up

// layer
{ id, kind,                    // "surface" | "wells" | "faults" | "installations" | "basemap"
  crs: "EPSG:25831",           // asserted, and checked by the host
  bounds(),                    // extent in metres
  draw(ctx, view),             // Canvas; layers that need SVG expose drawSvg(svg, view)
  legend(),                    // data only: [{ symbol, label, group }]; the host renders it
  facts(),                     // title-box rows: [{ label, value }], labels exactly as in the Geostandard
  probe(x, y) }                // what is under a point, or null
```

Symbols are exposed as d3-compatible symbol types, `{ draw(context, size) }`, so the same symbol draws on Canvas and SVG at any size and picks up tokens.

### Normalised records (what adapters write and layers read)

```
well         { ref: { country, quadrant, block, type, number, history, wellhistory, track },  // Geostandard 3.2, parsed
               name, x, y,                                    // surface location, EPSG:25831
               class: "exploration" | "development" | "injector" | "non-hydrocarbon" | "shallow",
               purpose, status, content: ["OIL","GAS",...],   // Sodir vocabulary, already mapped
               function: { kind, codes },                     // Geostandard 3.4.4
               planned: bool,
               track: [{ x, y, tvdss, md }] | null,           // EPSG:25831, tvdss positive down in metres
               trackKind: "actual" | "approximate" | "planned",
               picks: [{ surface, md, tvdss }] | null,
               source, licence }
fault        { id, name, geometry,                            // LineString or Polygon, EPSG:25831
               type: "normal" | "reverse" | "strike-slip" | "unknown",
               certainty: "certain" | "uncertain",
               horizon, domain: "depth" | "twt", source }
installation { id, type, planned: bool, x, y, source }        // type from Geostandard 3.5
surface      { the existing grid manifest, crs EPSG:25831 }
```

Every record carries `source` and `licence` so a host can assemble the attribution line. Unknown stays `unknown`; an adapter never guesses a fault's downthrown side or a well's fluid.

## Coordinates

Canonical is **EPSG:25831**. Measured here with pyproj 3.8 (offline, all grids present):

- Volve horizons are **ED50 / UTM 31N (EPSG:23031)**. The best available transformation, *ED50 to WGS 84 (24)* with ETRS89 as WGS 84, has a stated accuracy of **2 m** and moves a Volve point by about
  **-90 m east and -215 m north (about 233 m)**. Earlier notes in this repo said "about 100 m"; that was wrong. Ignoring it would put wells a quarter of a kilometre from the fault that should be next to them.
- **Sodir wellbore coordinates are ED50 geographic (EPSG:4230)** (Wildcat stays in ED50 on purpose, to keep Sodir's block rectangles exact). Wells from Sodir need the same conversion.
- Surfaces are built from scattered picks, so the conversion is applied to each pick **before** gridding: the grid frame is a north-up ETRS89 frame and nothing is resampled twice.
  `data/out` and `data/synthetic` manifests say `crs: EPSG:25831`; the real one also records `source_crs`, the transformation and its accuracy. The synthetic set uses the same frame.
- Convert only through `scripts/crs.py`. pyproj's default reverse transform (25831 to 23031) picks a coarser operation and lands about 90 m from the inverse of the one used here; a test guards this.
- A layer that is handed another CRS is an error, not a silent reprojection.

## Where things go (as built 2026-11-08)

```
site/js/
  surface/      grid.js  render.js (drawSurface, prepareGrid, surfaceBounds, probeSurface)  trend.js  describe.js  fill.js     the surface module: no layers, no host
  layers/       contract.js  surface.js  faults.js  contacts.js    layers meeting the contract; they never import each other or the host
  host/         viewer.js  review.js  view.js  ui.js        compose layers on one view; theme, controls, legend, facts rendering
  style/        ramps.js                                    reads SubScout tokens at draw time
  vendor/subscout/   symbols.js  symbols-data.js  symbols.json  NOTICE.md     copied unchanged, with the source commit
scripts/
  adapters/volve/    horizons.py  wells.py  faults.py  contacts.py     parse a source, convert ED50 -> ETRS89 (scripts/crs.py), write records
  crs.py  build.py  synthetic.py  check_datum.py  inventory.py  smoke.py  stage.py
```

`tests/test_site.py` checks the dependency direction; `scripts/smoke.py` runs the shared layer contract in a browser (every layer: crs
asserted, bounds, draw into a shared view, legend, facts, probe; an empty layer; a layer in ED50 is refused).

### What SubScout gets

Opened as [SubScout PR #1](https://github.com/AdmcCarthy/SubScout/pull/1) (2026-11-08, v0.6.0), with your go-ahead. What it contains, as built:

- `styleguide/wellbores.md`: the rules (shape first, colour optional, scale-dependent codes, legend always lists the codes in use, planned versus actual).
- `src/subscout/tokens/symbols.toml`: the vocabulary (technical status, hydrocarbon status, function, class, installation type), a shape per symbol as a path in a unit box, default size at each scale
  tier, the Geostandard colour set as an optional preset. Generated into `runtime/js/symbols.js` and `symbols.json`, committed, CI-checked for staleness, exactly as `tokens.css` is.
- Tests: every vocabulary entry has a shape; legend and draw agree; symbols stay legible at the smallest size; light and dark both pass contrast.
- Symbols are **shape-first**, so no meaning depends on colour. The standard's oil-green and gas-red then become an optional, off-by-default colour layer, with a visible note that it is not colour-vision safe.

As built the runtime is `wellSpec(well)` (compose layers from a record), `symbolSvg` and `drawSymbol` (SVG string or Canvas), `legend`, `describe` and `layersFor`, plus `installationSpec`, `classSpec` and `trajectoryDash`. There is no `classify()` in SubScout: translating a source's vocabulary (Sodir purpose, status, content) into the record is the job of the adapter that owns the source, so SubScout carries no source-specific code. Wildcat, Tulip and the rest call `wellSpec` and `drawSymbol`; their own data adapters stay in their repos. The review sheet is `site/symbols/`.

## Rules that keep the modules separate

1. A layer reads **records and a view**; it does not read files or URLs.
2. A layer **asserts its CRS**; the host refuses to compose layers with different ones.
3. Vocabulary is the **Geostandard's** (and the Sodir values already mapped to it). Source vocabularies are translated in the adapter, in a table that is a data file, not code.
4. Facts and legends are **data, not DOM**, so the same layer feeds a web viewer, a SubScout figure and a PNG export.
5. Tokens only. No raw colour in any module (already tested in this repo).
6. Each module has its own tests, and the **contract has a shared test** every layer must pass: asserts its CRS, returns bounds inside the view, draws without throwing on an empty view, has a legend and facts.

## Roadmap

0. **Done (2026-11-08): prerequisites.** Picks are converted to ETRS89 in the build (`scripts/crs.py`) and the grids rebuilt, manifests say EPSG:25831 and record the transformation. The horizon depth datum is verified against the well picks' TVDSS: mean sea level, positive down ([datum-check.md](datum-check.md)).
1. **Done (2026-11-08): refactor.** The layout above, the contract, `host/view.js` (one view, `compose`), and the shared contract test in `scripts/smoke.py`. The pages draw as before.
2. **Done (2026-11-08): faults as a vector layer**, from the Volve sticks (1,356) and fault polygons (78 top, 72 base Hugin), black via `--ss-text`, plain lines because the files carry names only. Normal-fault ticks are implemented and shown on the synthetic faults, whose type and downthrown side are known.
3. **SubScout symbols spec**: open as [SubScout PR #1](https://github.com/AdmcCarthy/SubScout/pull/1): style guide page, `symbols.toml`, generator, runtime, review sheet, tests, CI. Merge, then vendor `symbols.js` and `symbols-data.js` here with a NOTICE and the commit hash.
4. **Wells**: the Volve adapter (well picks, perforations; names parsed per 3.2), the Sodir adapter for status and fluid, the well layer using SubScout symbols; wells over a surface, with the datum check.
5. **Title box, scale bar and location map** as host components, fields exactly per the Geostandard.
6. **Optional `geostandard` ramp and hydrocarbon colour set**; H and L marks; hachured depressions on isochores.
7. **Done (2026-11-08): hydrocarbon contacts** ([contacts.md](contacts.md)): `surface/fill.js` (compute), `layers/contacts.js`, `adapters/volve/contacts.py` from the cited reports (OWC 3,120 base model and the plan's probability distribution; the superseded 1993 case, flagged contradicted), the viewer control and eight cards on the options page. The segment barrier and model outline are digitised from the plan's Figure 4.1 (about 250 m). Open questions are at the end of that note.

## Open decisions

- Where does the fault type and downthrown side come from for Volve? The sticks and polygons have names only. Candidates: derive it from the surfaces (throw direction), take it from the Volve reports, or leave it unknown.
- Should the Sodir adapter be shared with Wildcat's `fetch_sodir.py` (one place, two consumers), or stay separate for now?
- Standard terminology in Norwegian as an option, or English only?

## Map furniture (2026-11-08)

| Part | Where | Notes |
|---|---|---|
| Scale bar and north arrow | `site/js/host/furniture.js`, called by `compose(..., { furniture: true })` | Round length up to a quarter of the map width, four alternating blocks; on the canvas so exports include it |
| Title box | `site/js/host/titlebox.js` | Geostandard field names (map type, horizon, field, block and licence, area, coverage in UTM format, projection, datums, contour interval, date); inspired by, not bound to, the standard; the method and confidence stay in the fact strip |
| Location map | `drawLocator` in `titlebox.js`; data `data/context/` from `scripts/context.py` | Relief's `north_sea` overview layers (Copernicus DEM, EMODnet Bathymetry) drawn in Relief's own CRS (EPSG:25832, no reprojection in the browser) with Relief's Detuned palette (vendored in `vendor/relief/`); neighbouring fields from Wildcat's Sodir layers (NLOD 2.0) as outlines; the map frame in a strong ring; about 125 kB; real data only |

PNG export: `host/export.js` draws one sheet (title, map with scale bar, title box, location map, colour bar, layer names, method rows, attribution and disclaimer) in the on-screen scheme; the viewer's *Export PNG* button. Layer legends are exported as names only, without swatches.

Not done: a 1:n scale ratio (a screen has none), revision and approval fields, PDF export, export from the options page.
