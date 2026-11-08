// Interactive viewer: one horizon, controls on the left, state kept in the URL hash.
import { loadSet, loadGrid, extent, autoStep } from "./grid.js";
import { stopsOf, RAMPS } from "./ramps.js";
import { renderMap, probe } from "./render.js";
import { ATTRIBUTION, initRoot, setScheme, seg, renderLegend, factsHTML, rangeNote, store } from "./ui.js";

initRoot();
const $ = (id) => document.getElementById(id);
// Detail: how the surface is prepared for display. Smoothing is edge-preserving (fault steps are kept) and stated on the map.
const DETAIL = { raw: { sigmaM: 0, upsample: 1 }, light: { sigmaM: 0, upsample: 2 }, fine: { sigmaM: 25, upsample: 2 }, medium: { sigmaM: 50, upsample: 2 } };
const defaults = { set: "real", h: "hugin_top_depth", fill: "stepped", ramp: "fjord", step: "auto", min: null, max: null, detail: "fine", contour: 10, shade: 0, light: "auto" };
const NUM = new Set(["contour", "shade", "min", "max"]);
const state = { ...defaults };
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
  if (!(k in defaults)) continue;
  state[k] = NUM.has(k) || (k === "step" && v !== "auto") ? Number(v) : v;
}
const sets = {};
let g = null, info = null;

const getSet = (name) => (sets[name] ??= loadSet(`data/${name}`));
const save = () => history.replaceState(null, "", `#${new URLSearchParams(Object.entries(state).filter(([k, v]) => v !== defaults[k] && v !== null).map(([k, v]) => [k, String(v)])).toString()}`);

async function draw() {
  save();
  $("f-step").hidden = state.fill !== "stepped";
  $("f-light").hidden = !state.shade;
  try {
    const set = await getSet(state.set);
    g = await loadGrid(set, state.h);
  } catch (e) {
    $("title").textContent = "Data not found";
    $("sub").textContent = String(e.message);
    return;
  }
  const [lo, hi] = extent(g.z), step = state.step === "auto" ? autoStep(lo, hi) : state.step;
  info = renderMap($("map"), g, { fill: state.fill, stops: stopsOf(state.ramp), step, min: state.min, max: state.max,
    ...DETAIL[state.detail], contour: state.contour, shade: state.shade, light: state.light });
  renderLegend($("legend"), info);
  $("facts").innerHTML = factsHTML(info, g);
  // range inputs show the colour range in force (the data range rounded to the step unless set by hand)
  $("i-min").value = info.range.lo; $("i-max").value = info.range.hi; $("i-min").step = $("i-max").step = step;
  $("h-range").textContent = rangeNote(info) || (info.range.auto ? `Data range ${d3.format(",.1f")(info.range.dataMin)} to ${d3.format(",.1f")(info.range.dataMax)} ${g.unit}, rounded to the step.` : "");
  $("l-step").textContent = `Class step (${g.unit})${state.step === "auto" ? `, auto ${step}` : ""}`;
  $("l-contour").textContent = `Contour lines (${g.unit})`;
  $("title").textContent = `${g.label}, ${g.domain === "twt" ? "two-way time" : "depth"}`;
  $("sub").textContent = `${g.domain === "twt" ? "ms TWT" : "m, positive down, datum not stated"} · ED50 / UTM 31N (${g.manifest.crs.replace("EPSG:", "EPSG ")}) · 25 m grid`;
  $("attr").textContent = g.manifest.synthetic ? g.manifest.attribution : ATTRIBUTION;
}

// controls
const bind = (id, key, options, num = false) => seg($(id), options, state[key], (v) => { state[key] = num && v !== "auto" ? Number(v) : v; draw(); });
bind("c-set", "set", [["real", "Volve"], ["synthetic", "Synthetic"]]);
bind("c-fill", "fill", [["linear", "Linear"], ["stepped", "Stepped"]]);
bind("c-ramp", "ramp", Object.entries(RAMPS).filter(([, r]) => r.kind === "seq").map(([k, r]) => [k, r.label]));
bind("c-step", "step", [["auto", "Auto"], [10, "10"], [20, "20"], [50, "50"], [100, "100"]], true);
bind("c-detail", "detail", [["raw", "Raw"], ["light", "Light"], ["fine", "Fine"], ["medium", "Medium"]]);
bind("c-contour", "contour", [[0, "None"], [10, "10"], [20, "20"], [50, "50"]], true);
bind("c-shade", "shade", [[0, "Off"], [0.5, "Soft"], [1, "Strong"]], true);
bind("c-light", "light", [["auto", "Across faults"], ["nw", "North-west"]]);
const scheme = seg($("c-scheme"), [["light", "Light"], ["dark", "Dark"]], document.documentElement.dataset.colourScheme, (v) => { setScheme(v); draw(); });

// colour range: typed values are kept until Reset or a new horizon
const setRange = (key, el) => el.addEventListener("change", () => { state[key] = el.value === "" ? null : Number(el.value); draw(); });
setRange("min", $("i-min")); setRange("max", $("i-max"));
$("b-reset").addEventListener("click", () => { state.min = state.max = null; draw(); });

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
$("c-h").addEventListener("change", (e) => { state.h = e.target.value; state.min = state.max = null; draw(); });
$("c-set").addEventListener("click", async () => { state.min = state.max = null; await fillHorizons(); draw(); });

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
