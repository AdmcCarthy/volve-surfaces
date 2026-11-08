"""Volve fault sticks and fault polygons -> normalised fault records in ETRS89 / UTM 31N.

    PYTHONPATH=scripts uv run python -m adapters.volve.faults path/to/Volve_Geophysical_Interpretations.zip [out_dir]

Sources (docs/inventory.md): `Faults/Volve_Official_Faults.dat` (fault sticks: X, Y, TWT, position 1/2/3 along the stick, fault name; fixed
width, see the folder README) and `Fault_polygons/2014_Volve_Hugin_{Top,Base}.dat` (heave polygons, X Y TWT). Everything is ED50 / UTM 31N
(EPSG:23031) and is converted through scripts/crs.py. Records follow docs/modules.md: a fault never says more than the data does, so
`type` and `certainty` are "unknown" (the files carry names only; the downthrown side is not given).
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

import numpy as np
from crs import convert

ATTRIBUTION = (
    "Contains data from the Volve data village, © Equinor ASA and the former Volve licence partners "
    "(ExxonMobil E&P Norway, Bayerngas Norge). Used under the Volve Terms and Conditions."
)
HORIZON = {"Top": "hugin_top", "Base": "hugin_base"}
LABEL = {"hugin_top": "top Hugin Fm", "hugin_base": "base Hugin Fm"}


def parse_sticks(raw: str) -> list[dict]:
    """Sticks of three picks (position 1 top to 3 bottom), with the fault each belongs to. Columns by character, per the README."""
    sticks, cur = [], []
    for ln in raw.splitlines():
        if not ln.strip() or ln[0] in "#!":
            continue
        try:
            x, y, twt, pos = (
                float(ln[2:12]),
                float(ln[13:24]),
                float(ln[25:36]),
                ln[51:52],
            )
        except ValueError:
            continue
        if pos == "1" and cur:
            sticks.append(cur)
            cur = []
        cur.append((x, y, twt, ln[52:100].strip()))
    if cur:
        sticks.append(cur)
    return [
        {
            "name": s[0][3],
            "x": [p[0] for p in s],
            "y": [p[1] for p in s],
            "twt": [p[2] for p in s],
        }
        for s in sticks
    ]


def parse_polygons(raw: str) -> list[dict]:
    """Polygons of the 'New Mapping Polygon Set' format.

    A `Mapping Polygon ... <n>` line, a line `0 TIME <points> EXCLUSIVE FAULT`, then that many `X Y TWT` rows.
    The count is checked against the rows read.
    """
    polys, cur = [], None
    for ln in raw.splitlines():
        if ln.startswith("Mapping Polygon"):
            m = re.search(r"(\d+)\s*$", ln)
            cur = {
                "n": int(m.group(1)) if m else len(polys) + 1,
                "x": [],
                "y": [],
                "twt": [],
                "declared": None,
            }
            polys.append(cur)
        elif cur is not None and ln.strip() and ln[0] not in "!#":
            parts = ln.split()
            if len(parts) >= 3 and parts[1] == "TIME":
                cur["declared"] = int(parts[2])
                continue
            try:
                x, y, t = float(parts[0]), float(parts[1]), float(parts[2])
            except (ValueError, IndexError):
                continue
            cur["x"].append(x)
            cur["y"].append(y)
            cur["twt"].append(t)
    for p in polys:
        if p["declared"] is not None and p["declared"] != len(p["x"]):
            raise ValueError(
                f"polygon {p['n']}: declares {p['declared']} points, read {len(p['x'])}"
            )
    return [p for p in polys if len(p["x"]) >= 3]


def build(zip_path: str, out_dir: str = "data/out") -> dict:
    with zipfile.ZipFile(zip_path) as zf:
        read = lambda suffix: zf.read(
            next(n for n in zf.namelist() if n.endswith(suffix))
        ).decode("latin-1")
        sticks = parse_sticks(read("Volve_Official_Faults.dat"))
        polys = {
            h: parse_polygons(read(f"2014_Volve_Hugin_{k}.dat"))
            for k, h in HORIZON.items()
        }

    # convert every point in one call (one transformer), then split back
    groups = [*sticks, *[p for plist in polys.values() for p in plist]]
    xs, ys, info = convert(
        np.concatenate([g["x"] for g in groups]),
        np.concatenate([g["y"] for g in groups]),
    )
    at = 0
    for g in groups:
        n = len(g["x"])
        g["x"], g["y"], at = xs[at : at + n], ys[at : at + n], at + n

    feats = []
    for i, s in enumerate(sticks, 1):
        feats.append(
            {"id": f"stick:{s['name']}:{i}", "kind": "stick", "name": s["name"], "type": "unknown", "certainty": "unknown",
             "domain": "twt", "xy": np.round(np.column_stack([s["x"], s["y"]]), 1).tolist(), "twt": s["twt"]}
        )  # fmt: skip
    for h, plist in polys.items():
        for p in plist:
            feats.append(
                {"id": f"polygon:{h}:{p['n']}", "kind": "polygon", "name": f"Fault polygon {p['n']}, {LABEL[h]}", "horizon": h,
                 "type": "unknown", "certainty": "unknown", "domain": "twt", "closed": True,
                 "xy": np.round(np.column_stack([p["x"], p["y"]]), 1).tolist()}
            )  # fmt: skip
    out = {
        "crs": info["target_crs"], "source_crs": info["source_crs"], "transformation": info["transformation"],
        "transformation_accuracy_m": info["accuracy_m"],
        "source": "Geophysical_Interpretations/Faults/Volve_Official_Faults.dat; Fault_polygons/2014_Volve_Hugin_Top.dat, _Base.dat",
        "note": "Names only: fault type, certainty and downthrown side are not in the source files, so they are unknown.",
        "attribution": ATTRIBUTION, "counts": {"sticks": len(sticks), **{f"polygons_{h}": len(v) for h, v in polys.items()}},
        "features": feats,
    }  # fmt: skip
    path = Path(out_dir) / "faults.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {path}: {len(sticks)} sticks, "
        + ", ".join(f"{len(v)} {h} polygons" for h, v in polys.items())
    )
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "data/out")
