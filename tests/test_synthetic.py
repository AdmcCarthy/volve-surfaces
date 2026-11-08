import json
from pathlib import Path

import build
import numpy as np
import synthetic

OUT = Path(__file__).parent.parent / "data"


def test_layers_never_cross_and_are_ordered_by_depth():
    z, survey, _ = synthetic.surfaces(seed=3)
    for upper, lower in zip(synthetic.LAYERS, synthetic.LAYERS[1:]):
        assert np.all((z[lower] - z[upper])[survey] >= 19.99)


def test_deterministic_for_a_seed_and_different_across_seeds():
    a, _, _ = synthetic.surfaces(seed=5)
    b, _, _ = synthetic.surfaces(seed=5)
    c, _, _ = synthetic.surfaces(seed=6)
    assert np.array_equal(a["hugin_top"], b["hugin_top"])
    assert not np.array_equal(a["hugin_top"], c["hugin_top"])


def test_fault_gap_only_in_deep_layers_and_twt_increases_with_depth():
    z, survey, gap = synthetic.surfaces()
    assert (gap & survey).sum() > 50
    t = {k: synthetic.to_twt(v) for k, v in z.items()}
    for upper, lower in zip(synthetic.LAYERS, synthetic.LAYERS[1:]):
        assert np.all((t[lower] - t[upper])[survey] > 0)


def test_quantise_roundtrip_within_one_step():
    g = np.array([[3000.0, np.nan], [3100.5, 3400.0]])
    q, zmin, _zmax, scale = build.quantise(g)
    back = zmin + q * scale
    assert q[0, 1] == build.NODATA
    assert abs(back[1, 0] - 3100.5) <= scale


def test_synthetic_manifest_matches_real_schema():
    syn = json.loads((OUT / "synthetic" / "manifest.json").read_text(encoding="utf-8"))
    real = json.loads((OUT / "out" / "manifest.json").read_text(encoding="utf-8"))
    assert syn["synthetic"] is True and "Not Volve" in syn["attribution"]
    assert (syn["nx"], syn["ny"], syn["cell"], syn["crs"]) == (
        real["nx"],
        real["ny"],
        real["cell"],
        real["crs"],
    )
    shared = {
        "id",
        "label",
        "domain",
        "unit",
        "file",
        "valid_cells",
        "fill",
        "z_min",
        "z_max",
        "offset",
        "scale",
    }
    for h in syn["horizons"] + real["horizons"]:
        assert shared <= h.keys()
    for h in syn["horizons"]:
        assert (OUT / "synthetic" / h["file"]).stat().st_size < 300_000


def test_steepest_gradients_follow_the_main_fault_strike():
    # the detector in site/js/trend.js looks at the steepest 0.5 % of cells; the generator's faults must be what it finds
    z, survey, _ = synthetic.surfaces()
    zz = np.where(survey, z["hugin_top"], np.nan)
    gy, gx = np.gradient(zz, synthetic.CELL)
    mag = np.hypot(gx, gy)
    sel = mag >= np.nanpercentile(mag, 99.5)
    phi = np.arctan2(gx[sel], -gy[sel])  # azimuth of steepest descent (rows run south)
    axis = (
        np.degrees(0.5 * np.angle(np.sum(mag[sel] ** 2 * np.exp(2j * phi)))) + 360
    ) % 180
    strike = (axis + 90) % 180
    d = np.array(
        [500 + 1800, 1500 + 1700.0]
    )  # main fault direction in rotated (u, v) metres
    c, s = np.cos(synthetic.ANGLE), np.sin(synthetic.ANGLE)
    east, north = c * d[0] - s * d[1], s * d[0] + c * d[1]
    true = np.degrees(np.arctan2(east, north)) % 180
    assert min(abs(strike - true), 180 - abs(strike - true)) < 20
