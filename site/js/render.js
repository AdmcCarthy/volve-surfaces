// Draws one grid onto a canvas: linear gradient or stepped (stacked contour polygons) fill, optional contour lines and
// soft shading. Returns what the legend and the "generalised for display" badge need.
import { blur, edgePreserve, upsample, deviation, dilate, extent, classEdges, stepEdges } from "./grid.js";
import { classColours, lut, token } from "./ramps.js";
import { faultTrend } from "./trend.js";

const NEG = -1e9; // nodata value for contouring, far below every threshold
const ALT = (35 * Math.PI) / 180; // low sun, so scarps cast and take shadow

function bilinear(z, nx, ny, i, j, fx, fy) {
  let s = 0, w = 0;
  for (let dj = 0; dj < 2; dj++) {
    for (let di = 0; di < 2; di++) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      const v = z[y * nx + x];
      if (Number.isNaN(v)) continue;
      const wt = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
      s += v * wt; w += wt;
    }
  }
  return w > 1e-4 ? s / w : NaN;
}

// Soft hillshade as a nx x ny RGBA image: dark where the surface faces away from the light, light where it faces it,
// transparent on flat ground. Elevation is -depth, exaggerated by `ve`. `sources` is a list of [azimuth, weight]
// (degrees clockwise from north, weights summing to 1); each source also gets two neighbours 35 degrees either side,
// for a soft multi-directional result.
function hillshade(z, nx, ny, cell, ve, strength, sources) {
  const img = new ImageData(nx, ny);
  const lights = sources.flatMap(([az, w]) => [[az, 0.5 * w], [az - 35, 0.25 * w], [az + 35, 0.25 * w]]).map(([a, w]) => {
    const r = (a * Math.PI) / 180;
    return [Math.sin(r) * Math.cos(ALT), Math.cos(r) * Math.cos(ALT), w];
  });
  const at = (x, y, c) => { const v = z[y * nx + x]; return Number.isNaN(v) ? c : v; };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = z[y * nx + x];
      if (Number.isNaN(c)) continue;
      const xl = Math.max(0, x - 1), xr = Math.min(nx - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(ny - 1, y + 1);
      const dE = ((-at(xr, y, c) + at(xl, y, c)) * ve) / ((xr - xl || 1) * cell);
      const dN = (-(-at(x, yd, c) + at(x, yu, c)) * ve) / ((yd - yu || 1) * cell);
      const nrm = Math.hypot(dE, dN, 1);
      let il = 0;
      for (const [lx, ly, w] of lights) il += (w * (-dE * lx - dN * ly + Math.sin(ALT))) / nrm;
      const s = il - Math.sin(ALT), a = Math.min(0.45, Math.abs(s) * 1.1 * strength), p = (y * nx + x) * 4;
      const v = s < 0 ? 0 : 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = a * 255;
    }
  }
  return img;
}

