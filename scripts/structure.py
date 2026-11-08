"""Structure analysis of the depth grids: highs, saddles and spill points (the merge tree), fault throw, and a bottleneck path.

    uv run python scripts/structure.py            # writes closures.json and fault attributes for data/out and data/synthetic

Closures (docs/contacts-structure.md, steps 1 and 2). The merge tree joins cells from shallow to deep: each time two highs meet, the
deeper one ends at that saddle, its spill point. A high also spills to the outside where its closure reaches the edge of the data, so
a closure that the grid does not close is reported as an edge spill, never as closed.

Fault attributes are measurements: throw, thickness, their ratio, length, strike. They are NOT a fault-seal analysis: any fault, however
small, may hold or pass fluid, and sealing depends on things outside this repo (smear, cementation, pressure, juxtaposition in detail).
The ratio is a juxtaposition indicator only.
"""

from __future__ import annotations

import heapq
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
MIN_RELIEF = 5.0  # metres; a high with less closure relief than this is part of its parent (noise level of the grids)


# ---------------------------------------------------------------- grids
def load_grid(out_dir: Path, manifest: dict, hid: str) -> np.ndarray:
    """A horizon grid in metres or ms (NaN where nodata), row 0 north."""
    h = next(x for x in manifest["horizons"] if x["id"] == hid)
    raw = (
        np.fromfile(out_dir / h["file"], dtype="<u2")
        .reshape(manifest["ny"], manifest["nx"])
        .astype(float)
    )
    return np.where(raw == manifest["nodata"], np.nan, raw * h["scale"] + h["offset"])


def xy_of(manifest: dict, idx: int) -> tuple[float, float]:
    """Cell-centre position of a flat index."""
    r, c = divmod(int(idx), manifest["nx"])
    cell = manifest["cell"]
    return manifest["origin"]["x"] + (c + 0.5) * cell, manifest["origin"]["y"] - (
        r + 0.5
    ) * cell


def edge_cells(z: np.ndarray, closing: int = 4) -> np.ndarray:
    """Valid cells next to the exterior: the data edge, outside the closed footprint (fault gaps narrower than `closing` cells are inside)."""
    valid = np.isfinite(z)
    closed = ndi.binary_erosion(
        ndi.binary_dilation(valid, iterations=closing, border_value=0),
        iterations=closing,
        border_value=1,
    )
    exterior = ~closed
    near = ndi.binary_dilation(
        exterior, structure=ndi.generate_binary_structure(2, 1), border_value=1
    )
    return valid & near


