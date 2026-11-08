"""Parse the Volve well picks (`Well_picks_Volve_v1.dat`): fixed-width tables, one block per well."""

from __future__ import annotations

import re
import zipfile

import pandas as pd

COLS = [
    "well",
    "surface",
    "obs",
    "qlf",
    "md",
    "tvd",
    "tvdss",
    "twt",
    "dip",
    "azi",
    "easting",
    "northing",
    "intrp",
]


def parse_picks(zip_path: str) -> pd.DataFrame:
    """One row per pick. Columns are cut at the runs of dashes under the header, so blanks stay blank."""
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.endswith("Well_picks_Volve_v1.dat"))
        lines = zf.read(name).decode("latin-1").splitlines()
    rows, spans = [], None
    for ln in lines:
        if re.match(r"^\s*-{3,}( +-{3,})+\s*$", ln):
            spans = [(m.start(), m.end()) for m in re.finditer(r"-+", ln)]
            continue
        if (
            spans
            and ln.strip()
            and not ln.startswith(("Well ", "#", "!"))
            and "Well name" not in ln
        ):
            cells = [
                ln[a : (spans[i + 1][0] if i + 1 < len(spans) else None)].strip()
                for i, (a, _) in enumerate(spans)
            ]
            rows.append(cells[: len(COLS)])
    df = pd.DataFrame(rows, columns=COLS[: len(rows[0])])
    for c in ("md", "tvd", "tvdss", "twt", "dip", "azi", "easting", "northing"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df
