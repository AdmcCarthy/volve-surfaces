// Review page: one horizon under many treatments, painted lazily, repainted when the scheme, data set or emphasis changes.
import { loadSet, loadGrid, blur, derived, extent } from "./grid.js";
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
const ramps = ["fjord", "cobalt", "shale"];
const SECTIONS = [
  { id: "fill", title: "Linear or stepped, in each ramp",
    lead: "The same surface with rounded class steps against an unclassed gradient. Stepped reads values off the legend; linear shows shape without implying class boundaries.",
    cards: ramps.flatMap((r) => ["stepped", "linear"].map((fill) => ({
      title: `${RAMPS[r].label} · ${fill === "linear" ? "linear gradient" : "stepped"}`, h: TOP, ramp: r, opts: { fill },
      note: `${RAMPS[r].note}. ${fill === "linear" ? "Continuous blend through the seven steps." : "Classes at rounded depth steps, stated in the legend."}`, tags: [fill, r] }))) },
  { id: "detail", title: "How much to smooth",
    lead: "Gaussian smoothing, with the contour lines on so the effect is visible. Each caption gives the mean and largest change from the source surface. The default is Display; Raw shows the picks as interpreted, resampled to a 25 m grid.",
    cards: [[0, "Raw"], [25, "Fine"], [60, "Display (default)"], [120, "Bold"], [240, "Broad"]].map(([s, name]) => ({
      title: `${name}${s ? `, σ ${s} m` : ""}`, h: TOP, ramp: "fjord", opts: { sigmaM: s, contours: "lines" },
      note: s === 0 ? "Every kink in the interpretation shows; fault edges are stair-stepped at the 25 m grid." : s <= 25 ? "Removes grid noise, keeps fault edges and small closures." : s <= 60 ? "Calm contours that still follow the structure; small features soften." : s <= 120 ? "Small closures merge into their neighbours." : "Regional shape only: the main structure survives, detail does not.",
      tags: ["stepped", `σ ${s} m`] })) },
  { id: "lines", title: "Contours and shading",
    lead: "Lines give exact values; shading gives form. Shading is a soft multi-directional hillshade at five times vertical exaggeration, light from the north-west.",
    cards: [
      { title: "Fill only", note: "Cleanest. Class edges carry the contours.", opts: {}, tags: ["no lines"] },
      { title: "Lines", note: "Every contour, with every fifth drawn heavier.", opts: { contours: "lines" }, tags: ["lines"] },
      { title: "Index lines only", note: "Every fifth contour. Quieter, still readable.", opts: { contours: "index" }, tags: ["index"] },
      { title: "Linear with soft shading", note: "Gradient plus relief: the most three-dimensional.", opts: { fill: "linear", shade: 0.5 }, tags: ["linear", "shaded"] },
      { title: "Stepped, soft shading, index lines", note: "All three together: the busiest combination.", opts: { shade: 0.5, contours: "index" }, tags: ["stepped", "shaded", "index"] },
    ].map((c) => ({ ...c, h: TOP, ramp: "fjord" })) },
  { id: "breaks", title: "Class breaks",
    lead: "Rounded steps are easiest to read and to quote. Equal interval can give odd boundaries. Quantile gives each class the same area, which is not a depth step at all.",
    cards: [["nice", 9, "Rounded, about 9 classes"], ["nice", 5, "Rounded, about 5 classes"], ["nice", 12, "Rounded, about 12 classes"], ["equal", 7, "Equal interval, 7"], ["quantile", 7, "Quantile, 7"]].map(([m, n, t]) => ({
      title: t, h: TOP, ramp: "fjord", opts: { method: m, classes: n }, note: m === "quantile" ? "Equal area per class: spreads colour evenly, hides the true depth steps." : "Class boundaries are stated in the legend.", tags: [m, `${n} classes`] })) },
  { id: "horizons", title: "Other horizons",
    lead: "The house default (fjord, stepped, Display detail) on the other official surfaces. The scale changes with each horizon, so colours are not comparable across maps.",
    cards: [[TOP, "Hugin Fm top"], [BASE, "Hugin Fm base"], ["bcu_depth", "Base Cretaceous unconformity"], ["shetland_depth", "Shetland Gp top"], ["ty_depth", "Ty Fm top"], ["seabed_depth", "Seabed"], ["hugin_top_twt", "Hugin Fm top, two-way time"]].map(([h, t]) => ({
      title: t, h, ramp: "fjord", opts: {}, note: h === "seabed_depth" ? "Near flat: about 20 m of relief over 9 km, so contours are fine and class steps are small." : h.endsWith("twt") ? "Time, not depth: the same structure in milliseconds." : "", tags: [h.endsWith("twt") ? "time" : "depth"] })) },
  { id: "derived", title: "Thickness and residual relief",
    lead: "Derived maps, labelled as such. Thickness is Hugin base minus top, measured vertically in depth. Residual relief is depth minus the regional trend (a 1 km Gaussian), shown on the diverging ramp: cobalt is shallower than trend, ochre deeper.",
    cards: [
      { title: "Hugin thickness, stepped", h: "thickness", ramp: "cobalt", opts: {}, note: "Base minus top. Sequential ramp: thicker is stronger.", tags: ["derived", "sequential"] },
      { title: "Hugin thickness, linear", h: "thickness", ramp: "cobalt", opts: { fill: "linear" }, note: "Same, unclassed.", tags: ["derived", "linear"] },
      { title: "Residual relief, stepped", h: "residual", ramp: "div", opts: { diverging: true, sigmaM: 25 }, note: "Equal classes symmetric about zero, so the middle class is neutral.", tags: ["derived", "diverging"] },
      { title: "Residual relief, linear, fjord to ochre", h: "residual", ramp: "div_fjord", opts: { diverging: true, fill: "linear", sigmaM: 25 }, note: "The Frost diverging ramp.", tags: ["derived", "diverging"] },
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
    const [lo, hi] = extent(g.z), interval = d3.tickStep(lo, hi, 30);
    const info = renderMap(canvas, g, { fill: "stepped", classes: 9, method: "nice", sigmaM: 60, contours: "none", shade: 0, interval,
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
