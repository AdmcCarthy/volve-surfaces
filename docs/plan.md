# Plan

Goal: a modern, browser-based viewer of the Volve geophysical interpretations as **shaded contour maps** (D3), with
**linear-gradient** and **stepped-class** colour fills. Visual quality and speed come first: contours are deliberately
smoothed and generalised, and the map says so.

## 1. Licence findings (Volve HRS and Terms and Conditions)

Source: `HRS and Terms and conditions for license to data - Volve.pdf` (Equinor and the former Volve licence partners,
ExxonMobil and Bayerngas). Based on CC BY 4.0, with two changes.

| Term | Consequence for this repo |
|---|---|
| Commercial and non-commercial use, adapted material allowed (3.1) | A public repo and web viewer are fine. |
| **Sharing allowed** if Equinor and the former licence partners are attributed and the T&Cs are linked (3.3) | Derived grids may be committed. Attribution and a T&C link go in the README, the footer of every page and every export. |
| **May not be sold** (1, 3.2) | Repo code is MIT, but the data notice says the Volve-derived data is not for sale. |
| Adapted material must not be shared under a licence that stops recipients meeting these terms (3.3) | Derived data folder gets its own `DATA-LICENCE.md`; MIT applies to code only. |
| **Must not be presented in a misleading, distorted or incorrect manner** (3.2) | Our smoothing is a visible, declared generalisation. A "Generalised for display" badge sits on every map, with the smoothing radius and the maximum deviation from the source in metres. The raw-detail toggle stays available. |
| No endorsement; no use of Equinor or partner names or marks to promote (4) | Not Equinor-branded. Name it as a viewer of a public dataset, not an Equinor product. |
| Provided as-is, no liability (5) | Disclaimer in README and footer. |
| Sui generis database rights (3.5) | A database containing a substantial portion of the data is itself Adapted Material; covered by the same notice. |

(The zip's own `license.txt` says "CC BY NC SA", which contradicts the PDF, whose summary and clauses allow commercial
use. The PDF is the fuller legal text. We follow the stricter reading of both where cheap: attribution, link,
no resale, ShareAlike-style notice. Worth a one-line check with Equinor if the repo ever becomes commercial.)

Attribution line, to use everywhere:
> Contains data from the Volve data village, © Equinor ASA and the former Volve licence partners (ExxonMobil E&P Norway, Bayerngas Norge). Used under the Volve Terms and Conditions: [link to be verified: the PDF gives no URL]. Generalised for display.

## 2. The dataset (Volve_Geophysical_Interpretations.zip, 104 MB zipped, 406 MB raw, 56 files)

- **Horizons, TWT** (ms): Official (BCU, Shetland Gp, Ty, Hugin Top and Base), Other (Balder, Hod, Utsira Top and Base,
  Near Seabed, Shetland, Ty), Timelapse (8 intra-Hugin and base-Hugin horizons, small files), Multiples (4).
- **Horizons, DEPTH** (m): Official (the same five) and Other (Seabed). Depth is the primary map; TWT is a second domain.
- Row format (comma delimited, `#` comment header): `IL, XL, UTMX, UTMY, Z`. Seismic survey ST10010 and ST0202 share a
  related grid: `XL(ST10010) = XL(ST0202)`, `IL(ST10010) = 2 x IL(ST0202) - 1`. About 184k nodes per horizon.
- CRS: **ED50 / UTM zone 31N, EPSG:23031** (header says `ST_ED50_UTM31N_P23031_T1133`). The README says only "UTM 31N";
  the header settles the datum. Reproject to ETRS89 / UTM 31N (EPSG:25831) or WGS84 for display and to line up with Sodir
  data. Datum shift is ED50 to ETRS89 (about 100 m; use the Norwegian grid transform, test the choice).
- **Faults**: fixed-width fault sticks (x, y, TWT, stick position 1/2/3, name). **Fault polygons**: Top and Base Hugin
  (78 and 71 polygons). **Wells**: picks (with repeat observations) and perforations.
- Not needed now: seismic cubes, well logs, production, WITSML (kept for later linking to the `ep_geoscience_analytics` work).

Data checks to run first (cheap, before any design): node count, regularity of the IL/XL grid, holes and null values
(look for 99999 or -999 sentinels), Z range per horizon, whether faults offset surfaces (they will, so contours must
not smooth across them blindly).

## 3. Product

Single static site, GitHub Pages, no Node build (matches SubScout: plain ES modules + CSS, D3 pinned from cdnjs).

- **Map**: one horizon at a time, pan and zoom, d3-geo identity projection on pre-projected metres (as in Relief).
- **Fill modes** (toggle): *Linear* (continuous gradient) and *Stepped* (classes with a legend that draws each class at
  equal width, as in Relief).
- **Contours**: optional lines, index contour every 5th, labels along lines (d3 + halo). Stacked polygons, so no slivers.
- **Overlays**: fault sticks and Hugin fault polygons, well picks and perforations, with leader-line labels.
- **Smoothing control**: a "Detail" slider from raw to generalised (live), default generalised. Always shows the
  deviation badge (section 1).
