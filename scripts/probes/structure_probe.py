# ruff: noqa
"""Structure probe (not part of the build): closures, spill points and fault throw on the top-Hugin depth grid.

    uv run --with pillow python scripts/probes/structure_probe.py

Prototype for docs/contacts-structure.md; the plan there turns it into a tested module.
"""

import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

D = "data/out/"
m = json.load(open(D + "manifest.json"))
h = next(x for x in m["horizons"] if x["id"] == "hugin_top_depth")
raw = np.fromfile(D + h["file"], dtype="<u2").reshape(m["ny"], m["nx"]).astype(float)
z = np.where(raw == 65535, np.nan, raw * h["scale"] + h["offset"])
ny, nx = z.shape
print("z range", np.nanmin(z), np.nanmax(z), "valid", np.isfinite(z).mean())
x0, y0, c = m["origin"]["x"], m["origin"]["y"], m["cell"]


def px(x, y):
    return ((x - x0) / c, (y0 - y) / c)


c3 = json.load(open(D + "contacts.json"))
f = json.load(open(D + "faults.json"))
# fault mask from hugin_top polygons
im = Image.new("L", (nx, ny), 0)
d = ImageDraw.Draw(im)
for ft in f["features"]:
    if ft["kind"] == "polygon" and ft["horizon"] == "hugin_top":
        d.polygon([px(*p) for p in ft["xy"]], fill=1)
fm = np.array(im).astype(bool)
print("fault polygon cells", fm.sum(), "nodata inside faults", np.isnan(z[fm]).mean())
# smooth for structure (fill nan by nearest within faults? keep nan)
zz = np.where(np.isnan(z), np.inf, z)
# structural highs: local minima of depth (3x3 within 150 m window) with prominence from merge tree (union-find, shallow to deep)
order = np.argsort(zz.ravel())
par = -np.ones(nx * ny, int)
crest = {}
saddles = []


def find(a):
    while par[a] >= 0 and par[a] != a:
        par[a] = par[par[a]] if par[par[a]] >= 0 else par[a]
        a = par[a]
    return a


par = np.full(nx * ny, -1)


def root(a):
    r = a
    while par[r] != r:
        r = par[r]
    while par[a] != r:
        par[a], a = r, par[a]
    return r


merge = []
for idx in order:
    if not np.isfinite(zz.ravel()[idx]):
        break
    par[idx] = idx
    crest[idx] = idx
    y, x = divmod(idx, nx)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        yy, xx = y + dy, x + dx
        if 0 <= yy < ny and 0 <= xx < nx and par[yy * nx + xx] >= 0:
            a, b = root(idx), root(yy * nx + xx)
            if a != b:
                ca, cb = crest[a], crest[b]
                za, zb = zz.ravel()[ca], zz.ravel()[cb]
                lo, hi = (a, b) if za <= zb else (b, a)  # lo = shallower crest survives
                merge.append(
                    (zz.ravel()[idx], crest[hi], crest[lo], idx)
                )  # saddle depth, deeper crest, shallower crest
                par[hi] = lo
# merge: (saddle depth, deeper crest idx, shallower crest idx, saddle idx). closure relief of the deeper high = saddle - crest depth
rows = []
for s, ch, cl, si in merge:
    cz = zz.ravel()[ch]
    rel = s - cz
    if rel >= 5:
        yy, xx = divmod(ch, nx)
        sy, sx = divmod(si, nx)
        rows.append(
            (rel, cz, s, x0 + xx * c, y0 - yy * c, x0 + sx * c, y0 - sy * c, fm[sy, sx])
        )
rows.sort(reverse=True)
print(
    "highs with >=5 m closure relief (crest depth, saddle depth to a shallower high):"
)
for r in rows[:14]:
    print(
        "  relief %5.0f crest %6.0f saddle %6.0f  crest@(%.0f,%.0f) saddle@(%.0f,%.0f) saddle_in_fault_poly=%s"
        % r
    )
# wells
ev = c3["evidence"]
for e in ev:
    ix, iy = px(*e["xy"])
    ix, iy = int(round(ix)), int(round(iy))
    print(e["well"], e["fluid"], "top z", round(z[iy, ix], 1), "fault poly", fm[iy, ix])
