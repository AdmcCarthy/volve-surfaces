// Review page: one horizon under many treatments, painted lazily, repainted when the scheme, data set or emphasis changes.
import { loadSet, loadGrid, blur, derived, extent, autoStep } from "./grid.js";
import { RAMPS, stopsOf } from "./ramps.js";
import { renderMap } from "./render.js";
import { ATTRIBUTION, initRoot, setScheme, seg, renderLegend, factsHTML } from "./ui.js";

initRoot();
const $ = (id) => document.getElementById(id);
const state = { set: "real", emph: "deep" };
const sets = {};
const getSet = (n) => (sets[n] ??= loadSet(`data/${n}`));
const TOP = "hugin_top_depth", BASE = "hugin_base_depth";

// ---------------------------------------------------------------- what to show
const FINE = { sigmaM: 25, upsample: 2 };
const SECTIONS = [
  { id: "fill", title: "Fjord: linear or stepped",
    lead: "Fjord (the Tide preset) is the chosen ramp. Stepped reads values off the legend; linear shows shape without implying class boundaries. Cobalt and shale are kept below for reference only.",
    cards: [
      { title: "Fjord · stepped", ramp: "fjord", opts: { fill: "stepped" }, note: "Class step chosen from the range; stated in the legend.", tags: ["stepped", "fjord", "chosen"] },
      { title: "Fjord · linear gradient", ramp: "fjord", opts: { fill: "linear" }, note: "Continuous blend through the seven steps.", tags: ["linear", "fjord", "chosen"] },
      { title: "Cobalt · stepped", ramp: "cobalt", opts: {}, note: "Signal preset. Not chosen.", tags: ["stepped", "cobalt"] },
      { title: "Shale · stepped", ramp: "shale", opts: {}, note: "Frost preset. Not chosen.", tags: ["stepped", "shale"] },
    ].map((c) => ({ ...c, h: TOP })) },
  { id: "detail", title: "Detail: how much to smooth",
    lead: "Seismic horizons are smoothed with edge-preserving filters, because a plain blur rounds off fault steps. Fine and Medium use anisotropic diffusion (Perona-Malik) so noise and gentle roughness go and fault throws stay; every level above Raw also draws contours on a bicubic grid twice as dense, which removes the 25 m stair-steps without changing a value. Each caption gives the mean and largest change from the source. 20 m contours are on so the effect shows.",
    cards: [
      ["Raw", { sigmaM: 0, upsample: 1 }, "Source picks resampled to a 25 m grid. Contours show the grid stair-steps."],
      ["Light", { sigmaM: 0, upsample: 2 }, "Values unchanged. Contours drawn on a denser grid, so lines are smooth and every node is honoured."],
      ["Fine (default)", FINE, "About 25 m (one cell) of edge-preserving smoothing: noise goes, faults and closures stay."],
      ["Medium", { sigmaM: 50, upsample: 2 }, "About 50 m. Small closures begin to soften; the largest usable setting."],
      ["Fine, Gaussian (for comparison)", { ...FINE, smoother: "gaussian" }, "Same width with a plain blur: compare the fault edges."],
    ].map(([t, o, note]) => ({ title: t, h: TOP, ramp: "fjord", opts: { ...o, contour: 20 }, note, tags: ["stepped", "20 m lines"] })) },
  { id: "steps", title: "Class step and colour range",
    lead: "The class step is set by you, not by a class count: usually 20 to 50 m, sometimes 10 m, depending on the surface and the area of interest. The colour range defaults to the data range rounded to the step, and can be set by hand. Values outside it take the end colours.",
    cards: [
      ["100 m steps", { step: 100 }, "Regional overview."],
      ["50 m steps", { step: 50 }, "A good default for a field-scale structure."],
      ["20 m steps", { step: 20 }, "Closures and flanks start to show."],
      ["10 m steps", { step: 10 }, "Detailed. Many classes: the ramp is sampled along its length, and the legend labels every few."],
      ["20 m steps, range 2,900 to 3,300 m", { step: 20, min: 2900, max: 3300 }, "Colours spent on the reservoir interval; deeper and shallower ground takes the end colours."],
    ].map(([t, o, note]) => ({ title: t, h: TOP, ramp: "fjord", opts: o, note, tags: ["stepped", o.min ? "custom range" : "full range"] })) },
  { id: "lines", title: "Contour lines",
    lead: "Intervals of 10, 20 or 50 m; every fifth line is drawn heavier. Lines are optional and sit over either fill.",
    cards: [["No lines", 0], ["10 m", 10], ["20 m", 20], ["50 m", 50]].map(([t, c]) => ({ title: t, h: TOP, ramp: "fjord", opts: { contour: c, step: 50 }, note: c ? `Index lines every ${c * 5} m.` : "Class edges carry the contours.", tags: [c ? `${c} m` : "none"] })) },
  { id: "shade", title: "Shading across the faults",
    lead: "The steepest half of one per cent of the surface is fault scarps. Its orientation is measured from the data (doubled-angle mean of the gradient direction) and the light is placed across that trend, from the side the scarps face away from, so steep faces fall in shadow. Each caption gives the trend it found.",
    cards: [
      { title: "Soft, light across faults", opts: { shade: 0.5 }, note: "Automatic light direction.", tags: ["stepped", "auto light"] },
      { title: "Strong, light across faults", opts: { shade: 1 }, note: "Maximum relief.", tags: ["stepped", "auto light"] },
      { title: "Soft, fixed north-west light", opts: { shade: 0.5, light: "nw" }, note: "The usual 315 degrees, for comparison.", tags: ["stepped", "315°"] },
      { title: "Linear with soft shading", opts: { fill: "linear", shade: 0.5 }, note: "Gradient plus relief.", tags: ["linear", "auto light"] },
      { title: "20 m steps, 10 m lines, soft shading", opts: { step: 20, contour: 10, shade: 0.5 }, note: "Everything on: the busiest combination.", tags: ["stepped", "lines", "shaded"] },
    ].map((c) => ({ ...c, h: TOP, ramp: "fjord" })) },
  { id: "horizons", title: "Other horizons",
    lead: "The house default (fjord, stepped, Fine detail, step chosen from the range) on the other official surfaces. The scale changes with each horizon, so colours are not comparable across maps.",
    cards: [[TOP, "Hugin Fm top"], [BASE, "Hugin Fm base"], ["bcu_depth", "Base Cretaceous unconformity"], ["shetland_depth", "Shetland Gp top"], ["ty_depth", "Ty Fm top"], ["seabed_depth", "Seabed"], ["hugin_top_twt", "Hugin Fm top, two-way time"]].map(([h, t]) => ({
      title: t, h, ramp: "fjord", opts: {}, note: h === "seabed_depth" ? "Near flat: a few metres of relief, so steps are small." : h.endsWith("twt") ? "Time, not depth: the same structure in milliseconds." : "", tags: [h.endsWith("twt") ? "time" : "depth"] })) },
  { id: "derived", title: "Thickness and residual relief",
    lead: "Derived maps, labelled as such. Thickness is Hugin base minus top, measured vertically in depth. Residual relief is depth minus the regional trend (a 1 km Gaussian), shown on the diverging ramp: cobalt is shallower than trend, ochre deeper.",
    cards: [
      { title: "Hugin thickness, stepped", h: "thickness", ramp: "fjord", opts: {}, note: "Base minus top. Sequential ramp: thicker is stronger.", tags: ["derived", "sequential"] },
      { title: "Hugin thickness, linear", h: "thickness", ramp: "fjord", opts: { fill: "linear" }, note: "Same, unclassed.", tags: ["derived", "linear"] },
      { title: "Residual relief, stepped", h: "residual", ramp: "div", opts: { diverging: true, step: null }, note: "Equal classes symmetric about zero, so the middle class is neutral.", tags: ["derived", "diverging"] },
      { title: "Residual relief, linear, fjord to ochre", h: "residual", ramp: "div_fjord", opts: { diverging: true, step: null, fill: "linear" }, note: "The Frost diverging ramp.", tags: ["derived", "diverging"] },
    ] },
];

