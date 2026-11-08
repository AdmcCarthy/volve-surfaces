// The layer contract (docs/modules.md). A layer draws into a view the host owns and says what it shows; it never sizes the canvas,
// reads files or URLs, or draws another layer's data.
//
//   view   { crs, bounds [xmin, ymin, xmax, ymax] (m), x0, y0 (north-west corner, m), scale (css px per m), width, height (css px),
//            dpr, project(x, y) -> [device px], unproject(cssX, cssY) -> [x, y] in m }
//   layer  { id, kind, crs, bounds() -> [xmin, ymin, xmax, ymax], draw(ctx, view), legend(), facts(), probe(x, y) }
//
//   legend()  data only, never DOM: for a surface its classes and range, for vector layers a list of { kind, label, ... } entries.
//   facts()   title-box rows [{ label, value }], labels as in the Geostandard where it has one.
//   probe()   what is under a map position (metres), or null: { layer, label, value?, unit? }.

export const CANONICAL_CRS = "EPSG:25831"; // ETRS89 / UTM zone 31N

const FUNCTIONS = ["bounds", "draw", "legend", "facts", "probe"];

// Problems with a layer, as strings; empty when it meets the contract.
export function checkLayer(layer) {
  const out = [];
  for (const k of ["id", "kind", "crs"]) if (typeof layer[k] !== "string" || !layer[k]) out.push(`${k} must be a non-empty string`);
  for (const f of FUNCTIONS) if (typeof layer[f] !== "function") out.push(`${f}() is missing`);
  if (layer.crs && layer.crs !== CANONICAL_CRS) out.push(`crs is ${layer.crs}, expected ${CANONICAL_CRS}`);
  if (typeof layer.bounds === "function") {
    const b = layer.bounds();
    if (!Array.isArray(b) || b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[0] >= b[2] || b[1] >= b[3]) out.push(`bounds() is not [xmin, ymin, xmax, ymax]: ${JSON.stringify(b)}`);
  }
  return out;
}

// The host refuses to compose layers in different coordinate systems; there is no silent reprojection.
export function assertSameCrs(layers) {
  const bad = layers.filter((l) => l.crs !== CANONICAL_CRS);
  if (bad.length) throw new Error(`layers not in ${CANONICAL_CRS}: ${bad.map((l) => `${l.id} (${l.crs})`).join(", ")}`);
}
