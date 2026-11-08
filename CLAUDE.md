# Volve Surfaces: working rules

Browser viewer of the Volve geophysical interpretations (horizons, faults, wells) as smoothed, shaded contour maps in D3.
Owner: Adam McCarthy. Plan: docs/plan.md.

- Follow SubScout's styleguide and tokens (github.com/AdmcCarthy/SubScout) and Relief's palette and smoothing (github.com/AdmcCarthy/Relief). No raw hex in pages: use tokens.
- Volve terms: attribute Equinor and the former licence partners, link the terms, never sell, never imply endorsement, never present data misleadingly. Every map shows a "Generalised for display" badge with smoothing parameters and deviation.
- CRS of source: ED50 / UTM 31N (EPSG:23031). Horizon rows: IL, XL, UTMX, UTMY, Z.
- Ship quantised grids; contour in the browser (d3-contour). Plain ES modules + CSS, D3 pinned from cdnjs, no Node build.
- Python >= 3.12 via uv. `uv run pytest`, `uv run ruff check . && uv run ruff format .`. data/raw is git-ignored.
- British English, metric, sentence-case headings. Interpreted values carry confidence labels (Observed / Derived / Interpreted).
