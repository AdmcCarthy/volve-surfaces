// Interactive viewer: one horizon, controls on the left, state kept in the URL hash.
import { loadSet, loadGrid, extent, autoStep } from "../surface/grid.js";
import { rangeNote } from "../surface/describe.js";
import { stopsOf, RAMPS } from "../style/ramps.js";
import { createSurfaceLayer } from "../layers/surface.js";
import { createFaultLayer, loadFaults } from "../layers/faults.js";
import { createContactsLayer, loadContacts } from "../layers/contacts.js";
import { compose, probeAll } from "./view.js";
import { sheetCanvas, downloadPng } from "./export.js";
import { titleRows, renderTitleBox, drawLocator } from "./titlebox.js";
import { ATTRIBUTION, initRoot, setScheme, seg, renderLegend, renderEntries, factsHTML, store } from "./ui.js";

initRoot();
const $ = (id) => document.getElementById(id);
// Detail: how the surface is prepared for display. Smoothing is edge-preserving (fault steps are kept) and stated on the map.
const DETAIL = { raw: { sigmaM: 0, upsample: 1 }, light: { sigmaM: 0, upsample: 2 }, fine: { sigmaM: 25, upsample: 2 }, medium: { sigmaM: 50, upsample: 2 } };
const defaults = { set: "real", h: "hugin_top_depth", fill: "stepped", ramp: "fjord", step: "auto", min: null, max: null, detail: "fine", contour: 10, shade: 0, light: "auto", faults: "off", contacts: "off", ccase: "", ccolour: "continuous", cfade: "on", cpalette: "subscout" };
const NUM = new Set(["contour", "shade", "min", "max"]);
const state = { ...defaults };
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
  if (!(k in defaults)) continue;
  state[k] = NUM.has(k) || (k === "step" && v !== "auto") ? Number(v) : v;
}
const sets = {};
let sheet = null, g = null, info = null, layers = [], view = null;
const faultData = {}, contactData = {};
let contextData = null;

const getSet = (name) => (sets[name] ??= loadSet(`data/${name}`));
const getFaults = (name) => (faultData[name] ??= loadFaults(`data/${name}`));
const getContext = () => (contextData ??= fetch("data/context/north_sea.json").then((r) => { if (!r.ok) throw new Error("no context"); return r.json(); }));
const getContacts = (name) => (contactData[name] ??= loadContacts(`data/${name}`));
// the fault polygons that belong to the horizon on screen: hugin_top_depth and hugin_top_twt both show the top-Hugin polygons
const horizonKey = (h) => (/^hugin_(top|base)_/.test(h) ? h.replace(/_(depth|twt)$/, "") : null);
const save = () => history.replaceState(null, "", `#${new URLSearchParams(Object.entries(state).filter(([k, v]) => v !== defaults[k] && v !== null).map(([k, v]) => [k, String(v)])).toString()}`);

