"""Coordinate conversion at the edge of the repo: sources arrive in ED50, everything inside is ETRS89 / UTM 31N.

Canonical CRS is EPSG:25831 (docs/modules.md). Always convert through this module: pyproj's default choice for the reverse direction
(25831 to 23031) picks a coarser operation and lands about 90 m away from the inverse of the one used here. Volve horizons, faults and well picks are ED50 / UTM 31N (EPSG:23031). The shift at Volve is about
-90 m east and -215 m north, so a missed conversion puts a well a quarter of a kilometre from the fault next to it.
"""

from __future__ import annotations

import numpy as np
from pyproj.aoi import AreaOfInterest
from pyproj.transformer import TransformerGroup

CANONICAL = "EPSG:25831"  # ETRS89 / UTM zone 31N
ED50_UTM31 = "EPSG:23031"  # ED50 / UTM zone 31N
VOLVE_AOI = AreaOfInterest(
    2.0, 58.0, 3.0, 59.0
)  # lon/lat box around the field, to choose the transformation for the area


class CrsError(RuntimeError):
    pass


def to_canonical(src: str = ED50_UTM31):
    """Best transformation from `src` to the canonical CRS for the Volve area: (transformer, info).

    Fails if the best operation needs grids that are not installed, rather than silently falling back to a coarser one.
    """
    group = TransformerGroup(src, CANONICAL, area_of_interest=VOLVE_AOI, always_xy=True)
    if not group.best_available or not group.transformers:
        raise CrsError(
            f"best transformation {src} -> {CANONICAL} needs grids that are not available: {[str(o.name) for o in group.unavailable_operations]}"
        )
    t = group.transformers[0]
    return t, {
        "source_crs": src,
        "target_crs": CANONICAL,
        "transformation": t.description,
        "accuracy_m": t.accuracy,
    }


def convert(x, y, src: str = ED50_UTM31):
    """Arrays of x, y in `src` -> arrays in EPSG:25831 (float64), plus the transformation info."""
    t, info = to_canonical(src)
    x2, y2 = t.transform(np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64"))
    return np.asarray(x2), np.asarray(y2), info
