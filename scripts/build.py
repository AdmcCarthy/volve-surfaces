"""Build display grids from the Volve horizons.

    uv run python scripts/build.py path/to/Volve_Geophysical_Interpretations.zip [out_dir]

Every horizon is resampled onto ONE shared regular grid (native ED50 / UTM 31N metres, north-up), so horizons line up
for compare and isochore maps. Each grid is a little-endian Uint16 array, row-major from the north-west cell, with
`z = offset + value * scale` and `nodata` for cells with no nearby pick. `manifest.json` records everything the viewer
and the honesty badge need, including the resampling error against the source picks.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import cKDTree
from volve_io import read_horizon

CELL = 25.0  # metres
HOLE = 60.0  # cells further than this from any pick are nodata
NODATA = 65535
CRS = "EPSG:23031"  # ED50 / UTM zone 31N, from the export headers (assumed where a header omits it)

ATTRIBUTION = (
    "Contains data from the Volve data village, © Equinor ASA and the former Volve licence partners "
    "(ExxonMobil E&P Norway, Bayerngas Norge). Used under the Volve Terms and Conditions. Generalised for display."
)

# id, member suffix, label, domain, unit
HORIZONS = [
    ("seabed_depth", "Seabed+VelBuild_04_08+PUB+DEPTH.dat", "Seabed", "depth", "m"),
    (
        "shetland_depth",
        "SHETLAND_GP_Top+ST10010ZC11_160913_unadj_EasyDC+STAT+DEPTH.dat",
        "Shetland Gp top",
        "depth",
        "m",
    ),
    (
        "ty_depth",
        "Ty_Fm_Top+ST10010ZC11_270613_updateF11wells_EasyDC+STAT+DEPTH.dat",
        "Ty Fm top",
        "depth",
        "m",
    ),
    (
        "hugin_top_depth",
        "Hugin_Fm_Top+ST10010ZC11_Near_190314_adj2_2760_EasyDC+STAT+DEPTH.dat",
        "Hugin Fm top",
        "depth",
        "m",
    ),
    (
        "hugin_base_depth",
        "Hugin_Fm_Base+ST10010ZC11_Near_190314_adj_2999_EasyDC+STAT+DEPTH.dat",
        "Hugin Fm base",
        "depth",
        "m",
    ),
    (
        "bcu_depth",
        "BCU+ST10010ZC11_NoF10_160913_adjVolve_EasyDC+STAT+DEPTH.dat",
        "Base Cretaceous unconformity",
        "depth",
        "m",
    ),
    (
        "shetland_twt",
        "SHETLAND_GP_Top+ST10010ZC11_Full+STAT+TIME.dat",
        "Shetland Gp top",
        "twt",
        "ms",
    ),
    ("ty_twt", "Ty_Fm_Top+ST10010_Full+STAT+TIME.dat", "Ty Fm top", "twt", "ms"),
    (
        "hugin_top_twt",
        "Hugin_Fm_Top+ST10010ZC11_Near_190314+STAT+TIME.dat",
        "Hugin Fm top",
        "twt",
        "ms",
    ),
    (
        "hugin_base_twt",
        "Hugin_Fm_Base+ST10010ZC11_Near_190314+STAT+TIME.dat",
        "Hugin Fm base",
        "twt",
        "ms",
    ),
    (
        "bcu_twt",
        "BCU+ST10010ZC11_Full+STAT+TIME.dat",
        "Base Cretaceous unconformity",
        "twt",
        "ms",
    ),
]


def frame(picks: dict[str, np.ndarray]) -> tuple[float, float, int, int]:
    """Shared frame: union of pick extents, snapped outwards to CELL. Returns (x0 west, y0 north, nx, ny)."""
    xs = np.concatenate([p[:, 0] for p in picks.values()])
    ys = np.concatenate([p[:, 1] for p in picks.values()])
    x0 = np.floor(xs.min() / CELL) * CELL
    y1 = np.ceil(ys.max() / CELL) * CELL
    nx = int(np.ceil((xs.max() - x0) / CELL)) + 1
    ny = int(np.ceil((y1 - ys.min()) / CELL)) + 1
    return x0, y1, nx, ny


def resample(
    pts: np.ndarray, z: np.ndarray, x0: float, y0: float, nx: int, ny: int
) -> np.ndarray:
    """Linear (Delaunay) interpolation onto cell centres, masked where no pick lies within HOLE metres."""
    gx = x0 + (np.arange(nx) + 0.5) * CELL
    gy = y0 - (np.arange(ny) + 0.5) * CELL
    xx, yy = np.meshgrid(gx, gy)
    grid = LinearNDInterpolator(pts, z)(xx, yy)
    dist, _ = cKDTree(pts).query(np.column_stack([xx.ravel(), yy.ravel()]))
    grid[dist.reshape(grid.shape) > HOLE] = np.nan
    return grid


def sample(grid: np.ndarray, x0: float, y0: float, pts: np.ndarray) -> np.ndarray:
    """Bilinear sample of the grid at pick locations (NaN where a neighbouring cell is nodata or outside the grid)."""
    from scipy.ndimage import map_coordinates

    cx = (pts[:, 0] - x0) / CELL - 0.5
    cy = (y0 - pts[:, 1]) / CELL - 0.5
    return map_coordinates(grid, [cy, cx], order=1, mode="constant", cval=np.nan)


def quantise(grid: np.ndarray) -> tuple[np.ndarray, float, float, float]:
    """Uint16 encoding of a float grid (NaN -> NODATA): (values, z_min, z_max, scale); z = z_min + value * scale."""
    zmin, zmax = float(np.nanmin(grid)), float(np.nanmax(grid))
    scale = (zmax - zmin) / (NODATA - 1)
    q = np.where(np.isnan(grid), NODATA, np.rint((grid - zmin) / scale)).astype("<u2")
    return q, zmin, zmax, scale


def build(zip_path: str, out_dir: str = "data/out") -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    data = {}
    for hid, suffix, label, domain, unit in HORIZONS:
        name, df, nsec = read_horizon(zip_path, suffix)
        data[hid] = (name, df, nsec, label, domain, unit)
        print(f"read {hid}: {len(df):,} picks, {nsec} section(s)", flush=True)

    x0, y0, nx, ny = frame({k: v[1][["x", "y"]].to_numpy() for k, v in data.items()})
    entries = []
    for hid, (name, df, nsec, label, domain, unit) in data.items():
        pts, z = df[["x", "y"]].to_numpy(), df["z"].to_numpy()
        grid = resample(pts, z, x0, y0, nx, ny)
        q, zmin, zmax, scale = quantise(grid)
        (out / f"{hid}.bin").write_bytes(q.tobytes())
        err = sample(grid, x0, y0, pts) - z
        err = err[~np.isnan(err)]
        raw = Path(zip_path).stat().st_size  # provenance: size of the source zip
        entries.append(
            {
                "id": hid,
                "label": label,
                "domain": domain,
                "unit": unit,
                "file": f"{hid}.bin",
                "source": name.split("Geophysical_Interpretations/")[-1],
                "source_sections_used": f"1 of {nsec}",
                "source_zip_bytes": raw,
                "picks": len(df),
                "valid_cells": int(np.sum(q != NODATA)),
                "fill": round(float(np.mean(q != NODATA)), 4),
                "z_min": round(zmin, 2),
                "z_max": round(zmax, 2),
                "offset": zmin,
                "scale": scale,
                "resample_error": {
                    "unit": unit,
                    "rms": round(float(np.sqrt(np.mean(err**2))), 3),
                    "p99_abs": round(float(np.percentile(np.abs(err), 99)), 3),
                    "max_abs": round(float(np.abs(err).max()), 3),
                },
                "sha256": hashlib.sha256(q.tobytes()).hexdigest(),
            }
        )
        e = entries[-1]
        print(
            f"wrote {hid}: {nx}x{ny}, fill {e['fill']:.0%}, rms {e['resample_error']['rms']} {unit}",
            flush=True,
        )

    manifest = {
        "crs": CRS,
        "cell": CELL,
        "origin": {
            "x": x0,
            "y": y0,
            "note": "west edge, north edge; row 0 is the northernmost row",
        },
        "nx": nx,
        "ny": ny,
        "dtype": "uint16-le",
        "nodata": NODATA,
        "hole_distance_m": HOLE,
        "depth_datum": "not stated in the source files",
        "confidence": "Interpreted",
        "attribution": ATTRIBUTION,
        "horizons": entries,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "data/out")