# ---------------------------------------------------------------- the merge tree
def merge_tree(
    z: np.ndarray,
    min_relief: float = MIN_RELIEF,
    closing: int = 4,
    edge_leaks: bool = True,
) -> dict:
    """Highs of a depth grid with their spill points.

    Returns {"highs": [...], "cells": n}. A high: crest (flat index, z), relief (spill - crest), spill {z, idx, kind "saddle"|"edge", to},
    cells (closure size at the spill, for saddle spills). Highs with relief under `min_relief` are dissolved into the high they merge with.
    With `edge_leaks` False the edge of the data is a wall, not a leak (what the surface would say if the footprint were the limit of mapping only).
    A high that never spills (the shallowest of its connected area, with no edge reached) has spill None.
    """
    ny, nx = z.shape
    flat = z.ravel()
    valid = np.isfinite(flat)
    order = np.argsort(np.where(valid, flat, np.inf), kind="stable")[: int(valid.sum())]
    edge = (edge_cells(z, closing) if edge_leaks else np.zeros(z.shape, bool)).ravel()
    parent = np.full(flat.size, -1, np.int64)
    crest = np.full(flat.size, -1, np.int64)
    leak = np.full(flat.size, np.inf)
    leak_at = np.full(flat.size, -1, np.int64)
    count = np.zeros(flat.size, np.int64)

    def find(a: int) -> int:
        r = a
        while parent[r] != r:
            r = parent[r]
        while parent[a] != r:
            parent[a], a = r, parent[a]
        return r

    events = []
    for idx in order:
        parent[idx], crest[idx], count[idx] = idx, idx, 1
        if edge[idx]:
            leak[idx], leak_at[idx] = flat[idx], idx
        r, c = divmod(int(idx), nx)
        for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if not (0 <= rr < ny and 0 <= cc < nx):
                continue
            n = rr * nx + cc
            if parent[n] < 0:
                continue
            a, b = find(idx), find(n)
            if a == b:
                continue
            ka, kb = (flat[crest[a]], a), (flat[crest[b]], b)
            shallow, deep = (a, b) if ka <= kb else (b, a)
            events.append(
                (
                    flat[idx],
                    int(crest[deep]),
                    int(crest[shallow]),
                    int(idx),
                    leak[deep],
                    int(leak_at[deep]),
                    int(count[deep]),
                )
            )
            parent[deep] = shallow
            count[shallow] += count[deep]
            if leak[deep] < leak[shallow]:
                leak[shallow], leak_at[shallow] = leak[deep], leak_at[deep]

    # persistence: a high lives from its crest to the lower of its saddle and its edge leak
    rep: dict[int, int] = {}  # dissolved crest -> the crest it merges into
    kept = []
    for saddle, deep, shallow, sidx, lk, lat, cnt in events:
        spill_z, kind, at = (
            (lk, "edge", lat) if lk < saddle else (saddle, "saddle", sidx)
        )
        if spill_z - flat[deep] < min_relief:
            rep[deep] = shallow
        else:
            kept.append((deep, shallow, spill_z, kind, at, cnt))

    def resolve(c: int) -> int:
        while c in rep:
            c = rep[c]
        return c

    highs = []
    spilled = set()
    for deep, shallow, spill_z, kind, at, cnt in kept:
        spilled.add(deep)
        highs.append(
            {
                "crest": deep,
                "z": float(flat[deep]),
                "relief": float(spill_z - flat[deep]),
                "spill": {
                    "z": float(spill_z),
                    "idx": int(at),
                    "kind": kind,
                    "to": resolve(shallow) if kind == "saddle" else None,
                },
                "cells": cnt if kind == "saddle" else None,
            }
        )
    # highs that never ended: the shallowest of each connected area
    roots = {find(i) for i in order}
    for r in roots:
        c = int(crest[r])
        if c in spilled or c in rep:
            continue
        lk = leak[r]
        highs.append(
            {
                "crest": c,
                "z": float(flat[c]),
                "relief": float(lk - flat[c]) if np.isfinite(lk) else None,
                "spill": {
                    "z": float(lk),
                    "idx": int(leak_at[r]),
                    "kind": "edge",
                    "to": None,
                }
                if np.isfinite(lk)
                else None,
                "cells": None,
            }
        )
    highs.sort(key=lambda h: h["z"])
    return {"highs": highs, "cells": int(valid.sum())}


def _wall(s: dict | None, manifest: dict) -> dict | None:
    if not s:
        return None
    x, y = xy_of(manifest, s["idx"])
    return {"z": round(s["z"], 1), "xy": [round(x, 1), round(y, 1)], "kind": s["kind"]}


def closure_record(
    z: np.ndarray, manifest: dict, min_relief: float = MIN_RELIEF
) -> dict:
    """The merge tree as a JSON record: positions in metres, ids by crest depth order."""
    tree, walled = (
        merge_tree(z, min_relief),
        merge_tree(z, min_relief, edge_leaks=False),
    )
    wall_spill = {h["crest"]: h["spill"] for h in walled["highs"]}
    ids = {h["crest"]: f"H{i + 1}" for i, h in enumerate(tree["highs"])}
    cell2 = manifest["cell"] ** 2 / 1e6
    out = []
    for h in tree["highs"]:
        s = h["spill"]
        sx, sy = xy_of(manifest, s["idx"]) if s else (None, None)
        x, y = xy_of(manifest, h["crest"])
        out.append(
            {
                "id": ids[h["crest"]],
                "crest": [round(x, 1), round(y, 1)],
                "z": round(h["z"], 1),
                "relief": None if h["relief"] is None else round(h["relief"], 1),
                "spill": None
                if not s
                else {
                    "z": round(s["z"], 1),
                    "xy": [round(sx, 1), round(sy, 1)],
                    "kind": s["kind"],
                    "to": ids.get(s["to"]) if s["to"] is not None else None,
                },
                "area_km2": None
                if h["cells"] is None
                else round(h["cells"] * cell2, 2),
                "spill_if_edge_is_wall": _wall(wall_spill.get(h["crest"]), manifest)
                if s and s["kind"] == "edge"
                else None,
            }
        )
    return {"min_relief_m": min_relief, "highs": out}