// Options
//   fill      "linear" | "stepped"
//   stops     colour stops, low to high
//   step      class step in data units (stepped: class width; linear: rounds the range). null = classes/method
//   min, max  colour range; null = data range rounded outwards to `step`. Values outside take the end colours.
//   sigmaM    smoothing width in metres (0 = none); smoother "edge" (edge-preserving diffusion) or "gaussian"
//   upsample  1 or 2: contour on a bicubic grid 2x denser (values unchanged, lines lose the 25 m stair-steps)
//   contour   contour interval in data units, 0 = none (every 5th drawn heavier)
//   shade     0 | 0.5 | 1; light "auto" (across the fault trend) or "nw" (315 degrees)
export function renderMap(canvas, g, opts = {}) {
  const o = { fill: "stepped", stops: [], step: null, min: null, max: null, classes: 9, method: "nice", edges: null, sigmaM: 0,
    smoother: "edge", upsample: 1, contour: 0, shade: 0, light: "auto", ve: 5, diverging: false, width: null, ...opts };
  const { nx, ny, cell } = g;
  const sc = o.sigmaM / cell;
  const smooth = o.sigmaM > 0 ? (o.smoother === "gaussian" ? blur(g.z, nx, ny, sc) : edgePreserve(g.z, nx, ny, sc)) : g.z;
  const dev = deviation(g.z, smooth);
  const grid = dilate(smooth, nx, ny, 3);
  const fine = upsample(grid, nx, ny, o.upsample), U = fine.u;

  // crop to the valid area, with a small margin
  let x0 = nx, x1 = 0, y0 = ny, y1 = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (!Number.isNaN(g.z[y * nx + x])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(nx, x1 + 7); y1 = Math.min(ny, y1 + 7);
  const cw = x1 - x0, ch = y1 - y0;
  const cssW = o.width ?? (canvas.clientWidth || 640), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const k = cssW / cw, px = k * dpr;
  canvas.width = Math.round(cw * px); canvas.height = Math.round(ch * px);
  canvas.style.aspectRatio = `${cw} / ${ch}`;

  // colour range and class edges
  const ext = extent(smooth);
  let domain, edges = null, range = null;
  if (o.diverging) {
    const m = Math.max(Math.abs(ext[0]), Math.abs(ext[1]));
    domain = [-m, m];
  } else if (o.step) {
    const lo = o.min ?? Math.floor(ext[0] / o.step) * o.step, hi = o.max ?? Math.ceil(ext[1] / o.step) * o.step;
    domain = [lo, hi > lo ? hi : lo + o.step];
    range = { lo: domain[0], hi: domain[1], step: o.step, dataMin: ext[0], dataMax: ext[1], auto: o.min == null && o.max == null };
  } else {
    domain = [o.min ?? ext[0], o.max ?? ext[1]];
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const toGrid = () => ctx.setTransform(px, 0, 0, px, -x0 * px, -y0 * px);
  // contour coordinates of the denser grid: node I sits at X = I + 0.5, which is original position (X - 0.5) / U + 0.5
  const toFine = () => ctx.setTransform(px / U, 0, 0, px / U, (0.5 - 0.5 / U - x0) * px, (0.5 - 0.5 / U - y0) * px);
  const path = d3.geoPath(null, ctx);

  const mask = new Float32Array(g.z.length);
  for (let i = 0; i < mask.length; i++) mask[i] = Number.isNaN(g.z[i]) ? 0 : 1;
  // a lightly blurred mask gives a smooth survey edge instead of 25 m stair-steps; narrow fault gaps survive
  const foot = d3.contours().size([nx, ny]).smooth(true).thresholds([0.5])(blur(mask, nx, ny, 1))[0];
  const cg = Float32Array.from(fine.z, (v) => (Number.isNaN(v) ? NEG : v)); // contouring grid
  const contours = (th) => d3.contours().size([fine.nx, fine.ny]).thresholds(th)(cg);

  let cols = null;
  if (o.fill === "linear") {
    const L = lut(o.stops), [d0, d1] = domain, span = d1 - d0 || 1;
    const off = document.createElement("canvas");
    off.width = canvas.width; off.height = canvas.height;
    const octx = off.getContext("2d"), img = octx.createImageData(off.width, off.height), W = off.width, H = off.height;
    for (let Y = 0; Y < H; Y++) {
      const v = ((Y + 0.5) / px + y0 - 0.5) * U, j = Math.floor(v), fy = v - j;
      for (let X = 0; X < W; X++) {
        const u = ((X + 0.5) / px + x0 - 0.5) * U, i = Math.floor(u);
        const val = bilinear(fine.z, fine.nx, fine.ny, i, j, u - i, fy);
        if (Number.isNaN(val)) continue;
        const c = L[Math.max(0, Math.min(255, Math.round(((val - d0) / span) * 255)))], p = (Y * W + X) * 4;
        img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();
  } else {
    edges = o.edges || (o.step && !o.diverging ? stepEdges(domain[0], domain[1], o.step) : classEdges(smooth, o.diverging ? "sym" : o.method, o.classes));
    cols = classColours(o.stops, edges.length - 1);
    ctx.save(); toGrid();
    ctx.beginPath(); path(foot); ctx.fillStyle = cols[0]; ctx.fill(); ctx.clip();
    toFine();
    contours(edges.slice(1, -1)).forEach((p, i) => { ctx.beginPath(); path(p); ctx.fillStyle = cols[i + 1]; ctx.fill(); });
    ctx.restore();
  }

  // fault trend: orientation of the steepest gradients; light comes across it so steep faces fall in shadow
  const trend = faultTrend(g.z, nx, ny, cell);
  const lights = o.light === "nw" || !trend.auto ? [[315, 1]] : trend.trends.map((t) => [t.light, t.share]);
  if (o.shade > 0) {
    const sg = dilate(blur(smooth, nx, ny, 1), nx, ny, 3);
    const off = document.createElement("canvas");
    off.width = nx; off.height = ny;
    off.getContext("2d").putImageData(hillshade(sg, nx, ny, cell, o.ve, o.shade, lights), 0, 0);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  if (o.contour > 0) {
    const step = o.contour, th = d3.range(Math.ceil(ext[0] / step) * step, ext[1], step);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip(); toFine();
    ctx.strokeStyle = token("--ss-text"); ctx.lineJoin = "round";
    contours(th).forEach((c) => {
      const index = Math.round(c.value / step) % 5 === 0;
      ctx.globalAlpha = index ? 0.6 : 0.28; ctx.lineWidth = ((index ? 1.15 : 0.6) * dpr * U) / px;
      ctx.beginPath(); path(c); ctx.stroke();
    });
    ctx.restore();
  }

  ctx.save(); toGrid();
  ctx.strokeStyle = token("--ss-border"); ctx.lineWidth = dpr / px; ctx.beginPath(); path(foot); ctx.stroke();
  ctx.restore();

  return { fill: o.fill, stops: o.stops, edges, colours: cols, domain, range, unit: g.unit, method: o.diverging ? "sym" : o.method, step: o.step && !o.diverging ? o.step : null,
    sigmaM: o.sigmaM, smoother: o.smoother, upsample: U, dev, contour: o.contour || null, shade: o.shade, trend, lights, lightMode: o.light, view: { x0, y0, k } };
}

// Raw (unsmoothed) value and UTM position under a pointer, in CSS px relative to the canvas.
export function probe(g, info, cssX, cssY) {
  const { x0, y0, k } = info.view, gx = cssX / k + x0, gy = cssY / k + y0;
  const u = gx - 0.5, v = gy - 0.5, i = Math.floor(u), j = Math.floor(v);
  return { z: bilinear(g.z, g.nx, g.ny, i, j, u - i, v - j), easting: g.x0 + gx * g.cell, northing: g.y0 - gy * g.cell };
}
