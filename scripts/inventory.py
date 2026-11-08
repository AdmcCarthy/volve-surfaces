"""Inventory of the Volve geophysical interpretations zip: counts, extents, nulls, Z ranges.

    uv run python scripts/inventory.py path/to/Volve_Geophysical_Interpretations.zip [out.md]

Reads the zip directly (nothing is extracted). Horizon rows are `IL, XL, UTMX, UTMY, Z` after a `#` header.
"""

from __future__ import annotations

import io
import re
import sys
import zipfile

import numpy as np
import pandas as pd

ROW = re.compile(rb"^\s*-?[\d.]+(,\s*-?[\d.]+){4}\s*$")
NULL_LIMIT = 1e5  # |Z| beyond this, or <= -999, is treated as a null sentinel


def header_lines(raw: bytes) -> list[str]:
    out = []
    for line in io.BytesIO(raw):
        s = line.decode("latin-1")
        if not s.startswith("#"):
            break
        out.append(s.strip())
    return out


def horizon_stats(name: str, raw: bytes) -> dict:
    hdr = header_lines(raw)
    lines = raw.splitlines()
    meta = [
        ln.decode("latin-1").strip()
        for ln in lines
        if ln.strip() and not ln.startswith(b"#") and not ROW.match(ln)
    ]
    sections, prev_row = 1, False
    for ln in lines:
        is_row = bool(ROW.match(ln))
        if (
            prev_row
            and not is_row
            and ln.strip()
            and not ln.startswith(b"#")
            and ln.strip() != b","
        ):
            sections += 1
        if ln.strip():
            prev_row = is_row
    body = b"\n".join(ln for ln in lines if ROW.match(ln))
    df = pd.read_csv(
        io.BytesIO(body), header=None, names=["il", "xl", "x", "y", "z"], dtype=float
    )
    z = df["z"]
    null = (z.abs() > NULL_LIMIT) | (z <= -999) | z.isna()
    ok = df[~null]
    grid = ok.drop_duplicates(["il", "xl"])
    il, xl = np.sort(ok["il"].unique()), np.sort(ok["xl"].unique())
    crs = next(
        (
            re.sub(r"^#.*?:\s*", "", h)
            for h in hdr
            if "Target export data file cartographic" in h
        ),
        "",
    )
    return {
        "file": name.split("Horizons/")[-1],
        "rows": len(df),
        "nulls": int(null.sum()),
        "dup_ilxl": len(ok) - len(grid),
        "il": f"{il.min():.0f}-{il.max():.0f} ({len(il)}, step {np.median(np.diff(il)):.0f})",
        "xl": f"{xl.min():.0f}-{xl.max():.0f} ({len(xl)}, step {np.median(np.diff(xl)):.0f})",
        "fill": f"{len(grid) / (len(il) * len(xl)):.0%}",
        "x": f"{ok['x'].min():.0f}-{ok['x'].max():.0f}",
        "y": f"{ok['y'].min():.0f}-{ok['y'].max():.0f}",
        "z": f"{ok['z'].min():.1f} to {ok['z'].max():.1f} (mean {ok['z'].mean():.1f})",
        "crs": crs,
        "sections": sections,
        "domain": "DEPTH" if "DEPTH" in name else "TIME",
        "meta": [m for m in meta if m != "="],
    }


def faults_stats(raw: bytes) -> str:
    rows = [
        ln.decode("latin-1")
        for ln in io.BytesIO(raw)
        if ln.strip() and not ln.startswith((b"#", b"!"))
    ]
    names = {ln[52:100].strip() for ln in rows}
    return f"{len(rows)} points, {len(names)} fault names"


def main(zip_path: str, out: str | None) -> None:
    lines = ["# Inventory", "", f"Source: `{zip_path}`", ""]
    with zipfile.ZipFile(zip_path) as zf:
        horizons = [
            n for n in zf.namelist() if n.endswith(".dat") and "/Horizons/" in n
        ]
        lines += [
            "## Horizons",
            "",
            "| File | Domain | Rows | Nulls | Dup IL/XL | IL | XL | Grid fill | X | Y | Z |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        crs_seen: set[str] = set()
        for n in sorted(horizons):
            s = horizon_stats(n, zf.read(n))
            crs_seen.add(s["crs"])
            lines.append(
                f"| {s['file']}{' (**' + str(s['sections']) + ' sections**)' if s['sections'] > 1 else ''} | {s['domain']} | {s['rows']:,} | {s['nulls']} | {s['dup_ilxl']} | {s['il']} | {s['xl']} | {s['fill']} | {s['x']} | {s['y']} | {s['z']} |"
            )
            print(s["file"], s["rows"], s["z"], flush=True)
        lines += ["", f"Target CRS strings in headers: {sorted(crs_seen)}", ""]
        lines += ["## Faults and wells", ""]
        for n in sorted(zf.namelist()):
            if n.endswith("Volve_Official_Faults.dat"):
                lines.append(f"- Fault sticks: {faults_stats(zf.read(n))}")
            elif n.endswith((".dat",)) and ("Fault_polygons" in n or "/Wells/" in n):
                body = zf.read(n).decode("latin-1").splitlines()
                data = [
                    ln for ln in body if ln.strip() and not ln.startswith(("#", "!"))
                ]
                lines.append(
                    f"- {n.split('Interpretations/')[-1]}: {len(data)} data lines; first: `{data[0][:110] if data else ''}`"
                )
    text = "\n".join(lines) + "\n"
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
