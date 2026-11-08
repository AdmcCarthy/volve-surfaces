import json
from pathlib import Path

import build
import numpy as np
import pytest
from volve_io import parse_sections

OUT = Path(__file__).parent.parent / "data" / "out"


def rows(*vals):
    return b"\n".join(b"%d,%d,%.3f,%.3f,%.3f" % v for v in vals)


def test_parse_sections_splits_appended_surface():
    raw = (
        b"# header\nST1\nname\nPUB\nDEPTH\n"
        + rows((1, 1, 10, 20, 100), (1, 2, 11, 20, 101))
        + b"\nST1\nother\nTIME\n,\n"
        + rows((1, 1, 10, 20, 2500))
    )
    secs = parse_sections(raw)
    assert [len(s) for s in secs] == [2, 1]
    assert secs[0]["z"].max() == 101


def test_resample_recovers_a_plane_and_masks_holes():
    xs, ys = np.meshgrid(np.arange(0, 500, 12.5), np.arange(0, 500, 12.5))
    pts = np.column_stack([xs.ravel(), ys.ravel()])
    keep = ~((pts[:, 0] > 200) & (pts[:, 0] < 350))  # a hole 150 m wide
    pts = pts[keep]
    z = 3000 + 0.1 * pts[:, 0] + 0.05 * pts[:, 1]
    x0, y0, nx, ny = build.frame({"a": pts})
    grid = build.resample(pts, z, x0, y0, nx, ny)
    err = build.sample(grid, x0, y0, pts) - z
    assert np.nanmax(np.abs(err)) < 0.5
    assert np.isnan(
        grid[ny // 2, int((275 - x0) / build.CELL)]
    )  # centre of the hole is nodata


@pytest.mark.skipif(not (OUT / "manifest.json").exists(), reason="grids not built")
def test_built_grids_match_manifest_and_budget():
    m = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    assert (
        m["crs"] == "EPSG:23031"
        and m["confidence"] == "Interpreted"
        and "Equinor" in m["attribution"]
    )
    ids = {h["id"] for h in m["horizons"]}
    assert {"hugin_top_depth", "hugin_base_depth", "hugin_top_twt"} <= ids
    for h in m["horizons"]:
        q = np.fromfile(OUT / h["file"], dtype="<u2")
        assert q.size == m["nx"] * m["ny"]
        assert (q != m["nodata"]).sum() == h["valid_cells"]
        assert (OUT / h["file"]).stat().st_size < 300_000
        assert h["resample_error"]["p99_abs"] < 10
    hb = {h["id"]: h for h in m["horizons"]}
    assert (
        hb["hugin_top_depth"]["z_max"] < hb["hugin_base_depth"]["z_max"]
    )  # base is deeper than top
