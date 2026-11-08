"""Parsing of Volve horizon exports (`IL, XL, UTMX, UTMY, Z` rows after a `#` header and metadata lines)."""

from __future__ import annotations

import io
import re
import zipfile

import pandas as pd

ROW = re.compile(rb"^\s*-?[\d.]+(,\s*-?[\d.]+){4}\s*$")
COLS = ["il", "xl", "x", "y", "z"]


def parse_sections(raw: bytes) -> list[pd.DataFrame]:
    """Split a horizon file into its numeric sections (a few files append a second surface after a new header)."""
    sections: list[list[bytes]] = []
    prev_row = False
    for ln in raw.splitlines():
        if not ln.strip():
            continue
        if ROW.match(ln):
            if not prev_row:
                sections.append([])
            sections[-1].append(ln)
            prev_row = True
        elif not ln.startswith(b"#") and ln.strip() != b",":
            prev_row = False
    return [
        pd.read_csv(io.BytesIO(b"\n".join(s)), header=None, names=COLS, dtype=float)
        for s in sections
    ]


def read_horizon(zip_path: str, member_suffix: str) -> tuple[str, pd.DataFrame, int]:
    """First numeric section of the zip member ending with `member_suffix`: (member name, rows, sections found)."""
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.endswith(member_suffix))
        secs = parse_sections(zf.read(name))
    return name, secs[0], len(secs)
