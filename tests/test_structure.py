import json
from pathlib import Path

import numpy as np
import structure as st

DATA = Path(__file__).parent.parent / "data"


def domes(ny=90, nx=140, saddle_gap=0):
    """Two Gaussian highs on a flat 3000 m background, the deeper one smaller; a frame of nodata round the outside."""
    y, x = np.mgrid[0:ny, 0:nx].astype(float)
    g = lambda cx, cy, s: np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s**2))
    z = 3000 - 200 * g(45, 45, 12) - 120 * g(95, 45, 10)
    z[:6, :] = z[-6:, :] = np.nan
    z[:, :6] = z[:, -6:] = np.nan
    if saddle_gap:
        z[:, 70 - saddle_gap // 2 : 70 + saddle_gap // 2 + 1] = np.nan
    return z


def test_two_highs_spill_over_their_saddle():
    z = domes()
    # the exact pass: the highest point of the straight profile joining the crests
    profile = z[45, 45:96]
    tree = st.merge_tree(z, min_relief=5.0)
    deep = next(h for h in tree["highs"] if abs(h["z"] - (3000 - 120)) < 5)
    assert deep["spill"]["kind"] == "saddle"
    assert abs(deep["spill"]["z"] - np.nanmax(profile)) < 1.0
    assert abs(deep["relief"] - (deep["spill"]["z"] - deep["z"])) < 1e-6
    shallow = tree["highs"][0]
    assert abs(shallow["z"] - 2800) < 3 and deep["spill"]["to"] == shallow["crest"]


def test_bottleneck_finds_the_same_saddle():
    z = domes()
    _ny, nx = z.shape
    a, b = 45 * nx + 45, 45 * nx + 95
    depth, path = st.bottleneck(z, a, b)
    assert abs(depth - np.nanmax(z[45, 45:96])) < 1.0
    assert path[0] == a and path[-1] == b


def test_noise_below_the_relief_threshold_is_dissolved():
    z = domes()
    z[30, 60] -= 3.0  # a 3 m bump on the flank
    tree = st.merge_tree(z, min_relief=5.0)
    assert not any(abs(h["z"] - (z[30, 60])) < 0.01 for h in tree["highs"])
    assert len(tree["highs"]) == 2


def test_a_high_reaching_the_data_edge_spills_there_not_over_a_saddle():
    z = domes()
    z[:, :] = np.where(np.isnan(z), np.nan, z)
    z[40:50, 6:12] -= 150  # a high on the western edge of the footprint
    tree = st.merge_tree(z, min_relief=5.0)
    edge_high = next(
        h
        for h in tree["highs"]
        if h["z"] < 2860 and h["spill"] and h["spill"]["kind"] == "edge"
    )
    assert edge_high["spill"]["z"] < 3000
    walled = st.merge_tree(z, min_relief=5.0, edge_leaks=False)
    same = next(h for h in walled["highs"] if h["crest"] == edge_high["crest"])
    assert (
        same["spill"] is None or same["spill"]["kind"] == "saddle"
    )  # with the edge as a wall it is no longer an edge spill


def test_a_narrow_fault_gap_is_not_an_edge():
    z = domes(
        saddle_gap=2
    )  # a 3-cell nodata strip between the highs: heave, not the edge of the data
    tree = st.merge_tree(z, min_relief=5.0)
    kinds = {h["spill"]["kind"] for h in tree["highs"] if h["spill"]}
    assert "edge" in kinds  # the survey edge still leaks
    east = next(h for h in tree["highs"] if abs(h["z"] - 2880) < 5)
    assert (
        east["spill"]["kind"] == "edge"
    )  # beyond the gap it is a separate area: walled by the gap, leaking at the frame, not at the gap
    gap_cells = np.isnan(z) & ~st.edge_cells(z) & np.isnan(z)
    assert gap_cells[:, 69].sum() > 0


def test_polygon_mask_is_even_odd():
    sq = np.array([[2.0, 2.0], [8.0, 2.0], [8.0, 6.0], [2.0, 6.0]])
    m = st.polygon_mask(sq, 10, 12)
    assert m.sum() == 24 and m[3, 3] and not m[0, 0]


def test_synthetic_throw_recovers_the_generator_within_ten_metres():
    f = json.loads((DATA / "synthetic" / "faults.json").read_text(encoding="utf-8"))
    attrs = {x["name"]: x["attrs"] for x in f["features"]}
    t = np.linspace(0.3, 0.7, 9)
    truth = {
        "Synthetic fault F1": np.median(70 * np.sin(np.pi * t) ** 1.5),
        "Synthetic fault F2": np.median(35 * np.sin(np.pi * t) ** 1.5),
    }
    for name, expected in truth.items():
        assert abs(attrs[name]["throw_m"] - expected) < 10, (
            name,
            attrs[name]["throw_m"],
            expected,
        )
    assert "seal" in f["attrs_note"]


def test_real_closures_and_fault_attributes_are_written():
    c = json.loads((DATA / "out" / "closures.json").read_text(encoding="utf-8"))
    highs = c["horizons"]["hugin_top_depth"]["highs"]
    volve = next(h for h in highs if abs(h["z"] - 2802.2) < 1)
    assert volve["spill"]["kind"] == "edge" and abs(volve["spill"]["z"] - 2989.5) < 2
    assert abs(volve["spill_if_edge_is_wall"]["z"] - 3132.5) < 2
    f = json.loads((DATA / "out" / "faults.json").read_text(encoding="utf-8"))
    polys = [x for x in f["features"] if x["kind"] == "polygon"]
    measured = [x for x in polys if "attrs" in x]
    assert len(measured) >= 0.9 * len(polys) and all(
        x["attrs"]["throw_m"] >= 0 for x in measured
    )


def test_area_curve_is_monotonic_and_matches_the_closure_at_its_spill():
    z = domes()
    tree = st.merge_tree(z, min_relief=5.0)
    deep = next(h for h in tree["highs"] if abs(h["z"] - (3000 - 120)) < 5)
    below = st.basin_curve(z, deep["crest"], deep["spill"]["z"] - 0.01, 25.0)
    assert (
        abs(below["area_km2"][-1] - deep["cells"] * 625 / 1e6) < 0.01
    )  # the closure's own area just under its spill
    curve = st.basin_curve(z, deep["crest"], deep["spill"]["z"] + 30, 25.0)
    area = np.array(curve["area_km2"])
    assert (np.diff(area) >= 0).all() and area[0] < 0.01
    assert (
        area[-1] > 1.5 * below["area_km2"][-1]
    )  # past the saddle it merges with the neighbouring high: the area jumps


def test_real_closure_curves_are_written():
    c = json.loads((DATA / "out" / "closures.json").read_text(encoding="utf-8"))
    volve = next(
        h for h in c["horizons"]["hugin_top_depth"]["highs"] if abs(h["z"] - 2802.2) < 1
    )
    cv = volve["curve"]
    assert cv["depth"][-1] > 3133 and len(cv["depth"]) == len(cv["area_km2"])
    assert (
        abs(np.interp(3120, cv["depth"], cv["area_km2"]) - 8.4) < 0.4
    )  # the 8.4 km2 surface-connected area at 3,120 m