// ---------------------------------------------------------------- build
const cards = [];
function swatches(key) {
  const wrap = document.createElement("figure");
  wrap.className = "ss-figure";
  wrap.innerHTML = `<p class="ss-fig-title">${RAMPS[key].label} <span class="vs-tag">${RAMPS[key].kind === "seq" ? "sequential" : "diverging"}</span></p><p class="ss-fig-sub">${RAMPS[key].note} · <code>--ss-data-${RAMPS[key].kind}-${RAMPS[key].name}-1…${RAMPS[key].kind === "seq" ? 7 : 9}</code></p><div class="vs-bar" style="display:grid"></div>`;
  wrap.dataset.ramp = key;
  return wrap;
}
function paintSwatches() {
  document.querySelectorAll("[data-ramp]").forEach((el) => {
    const bar = el.querySelector(".vs-bar"), stops = stopsOf(el.dataset.ramp, state.emph === "shallow" && RAMPS[el.dataset.ramp].kind === "seq");
    bar.style.gridTemplateColumns = `repeat(${stops.length}, 1fr)`;
    bar.replaceChildren(...stops.map((c) => { const i = document.createElement("i"); i.style.background = c; i.style.height = "28px"; return i; }));
  });
}
$("ramps").replaceChildren(...["fjord", "cobalt", "shale", "div", "div_fjord"].map(swatches));

