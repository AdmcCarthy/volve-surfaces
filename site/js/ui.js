// Legend, fact strip ("generalised for display" badge) and small UI helpers shared by the viewer and the review page.
import { interpolator } from "./ramps.js";

export const ATTRIBUTION = "Contains data from the Volve data village, © Equinor ASA and the former Volve licence partners (ExxonMobil E&P Norway, Bayerngas Norge). Used under the Volve Terms and Conditions. Generalised for display.";

// ---------------------------------------------------------------- preferences (per viewer, never required)
export const store = {
  get(k, d) { try { return localStorage.getItem(`vs-${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`vs-${k}`, v); } catch { /* private window: ignore */ } },
};

export function initRoot() {
  const root = document.documentElement;
  const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.type = "ledger"; root.dataset.surface = "nordic-cool";
  root.dataset.colourScheme = store.get("scheme", sys);
  return root;
}

export function setScheme(s) { document.documentElement.dataset.colourScheme = s; store.set("scheme", s); }

// Segmented control: options [[value, label], ...]; calls onchange(value).
export function seg(el, options, value, onchange) {
  el.classList.add("ss-seg"); el.setAttribute("role", "group");
  const draw = (v) => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(v))));
  el.replaceChildren(...options.map(([v, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.v = v; b.textContent = label;
    b.addEventListener("click", () => { draw(v); onchange(v); });
    return b;
  }));
  draw(value);
  return { set: draw };
}

// ---------------------------------------------------------------- legend
const fmtFor = (span) => d3.format(span >= 20 ? ",.0f" : span >= 2 ? ",.1f" : ",.2f");

// Stepped: one equal-width cell per class, labelled at its boundaries. Linear: the gradient with round ticks.
export function renderLegend(el, info) {
  const [d0, d1] = info.domain, f = fmtFor(d1 - d0);
  el.className = "vs-legend"; el.replaceChildren();
  const bar = document.createElement("div"), ticks = document.createElement("div");
  bar.className = "vs-bar"; ticks.className = "vs-ticks";
  const tick = (pos, text) => { const s = document.createElement("span"); s.style.left = `${pos * 100}%`; s.textContent = text; ticks.append(s); };
  if (info.fill === "stepped") {
    const n = info.colours.length, every = [1, 2, 5, 10, 20].find((k) => n / k <= 10) ?? 20;
    bar.style.display = "grid"; bar.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    info.colours.forEach((c) => { const cell = document.createElement("i"); cell.style.background = c; bar.append(cell); });
    info.edges.forEach((e, i) => { if (i % every === 0 || (i === n && n % every === 0)) tick(i / n, f(e)); });
  } else {
    const interp = interpolator(info.stops);
    bar.style.background = `linear-gradient(to right, ${d3.range(25).map((i) => interp(i / 24)).join(",")})`;
    d3.ticks(d0, d1, 5).forEach((v) => tick((v - d0) / (d1 - d0), f(v)));
  }
  const unit = document.createElement("div");
  unit.className = "vs-unit"; unit.textContent = info.unit === "m" ? "metres, positive down" : info.unit === "ms" ? "milliseconds two-way time" : info.unit;
  el.append(bar, ticks, unit);
}

// ---------------------------------------------------------------- facts
export function classification(info) {
  const fmt = d3.format(",.0f"), u = info.unit;
  if (info.fill === "linear") return info.range ? `Unclassed gradient, ${fmt(info.range.lo)} to ${fmt(info.range.hi)} ${u}` : "Unclassed: continuous gradient";
  const n = info.colours.length;
  if (info.step) return `${n} classes of ${info.step} ${u}, ${fmt(info.domain[0])} to ${fmt(info.domain[1])} ${u}`;
  const how = { nice: "equal interval, rounded steps", equal: "equal interval", quantile: "quantile (equal area)", sym: "equal interval, symmetric about zero" }[info.method];
  return `${n} classes, ${how}`;
}

// Says when the chosen colour range does not cover the data (end colours then stand for everything beyond).
export function rangeNote(info) {
  const r = info.range;
  if (!r || r.auto) return "";
  const f = d3.format(",.0f"), parts = [];
  if (r.dataMin < r.lo - 1e-6) parts.push(`below ${f(r.lo)}`);
  if (r.dataMax > r.hi + 1e-6) parts.push(`above ${f(r.hi)}`);
  return parts.length ? `Values ${parts.join(" and ")} ${info.unit} take the end colours.` : "";
}

export function smoothing(info) {
  const f = d3.format(".1f"), dense = info.upsample > 1 ? "contours drawn on a bicubic grid twice as dense (values unchanged)" : "";
  if (!info.sigmaM) return dense ? `None to the values; ${dense}` : "None: source picks resampled to a 25 m grid";
  const how = info.smoother === "gaussian" ? "Gaussian" : "Edge-preserving (anisotropic diffusion), fault steps kept";
  return `${how}, about ${info.sigmaM} m; mean change ${f(info.dev.rms)} ${info.unit}, largest ${f(info.dev.max)} ${info.unit}${dense ? `; ${dense}` : ""}`;
}

export function shading(info) {
  if (!info.shade) return "";
  const t = info.trend, f = d3.format(".2f"), az = (a) => `${Math.round(a)}°`;
  if (info.lightMode === "nw" || !t.auto) return `Light from ${az(info.lights[0][0])} (north-west, fixed${t.auto ? "" : "; no clear fault trend"})`;
  const parts = t.trends.map((x) => `${az(x.light)} across the N${Math.round(x.strike)}°E trend (coherence ${f(x.coherence)}${t.trends.length > 1 ? `, ${Math.round(x.share * 100)}% of the steepness` : ""})`);
  return `${t.trends.length > 1 ? "Two lights: " : "Light from "}${parts.join("; ")}. Steep faces fall in shadow`;
}

export function factsHTML(info, g, { short = false } = {}) {
  const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const out = [row("Generalised", smoothing(info)), row("Classes", classification(info))];
  const rn = rangeNote(info);
  if (rn) out.push(row("Range", rn));
  if (info.contour) out.push(row("Contours", `every ${info.contour} ${info.unit}, every fifth heavier`));
  if (info.shade) out.push(row("Shading", shading(info)));
  if (!short) {
    const syn = g.manifest?.synthetic;
    out.push(row("Source", syn ? "Synthetic surface generated by this repository. Not Volve data."
      : `Volve geophysical interpretations, ${g.meta.source?.split("/").pop() ?? g.id}`));
    out.push(row("Confidence", `<span class="ss-conf" data-level="${syn ? "parameter" : "interpreted"}">${syn ? "Synthetic" : "Interpreted"}</span>`));
  }
  return `<dl class="ss-facts">${out.join("")}</dl>`;
}
