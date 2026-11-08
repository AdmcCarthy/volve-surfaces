// The title box: identification of the map (in the order and wording of the Sodir Geostandard's title block, which is a guide here, not a rule),
// then the coordinate system, and a location map. Rows come from the manifest and the layers, nothing is typed by hand per map.
import { token } from "../style/ramps.js";

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

// Fill or stroke GeoJSON polygons by hand on a planar projection: the source rings are not wound for the sphere, which d3.geoPath would read as "everything but this".
function geoPath(ctx, geo, proj) {
  const feats = geo.features ?? [geo];
  ctx.beginPath();
  for (const f of feats) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) for (const ring of rings) ring.forEach((p, i) => { const [x, y] = proj(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  }
}

// Location map: land, neighbouring fields, the field in the accent colour, the map frame ringed so it stays visible at regional scale.
export function drawLocator(canvas, ctxData, { width = 220 } = {}) {
  const [w, s, e, n] = ctxData.window, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const proj = d3.geoMercator().fitWidth(width, { type: "MultiPoint", coordinates: [[w, s], [e, n]] });
  const height = Math.round(proj([w, s])[1] - proj([e, n])[1]);
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d"), field = (volve) => ({ features: ctxData.fields.features.filter((f) => (f.properties.name === "VOLVE") === volve) });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = token("--ss-surface"); ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = token("--ss-text-subtle"); ctx.strokeStyle = token("--ss-text-subtle"); ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.22; geoPath(ctx, ctxData.land, proj); ctx.fill("evenodd"); ctx.globalAlpha = 0.7; ctx.stroke();
  ctx.fillStyle = token("--ss-text-subtle"); ctx.globalAlpha = 0.6;
  geoPath(ctx, field(false), proj); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = token("--ss-accent"); ctx.strokeStyle = token("--ss-accent");
  geoPath(ctx, field(true), proj); ctx.fill();
  const ring = d3.polygonCentroid(ctxData.extent.map((p) => proj(p)));
  ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ring[0], ring[1], 9, 0, 2 * Math.PI); ctx.stroke();
  ctx.fillStyle = token("--ss-text"); ctx.font = `600 11px ${token("--ss-font-body")}`; ctx.textBaseline = "middle";
  ctx.fillText("Volve", ring[0] + 14, ring[1]);
  ctx.fillStyle = token("--ss-text-muted"); ctx.font = `500 10px ${token("--ss-font-body")}`;
  ctx.textAlign = "right"; ctx.fillText("Norway", width - 8, 14); ctx.textAlign = "left";
  ctx.strokeStyle = token("--ss-border"); ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}
