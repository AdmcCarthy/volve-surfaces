// Interactive viewer: one horizon, controls on the left, state kept in the URL hash.
import { loadSet, loadGrid, extent } from "./grid.js";
import { stopsOf, RAMPS } from "./ramps.js";
import { renderMap, probe } from "./render.js";
import { ATTRIBUTION, initRoot, setScheme, seg, renderLegend, factsHTML, store } from "./ui.js";

initRoot();
const $ = (id) => document.getElementById(id);
const DETAIL = [[0, "Raw"], [25, "Fine"], [60, "Display"], [120, "Bold"], [240, "Broad"]];
const defaults = { set: "real", h: "hugin_top_depth", fill: "stepped", ramp: "fjord", emph: "deep", classes: 9, method: "nice", detail: 60, contours: "none", shade: 0 };
const state = { ...defaults };
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) if (k in defaults) state[k] = typeof defaults[k] === "number" ? Number(v) : v;
const sets = {};
let g = null, info = null;

const getSet = (name) => (sets[name] ??= loadSet(`data/${name}`));
const save = () => history.replaceState(null, "", `#${new URLSearchParams(Object.entries(state).filter(([k, v]) => v !== defaults[k])).toString()}`);

async function draw() {
  save();
  $("f-classes").hidden = $("f-method").hidden = state.fill !== "stepped";
  try {
    const set = await getSet(state.set);
    g = await loadGrid(set, state.h);
  } catch (e) {
    $("title").textContent = "Data not found";
    $("sub").textContent = String(e.message);
    return;
  }
  const [lo, hi] = extent(g.z), interval = d3.tickStep(lo, hi, 30);
  info = renderMap($("map"), g, { fill: state.fill, stops: stopsOf(state.ramp, state.emph === "shallow"), classes: state.classes, method: state.method,
    sigmaM: state.detail, contours: state.contours, interval, shade: state.shade });
  renderLegend($("legend"), info);
  $("facts").innerHTML = factsHTML(info, g);
  $("title").textContent = `${g.label}, ${g.domain === "twt" ? "two-way time" : "depth"}${g.manifest.synthetic ? " (synthetic)" : ""}`;
  $("sub").textContent = `${g.domain === "twt" ? "ms TWT" : "m, positive down, datum not stated"} · ED50 / UTM 31N (${g.manifest.crs.replace("EPSG:", "EPSG ")}) · 25 m grid`;
  $("attr").textContent = g.manifest.synthetic ? g.manifest.attribution : ATTRIBUTION;
}

// controls
const bind = (id, key, options, num = false) => seg($(id), options, state[key], (v) => { state[key] = num ? Number(v) : v; draw(); });
bind("c-set", "set", [["real", "Volve"], ["synthetic", "Synthetic"]]);
bind("c-fill", "fill", [["linear", "Linear"], ["stepped", "Stepped"]]);
bind("c-ramp", "ramp", Object.entries(RAMPS).filter(([, r]) => r.kind === "seq").map(([k, r]) => [k, r.label]));
bind("c-emph", "emph", [["deep", "Deepest"], ["shallow", "Shallowest"]]);
bind("c-classes", "classes", [[5, "5"], [7, "7"], [9, "9"], [12, "12"]], true);
bind("c-method", "method", [["nice", "Rounded"], ["equal", "Equal"], ["quantile", "Quantile"]]);
bind("c-detail", "detail", DETAIL, true);
bind("c-contours", "contours", [["none", "None"], ["lines", "Lines"], ["index", "Index"]]);
bind("c-shade", "shade", [[0, "Off"], [0.5, "Soft"], [1, "Strong"]], true);
const scheme = seg($("c-scheme"), [["light", "Light"], ["dark", "Dark"]], document.documentElement.dataset.colourScheme, (v) => { setScheme(v); draw(); });

async function fillHorizons() {
  const set = await getSet(state.set).catch(() => null);
  if (!set) return;
  const sel = $("c-h");
  sel.replaceChildren(...["depth", "twt"].map((d) => {
    const og = document.createElement("optgroup");
    og.label = d === "depth" ? "Depth (m)" : "Two-way time (ms)";
    set.m.horizons.filter((h) => h.domain === d).forEach((h) => og.append(new Option(h.label, h.id, false, h.id === state.h)));
    return og;
  }));
  if (![...sel.options].some((o) => o.value === state.h)) state.h = sel.options[0].value;
  sel.value = state.h;
}
$("c-h").addEventListener("change", (e) => { state.h = e.target.value; draw(); });
$("c-set").addEventListener("click", async () => { await fillHorizons(); draw(); });

// readout under the pointer (raw value, not the smoothed one)
const read = $("read");
$("map").addEventListener("pointermove", (e) => {
  if (!g || !info) return;
  const p = probe(g, info, e.offsetX, e.offsetY);
  if (Number.isNaN(p.z)) { read.classList.remove("on"); return; }
  read.textContent = `${d3.format(",.1f")(p.z)} ${g.unit} · E ${d3.format(",.0f")(p.easting)} N ${d3.format(",.0f")(p.northing)}`;
  read.classList.add("on");
});
$("map").addEventListener("pointerleave", () => read.classList.remove("on"));

let timer, lastW = 0;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (w === lastW) return;
  lastW = w; clearTimeout(timer); timer = setTimeout(() => { if (g) draw(); }, 150);
}).observe($("fig"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (store.get("scheme", null)) return;
  setScheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  scheme.set(document.documentElement.dataset.colourScheme);
  draw();
});
fillHorizons().then(draw);
