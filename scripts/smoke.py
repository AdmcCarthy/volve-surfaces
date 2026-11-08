"""Browser smoke check: serve the staged site, open both pages in Edge or Chrome, fail on any console error or unpainted map.

    uv run python scripts/stage.py && uv run --with playwright python scripts/smoke.py [out_dir]

Not part of CI (it needs a browser); run it before every push that touches site/. Screenshots go to out_dir (default _smoke/).
"""

from __future__ import annotations

import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# the shared layer contract (site/js/layers/contract.js): every layer must pass this
CONTRACT = """
async () => {
  const G = await import('/js/surface/grid.js'), C = await import('/js/layers/contract.js'), R = await import('/js/style/ramps.js');
  const S = await import('/js/layers/surface.js'), F = await import('/js/layers/faults.js'), V = await import('/js/host/view.js');
  const problems = [], canvas = document.createElement('canvas');
  for (const set of ['real', 'synthetic']) {
    const g = await G.loadGrid(await G.loadSet('data/' + set), 'hugin_top_depth'), data = await F.loadFaults('data/' + set);
    const surface = S.createSurfaceLayer(g, { step: 50, stops: R.stopsOf('fjord'), sigmaM: 25, upsample: 2, contour: 10 });
    const layers = [surface, F.createFaultLayer(data, { polygons: true, sticks: true, horizon: 'hugin_top' }),
      F.createFaultLayer(data, { polygons: false, sticks: false })]; // the last is empty: must still meet the contract
    for (const l of layers) for (const p of C.checkLayer(l)) problems.push(set + ' ' + l.id + ': ' + p);
    try { V.compose(canvas, layers.slice(0, 2), { width: 600 }); } catch (e) { problems.push(set + ' compose: ' + e.message); }
    for (const l of layers) {
      if (!Array.isArray(l.facts())) problems.push(set + ' ' + l.id + ': facts() is not a list');
      if (l.legend() == null) problems.push(set + ' ' + l.id + ': legend() is empty after draw');
      if (l.probe(0, 0) !== null) problems.push(set + ' ' + l.id + ': probe far outside the map is not null');
    }
    const [x0, y0, x1, y1] = surface.bounds(), mid = surface.probe((x0 + x1) / 2, (y0 + y1) / 2);
    if (mid !== null && !Number.isFinite(mid.value)) problems.push(set + ': probe value is not a number');
  }
  try { C.assertSameCrs([{ id: 'x', crs: 'EPSG:23031' }]); problems.push('a layer in ED50 was not refused'); } catch { /* expected */ }
  return problems;
}
"""

PAGES = [
    ("viewer", "viewer.html#shade=0.5", "canvas#map", "light"),
    ("viewer_faults", "viewer.html#faults=both&shade=0.5", "canvas#map", "light"),
    (
        "viewer_synthetic",
        "viewer.html#set=synthetic&h=hugin_top_depth&faults=polygons",
        "canvas#map",
        "light",
    ),
    (
        "viewer_dark",
        "viewer.html#fill=linear&contour=0&faults=polygons",
        "canvas#map",
        "dark",
    ),
    ("options", "index.html", ".vs-card canvas", "light"),
]


def serve(directory: Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(directory), **k)

        def log_message(self, *args):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main(out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    httpd = serve(ROOT / "_site")
    base, failures = f"http://127.0.0.1:{httpd.server_address[1]}/", []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge")
        except PlaywrightError:  # no Edge: try Chrome
            browser = p.chromium.launch(channel="chrome")
        for name, path, painted, scheme in PAGES:
            ctx = browser.new_context(
                viewport={"width": 1280, "height": 1200}, color_scheme=scheme
            )
            ctx.add_init_script(f"localStorage.setItem('vs-scheme','{scheme}')")
            page, errors = ctx.new_page(), []
            page.on(
                "console",
                lambda m, e=errors: e.append(m.text) if m.type == "error" else None,
            )
            page.on("pageerror", lambda exc, e=errors: e.append(str(exc)))
            page.goto(base + path)
            page.wait_for_timeout(2500)
            n = page.evaluate(
                f"[...document.querySelectorAll('{painted}')].filter(c => c.width > 300).length"
            )
            page.screenshot(path=str(out / f"{name}.png"))
            if errors or n == 0:
                failures.append(f"{name}: {n} painted canvases, errors {errors[:3]}")
            print(f"{name}: {n} painted canvases, {len(errors)} console errors")
            ctx.close()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(base + "viewer.html")
        problems = page.evaluate(CONTRACT)
        print(f"layer contract: {len(problems)} problems")
        failures += [f"contract: {p}" for p in problems]
        browser.close()
    httpd.shutdown()
    for f in failures:
        print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_smoke"))
