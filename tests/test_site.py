import re
from pathlib import Path

import stage

ROOT = Path(__file__).parent.parent
SITE = ROOT / "site"
OWN = [
    *SITE.glob("*.html"),
    *(p for p in SITE.glob("js/**/*.js") if "vendor" not in p.parts),
    SITE / "css" / "site.css",
]


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
    assert "Equinor ASA" in (SITE / "js" / "host" / "ui.js").read_text(encoding="utf-8")


def test_stage_assembles_site_and_both_data_sets(tmp_path):
    stage.stage(tmp_path / "_site")
    out = tmp_path / "_site"
    assert (out / "index.html").exists() and (out / "viewer.html").exists()
    assert (out / "data" / "real" / "manifest.json").exists()
    assert (out / "data" / "synthetic" / "manifest.json").exists()


def test_strongest_colour_is_not_an_option_and_ten_metre_lines_are_default():
    for f in OWN:
        assert "emph" not in f.read_text(encoding="utf-8").lower().replace(
            "emphasis", ""
        ), f.name
    assert "contour: 10" in (SITE / "js" / "host" / "viewer.js").read_text(
        encoding="utf-8"
    )


def test_vendored_subscout_symbols_carry_a_notice_with_the_source_commit():
    v = SITE / "js" / "vendor" / "subscout"
    assert {p.name for p in v.iterdir()} >= {
        "symbols.js",
        "symbols-data.js",
        "symbols.json",
        "NOTICE.md",
    }
    assert re.search(
        r"commit [0-9a-f]{40}", (v / "NOTICE.md").read_text(encoding="utf-8")
    )


def test_modules_are_separate_surface_never_imports_layers_or_host():
    # dependency direction (docs/modules.md): host -> layers -> surface and style; never the other way
    for f in (SITE / "js" / "surface").glob("*.js"):
        assert not re.search(
            r'from "\.\./(layers|host)/', f.read_text(encoding="utf-8")
        ), f.name
    for f in (SITE / "js" / "layers").glob("*.js"):
        assert "../host/" not in f.read_text(encoding="utf-8"), f.name
    surface = (SITE / "js" / "layers" / "surface.js").read_text(encoding="utf-8")
    faults = (SITE / "js" / "layers" / "faults.js").read_text(encoding="utf-8")
    assert (
        "surface/" not in faults and "faults" not in surface
    )  # layers never import each other


def test_contacts_layer_uses_the_surface_module_but_never_another_layer_or_the_host():
    contacts = (SITE / "js" / "layers" / "contacts.js").read_text(encoding="utf-8")
    assert (
        '"../host/' not in contacts
        and '"./surface.js"' not in contacts
        and '"./faults.js"' not in contacts
    )
    assert (
        "../surface/fill.js" in contacts and "../vendor/subscout/symbols.js" in contacts
    )  # compute from the surface module, symbols from SubScout


def test_context_for_the_location_map_holds_the_volve_field_and_frame_in_reliefs_crs():
    import json

    ctx = json.loads(
        (ROOT / "data" / "context" / "north_sea.json").read_text(encoding="utf-8")
    )
    assert ctx["crs"] == "EPSG:25832"
    assert any(f["properties"]["name"] == "VOLVE" for f in ctx["fields"]["features"])
    wx0, wy0, wx1, wy1 = ctx["window"]
    assert all(wx0 < x < wx1 and wy0 < y < wy1 for x, y in ctx["extent"])
    base = json.loads(
        (ROOT / "data" / "context" / ctx["base"]).read_text(encoding="utf-8")
    )
    assert {f["properties"]["kind"] for f in base["features"]} == {"land", "sea"}
    assert base["bbox"][0] <= wx0 and base["bbox"][2] >= wx1
    assert (
        "Copernicus" in ctx["attribution"]
        and "EMODnet" in ctx["attribution"]
        and "NLOD" in ctx["attribution"]
    )


def test_stage_includes_the_context_and_the_pages_use_the_furniture(tmp_path):
    stage.stage(tmp_path / "site")
    assert (tmp_path / "site" / "data" / "context" / "north_sea.json").exists()
    view = (SITE / "js" / "host" / "view.js").read_text(encoding="utf-8")
    assert "drawScaleBar" in view
    assert 'id="titlebox"' in (SITE / "viewer.html").read_text(encoding="utf-8")


def test_base_pages_do_not_lead_with_work_in_progress():
    # the options page and the viewer's open controls are about surfaces; contacts and closures sit under Work in progress
    js = (SITE / "js" / "host" / "review.js").read_text(encoding="utf-8")
    assert 'dataset.page === "wip"' in js
    assert 'data-page="wip"' in (SITE / "wip.html").read_text(encoding="utf-8")
    assert "data-page" not in (SITE / "index.html").read_text(encoding="utf-8")
    viewer = (SITE / "viewer.html").read_text(encoding="utf-8")
    wip = viewer[viewer.index('<details class="vs-wip"') : viewer.index("</details>")]
    for control in ("c-contacts", "c-closures", "c-tentative"):
        assert control in wip and viewer.index(control) > viewer.index(
            '<details class="vs-wip"'
        )
