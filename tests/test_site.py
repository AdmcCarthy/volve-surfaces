import re
from pathlib import Path

import stage

ROOT = Path(__file__).parent.parent
SITE = ROOT / "site"
OWN = [*SITE.glob("*.html"), *SITE.glob("js/*.js"), SITE / "css" / "site.css"]


def test_no_raw_hex_colours_outside_the_vendored_tokens():
    # colour comes from SubScout tokens (css/subscout/tokens.css), never from hex in our own files
    for f in OWN:
        assert not re.search(
            r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])",
            f.read_text(encoding="utf-8"),
        ), f.name


def test_ramps_are_read_from_tokens_that_exist():
    tokens = (SITE / "css" / "subscout" / "tokens.css").read_text(encoding="utf-8")
    for name in ("fjord", "cobalt", "shale"):
        for i in range(1, 8):
            assert f"--ss-data-seq-{name}-{i}:" in tokens
    for name in ("default", "fjord_ochre"):
        for i in range(1, 10):
            assert f"--ss-data-div-{name}-{i}:" in tokens


def test_pages_pin_d3_and_carry_attribution_and_disclaimer():
    for page in ("index.html", "viewer.html"):
        html = (SITE / page).read_text(encoding="utf-8")
        assert "d3/7.9.0/d3.min.js" in html
        assert "not connected with, sponsored or endorsed by equinor" in html.lower()
    assert "Equinor ASA" in (SITE / "js" / "ui.js").read_text(encoding="utf-8")


def test_stage_assembles_site_and_both_data_sets(tmp_path):
    stage.stage(tmp_path / "_site")
    out = tmp_path / "_site"
    assert (out / "index.html").exists() and (out / "viewer.html").exists()
    assert (out / "data" / "real" / "manifest.json").exists()
    assert (out / "data" / "synthetic" / "manifest.json").exists()