# ---------------------------------------------------------------- bottleneck path
def bottleneck(z: np.ndarray, a: int, b: int) -> tuple[float, list[int]] | None:
    """The shallowest-pass path between two cells: minimises the deepest cell on the way. Returns (depth of that pass, cells), or None.

    The pass is the saddle that first joins the two places: below that contact depth they are one closure (if nothing else separates them).
    """
    ny, nx = z.shape
    flat = z.ravel()
    best = np.full(flat.size, np.inf)
    prev = np.full(flat.size, -1, np.int64)
    best[a] = flat[a]
    heap = [(flat[a], a)]
    while heap:
        d, i = heapq.heappop(heap)
        if d > best[i]:
            continue
        if i == b:
            path = [i]
            while prev[path[-1]] >= 0:
                path.append(int(prev[path[-1]]))
            return float(d), path[::-1]
        r, c = divmod(i, nx)
        for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= rr < ny and 0 <= cc < nx:
                n = rr * nx + cc
                if np.isfinite(flat[n]) and max(d, flat[n]) < best[n]:
                    best[n], prev[n] = max(d, flat[n]), i
                    heapq.heappush(heap, (best[n], n))
    return None


def polygon_mask(pts: np.ndarray, ny: int, nx: int) -> np.ndarray:
    """Cells whose centre is inside a polygon given in cell units (x right, y down); even-odd ray casting."""
    gx, gy = np.meshgrid(np.arange(nx) + 0.5, np.arange(ny) + 0.5)
    inside = np.zeros((ny, nx), bool)
    x, y = pts[:, 0], pts[:, 1]
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        if y[i] == y[j]:
            continue
        cross = (y[i] > gy) != (y[j] > gy)
        xint = x[i] + (gy - y[i]) * (x[j] - x[i]) / (y[j] - y[i])
        inside ^= cross & (gx < xint)
    return inside


# ---------------------------------------------------------------- fault attributes (measurements, not seal analysis)
def _plane_at(pts: np.ndarray, z: np.ndarray, at: np.ndarray) -> float:
    """Least-squares plane z = a + b*dn + c*da through (dn, da) samples, evaluated at `at`; the median if there are too few samples."""
    if len(z) < 8:
        return float(np.median(z))
    a = np.c_[np.ones(len(z)), pts]
    coef, *_ = np.linalg.lstsq(a, z, rcond=None)
    return float(coef[0] + coef[1:] @ at)


def _ring_throw(
    top: np.ndarray,
    thick: np.ndarray,
    pm: np.ndarray,
    pts: np.ndarray,
    ctr: np.ndarray,
    ax: np.ndarray,
    nrm: np.ndarray,
    width: int = 8,
) -> tuple | None:
    """Throw from a plane fitted to the surface on each side of the polygon and evaluated at the polygon's edge: the regional dip is removed."""
    ring = (
        ndi.binary_dilation(pm, iterations=width)
        & ~ndi.binary_dilation(pm, iterations=1)
        & np.isfinite(top)
    )
    yy, xx = np.nonzero(ring)
    if ring.sum() < 12:
        return None
    rel = np.c_[xx, yy] + 0.5 - ctr
    dn, da = rel @ nrm, rel @ ax
    side = dn > 0
    if side.sum() < 5 or (~side).sum() < 5:
        return None
    zt = top[yy, xx]
    edge = (pts - ctr) @ nrm
    zp = _plane_at(np.c_[dn[side], da[side]], zt[side], np.array([edge.max(), 0.0]))
    zn = _plane_at(np.c_[dn[~side], da[~side]], zt[~side], np.array([edge.min(), 0.0]))
    th = np.nanmedian(thick[yy, xx]) if np.isfinite(thick[yy, xx]).any() else np.nan
    return abs(zp - zn), float(th), int(ring.sum())


