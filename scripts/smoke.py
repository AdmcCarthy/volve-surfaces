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

FILL = """
async () => {
  const G = await import('/js/surface/grid.js'), Fill = await import('/js/surface/fill.js'), C = await import('/js/layers/contract.js');
  const R = await import('/js/style/ramps.js'), S = await import('/js/layers/surface.js'), K = await import('/js/layers/contacts.js');
  const V = await import('/js/host/view.js');
  const problems = [], canvas = document.createElement('canvas'), near = (a, b) => Math.abs(a - b) < 1e-9;
  const expect = { real: { pdo2005: ['north', 'south'], 'pdo2005-base': ['north', 'south'], disc1993: ['south'] }, synthetic: { model: ['east', 'west'] } };
  for (const set of ['real', 'synthetic']) {
    const g = await G.loadGrid(await G.loadSet('data/' + set), 'hugin_top_depth'), data = await K.loadContacts('data/' + set);
    if (!data) { problems.push(set + ': no contacts file'); continue; }
    const surface = S.createSurfaceLayer(g, { step: 50, stops: R.stopsOf('fjord'), sigmaM: 25, upsample: 2 });
    for (const c of data.cases) {
      const layer = K.createContactsLayer(g, data, { caseId: c.id, prepared: surface.prepared() });
      for (const p of C.checkLayer(layer)) problems.push(set + ' ' + c.id + ': ' + p);
      try { V.compose(canvas, [surface, layer], { width: 500 }); } catch (e) { problems.push(set + ' ' + c.id + ' compose: ' + e.message); }
      const filled = layer.fill.segments.filter((s) => !s.empty && s.area_km2 > 0).map((s) => s.id).sort();
      if (JSON.stringify(filled) !== JSON.stringify(expect[set][c.id])) problems.push(set + ' ' + c.id + ': filled ' + filled + ', expected ' + expect[set][c.id]);
      const merged = layer.fill.segments.filter((s) => s.merged).map((s) => s.id);
      if (merged.length) problems.push(set + ' ' + c.id + ': segments merge across the barrier: ' + merged);
      if (set === 'synthetic' && layer.fill.segments.some((s) => s.open)) problems.push('synthetic ' + c.id + ': an accumulation is open to the survey edge, it should be closed');
      if (!Array.isArray(layer.legend()) || !layer.facts().length) problems.push(set + ' ' + c.id + ': empty legend or facts');
    }
  }
  // probability of hydrocarbons from the Volve development plan's Table 3.5 (exceedance of the discrete contacts)
  const T = [[3105, 24], [3120, 21], [3135, 28], [3170, 14], [3260, 7], [3330, 6]].map(([depth, p]) => ({ depth, p }));
  const m = Fill.segmentModel([{ kind: 'OWC', depth: 3120, distribution: T }]);
  const want = [[3100, 1], [3105, 1], [3120, 0.76], [3135, 0.55], [3170, 0.27], [3260, 0.13], [3330, 0.06], [3400, 0]];
  for (const [z, p] of want) if (!near(Fill.probAt(m, z), p)) problems.push('probAt ' + z + ' = ' + Fill.probAt(m, z) + ', expected ' + p);
  let last = 1;
  for (let z = 3000; z <= 3400; z += 5) { const p = Fill.probAt(m, z); if (p > last + 1e-12) problems.push('probability rises at ' + z); last = p; }
  const q = Fill.quantiles(T);
  if (q.P90 !== 3105 || q.P50 !== 3135 || q.P10 !== 3260) problems.push('quantiles ' + JSON.stringify(q));
  const dual = Fill.segmentModel([{ kind: 'GOC', depth: 2800 }, { kind: 'OWC', depth: 2900 }]);
  if (Fill.fluidAt(dual, 2790) !== 'gas' || Fill.fluidAt(dual, 2850) !== 'oil' || Fill.fluidAt(dual, 2950) !== null) problems.push('fluidAt on a gas cap over an oil leg');
  const tri = Fill.segmentModel([{ kind: 'OWC', depth: 20, range: { min: 10, likely: 20, max: 40 } }]);
  if (!near(Fill.probAt(tri, 10), 1) || !near(Fill.probAt(tri, 40), 0) || Math.abs(Fill.probAt(tri, 20 - 1e-9) - Fill.probAt(tri, 20 + 1e-9)) > 1e-6) problems.push('triangular probability is not continuous at the likely value');
  return problems;
}
"""

PAGES = [
    ("viewer", "viewer.html#shade=0.5", "canvas#map", "light"),
    ("viewer_faults", "viewer.html#faults=both&shade=0.5", "canvas#map", "light"),
    (
        "viewer_contacts",
        "viewer.html#contacts=on&ccase=pdo2005&faults=polygons",
        "canvas#map",
        "light",
    ),
    (
        "viewer_contacts_synthetic",
        "viewer.html#set=synthetic&contacts=on&ccase=model&ccolour=stepped",
        "canvas#map",
        "dark",
    ),
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
        fill_problems = page.evaluate(FILL)
        print(f"contacts fill and probability: {len(fill_problems)} problems")
        failures += [f"contacts: {p}" for p in fill_problems]
        browser.close()
    httpd.shutdown()
    for f in failures:
        print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_smoke"))
