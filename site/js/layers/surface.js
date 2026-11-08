// The surface layer: one grid as stepped or linear colour, contour lines and shading. Meets the layer contract (contract.js).
import { drawSurface, surfaceBounds, probeSurface } from "../surface/render.js";
import { surfaceFacts } from "../surface/describe.js";

// `opts` are the drawSurface options (fill, stops, step, min, max, sigmaM, upsample, contour, shade, light, ...).
export function createSurfaceLayer(g, opts = {}) {
  let info = null;
  return {
    id: "surface",
    kind: "surface",
    crs: g.manifest.crs,
    grid: g,
    get info() { return info; },
    bounds: () => surfaceBounds(g),
    draw(ctx, view) { info = drawSurface(ctx, g, view, opts); },
    legend: () => info,
    facts: (o = {}) => (info ? surfaceFacts(info, g, o) : []),
    probe(x, y) {
      const z = probeSurface(g, x, y);
      return Number.isNaN(z) ? null : { layer: "surface", label: g.label, value: z, unit: g.unit };
    },
  };
}
