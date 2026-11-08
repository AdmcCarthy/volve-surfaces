# Datum check

Horizon depth against well-pick TVDSS, in EPSG:25831. Source ED50 converted with: Inverse of UTM zone 31N + ED50 to WGS 84 (24) + Inverse of ETRS89 to WGS 84 (1) + UTM zone 31N (accuracy 2.0 m).
408 picks with coordinates and TVDSS in 34 wells. Residual = horizon depth minus (-TVDSS), in metres; zero means the horizon is depth below mean sea level, positive down.

| Surface | n | median | MAD | RMS | within 5 m | control: wells unconverted, median |
|---|---|---|---|---|---|---|
| Seabed | 27 | 0.6 | 0.0 | 2.0 | 100% | 0.5 |
| Ty Fm. Top | 25 | 2.6 | 2.4 | 25.7 | 76% | 5.5 |
| SHETLAND GP. Top | 24 | 0.7 | 6.0 | 22.1 | 42% | 8.6 |
| Hugin Fm. VOLVE Top | 28 | -0.1 | 1.2 | 22.8 | 75% | 36.2 |
| Hugin Fm. VOLVE Base | 28 | 0.6 | 3.3 | 37.7 | 54% | 72.3 |

Two-way time, same method (milliseconds):

| Surface | n | median | MAD | RMS |
|---|---|---|---|---|
| Ty Fm. Top | 21 | 8.6 | 5.3 | 23.9 |
| SHETLAND GP. Top | 22 | 12.3 | 9.3 | 21.3 |
| Hugin Fm. VOLVE Top | 28 | 0.6 | 4.8 | 13.9 |
| Hugin Fm. VOLVE Base | 25 | 12.4 | 7.2 | 24.7 |

Largest depth residuals (most are picks on or beside faults, where the pick and the gridded surface can sit on different sides):

| Well | Surface | residual (m) |
|---|---|---|
| NO 15/9-17 | Hugin Fm. VOLVE Base | +103.4 |
| NO 15/9-17 | Hugin Fm. VOLVE Top | +84.3 |
| NO 15/9-17 | Ty Fm. Top | +74.9 |
| NO 15/9-F-11 B | Hugin Fm. VOLVE Base | +71.9 |
| NO 15/9-F-11 B | Hugin Fm. VOLVE Base | +71.9 |
| NO 15/9-F-11 B | Hugin Fm. VOLVE Base | +67.9 |
| NO 15/9-F-11 B | Hugin Fm. VOLVE Base | +67.9 |
| NO 15/9-C-2 H | Ty Fm. Top | +65.5 |
