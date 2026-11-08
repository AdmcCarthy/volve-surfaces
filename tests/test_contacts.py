import json
from pathlib import Path

import numpy as np
import pytest
from adapters.volve.contacts import check, extend, quantiles, similarity

DATA = Path(__file__).parent.parent / "data"
CURATED = DATA / "contacts" / "volve_curated.json"
OUT = DATA / "out" / "contacts.json"


def inside(poly, p):  # ray casting
    x, y, n, c = p[0], p[1], len(poly), False
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def area_km2(poly):
    p = np.array(poly)
    return (
        abs(
            np.dot(p[:, 0], np.roll(p[:, 1], -1))
            - np.dot(p[:, 1], np.roll(p[:, 0], -1))
        )
        / 2
        / 1e6
    )


def test_quantiles_are_exceedance_quantiles_with_p90_the_low_case():
    q = quantiles(
        [{"depth": 100, "p": 50}, {"depth": 200, "p": 30}, {"depth": 300, "p": 20}]
    )
    assert (q["P90"], q["P50"], q["P10"]) == (100, 200, 300) and q["mean"] == 170
    assert q["exceedance"] == {100: 100, 200: 50, 300: 20}


def test_a_distribution_that_does_not_sum_to_100_is_refused():
    with pytest.raises(ValueError):
        quantiles([{"depth": 100, "p": 60}, {"depth": 200, "p": 30}])


def test_a_contact_is_checked_against_the_wells():
    ev = [
        {"well": "A", "fluid": "oil", "top": 10, "base": 100},
        {"well": "B", "fluid": "water", "top": 150, "base": 200},
    ]
    assert check({"depth": 120}, ev) == []
    assert any(
        "contradicted" in p
        for p in check({"depth": 90, "range": {"min": 80, "max": 95}}, ev)
    )  # oil below even the maximum
    assert any(
        "contradicted" in p
        for p in check({"depth": 170, "range": {"min": 160, "max": 180}}, ev)
    )  # water above even the minimum
    assert any(
        "deepest" in p
        for p in check({"depth": 140, "range": {"min": 120, "max": 160}}, ev)
    )  # water above the maximum only
    outside = [
        {"well": "C", "fluid": "water", "top": 50, "base": 90, "segment": "outside"}
    ]
    assert (
        check({"depth": 140}, outside) == []
    )  # a well outside the field does not constrain it


def test_similarity_reproduces_its_control_points_and_extension_keeps_the_ends_in_line():
    px, xy = (
        np.array([[10, 10], [110, 30]], float),
        np.array([[1000, 2000], [1900, 2300]], float),
    )
    apply, scale, _ = similarity(px, xy)
    assert np.allclose(apply(px), xy, atol=1e-6) and scale > 0
    poly = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]])
    assert np.allclose(extend(poly, 5), [[-5, 0], [0, 0], [10, 0], [20, 0], [25, 0]])


@pytest.mark.skipif(not CURATED.exists(), reason="curated contacts missing")
def test_every_curated_contact_and_well_carries_its_source():
    cur = json.loads(CURATED.read_text(encoding="utf-8"))
    for case in cur["cases"]:
        for c in case["contacts"]:
            assert c.get("source") and c["basis"] and c["confidence"], (
                case["id"],
                c["kind"],
            )
            if "distribution" in c:
                assert abs(sum(r["p"] for r in c["distribution"]) - 100) < 0.5
                assert c["depth"] in {r["depth"] for r in c["distribution"]}
    for e in cur["evidence"] + cur["minimum_contacts"]:
        assert e["source"], e
    assert {s["well"] for s in cur["segments"]} <= {e["well"] for e in cur["evidence"]}


@pytest.mark.skipif(not OUT.exists(), reason="contacts not built")
def test_volve_contacts_output_is_georeferenced_closed_and_checked():
    d = json.loads(OUT.read_text(encoding="utf-8"))
    assert d["crs"] == "EPSG:25831" and d["datum"].startswith("m below mean sea level")
    gr = d["georeference"]
    assert (
        8 < gr["scale_m_per_px"] < 11 and gr["accuracy_m"] >= 200
    )  # about 25 m cells at 2.7 px; and we say how rough it is
    outline = d["outline"]["xy"]
    assert 4 < area_km2(outline) < 8  # the plan calls the field 2 x 3 km
    for s in d["segments"]:
        assert inside(outline, s["seed"]), s[
            "id"
        ]  # both wells lie inside the accumulation outline
    barrier = np.array(d["barriers"][0]["xy"])
    assert (
        np.hypot(*np.diff(barrier, axis=0).T).sum() > 1500
    )  # the barrier crosses the field
    q = d["cases"][0]["contacts"][0]["quantiles"]
    assert (q["P90"], q["P50"], q["P10"], q["mean"]) == (
        3105,
        3135,
        3260,
        3150.0,
    )  # PUD Table 3.5
    flags = {
        c["id"]: any(x.get("contradicted") for x in c["contacts"]) for c in d["cases"]
    }
    assert flags == {
        "pdo2005": False,
        "pdo2005-base": False,
        "disc1993": True,
    }  # 15/9-19 A found oil below the 1993 maximum
    assert OUT.stat().st_size < 20_000


@pytest.mark.skipif(
    not (DATA / "synthetic" / "contacts.json").exists(),
    reason="synthetic contacts not built",
)
def test_synthetic_contacts_are_dual_phase_in_the_west_and_unequal_across_the_barrier():
    d = json.loads((DATA / "synthetic" / "contacts.json").read_text(encoding="utf-8"))
    cs = d["cases"][0]["contacts"]
    goc = next(c for c in cs if c["kind"] == "GOC")
    owc = {c["segment"]: c for c in cs if c["kind"] == "OWC"}
    assert goc["segment"] == "west" and goc["depth"] < owc["west"]["depth"]
    assert (
        owc["west"]["depth"] != owc["east"]["depth"]
        and "spill points" in d["cases"][0]["note"]
    )
    assert len(d["barriers"][0]["xy"]) == 2 and d["outline"] is None
