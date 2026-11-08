// Area against contact depth for each closure (docs/contacts-structure.md): how much map area a contact at each depth would span, from the
// crest to below the spill, with the spill depths, the contacts and the wells marked. A jump in the curve is a merge with a neighbouring
// high. Map area, not volume. Drawn as SVG in tokens, so it follows the colour scheme.
const NS = "http://www.w3.org/2000/svg";
const fmt = d3.format(",.0f");

const STYLE = {
  spill: { stroke: "var(--ss-text)", dash: "", width: 1.6 },
  "spill-wall": { stroke: "var(--ss-text)", dash: "2 3", width: 1.2 },
  contact: { stroke: "var(--ss-accent)", dash: "", width: 1.8 },
  oil: { stroke: "var(--ss-text-muted)", dash: "6 3", width: 1.2 },
  water: { stroke: "var(--ss-text-muted)", dash: "1 3", width: 1.6 },
};

function el(name, attrs = {}, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

export function renderAreaCharts(root, charts) {
  root.replaceChildren();
  root.className = "vs-charts";
  if (!charts.length) return;
  const head = document.createElement("p");
  head.className = "vs-charts-head";
  head.textContent = "Area against contact depth, per closure: the map area a flat contact at each depth would span. A jump is a merge with a neighbouring high. Map area, not a volume.";
  root.append(head);
  const grid = document.createElement("div");
  grid.className = "vs-charts-grid";
  root.append(grid);
  for (const c of charts) {
    const W = 330, H = 215, m = { l: 40, r: 10, t: 18, b: 34 };
    const x = d3.scaleLinear().domain([c.curve.depth[0], c.curve.depth.at(-1)]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, d3.max(c.curve.area_km2) * 1.05 || 1]).nice().range([H - m.b, m.t]);
    const fig = document.createElement("figure");
    fig.className = "vs-chart";
    const cap = document.createElement("figcaption");
    cap.textContent = `${c.title}${c.open ? ", open at the data edge" : ""}`;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Area against depth for ${c.title}` });
    // axes
    svg.append(el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: "var(--ss-border)" }), el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, stroke: "var(--ss-border)" }));
    for (const t of x.ticks(5)) svg.append(el("text", { x: x(t), y: H - m.b + 13, "text-anchor": "middle", fill: "var(--ss-text-muted)", "font-size": 9.5 }, fmt(t)));
    for (const t of y.ticks(4)) {
      svg.append(el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--ss-border-subtle)" }), el("text", { x: m.l - 5, y: y(t) + 3, "text-anchor": "end", fill: "var(--ss-text-muted)", "font-size": 9.5 }, t));
    }
    svg.append(el("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", fill: "var(--ss-text-subtle)", "font-size": 9.5 }, "Contact depth (m, positive down)"));
    svg.append(el("text", { x: 11, y: (m.t + H - m.b) / 2, "text-anchor": "middle", fill: "var(--ss-text-subtle)", "font-size": 9.5, transform: `rotate(-90 11 ${(m.t + H - m.b) / 2})` }, "Area (km²)"));
    // the curve, shaded to the first spill
    const pts = c.curve.depth.map((d, i) => [x(d), y(c.curve.area_km2[i])]);
    const spill = c.marks.find((k) => k.kind === "spill"), cut = spill ? Math.max(1, c.curve.depth.findIndex((d) => d >= spill.depth)) : pts.length - 1;
    svg.append(el("path", { d: `M${pts.slice(0, cut + 1).map((p) => p.join(",")).join("L")}L${pts[Math.min(cut, pts.length - 1)][0]},${y(0)}L${x(c.curve.depth[0])},${y(0)}Z`, fill: "var(--ss-accent)", opacity: 0.14 }));
    svg.append(el("path", { d: `M${pts.map((p) => p.join(",")).join("L")}`, fill: "none", stroke: "var(--ss-text)", "stroke-width": 1.8 }));
    // markers: vertical lines, labels staggered so they do not collide
    const marks = c.marks.filter((k) => k.depth >= x.domain()[0] && k.depth <= x.domain()[1]).sort((a, b) => a.depth - b.depth);
    let lastX = -1e9, row = 0;
    for (const k of marks) {
      const s = STYLE[k.kind] ?? STYLE.contact, px = x(k.depth);
      svg.append(el("line", { x1: px, x2: px, y1: m.t - 2, y2: H - m.b, stroke: s.stroke, "stroke-width": s.width, "stroke-dasharray": s.dash, opacity: k.main ? 1 : 0.7 }));
      row = px - lastX < 60 ? (row + 1) % 7 : 0;
      lastX = px;
      svg.append(el("text", { x: px + 3, y: m.t + 8 + row * 10, fill: "var(--ss-text)", "font-size": 9, stroke: "var(--ss-surface)", "stroke-width": 3, "paint-order": "stroke" }, `${k.label} ${fmt(k.depth)}`));
    }
    fig.append(cap, svg);
    grid.append(fig);
  }
  const key = document.createElement("p");
  key.className = "vs-charts-key";
  key.textContent = "Lines: spill (solid black), spill if the data edge is a limit (dotted black), contact (accent), oil down to (dashed grey), water top (dotted grey). Shading runs to the first spill.";
  root.append(key);
}
