"""Build the location-map context: land and field outlines around the map frame, with the frame's corners as lon/lat.

    uv run python scripts/context.py <Wildcat data dir>

Land and field outlines come from the Wildcat repo's North Sea layers (Sodir FactMaps, NLOD 2.0). They are used only for
the small location map, never for analysis. The frame is shared by the real and synthetic grids; the synthetic data
carries no real location, so only the real map shows the locator.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import synthetic as syn
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "context" / "north_sea.json"
WINDOW = (
    -1.5,
    57.2,
    7.0,
    60.2,
)  # lon/lat window of the location map (west, south, east, north)


def _round(c, nd=3):
    return (
        [round(v, nd) for v in c]
        if isinstance(c[0], (int, float))
        else [_round(x, nd) for x in c]
    )


def _keep(geom) -> bool:
    w, s, e, n = WINDOW
    pts = []

    def walk(c):
        if isinstance(c[0], (int, float)):
            pts.append(c)
        else:
            for x in c:
                walk(x)

    walk(geom["coordinates"])
    return any(w - 1 <= x <= e + 1 and s - 1 <= y <= n + 1 for x, y in pts)


def build(wildcat_data: Path) -> dict:
    land = json.loads((wildcat_data / "land_ns.geojson").read_text(encoding="utf-8"))
    fields = json.loads(
        (wildcat_data / "fields_ns.geojson").read_text(encoding="utf-8")
    )
    t = Transformer.from_crs(
        "EPSG:25831", "EPSG:4326", always_xy=True
    )  # ETRS89 and WGS 84 agree to about a metre
    x0, y0, x1, y1 = syn.X0, syn.Y0 - syn.NY * 25.0, syn.X0 + syn.NX * 25.0, syn.Y0
    corners = [t.transform(x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    return {
        "window": WINDOW,
        "extent": [_round(c, 4) for c in corners],
        "land": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        **f["geometry"],
                        "coordinates": _round(f["geometry"]["coordinates"]),
                    },
                }
                for f in land["features"]
            ],
        },
        "fields": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": f["properties"]["name"]},
                    "geometry": {
                        **f["geometry"],
                        "coordinates": _round(f["geometry"]["coordinates"]),
                    },
                }
                for f in fields["features"]
                if _keep(f["geometry"])
            ],
        },
        "attribution": "Land and field outlines: Sodir (Norwegian Offshore Directorate) FactMaps, NLOD 2.0.",
    }


if __name__ == "__main__":
    rec = build(Path(sys.argv[1]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rec, separators=(",", ":")), encoding="utf-8")
    print(
        f"{OUT} {OUT.stat().st_size / 1000:.0f} kB, {len(rec['fields']['features'])} fields, extent {rec['extent'][0]} to {rec['extent'][2]}"
    )
