"""The 19BT2 test (docs/contacts-structure.md): what separates the water well 15/9-19 BT2 from the Volve high on the top-Hugin surface?

    uv run python scripts/probes/bt2_probe.py

Finds the shallowest pass (the bottleneck path) from the water well to each oil well, with fault gaps as walls and bridged, and
reports the pass depth, where it is, the fault polygons and the digitised barrier near it.
"""

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import structure as st

D = Path(__file__).resolve().parent.parent.parent / "data" / "out"
m = json.loads((D / "manifest.json").read_text(encoding="utf-8"))
z = st.load_grid(D, m, "hugin_top_depth")
ny, nx = z.shape
c = json.loads((D / "contacts.json").read_text(encoding="utf-8"))
f = json.loads((D / "faults.json").read_text(encoding="utf-8"))
x0, y0, cell = m["origin"]["x"], m["origin"]["y"], m["cell"]


def cell_of(xy):
    return int((y0 - xy[1]) / cell) * nx + int((xy[0] - x0) / cell)


def bridged(zz, closing=4):
    """Fault gaps (nodata inside the closed footprint) filled from the nearest valid cell, for connectivity only."""
    valid = np.isfinite(zz)
    closed = ndi.binary_erosion(
        ndi.binary_dilation(valid, iterations=closing),
        iterations=closing,
        border_value=1,
    )
    idx = ndi.distance_transform_edt(
        ~valid, return_distances=False, return_indices=True
    )
    out = zz.copy()
    fill = closed & ~valid
    out[fill] = zz[idx[0][fill], idx[1][fill]]
    return out


wells = {e["well"]: e for e in c["evidence"]}
bt2 = wells["NO 15/9-19 BT2"]
polys = [
    p for p in f["features"] if p["kind"] == "polygon" and p["horizon"] == "hugin_top"
]
print(
    f"19BT2: water from {bt2['top']} m; top Hugin there {z.ravel()[cell_of(bt2['xy'])]:.1f} m"
)


def seg_dist(p, a, b):
    p, a, b = map(np.array, (p, a, b))
    t = np.clip(np.dot(p - a, b - a) / max(np.dot(b - a, b - a), 1e-9), 0, 1)
    return float(np.hypot(*(p - (a + t * (b - a)))))


for label, grid in (("fault gaps as walls", z), ("fault gaps bridged", bridged(z))):
    print(f"-- {label}")
    for wname in ("NO 15/9-19 SR", "NO 15/9-19 A"):
        r = st.bottleneck(grid, cell_of(bt2["xy"]), cell_of(wells[wname]["xy"]))
        if not r:
            print(f"  to {wname}: not connected on the surface")
            continue
        depth, path = r
        pxy = np.array([st.xy_of(m, i) for i in path])
        along = sorted(
            (
                float(min(np.hypot(*(pxy - np.array(v)).T).min() for v in p["xy"])),
                p["id"].split(":")[-1],
                p.get("attrs", {}).get("throw_m"),
                p.get("attrs", {}).get("ratio"),
            )
            for p in polys
        )[:3]
        print(
            f"  path of {len(path)} cells; closest fault polygons to any cell on it (distance m, polygon, throw m, throw/thickness): {[(round(a), b, c, d) for a, b, c, d in along]}"
        )
        px, py = st.xy_of(m, path[int(np.argmax([grid.ravel()[i] for i in path]))])
        near = sorted(
            (
                (
                    min(
                        seg_dist((px, py), a, b)
                        for a, b in zip(p["xy"], p["xy"][1:], strict=False)
                    ),
                    p,
                )
                for p in polys
            ),
            key=lambda t: t[0],
        )[:2]
        bar = [
            min(
                seg_dist((px, py), a, b)
                for a, b in zip(b_["xy"], b_["xy"][1:], strict=False)
            )
            for b_ in c["barriers"]
        ]
        print(
            f"  to {wname}: pass {depth:.1f} m at E {px:.0f} N {py:.0f}; nearest fault polygons {[(round(d), p['id'].split(':')[-1], p.get('attrs', {}).get('throw_m')) for d, p in near]}; digitised barrier {round(min(bar))} m away"
        )

print(
    "-- fault polygons the surface path crosses (cells of the path inside the polygon; the grid is interpolated across heave)"
)
gridb = bridged(z)
for wname in ("NO 15/9-19 SR", "NO 15/9-19 A"):
    depth, path = st.bottleneck(gridb, cell_of(bt2["xy"]), cell_of(wells[wname]["xy"]))
    rows, cols = np.divmod(np.array(path), nx)
    hits = []
    for p in polys:
        pts = np.array([((x - x0) / cell, (y0 - y) / cell) for x, y in p["xy"]])
        inside = st.polygon_mask(pts, ny, nx)[rows, cols]
        if inside.any():
            a = p.get("attrs", {})
            hits.append(
                (
                    p["id"].split(":")[-1],
                    int(inside.sum()),
                    a.get("throw_m"),
                    a.get("ratio"),
                    round(float(gridb.ravel()[np.array(path)][inside].max()), 1),
                )
            )
    print(
        f"  BT2 to {wname}: {len(path)} cells; polygons crossed (id, cells inside, throw m, throw/thickness, deepest cell inside): {hits}"
    )

print(
    "-- with fault polygons treated as walls (a heave area is not a connection): pass depth BT2 to the oil wells"
)


def walled(sel):
    g = gridb.copy()
    for p in polys:
        if sel(p):
            pts = np.array([((x - x0) / cell, (y0 - y) / cell) for x, y in p["xy"]])
            g[st.polygon_mask(pts, ny, nx)] = np.nan
    return g


for name, sel in (
    ("no polygon", lambda p: False),
    ("polygon 68 only", lambda p: p["id"].endswith(":68")),
    (
        "throw over thickness (ratio above 1)",
        lambda p: (p.get("attrs", {}).get("ratio") or 0) > 1,
    ),
    ("every polygon", lambda p: True),
):
    g = walled(sel)
    out = []
    for wname in ("NO 15/9-19 SR", "NO 15/9-19 A"):
        r = st.bottleneck(g, cell_of(bt2["xy"]), cell_of(wells[wname]["xy"]))
        out.append("not connected" if r is None else f"{r[0]:.1f} m")
    print(f"  {name}: SR {out[0]}, A {out[1]}")
