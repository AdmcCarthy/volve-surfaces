// Legend, fact strip ("generalised for display" badge) and small UI helpers shared by the viewer and the review page.
import { interpolator } from "../style/ramps.js";

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

// ---------------------------------------------------------------- facts and layer legends (rendering only)
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Title-box rows [{ label, value, level? }] as the SubScout fact strip.
export function factsHTML(rows) {
  const row = (r) => `<div><dt>${escape(r.label)}</dt><dd>${r.level ? `<span class="ss-conf" data-level="${r.level}">${escape(r.value)}</span>` : escape(r.value)}</dd></div>`;
  return `<dl class="ss-facts">${rows.map(row).join("")}</dl>`;
}

// Legend entries of vector layers: [{ kind: "line", label, width, alpha, dash }, { kind: "symbol", label, svg }].
export function renderEntries(el, entries) {
  el.className = "vs-entries";
  el.replaceChildren(...entries.map((e) => {
    const row = document.createElement("div");
    row.className = "vs-entry";
    if (e.kind === "bar") {
      // a colour bar: stepped cells or a gradient, ticks at the ends and the middle
      const [d0, d1] = e.domain, f = d3.format(",.0f");
      const bar = e.colours ? `display:grid;grid-template-columns:repeat(${e.colours.length},1fr)` : `background:linear-gradient(to right,${e.stops.join(",")})`;
      row.className = "vs-entry vs-entry-bar";
      row.innerHTML = `<div><div class="vs-bar" style="${bar}">${e.colours ? e.colours.map((c) => `<i style="background:${c}"></i>`).join("") : ""}</div><div class="vs-ticks"><span style="left:0">${f(d0)}</span><span style="left:50%">${f((d0 + d1) / 2)}</span><span style="left:100%">${f(d1)}</span></div></div><span>${escape(e.label)}</span>`;
      return row;
    }
    const sample = e.kind === "symbol" ? e.svg
      : e.kind === "hatch" ? `<svg width="34" height="14" aria-hidden="true"><line x1="2" y1="7" x2="32" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>${[6, 12, 18, 24, 30].map((x) => `<line x1="${x}" y1="2" x2="${x}" y2="12" stroke="currentColor" stroke-width="1"/>`).join("")}</svg>`
      : e.kind === "fade" ? `<svg width="34" height="12" aria-hidden="true"><defs><linearGradient id="vs-fade"><stop offset="0" stop-color="currentColor" stop-opacity="1"/><stop offset="1" stop-color="currentColor" stop-opacity="0.05"/></linearGradient></defs><rect x="2" y="2" width="30" height="8" fill="url(#vs-fade)"/></svg>`
      : e.kind === "note" ? ""
      : `<svg width="34" height="12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="${e.width ?? 1.4}" stroke-opacity="${e.alpha ?? 1}" stroke-linecap="round"${e.dash ? ` stroke-dasharray="${e.dash}"` : ""}/>${e.over ? `<line x1="2" y1="6" x2="32" y2="6" stroke="${e.over.colour}" stroke-width="${e.over.width}" stroke-dasharray="${e.over.dash}"/>` : ""}</svg>`;
    row.innerHTML = e.kind === "note" ? `<span class="vs-note-entry">${escape(e.label)}</span>` : `${sample}<span>${escape(e.label)}</span>`;
    return row;
  }));
}