let drawId = 0; // a draw that is overtaken by a newer one stops, so slow loads never overwrite the page with stale layers
async function draw() {
  const mine = ++drawId;
  save();
  $("f-step").hidden = state.fill !== "stepped";
  $("f-light").hidden = !state.shade;
  try {
    const set = await getSet(state.set);
    const loaded = await loadGrid(set, state.h);
    if (mine !== drawId) return;
    g = loaded;
  } catch (e) {
    $("title").textContent = "Data not found";
    $("sub").textContent = String(e.message);
    return;
  }
  const [lo, hi] = extent(g.z), step = state.step === "auto" ? autoStep(lo, hi) : state.step;
  const surface = createSurfaceLayer(g, { fill: state.fill, stops: stopsOf(state.ramp), step, min: state.min, max: state.max,
    ...DETAIL[state.detail], contour: state.contour, shade: state.shade, light: state.light });
  const ls = [surface];
  // hydrocarbon contacts belong to the top-reservoir depth map; they sit above the surface and below the faults
  const cd = state.contacts === "on" ? await getContacts(state.set).catch(() => null) : null;
  if (mine !== drawId) return;
  const cOk = cd && g.domain === "depth" && horizonKey(state.h) === cd.horizon && state.h.startsWith(cd.horizon);
  $("f-ccase").hidden = $("f-ccolour").hidden = $("f-cfade").hidden = $("f-cpalette").hidden = state.contacts !== "on" || !cd;
  $("f-contacts-note").textContent = state.contacts !== "on" ? "" : !cd ? "No contacts for this data set." : cOk ? "" : "Contacts are drawn on the top Hugin depth map: choose Hugin Fm top, depth.";
  if (cd && !$("c-ccase").options.length) $("c-ccase").replaceChildren(...cd.cases.map((c) => new Option(c.label, c.id)));
  if (cd) { if (!cd.cases.some((c) => c.id === state.ccase)) state.ccase = cd.cases[0].id; $("c-ccase").value = state.ccase; }
  if (cOk) ls.push(createContactsLayer(g, cd, { caseId: state.ccase, prepared: surface.prepared(), colour: state.ccolour, fade: state.cfade === "on", standard: state.cpalette === "geostandard" }));
  const fd = state.faults === "off" ? null : await getFaults(state.set).catch(() => null);
  if (mine !== drawId) return;
  const fl = fd && createFaultLayer(fd, { polygons: ["polygons", "both"].includes(state.faults), sticks: ["sticks", "both"].includes(state.faults), horizon: horizonKey(state.h) });
  if (fl && fl.count) ls.push(fl);
  layers = ls;
  view = compose($("map"), layers, { furniture: true });
  info = surface.legend();
  const rows = titleRows({ g, bounds: layers[0].bounds(), contour: state.contour, contacts: layers.some((l) => l.id === "contacts") });
  renderTitleBox($("titlebox"), rows);
  const loc = $("titlebox").querySelector(".vs-tb-loc");
  if (g.manifest.synthetic) loc.replaceChildren(Object.assign(document.createElement("small"), { className: "vs-hint", textContent: "Synthetic data: no real location." }));
  else {
    const cd = await getContext().catch(() => null);
    if (mine !== drawId) return;
    if (cd) {
      const c = document.createElement("canvas");
      c.setAttribute("role", "img"); c.setAttribute("aria-label", "Location map: the Volve field on the Utsira High, North Sea");
      loc.replaceChildren(c, Object.assign(document.createElement("small"), { className: "vs-hint", textContent: cd.attribution }));
      drawLocator(c, cd);
    } else loc.replaceChildren();
  }
  renderLegend($("legend"), info);
  renderEntries($("entries"), layers.slice(1).flatMap((l) => l.legend()));
  $("facts").innerHTML = factsHTML(layers.flatMap((l, i) => l.facts(i === 0 ? {} : undefined)));
  $("f-faults-note").textContent = state.faults !== "off" && fd && !(fl && fl.count) ? "No fault polygons for this horizon: choose Sticks or Both, or a Hugin horizon." : "";
  // range inputs show the colour range in force (the data range rounded to the step unless set by hand)
  $("i-min").value = info.range.lo; $("i-max").value = info.range.hi; $("i-min").step = $("i-max").step = step;
  $("h-range").textContent = rangeNote(info) || (info.range.auto ? `Data range ${d3.format(",.1f")(info.range.dataMin)} to ${d3.format(",.1f")(info.range.dataMax)} ${g.unit}, rounded to the step.` : "");
  $("l-step").textContent = `Class step (${g.unit})${state.step === "auto" ? `, auto ${step}` : ""}`;
  $("l-contour").textContent = `Contour lines (${g.unit})`;
  $("title").textContent = `${g.label}, ${g.domain === "twt" ? "two-way time" : "depth"}`;
  const crsName = { "EPSG:25831": "ETRS89 / UTM 31N" }[g.manifest.crs] ?? g.manifest.crs;
  $("sub").textContent = `${g.domain === "twt" ? "ms TWT" : g.manifest.synthetic ? "m, synthetic datum" : "m below mean sea level, positive down"} · ${crsName} (${g.manifest.crs.replace("EPSG:", "EPSG ")}) · 25 m grid`;
  $("attr").textContent = g.manifest.synthetic ? g.manifest.attribution : ATTRIBUTION;
  sheet = { title: $("title").textContent, sub: $("sub").textContent, rows, info, entries: layers.slice(1).flatMap((l) => l.legend()).filter((e) => e.label), facts: layers.flatMap((l, i) => l.facts(i === 0 ? {} : undefined)), attribution: $("attr").textContent, name: `volve-surfaces-${state.set}-${state.h}.png` };
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
bind("c-faults", "faults", [["off", "Off"], ["polygons", "Polygons"], ["sticks", "Sticks"], ["both", "Both"]]);
bind("c-contacts", "contacts", [["off", "Off"], ["on", "On"]]);
bind("c-ccolour", "ccolour", [["continuous", "Continuous"], ["stepped", "Stepped"]]);
bind("c-cfade", "cfade", [["on", "Fade"], ["off", "None"]]);
bind("c-cpalette", "cpalette", [["subscout", "SubScout"], ["geostandard", "Geostandard"]]);
$("c-ccase").addEventListener("change", (e) => { state.ccase = e.target.value; draw(); });
const scheme = seg($("c-scheme"), [["light", "Light"], ["dark", "Dark"]], document.documentElement.dataset.colourScheme, (v) => { setScheme(v); draw(); });

// PNG export: the map with scale bar, title box, location map, colour bar, method and attribution
$("b-export").addEventListener("click", () => {
  if (!sheet) return;
  const locator = $("titlebox").querySelector(".vs-tb-loc canvas");
  downloadPng(sheetCanvas({ ...sheet, map: $("map"), mapCssWidth: view.width, locator }), sheet.name);
});

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
$("c-set").addEventListener("click", async () => { state.min = state.max = null; state.ccase = ""; $("c-ccase").replaceChildren(); await fillHorizons(); draw(); });

// readout under the pointer: the raw surface value (not the smoothed one) and any fault within 30 m
const read = $("read");
$("map").addEventListener("pointermove", (e) => {
  if (!view) return;
  const [x, y] = view.unproject(e.offsetX, e.offsetY), hits = probeAll(layers, x, y);
  const s = hits.find((h) => h.layer === "surface"), f = hits.find((h) => h.layer === "faults");
  if (!s) { read.classList.remove("on"); return; }
  read.textContent = `${d3.format(",.1f")(s.value)} ${s.unit} · E ${d3.format(",.0f")(x)} N ${d3.format(",.0f")(y)}${f ? ` · ${f.label}` : ""}`;
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
