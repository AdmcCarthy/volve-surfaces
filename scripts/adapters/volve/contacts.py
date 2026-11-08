"""Volve hydrocarbon contacts: the curated, cited record -> normalised contact records in ETRS89 / UTM 31N.

    PYTHONPATH=scripts uv run python -m adapters.volve.contacts path/to/Volve_Geophysical_Interpretations.zip [out_dir]

Reads `data/contacts/volve_curated.json` (everything in it is read from the Volve reports, with the page cited) and writes
`data/out/contacts.json`. The geophysical zip is only used for the positions of the wells in the curated file (their Hugin top picks).

What it does
- Georeferences PUD Figure 4.1 (which has no coordinates) by a similarity transform from two wells' pick positions, then places
  the accumulation outline and the segment barrier in map coordinates. The barrier's ends are extended so it divides the outline.
- Gives each segment a seed at its well's pick, converted ED50 to ETRS89 (scripts/crs.py).
- Turns a discrete contact distribution into exceedance quantiles in the oilfield convention (P90 is the low case, the depth the
  contact reaches or passes with 90 % probability) and a mean.
- Checks every contact against the well evidence (oil seen below a contact, or water above it, contradicts it) and records the result.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from crs import convert

from adapters.volve.wells import parse_picks

ATTRIBUTION = (
    "Contains data from the Volve data village, © Equinor ASA and the former Volve licence partners "
    "(ExxonMobil E&P Norway, Bayerngas Norge). Used under the Volve Terms and Conditions. "
    "Contacts and segments digitised from the Volve reports; approximate."
)
EXTEND_M = 800.0


def similarity(px: np.ndarray, xy: np.ndarray):
    """The transform from figure pixels (u right, v down) to map metres fixed by two control points. North is not assumed."""
    fv = np.array(
        [px[1][0] - px[0][0], -(px[1][1] - px[0][1])], float
    )  # up-positive figure vector
    mv = np.array(xy[1], float) - np.array(xy[0], float)
    scale = float(np.hypot(*mv) / np.hypot(*fv))
    theta = float(np.arctan2(mv[1], mv[0]) - np.arctan2(fv[1], fv[0]))
    ct, st = np.cos(theta), np.sin(theta)

    def apply(points):
        p = np.asarray(points, float)
        du, dv = p[:, 0] - px[0][0], p[:, 1] - px[0][1]
        return np.column_stack(
            [
                xy[0][0] + scale * (du * ct + dv * st),
                xy[0][1] + scale * (du * st - dv * ct),
            ]
        )

    return apply, scale, float(np.degrees(theta))


def extend(poly: np.ndarray, length: float) -> np.ndarray:
    """Extend both ends of a polyline along their end tangents."""
    d0, d1 = poly[0] - poly[1], poly[-1] - poly[-2]
    return np.vstack(
        [
            poly[0] + length * d0 / np.hypot(*d0),
            poly,
            poly[-1] + length * d1 / np.hypot(*d1),
        ]
    )


def quantiles(dist: list[dict]) -> dict:
    """Exceedance quantiles of a discrete distribution of contact depths: P90 low, P50, P10 high (oilfield convention)."""
    d = sorted(dist, key=lambda r: r["depth"])
    total = sum(r["p"] for r in d)
    if abs(total - 100) > 0.5:
        raise ValueError(f"probabilities sum to {total}, not 100")
    exceed = {
        r["depth"]: sum(s["p"] for s in d if s["depth"] >= r["depth"]) for r in d
    }  # P(contact reaches at least this depth), %

    def q(p):  # the deepest depth still reached with probability at least p
        return max(dep for dep, e in exceed.items() if e >= p)

    return {
        "P90": q(90),
        "P50": q(50),
        "P10": q(10),
        "mean": round(sum(r["depth"] * r["p"] for r in d) / 100, 1),
        "exceedance": exceed,
    }


def check(contact: dict, evidence: list[dict]) -> list[str]:
    """Problems between a contact and the wells: oil below the contact, or water above it."""
    lo = contact.get("range", {}).get("min") or (
        min(r["depth"] for r in contact["distribution"])
        if "distribution" in contact
        else contact["depth"]
    )
    hi = contact.get("range", {}).get("max") or (
        max(r["depth"] for r in contact["distribution"])
        if "distribution" in contact
        else contact["depth"]
    )
    out = []
    for e in evidence:
        if (
            e.get("segment") == "outside"
        ):  # a penetration outside the field says nothing about the field's contact
            continue
        if e["fluid"] == "oil" and e["base"] > hi:
            out.append(
                f"oil seen to {e['base']} m in {e['well']} is below even the deepest contact ({hi} m): contradicted"
            )
        elif e["fluid"] == "oil" and e["base"] > lo:
            out.append(
                f"oil seen to {e['base']} m in {e['well']} is below the shallowest contact ({lo} m)"
            )
        if e["fluid"] == "water":
            if e["top"] < lo:
                out.append(
                    f"water from {e['top']} m in {e['well']} is above even the shallowest contact ({lo} m): contradicted"
                )
            elif e["top"] < hi:
                out.append(
                    f"water from {e['top']} m in {e['well']} is above the deepest contact ({hi} m)"
                )
    return out


def build(
    zip_path: str,
    out_dir: str = "data/out",
    curated: str = "data/contacts/volve_curated.json",
) -> dict:
    cur = json.loads(Path(curated).read_text(encoding="utf-8"))
    picks = parse_picks(zip_path).dropna(subset=["easting", "northing"])

    def well_xy(name: str, surface: str = "Hugin Fm. VOLVE Top") -> list[float]:
        r = picks[
            (picks.well == name) & picks.surface.str.contains(surface, regex=False)
        ].iloc[0]
        x, y, _ = convert([r.easting], [r.northing])
        return [round(float(x[0]), 1), round(float(y[0]), 1)]

    g = cur["georeference"]
    cp = g["control_points"]
    px = np.array([c["px"] for c in cp], float)
    xy = np.array([well_xy(c["well"], c["surface"]) for c in cp], float)
    to_map, scale, rot = similarity(px, xy)

    outline = np.round(to_map(cur["outline_px"]), 1)
    barrier = np.round(extend(to_map(cur["barrier_px"]), EXTEND_M), 1)
    segments = [
        {
            "id": s["id"],
            "name": s["name"],
            "well": s["well"],
            "seed": well_xy(s["well"]),
            "note": s.get("note"),
        }
        for s in cur["segments"]
    ]
    evidence = [{**e, "xy": well_xy(e["well"])} for e in cur["evidence"]]

    cases, checks = [], []
    for case in cur["cases"]:
        contacts = []
        for c in case["contacts"]:
            c = dict(c)
            if "distribution" in c:
                c["quantiles"] = quantiles(c["distribution"])
            probs = check(c, cur["evidence"])
            c["contradicted"] = bool(probs) and any("contradicted" in p for p in probs)
            for p in probs:
                checks.append({"case": case["id"], "kind": c["kind"], "problem": p})
            contacts.append(c)
        cases.append(
            {k: v for k, v in case.items() if k != "contacts"} | {"contacts": contacts}
        )
    out = {
        "crs": "EPSG:25831", "source_crs": "EPSG:23031", "reservoir": cur["reservoir"], "horizon": cur["horizon"], "datum": cur["datum"],
        "attribution": ATTRIBUTION,
        "georeference": {"figure": g["figure"], "method": g["method"], "accuracy_m": g["accuracy_m"], "scale_m_per_px": round(scale, 3), "rotation_deg": round(rot, 2),
                         "control_points": [{"well": c["well"], "px": c["px"], "xy": list(map(float, p))} for c, p in zip(cp, xy)]},
        "outline": {"xy": outline.tolist(), "note": cur["outline_note"]},
        "barriers": [{"id": "dynamic-barrier", "name": "Dynamic barrier (PUD Figure 4.1)", "kind": "digitised", "accuracy_m": g["accuracy_m"], "note": cur["barrier_note"], "xy": barrier.tolist()}],
        "segments": segments, "evidence": evidence, "minimum_contacts": cur["minimum_contacts"], "cases": cases, "checks": checks,
    }  # fmt: skip
    path = Path(out_dir) / "contacts.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    q = next(c for c in cases[0]["contacts"])["quantiles"]
    print(
        f"wrote {path}: georeference scale {scale:.2f} m/px, rotation {rot:.1f} deg; OWC P90/P50/P10 = {q['P90']}/{q['P50']}/{q['P10']}, mean {q['mean']}; {len(checks)} checks flagged"
    )
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "data/out")
