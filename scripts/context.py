"""Build the location-map context: Relief's North Sea layers, the neighbouring fields, and the map frame, all in Relief's CRS.

    uv run python scripts/context.py <Wildcat data dir> <Relief dir>

The base map is Relief's `north_sea` region at its overview level of detail (a stack of land and sea-floor polygons, 2 km cell,
Copernicus DEM and EMODnet Bathymetry), copied unchanged to data/context/. It is drawn in Relief's own frame (ETRS89 / UTM 32N,
EPSG:25832), so nothing is reprojected in the browser. Field outlines (Sodir, NLOD 2.0) come from the Wildcat repo and are
converted to the same frame here. The locator window and the Volve frame are given in metres in that CRS. The synthetic data
carries no real location, so only the real map shows the locator.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import synthetic as syn
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "context"
CRS = "EPSG:25832"
WIDTH, HEIGHT = (
    540_000.0,
    378_000.0,
)  # window of the location map, metres (aspect 1:0.7)


def _walk(c, f):
    return [f(c)] if isinstance(c[0], (int, float)) else [_walk(x, f) for x in c]


def build(wildcat_data: Path, relief: Path) -> dict:
    t = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    u = Transformer.from_crs(
        "EPSG:25831", CRS, always_xy=True
    )  # ETRS89 to ETRS89: a reprojection only
    region = next(
        r
        for r in json.loads(
            (relief / "regions" / "regions.json").read_text(encoding="utf-8")
        )["regions"]
        if r["id"] == "north_sea"
    )
    rx0, ry0, _rx1, ry1 = region["extent"]
    x0, y0, x1, y1 = syn.X0, syn.Y0 - syn.NY * 25.0, syn.X0 + syn.NX * 25.0, syn.Y0
    extent = [u.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    cx, cy = sum(p[0] for p in extent) / 4, sum(p[1] for p in extent) / 4
    wx0 = max(
        rx0, cx - 0.4 * WIDTH
    )  # the field sits left of centre so the Norwegian coast is in view
    wy0 = min(max(ry0, cy - HEIGHT / 2), ry1 - HEIGHT)
    window = [wx0, wy0, wx0 + WIDTH, wy0 + HEIGHT]
    fields = json.loads(
        (wildcat_data / "fields_ns.geojson").read_text(encoding="utf-8")
    )
    feats = []
    for f in fields["features"]:
        g = {
            **f["geometry"],
            "coordinates": _walk(
                f["geometry"]["coordinates"],
                lambda p: [round(v) for v in t.transform(*p)],
            ),
        }
        pts = []
        _walk(g["coordinates"], pts.append)
        if any(
            window[0] <= x <= window[2] and window[1] <= y <= window[3] for x, y in pts
        ):
            feats.append(
                {
                    "type": "Feature",
                    "properties": {"name": f["properties"]["name"]},
                    "geometry": g,
                }
            )
    shutil.copyfile(
        relief / "data" / "out" / "north_sea" / "overview.geojson",
        OUT / "relief_north_sea_overview.geojson",
    )
    return {
        "crs": CRS,
        "base": "relief_north_sea_overview.geojson",
        "window": [round(v) for v in window],
        "extent": [[round(x), round(y)] for x, y in extent],
        "fields": {"type": "FeatureCollection", "features": feats},
        "attribution": (
            "Base map: Relief (github.com/AdmcCarthy/Relief), Copernicus DEM GLO-90 © DLR e.V. 2010-2014 and © Airbus 2014-2018, "
            "provided under COPERNICUS by the European Union and ESA; EMODnet Bathymetry Consortium (2024), EMODnet Digital Bathymetry (DTM). "
            "Field outlines: Sodir (Norwegian Offshore Directorate), NLOD 2.0."
        ),
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    rec = build(Path(sys.argv[1]), Path(sys.argv[2]))
    (OUT / "north_sea.json").write_text(
        json.dumps(rec, separators=(",", ":")), encoding="utf-8"
    )
    print(f"window {rec['window']}, {len(rec['fields']['features'])} fields")
