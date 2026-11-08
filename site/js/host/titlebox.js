// The title box: identification of the map (in the order and wording of the Sodir Geostandard's title block, which is a guide here, not a rule),
// then the coordinate system, and a location map. Rows come from the manifest and the layers, nothing is typed by hand per map.
import { token } from "../style/ramps.js";
import { detunedStyle, rampAt } from "../vendor/relief/palette.js";

const FIELD = { name: "Volve", block: "15/9", licence: "PL 046", area: "Utsira High", country: "Norway" };
const fmtN = d3.format(".0f");

// Geostandard map-type names, "Depth structure contour map" and so on; contacts add the hydrocarbon area map.
export const mapType = (g, withContacts) =>
  g.id === "thickness" ? "Isochore map" : g.id === "residual" ? "Residual relief map" : `${g.domain === "twt" ? "Time" : "Depth"} structure contour map${withContacts ? " and hydrocarbon area map" : ""}`;

// UTM coverage in the standard's format: "6482150 N-6489275 N, 429650 E-440025 E".
export const coverage = ([xmin, ymin, xmax, ymax]) => `${fmtN(ymin)} N-${fmtN(ymax)} N, ${fmtN(xmin)} E-${fmtN(xmax)} E`;

export function titleRows({ g, bounds, contour, contacts }) {
  const syn = !!g.manifest.synthetic;
  const rows = [
    ["Map type", mapType(g, contacts)],
    ["Horizon", g.label],
    ["Field", syn ? "Synthetic, fictional" : FIELD.name],
  ];
  if (!syn) rows.push(["Block, licence", `${FIELD.block}, ${FIELD.licence}`], ["Area, country", `${FIELD.area}, ${FIELD.country}`]);
  rows.push(
    ["Map coverage", coverage(bounds)],
    ["Projection", "UTM zone 31N, central meridian 3° E"],
    ["Geodetic datum", syn ? "ETRS89 (synthetic coordinates)" : "ETRS89 (source ED50, converted to about 2 m)"],
    ["Vertical datum", g.domain === "twt" ? "Two-way time, ms" : syn ? "Synthetic datum, m, positive down" : "Mean sea level, m, positive down"],
  );
  if (contour) rows.push(["Contour interval", `${contour} ${g.unit}`]);
  rows.push(["Date", new Date().toISOString().slice(0, 10)]);
  return rows;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Rows into the box, leaving the location-map slot (.vs-tb-loc) where it is.
export function renderTitleBox(el, rows) {
  const dl = document.createElement("dl");
  dl.className = "vs-tb-rows";
  dl.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  el.querySelector(".vs-tb-rows")?.remove();
  el.prepend(dl);
}

// Draw GeoJSON polygons by hand in a planar frame (Relief's metres): d3.geoPath would read unwound rings as the sphere's complement.
function geoPath(ctx, geo, proj) {
  const feats = geo.features ?? [geo];
  ctx.beginPath();
  for (const f of feats) {
    const g = f.geometry ?? f, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const rings of polys) for (const ring of rings) ring.forEach((p, i) => { const [x, y] = proj(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  }
}

// Mid-point of each stacked level to the next, so a level takes the colour of the band it opens (the last band is as wide as the one before).
const mids = (levels) => levels.map((v, i) => (i + 1 < levels.length ? (v + levels[i + 1]) / 2 : v + (v - levels[i - 1]) / 2));

// Location map on Relief's base (north_sea, overview): stacked land and sea-floor polygons in the Detuned style, land tints at half strength
// and a wide indigo sea, so the strong ring around the map frame is the one thing that stands out. Everything is in Relief's CRS, drawn planar.
export function drawLocator(canvas, ctxData, base, { width = 220 } = {}) {
  const [wx0, wy0, wx1, wy1] = ctxData.window, dpr = Math.min(window.devicePixelRatio || 1, 2), height = Math.round((width * (wy1 - wy0)) / (wx1 - wx0));
  const k = width / (wx1 - wx0), proj = ([x, y]) => [(x - wx0) * k, (wy1 - y) * k];
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d"), st = detunedStyle(document.documentElement.dataset.colourScheme === "dark" ? "dark" : "light");
  const sea = base.features.filter((f) => f.properties.kind === "sea"), land = base.features.filter((f) => f.properties.kind === "land");
  const seaMid = mids(sea.map((f) => -f.properties.level)), landMid = mids(land.map((f) => f.properties.level));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = rampAt(st.sea, seaMid[0] / st.seaMax); ctx.fillRect(0, 0, width, height);
  sea.forEach((f, i) => { if (i) { geoPath(ctx, f, proj); ctx.fillStyle = rampAt(st.sea, seaMid[i] / st.seaMax); ctx.fill("evenodd"); } });
  land.forEach((f, i) => { geoPath(ctx, f, proj); ctx.fillStyle = rampAt(st.zones.boreal, landMid[i] / st.landMax); ctx.fill("evenodd"); });
  geoPath(ctx, land[0], proj); ctx.strokeStyle = token("--ss-text-subtle"); ctx.globalAlpha = 0.6; ctx.lineWidth = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
  const feats = ctxData.fields.features, volve = feats.filter((f) => f.properties.name === "VOLVE");
  ctx.strokeStyle = token("--ss-text-subtle"); ctx.globalAlpha = 0.5; ctx.lineWidth = 0.7;
  geoPath(ctx, { features: feats.filter((f) => !volve.includes(f)) }, proj); ctx.stroke(); ctx.globalAlpha = 1;
  // the one strong mark: the map frame, ringed
  const [cx, cy] = proj([d3.mean(ctxData.extent, (p) => p[0]), d3.mean(ctxData.extent, (p) => p[1])]);
  ctx.strokeStyle = token("--ss-accent"); ctx.fillStyle = token("--ss-accent");
  geoPath(ctx, { features: volve }, proj); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 2 * Math.PI);
  ctx.strokeStyle = token("--ss-surface"); ctx.lineWidth = 5.5; ctx.stroke(); // halo, so the ring reads on any base colour
  ctx.strokeStyle = token("--ss-accent"); ctx.lineWidth = 2.4; ctx.stroke();
  ctx.font = `600 11px ${token("--ss-font-body")}`; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.lineJoin = "round";
  ctx.strokeStyle = token("--ss-surface"); ctx.fillStyle = token("--ss-text"); ctx.strokeText("Volve", cx + 15, cy); ctx.fillText("Volve", cx + 15, cy);
  ctx.strokeStyle = token("--ss-border"); ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}
