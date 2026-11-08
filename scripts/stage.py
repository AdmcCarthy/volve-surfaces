"""Assemble the static site: site/ plus the grids (real as data/real, synthetic as data/synthetic) into _site/.

    uv run python scripts/stage.py [out_dir]
    python -m http.server -d _site 8000

The GitHub Pages workflow runs the same script.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stage(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    for src, name in (("data/out", "real"), ("data/synthetic", "synthetic")):
        shutil.copytree(
            ROOT / src, out / "data" / name, ignore=shutil.ignore_patterns(".gitkeep")
        )
    shutil.copytree(ROOT / "data" / "context", out / "data" / "context")
    (out / ".nojekyll").write_text("", encoding="utf-8")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    stage(target)
    print(f"staged {target}")
