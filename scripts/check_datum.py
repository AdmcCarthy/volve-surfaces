"""Check the horizon depth datum against the Volve well picks, end to end in the canonical CRS.

    uv run python scripts/check_datum.py path/to/Volve_Geophysical_Interpretations.zip [grids_dir] [out.md]

The well picks give TVDSS (depth below mean sea level, negative down). If the horizons are depth below MSL, positive down, then
horizon depth at a pick's position equals -TVDSS. Horizons and picks are both ED50 in the source; both are converted to ETRS89
before comparing. As a control, the same comparison is made with the wells left unconverted: that must be clearly worse where
the surface is structured, or the check cannot tell a datum from a position.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from adapters.volve.wells import parse_picks
from crs import convert
from scipy.ndimage import map_coordinates

PAIRS = {  # pick surface name -> (horizon id, domain)
    "Seabed": "seabed_depth",
    "Ty Fm. Top": "ty_depth",
    "SHETLAND GP. Top": "shetland_depth",
    "Hugin Fm. VOLVE Top": "hugin_top_depth",
    "Hugin Fm. VOLVE Base": "hugin_base_depth",
}
TWT_PAIRS = {
    "Ty Fm. Top": "ty_twt",
    "SHETLAND GP. Top": "shetland_twt",
    "Hugin Fm. VOLVE Top": "hugin_top_twt",
    "Hugin Fm. VOLVE Base": "hugin_base_twt",
}


def load(m: dict, grids: Path, hid: str) -> np.ndarray:
    h = next(x for x in m["horizons"] if x["id"] == hid)
    q = (
        np.fromfile(grids / h["file"], dtype="<u2")
        .reshape(m["ny"], m["nx"])
        .astype(float)
    )
    z = h["offset"] + q * h["scale"]
    z[q == m["nodata"]] = np.nan
    return z


def sample(m: dict, z: np.ndarray, e, n) -> np.ndarray:
    cx = (np.asarray(e) - m["origin"]["x"]) / m["cell"] - 0.5
    cy = (m["origin"]["y"] - np.asarray(n)) / m["cell"] - 0.5
    return map_coordinates(z, [cy, cx], order=1, mode="constant", cval=np.nan)


def stats(r: np.ndarray) -> dict:
    r = r[~np.isnan(r)]
    med = float(np.median(r)) if len(r) else float("nan")
    return {
        "n": len(r),
        "median": med,
        "mad": float(np.median(np.abs(r - med))) if len(r) else float("nan"),
        "rms": float(np.sqrt(np.mean(r**2))) if len(r) else float("nan"),
        "within5": float(np.mean(np.abs(r) <= 5)) if len(r) else float("nan"),
    }


def run(zip_path: str, grids: str = "data/out", out: str | None = None) -> str:
    g = Path(grids)
    m = json.loads((g / "manifest.json").read_text(encoding="utf-8"))
    assert m["crs"] == "EPSG:25831", (
        f"grids are {m['crs']}, expected EPSG:25831: rebuild with scripts/build.py"
    )
    df = parse_picks(zip_path).dropna(subset=["easting", "northing", "tvdss"])
    e, n, info = convert(df["easting"].to_numpy(), df["northing"].to_numpy())
    df = df.assign(e=e, n=n)
    lines = [
        "# Datum check",
        "",
        f"Horizon depth against well-pick TVDSS, in {m['crs']}. Source ED50 converted with: {info['transformation']} (accuracy {info['accuracy_m']} m).",
        f"{len(df)} picks with coordinates and TVDSS in {df.well.nunique()} wells. Residual = horizon depth minus (-TVDSS), in metres; zero means the horizon is depth below mean sea level, positive down.",
        "",
        "| Surface | n | median | MAD | RMS | within 5 m | control: wells unconverted, median |",
        "|---|---|---|---|---|---|---|",
    ]
    worst = []
    for s, hid in PAIRS.items():
        d = df[df.surface == s]
        z = load(m, g, hid)
        r = sample(m, z, d.e, d.n) - (-d.tvdss.to_numpy())
        c = sample(m, z, d.easting, d.northing) - (-d.tvdss.to_numpy())
        st, sc = stats(r), stats(c)
        lines.append(
            f"| {s} | {st['n']} | {st['median']:.1f} | {st['mad']:.1f} | {st['rms']:.1f} | {st['within5']:.0%} | {sc['median']:.1f} |"
        )
        worst += [(abs(v), s, w, v) for v, w in zip(r, d.well) if not np.isnan(v)]
    lines += [
        "",
        "Two-way time, same method (milliseconds):",
        "",
        "| Surface | n | median | MAD | RMS |",
        "|---|---|---|---|---|",
    ]
    for s, hid in TWT_PAIRS.items():
        d = df[df.surface == s].dropna(subset=["twt"])
        r = sample(m, load(m, g, hid), d.e, d.n) - d.twt.to_numpy()
        st = stats(r)
        lines.append(
            f"| {s} | {st['n']} | {st['median']:.1f} | {st['mad']:.1f} | {st['rms']:.1f} |"
        )
    worst.sort(reverse=True)
    lines += [
        "",
        "Largest depth residuals (most are picks on or beside faults, where the pick and the gridded surface can sit on different sides):",
        "",
        "| Well | Surface | residual (m) |",
        "|---|---|---|",
    ]
    lines += [f"| {w} | {s} | {v:+.1f} |" for _, s, w, v in worst[:8]]
    text = "\n".join(lines) + "\n"
    if out:
        Path(out).write_text(text, encoding="utf-8")
    return text


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(
        run(
            sys.argv[1],
            sys.argv[2] if len(sys.argv) > 2 else "data/out",
            sys.argv[3] if len(sys.argv) > 3 else None,
        )
    )
