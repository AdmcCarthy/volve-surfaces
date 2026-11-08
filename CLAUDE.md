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