- **Compare**: horizon A vs B, and thickness (isochore) between two depth horizons, using a diverging cobalt to ochre scale.
- **Light and dark** themes via SubScout tokens (`data-colour-scheme`).
- **Honesty strip** per map: title, units (m TVDSS or ms TWT; confirm the depth datum from the headers), source with date,
  confidence level (**Interpreted**), classification (linear or class breaks), generalisation parameters.

## 4. Architecture decision: client-side contouring

Ship each horizon as a small **quantised grid**, not pre-made polygons.

- Python build: read the .dat, resample onto a regular grid in IL/XL index space (nodes already near-regular, so cheap),
  mask holes, write `data/out/<horizon>.bin` (Int16 or Uint16 with offset and scale) + `manifest.json` (extent, cell size,
  CRS, z range, source file, checksum). About 100 to 250 kB each at display resolution.
- Browser: `d3-contour` on the grid, with a Gaussian blur (separable) for the Detail slider, then optional
  `d3.geoPath` line smoothing with `curveCatmullRomClosed` or Chaikin. Class breaks and gradient stops are free to change live.
- Why not pre-built GeoJSON like Relief: the Detail slider, break editing and compare mode all need live contouring, and the
  grids are tiny. Pre-built polygons stay available as a fallback LOD output if mobile perf demands it.
- Faults: build step also writes a **fault mask** so contouring does not smooth across fault throws. Start with simple
  masking (nodes within N cells of a fault stick are down-weighted in the blur), flag it as a known limit.

Performance budgets (to be tested, as in Relief): first paint under 1 s on 4G for the Official set; grid under 300 kB per
horizon; redraw under 50 ms during slider drag on Canvas (SVG for the final view and export).

## 5. Style (inherit, do not reinvent)

From **SubScout** (`styleguide/`, `src/subscout/tokens/colour.toml`) and **Relief** (`preview/palette.js`):

- Tokens, not hex: `--ss-*` aliases; hues fjord, shale, slate, cobalt, highlights malachite, ochre, haematite; Tide palette,
  Ledger type, Nordic cool room (shale-white by day, deep blue-grey by night, never black). Reuse `tokens.css/json` by
  copying the generated runtime files (pinned, with credit to the Equinor Design System method as SubScout does).
- Sequential ramp for depth (fjord/cobalt-based, shallow light to deep dark, like Relief's sea ramp), diverging cobalt ↔ ochre
  for differences, never red ↔ green; colour-vision-deficiency and APCA tests as in SubScout.
- Relief's Detuned idea: quiet fills so faults and wells on top read clearly; stepped breaks drawn at equal-width legend cells.
- Maps rules from `styleguide/maps.md`: declare the classification; value-by-confidence where evidence is sparse (e.g. fade
  extrapolated areas beyond the picked nodes).
- British English, metric, sentence-case headings. `prefers-reduced-motion` honoured; keyed joins for transitions.
- Smoothing methods already proven in Relief (`scripts/smooth.py`): Gaussian pre-blur 1 cell + topology-preserving
  Douglas-Peucker + Chaikin x2. Port the idea to JS for the browser; keep the Python version for build-time QA of deviation.
- **To confirm in the next pass:** SubScout's `runtime/js` (chart/map components, theme switch) and `export` page pattern, so
  the viewer can later become a SubScout figure type. Not yet read in detail.

## 6. Repo layout

```
volve-surfaces/
  README.md  CLAUDE.md  LICENSE (MIT, code)  DATA-LICENCE.md (Volve terms + attribution)
  pyproject.toml (uv, Python >= 3.12: numpy, scipy, pyproj, pandas, contourpy, pytest, ruff)
  docs/        plan.md  sources.md  generalisation.md
  scripts/     inventory.py  build.py  build_faults.py  qa_deviation.py
  data/raw/    (git-ignored; zip extracted here)
  data/out/    grids + manifest + faults/wells GeoJSON (committed, small)
  site/        index.html  js/{map,contours,smooth,palette,legend,overlays}.js  css/  (GitHub Pages)
  tests/       parsing, CRS, grid, deviation bound, size budgets, number-in-prose
```

## 7. Roadmap

1. **Inventory** (`scripts/inventory.py`): parse every file, report counts, extents, nulls, Z ranges. Gate for everything else.
2. **Grid build** for the 5 official depth horizons; CRS check against well picks (picks should sit on the surface within
   interpretation tolerance, a free validation).
3. **Viewer v0**: one horizon, linear and stepped fills, legend, pan and zoom, theme.
4. **Smoothing + honesty**: Detail slider, deviation badge, tests that bound deviation.
5. **Overlays**: faults, fault polygons, wells.
6. **More horizons**: TWT, Other, Timelapse; horizon picker; compare and isochore.
7. **Polish**: export (PNG/SVG), mobile layout, readability and snapshot checks, publish on GitHub Pages.

## 8. Open decisions (for the owner)

- Repo name and whether to build as a standalone app or as a SubScout figure type from day one.
- Depth datum and sign convention (m TVDSS, positive down?): to be read from headers/READMEs; not stated in the zip's README.
- Whether to commit derived grids (allowed with attribution; about 1 to 2 MB for the official set) or build from a user-supplied zip.
- Seabed (36 MB) and the 15 TWT surfaces are large; ship at coarser grids or leave to a later release.