def polygon_attrs(
    xy: list, top: np.ndarray, thick: np.ndarray, manifest: dict
) -> dict | None:
    """Throw across a fault polygon (a heave area in the horizon) from the surface either side of it.

    A plane fitted to the surface in a ring either side of the polygon (split by its principal axis) and evaluated at the polygon's edge, so the
    regional dip is removed. An estimate to compare faults with each other, not a throw-profile analysis.
    """
    ny, nx = top.shape
    x0, y0, cell = manifest["origin"]["x"], manifest["origin"]["y"], manifest["cell"]
    pts = np.array([((x - x0) / cell, (y0 - y) / cell) for x, y in xy])
    pm = polygon_mask(pts, ny, nx)
    ctr = pts.mean(0)
    _u, _s, vt = np.linalg.svd(pts - ctr)
    ax = vt[0]
    nrm = np.array([-ax[1], ax[0]])
    res = _ring_throw(top, thick, pm, pts, ctr, ax, nrm)
    if res is None:
        return None
    throw, th, n = res
    proj = (pts - ctr) @ ax
    return {
        "throw_m": round(throw, 1),
        "thickness_m": None if np.isnan(th) else round(th, 1),
        "ratio": None if np.isnan(th) or th <= 0 else round(throw / th, 2),
        "length_m": round(float(proj.max() - proj.min()) * cell),
        "strike_deg": round(float(np.degrees(np.arctan2(ax[0], -ax[1])) % 180), 0),
        "samples": n,
        "method": "plane fitted to the top surface in a ring either side of the polygon, evaluated at its edge",
    }


def trace_attrs(
    xy: list,
    top: np.ndarray,
    thick: np.ndarray,
    manifest: dict,
    near: tuple[float, float] = (100.0, 400.0),
) -> dict | None:
    """Throw across a fault trace (a line): at stations along its middle, a line fitted to the surface 100-400 m either side, extrapolated
    to the trace; the difference of the two, median over stations. The fit removes the regional dip."""
    ny, nx = top.shape
    x0, y0, cell = manifest["origin"]["x"], manifest["origin"]["y"], manifest["cell"]
    p0, p1 = np.array(xy[0], float), np.array(xy[-1], float)
    d = p1 - p0
    length = float(np.hypot(*d))
    u = d / length
    n = np.array([-u[1], u[0]])
    ks = np.arange(near[0], near[1] + 1, cell)

    def at(p):
        c, r = int((p[0] - x0) / cell), int((y0 - p[1]) / cell)
        return (
            (top[r, c], thick[r, c])
            if 0 <= r < ny and 0 <= c < nx
            else (np.nan, np.nan)
        )

    def intercept(s, sign):
        z = np.array([at(s + sign * n * k)[0] for k in ks])
        ok = np.isfinite(z)
        if ok.sum() < 5:
            return None
        _b, a = np.polyfit(ks[ok], z[ok], 1)
        return a

    thr, ths = [], []
    for t in np.linspace(
        0.3, 0.7, 9
    ):  # the middle of the trace, away from the tip taper
        s = p0 + t * d
        left, right = intercept(s, 1), intercept(s, -1)
        if left is not None and right is not None:
            thr.append(abs(left - right))
            ths.append(np.nanmedian([at(s + n * k)[1] for k in ks]))
    if not thr:
        return None
    throw, th = float(np.median(thr)), float(np.nanmedian(ths))
    return {
        "throw_m": round(throw, 1),
        "thickness_m": None if np.isnan(th) else round(th, 1),
        "ratio": None if np.isnan(th) or th <= 0 else round(throw / th, 2),
        "length_m": round(length),
        "strike_deg": round(float(np.degrees(np.arctan2(u[0], u[1])) % 180), 0),
        "samples": len(thr),
        "method": "line fitted to the top surface 100-400 m either side, extrapolated to the trace, median over stations",
    }


def bridged(z: np.ndarray, closing: int = 4) -> np.ndarray:
    """Fault gaps (nodata inside the closed footprint) filled from the nearest valid cell: for connectivity only, never for values."""
    valid = np.isfinite(z)
    closed = ndi.binary_erosion(
        ndi.binary_dilation(valid, iterations=closing),
        iterations=closing,
        border_value=1,
    )
    idx = ndi.distance_transform_edt(
        ~valid, return_distances=False, return_indices=True
    )
    out = z.copy()
    fill = closed & ~valid
    out[fill] = z[idx[0][fill], idx[1][fill]]
    return out