for (const s of SECTIONS) {
  const sec = document.createElement("section");
  sec.className = "vs-section"; sec.id = s.id;
  sec.innerHTML = `<h2>${s.title}</h2><p class="vs-lead">${s.lead}</p><div class="vs-grid"></div>`;
  for (const c of s.cards) {
    const el = document.createElement("figure");
    el.className = "ss-figure vs-card";
    el.innerHTML = `<p class="ss-fig-title">${c.title}</p><canvas role="img" aria-label="${c.title}"></canvas><div class="lg"></div><p class="vs-note">${c.note || ""}</p><div class="vs-tags">${(c.tags || []).map((t) => `<span class="vs-tag">${t}</span>`).join("")}</div><div class="fx"></div>`;
    sec.querySelector(".vs-grid").append(el);
    const card = { ...c, el, visible: false, stale: true };
    el._card = card; cards.push(card);
  }
  $("sections").append(sec);
}

// ---------------------------------------------------------------- data
async function gridFor(h) {
  const set = await getSet(state.set);
  if (h === "thickness") {
    const [t, b] = await Promise.all([loadGrid(set, TOP), loadGrid(set, BASE)]);
    const z = Float32Array.from(t.z, (v, i) => { const d = b.z[i] - v; return d >= 0 ? d : NaN; });
    return derived(t, "thickness", "Hugin thickness", "m", z);
  }
  if (h === "residual") {
    const t = await loadGrid(set, TOP), trend = blur(t.z, t.nx, t.ny, 1000 / t.cell);
    return derived(t, "residual", "Residual relief", "m", Float32Array.from(t.z, (v, i) => v - trend[i]));
  }
  return loadGrid(set, h);
}

async function paint(c) {
  c.stale = false;
  const canvas = c.el.querySelector("canvas");
  try {
    const g = await gridFor(c.h), seq = RAMPS[c.ramp].kind === "seq";
    const [lo, hi] = extent(g.z);
    const info = renderMap(canvas, g, { fill: "stepped", step: autoStep(lo, hi), classes: 9, ...FINE, contour: 0, shade: 0,
      ...c.opts, stops: stopsOf(c.ramp, seq && state.emph === "shallow") });
    renderLegend(c.el.querySelector(".lg"), info);
    c.el.querySelector(".fx").innerHTML = factsHTML(info, g, { short: true });
    $("attr").textContent = g.manifest.synthetic ? g.manifest.attribution : ATTRIBUTION;
  } catch (e) {
    c.el.querySelector(".fx").textContent = `Could not draw: ${e.message}`;
  }
}

const obs = new IntersectionObserver((es) => es.forEach((e) => {
  const c = e.target._card;
  c.visible = e.isIntersecting;
  if (c.visible && c.stale) paint(c);
}), { rootMargin: "300px" });
cards.forEach((c) => obs.observe(c.el));
function invalidate() { paintSwatches(); cards.forEach((c) => { c.stale = true; if (c.visible) paint(c); }); }

// ---------------------------------------------------------------- controls
seg($("c-set"), [["real", "Volve"], ["synthetic", "Synthetic"]], state.set, (v) => { state.set = v; invalidate(); });
seg($("c-scheme"), [["light", "Light"], ["dark", "Dark"]], document.documentElement.dataset.colourScheme, (v) => { setScheme(v); invalidate(); });
seg($("c-emph"), [["deep", "Deepest"], ["shallow", "Shallowest"]], state.emph, (v) => { state.emph = v; invalidate(); });
$("attr").textContent = ATTRIBUTION;
paintSwatches();
