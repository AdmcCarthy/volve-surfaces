import json
from pathlib import Path

import numpy as np
import pytest
from adapters.volve.faults import parse_polygons, parse_sticks
from scipy.ndimage import map_coordinates

DATA = Path(__file__).parent.parent / "data"

STICKS = (
    "# header\n"
    "  435539.323 6479337.382    2602.036  0 153   0  1 1Volve_F1_2011                                    UNKNOWN\n"
    "  435586.080 6479383.795    2711.715  0 153   0  1 2Volve_F1_2011                                    UNKNOWN\n"
    "  435637.289 6479434.629    2814.798  0 153   0  1 3Volve_F1_2011                                    UNKNOWN\n"
    "  435100.000 6479000.000    2600.000  0 153   0  1 1Volve_F2_2011                                    UNKNOWN\n"
    "  435150.000 6479050.000    2700.000  0 153   0  1 3Volve_F2_2011                                    UNKNOWN\n"
)
POLYGONS = (
    "! comment\nNew Mapping Polygon Set, version 1.1\nUNKNOWN   2014_Volve_Hugin_Top   STAT\n"
    "Mapping Polygon    UNKNOWN          7\n"
    "0         TIME           4                      EXCLUSIVE   FAULT\n"
    "      434570.84          6479042.50        2644.875\n"
    "      434505.62          6478986.50        2644.195\n"
    "      434400.00          6478900.00        2640.000\n"
    "      434570.84          6479042.50        2644.875\n"
)


def test_sticks_group_by_position_and_keep_the_fault_name():
    s = parse_sticks(STICKS)
    assert [x["name"] for x in s] == ["Volve_F1_2011", "Volve_F2_2011"]
    assert [len(x["x"]) for x in s] == [3, 2]
    assert s[0]["twt"] == [2602.036, 2711.715, 2814.798]


def test_polygons_read_the_count_line_and_do_not_mistake_it_for_a_vertex():
    (p,) = parse_polygons(POLYGONS)
    assert (
        p["n"] == 7 and len(p["x"]) == len(p["y"]) == len(p["twt"]) == 4
    )  # the "0 TIME 4 ..." line is not a point


def test_a_polygon_that_misdeclares_its_point_count_is_an_error():
    with pytest.raises(ValueError):
        parse_polygons(POLYGONS.replace("TIME           4", "TIME           9"))


@pytest.mark.skipif(
    not (DATA / "out" / "faults.json").exists(), reason="faults not built"
)
def test_volve_faults_are_in_the_canonical_crs_inside_the_grid_and_say_no_more_than_the_data():
    d = json.loads((DATA / "out" / "faults.json").read_text(encoding="utf-8"))
    m = json.loads((DATA / "out" / "manifest.json").read_text(encoding="utf-8"))
    assert (
        d["crs"] == "EPSG:25831"
        and d["source_crs"] == "EPSG:23031"
        and d["transformation_accuracy_m"] <= 2.0
    )
    assert d["counts"] == {
        "sticks": 1356,
        "polygons_hugin_top": 78,
        "polygons_hugin_base": 72,
    }
    assert {f["type"] for f in d["features"]} == {"unknown"} and {
        f["certainty"] for f in d["features"]
    } == {"unknown"}
    assert not any(
        "downthrown" in f for f in d["features"]
    )  # the files do not give it, so we do not either
    xy = np.array([p for f in d["features"] for p in f["xy"]])
    o, n = m["origin"], (m["nx"] * m["cell"], m["ny"] * m["cell"])
    assert (
        xy[:, 0].min() > o["x"]
        and xy[:, 0].max() < o["x"] + n[0]
        and xy[:, 1].max() < o["y"]
        and xy[:, 1].min() > o["y"] - n[1]
    )
    assert (DATA / "out" / "faults.json").stat().st_size < 600_000


@pytest.mark.skipif(
    not (DATA / "synthetic" / "faults.json").exists(),
    reason="synthetic faults not built",
)
def test_synthetic_faults_have_the_downthrown_side_the_surface_shows():
    # the record says "left of the digitising direction"; the deeper side of the Hugin top must be that side
    m = json.loads((DATA / "synthetic" / "manifest.json").read_text(encoding="utf-8"))
    d = json.loads((DATA / "synthetic" / "faults.json").read_text(encoding="utf-8"))
    h = next(x for x in m["horizons"] if x["id"] == "hugin_top_depth")
    q = (
        np.fromfile(DATA / "synthetic" / h["file"], dtype="<u2")
        .reshape(m["ny"], m["nx"])
        .astype(float)
    )
    z = h["offset"] + q * h["scale"]
    z[q == m["nodata"]] = np.nan

    def at(x, y):
        c = [
            np.atleast_1d((m["origin"]["y"] - y) / m["cell"] - 0.5),
            np.atleast_1d((x - m["origin"]["x"]) / m["cell"] - 0.5),
        ]
        return float(map_coordinates(z, c, order=1, mode="nearest")[0])

    for f in d["features"]:
        assert f["type"] == "normal" and f["downthrown"] == "left"
        (x0, y0), (x1, y1) = f["xy"]
        v = np.array([x1 - x0, y1 - y0])
        length = np.hypot(*v)
        u, nrm = v / length, np.array([-v[1], v[0]]) / length
        diffs = [
            at(*(np.array([x0, y0]) + t * length * u + 120 * nrm))
            - at(*(np.array([x0, y0]) + t * length * u - 120 * nrm))
            for t in np.linspace(0.35, 0.65, 7)
        ]
        assert np.nanmean(diffs) > 10, f[
            "name"
        ]  # left is deeper by more than the regional dip