def well_connections(out_dir: Path, manifest: dict, faults: dict) -> int:
    """For each well in contacts.json: how it connects to the oil wells on the top-Hugin surface (the 19BT2 test, docs/contacts-structure.md).

    pass_z: the shallowest pass, with fault gaps bridged. pass_z_walled: the same with the fault polygons whose throw exceeds the Hugin
    thickness treated as walls (a juxtaposition indicator, not a seal analysis). A heave area in a grid is interpolated, not a connection.
    """
    path = out_dir / "contacts.json"
    if not path.exists() or not (out_dir / "hugin_top_depth.bin").exists():
        return 0
    rec = json.loads(path.read_text(encoding="utf-8"))
    ev = [e for e in rec.get("evidence", []) if e.get("xy")]
    if not ev:
        return 0
    z = bridged(load_grid(out_dir, manifest, "hugin_top_depth"))
    ny, nx = z.shape
    x0, y0, cell = manifest["origin"]["x"], manifest["origin"]["y"], manifest["cell"]
    walled = z.copy()
    for f in faults["features"]:
        if (
            f["kind"] == "polygon"
            and f.get("horizon") == "hugin_top"
            and (f.get("attrs", {}).get("ratio") or 0) > 1
        ):
            pts = np.array([((x - x0) / cell, (y0 - y) / cell) for x, y in f["xy"]])
            walled[polygon_mask(pts, ny, nx)] = np.nan

    def cell_of(xy):
        return int((y0 - xy[1]) / cell) * nx + int((xy[0] - x0) / cell)

    oil = [e for e in ev if e["fluid"] == "oil"]
    n = 0
    for e in ev:
        conn = []
        for o in oil:
            if o is e:
                continue
            a, b = cell_of(e["xy"]), cell_of(o["xy"])
            r, rw = bottleneck(z, a, b), bottleneck(walled, a, b)
            conn.append({"to": o["well"], "pass_z": None if not r else round(r[0], 1),
                         "pass_z_walled": None if not rw else round(rw[0], 1)})  # fmt: skip
        if conn:
            e["surface_connection"] = {"top_hugin_z": round(float(z.ravel()[cell_of(e["xy"])]), 1), "to": conn,
                                       "walls": "fault polygons with throw over Hugin thickness above 1 (an indicator, not a seal analysis)"}  # fmt: skip
            n += 1
    path.write_text(json.dumps(rec, indent=1), encoding="utf-8")
    return n


# ---------------------------------------------------------------- build
def build(out_dir: Path) -> dict:
    """closures.json for every depth horizon, and attributes on the faults, for one data set."""
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    depth = [
        h
        for h in manifest["horizons"]
        if h["domain"] == "depth" and h["id"] != "seabed_depth"
    ]
    rec = {
        "crs": manifest["crs"],
        "method": "merge tree of the depth grid, cells shallow to deep (scripts/structure.py)",
        "horizons": {
            h["id"]: closure_record(load_grid(out_dir, manifest, h["id"]), manifest)
            for h in depth
        },
    }
    (out_dir / "closures.json").write_text(
        json.dumps(rec, separators=(",", ":")), encoding="utf-8"
    )
    fpath = out_dir / "faults.json"
    counts = {"closures": sum(len(v["highs"]) for v in rec["horizons"].values())}
    if fpath.exists():
        faults = json.loads(fpath.read_text(encoding="utf-8"))
        tops = {"hugin_top": "hugin_top_depth", "hugin_base": "hugin_base_depth"}
        have = {h["id"] for h in manifest["horizons"]}
        if {"hugin_top_depth", "hugin_base_depth"} <= have:
            top, base = (
                load_grid(out_dir, manifest, "hugin_top_depth"),
                load_grid(out_dir, manifest, "hugin_base_depth"),
            )
            thick = base - top
            n = 0
            for f in faults["features"]:
                a = None
                if f["kind"] == "polygon" and f.get("horizon") in tops:
                    surf = load_grid(out_dir, manifest, tops[f["horizon"]])
                    a = polygon_attrs(f["xy"], surf, thick, manifest)
                elif f["kind"] == "trace":
                    a = trace_attrs(f["xy"], top, thick, manifest)
                if a:
                    f["attrs"] = a
                    n += 1
            faults["attrs_note"] = (
                "attrs are measurements of throw and thickness, not a fault-seal analysis: any fault may hold or pass fluid, "
                "and sealing depends on things outside this repository."
            )
            fpath.write_text(
                json.dumps(faults, separators=(",", ":")), encoding="utf-8"
            )
            counts["fault_attrs"] = n
            counts["well_connections"] = well_connections(out_dir, manifest, faults)
    return counts


if __name__ == "__main__":
    for d in ("data/out", "data/synthetic"):
        print(d, build(ROOT / d))