# component sizes at contact 3120 without outline or barrier
for cd in (3105, 3120, 3135, 3170, 3260):
    lab, n = ndi.label(np.isfinite(z) & (z <= cd))
    seeds = [
        (e["well"], lab[int(round(px(*e["xy"])[1])), int(round(px(*e["xy"])[0]))])
        for e in ev
    ]
    sizes = ndi.sum(np.ones_like(z), lab, range(1, n + 1))
    print(
        cd,
        "components",
        n,
        "seeded:",
        [(w, l, round(sizes[l - 1] * c * c / 1e6, 2) if l else 0) for w, l in seeds],
    )
# how much does a close of narrow fault gaps change connectivity? close nodata gaps <=3 cells
for k in (0, 2, 4):
    ok = np.isfinite(z)
    if k:
        ok = ndi.binary_closing(ok, iterations=k)
    lab, n = ndi.label(
        ok & (np.where(np.isfinite(z), z, 0) <= 3120) | (~np.isfinite(z) & ok & True)
    )
    print("closing", k, "labels", n)
# fault-polygon cells crossing the 3120 shoreline: fraction of the contour length touching fault polygons
cont = (z <= 3120) & ~ndi.binary_erosion(z <= 3120)
print(
    "3120 contour cells",
    cont.sum(),
    "in fault polys",
    (cont & ndi.binary_dilation(fm, iterations=1)).sum(),
    "next to nodata",
    (cont & ndi.binary_dilation(~np.isfinite(z), iterations=1)).sum(),
)

print()


def grid(i):
    h = next(x for x in m["horizons"] if x["id"] == i)
    r = np.fromfile(D + h["file"], dtype="<u2").reshape(m["ny"], m["nx"]).astype(float)
    return np.where(r == 65535, np.nan, r * h["scale"] + h["offset"])


top, base = grid("hugin_top_depth"), grid("hugin_base_depth")
thick = base - top
ny, nx = top.shape
x0, y0, c = m["origin"]["x"], m["origin"]["y"], m["cell"]
f = json.load(open(D + "faults.json"))
print(
    "thickness median/p10/p90 (m):",
    [round(float(np.nanpercentile(thick, q)), 1) for q in (50, 10, 90)],
)
res = []
for ft in f["features"]:
    if ft["kind"] != "polygon" or ft["horizon"] != "hugin_top":
        continue
    pts = np.array([((x - x0) / c, (y0 - y) / c) for x, y in ft["xy"]])
    im = Image.new("L", (nx, ny), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in pts], fill=1)
    pm = np.array(im).astype(bool)
    ring = (
        ndi.binary_dilation(pm, iterations=6)
        & ~ndi.binary_dilation(pm, iterations=1)
        & np.isfinite(top)
    )
    if ring.sum() < 12:
        continue
    ctr = pts.mean(0)
    u, s, vt = np.linalg.svd(pts - ctr)
    ax = vt[0]
    nrm = np.array([-ax[1], ax[0]])
    yy, xx = np.nonzero(ring)
    side = ((np.c_[xx, yy] - ctr) @ nrm) > 0
    if side.sum() < 5 or (~side).sum() < 5:
        continue
    zt = top[yy, xx]
    a, b = np.median(zt[side]), np.median(zt[~side])
    th = np.nanmedian(thick[yy, xx])
    length = (s[0] * 2 / np.sqrt(len(pts))) * c * 2  # rough
    res.append((abs(a - b), th, pm.sum() * c * c, ft["id"]))
res = np.array([(r[0], r[1], r[2]) for r in res])
print("polygons measured", len(res))
ratio = res[:, 0] / res[:, 1]
print(
    "throw (m) percentiles 10/50/90:",
    [round(float(np.percentile(res[:, 0], q)), 1) for q in (10, 50, 90)],
)
print(
    "throw<10 m (below seismic resolution):",
    int((res[:, 0] < 10).sum()),
    "; 10-30:",
    int(((res[:, 0] >= 10) & (res[:, 0] < 30)).sum()),
    "; >=30:",
    int((res[:, 0] >= 30).sum()),
)
print(
    "throw/thickness >1 (reservoir against non-reservoir):",
    int((ratio > 1).sum()),
    "; 0.5-1:",
    int(((ratio > 0.5) & (ratio <= 1)).sum()),
    "; <0.5:",
    int((ratio <= 0.5).sum()),
)
