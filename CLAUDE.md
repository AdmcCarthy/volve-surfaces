# Volve Surfaces: working rules

Browser viewer of the Volve geophysical interpretations (horizons, faults, wells) as smoothed, shaded contour maps in D3.
Owner: Adam McCarthy. Plan: docs/plan.md.

- Follow SubScout's styleguide and tokens (github.com/AdmcCarthy/SubScout) and Relief's palette and smoothing (github.com/AdmcCarthy/Relief). No raw hex in pages: use tokens.
- Volve terms: attribute Equinor and the former licence partners, link the terms, never sell, never imply endorsement, never present data misleadingly. Every map shows a "Generalised for display" badge with smoothing parameters and deviation.
- CRS of source: ED50 / UTM 31N (EPSG:23031). Horizon rows: IL, XL, UTMX, UTMY, Z.
- Ship quantised grids; contour in the browser (d3-contour). Plain ES modules + CSS, D3 pinned from cdnjs, no Node build.
- Python >= 3.12 via uv. `uv run pytest`, `uv run ruff check . && uv run ruff format .`. data/raw is git-ignored.
- British English, metric, sentence-case headings. Interpreted values carry confidence labels (Observed / Derived / Interpreted).
- Site (site/): plain ES modules, d3 7.9.0 from cdnjs. `css/subscout/` is copied unchanged from SubScout (see NOTICE.md); colours are read from its `--ss-data-seq-*` / `--ss-data-div-*` tokens at draw time. No raw hex in our own files (tests enforce it). `scripts/stage.py` builds `_site/` (site + data/real + data/synthetic); the Pages workflow runs the same script.
- Stepped fill = stacked d3-contour polygons on canvas; linear fill = per-pixel bilinear sample through a Lab ramp. Smoothing is a NaN-aware Gaussian (grid.js); every map states sigma and mean/largest change from the source.
- Editorial decisions (2026-11-08): **Fjord** is the chosen ramp. Detail levels are Raw, Light, Fine, Medium only (no Gaussian blur beyond about 50 m: broad smoothing was rejected as useless). Smoothing is edge-preserving (Perona-Malik, keeps fault steps); Light and above draw contours on a bicubic grid 2x denser. Class **step** (10, 20, 50, 100, or auto) plus adjustable **min and max**, not a class count. Contour intervals 10, 20, 50 (every fifth heavier). Shading light is placed across the measured fault trend (docs/fault-trend.md), fixed north-west as an option.
