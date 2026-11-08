// The one view every layer draws through, and composing layers onto a canvas.
import { assertSameCrs, CANONICAL_CRS } from "../layers/contract.js";

// A view framing `bounds` [xmin, ymin, xmax, ymax] (metres) at `width` css px across.
export function makeView(bounds, width, { dpr = Math.min(window.devicePixelRatio || 1, 2), crs = CANONICAL_CRS } = {}) {
  const [xmin, ymin, xmax, ymax] = bounds, scale = width / (xmax - xmin);
  return {
    crs, bounds, x0: xmin, y0: ymax, scale, width, height: (ymax - ymin) * scale, dpr,
    project: (x, y) => [(x - xmin) * scale * dpr, (ymax - y) * scale * dpr],
    unproject: (cssX, cssY) => [xmin + cssX / scale, ymax - cssY / scale],
  };
}

export function sizeCanvas(canvas, view) {
  canvas.width = Math.round(view.width * view.dpr);
  canvas.height = Math.round(view.height * view.dpr);
  canvas.style.aspectRatio = `${view.width} / ${view.height}`;
}

// Draw layers, first to last, onto one canvas. The frame is the first layer's bounds (the surface), so overlays never change the map extent.
export function compose(canvas, layers, { width = canvas.clientWidth || 640 } = {}) {
  assertSameCrs(layers);
  const view = makeView(layers[0].bounds(), width);
  sizeCanvas(canvas, view);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const layer of layers) {
    ctx.save();
    layer.draw(ctx, view);
    ctx.restore();
  }
  return view;
}

// Everything under a map position (metres), topmost layer first.
export function probeAll(layers, x, y) {
  return [...layers].reverse().map((l) => l.probe(x, y)).filter(Boolean);
}
