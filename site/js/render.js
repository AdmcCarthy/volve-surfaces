// Draws one grid onto a canvas: linear gradient or stepped (stacked contour polygons) fill, optional contour lines and
// soft shading. Returns what the legend and the "generalised for display" badge need.
import { blur, deviation, dilate, extent, classEdges } from "./grid.js";
import { classColours, lut, token } from "./ramps.js";

const NEG = -1e9; // nodata value for contouring, far below every threshold

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

// Soft multi-directional hillshade as a nx x ny RGBA image: dark where the surface faces away from the light,
// light where it faces it, transparent on flat ground. Elevation is -depth, exaggerated by `ve`.
function hillshade(z, nx, ny, cell, ve, strength) {
  const img = new ImageData(nx, ny), alt = Math.PI / 4;
  const lights = [[315, 0.5], [270, 0.25], [360, 0.25]].map(([a, w]) => {
    const r = (a * Math.PI) / 180;
    return [Math.sin(r) * Math.cos(alt), Math.cos(r) * Math.cos(alt), w];
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
      for (const [lx, ly, w] of lights) il += (w * (-dE * lx - dN * ly + Math.sin(alt))) / nrm;
      const s = il - Math.sin(alt), a = Math.min(0.5, Math.abs(s) * 1.1 * strength), p = (y * nx + x) * 4;
      const v = s < 0 ? 0 : 255;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = a * 255;
    }
  }
  return img;
}

export function renderMap(canvas, g, opts = {}) {
  const o = { fill: "stepped", stops: [], classes: 9, method: "nice", edges: null, sigmaM: 60, contours: "none", interval: 20,
    shade: 0, ve: 5, diverging: false, domain: null, width: null, ...opts };
  const { nx, ny, cell } = g;
  const smooth = o.sigmaM > 0 ? blur(g.z, nx, ny, o.sigmaM / cell) : g.z;
  const dev = deviation(g.z, smooth);
  const grid = dilate(smooth, nx, ny, 3);

  // crop to the valid area, with a small margin
  let x0 = nx, x1 = 0, y0 = ny, y1 = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (!Number.isNaN(g.z[y * nx + x])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6); x1 = Math.min(nx, x1 + 7); y1 = Math.min(ny, y1 + 7);
  const cw = x1 - x0, ch = y1 - y0;
  const cssW = o.width ?? (canvas.clientWidth || 640), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const k = cssW / cw, px = k * dpr;
  canvas.width = Math.round(cw * px); canvas.height = Math.round(ch * px);
  canvas.style.aspectRatio = `${cw} / ${ch}`;

  let domain = o.domain || extent(smooth);
  if (o.diverging) { const m = Math.max(Math.abs(domain[0]), Math.abs(domain[1])); domain = [-m, m]; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const toGrid = () => ctx.setTransform(px, 0, 0, px, -x0 * px, -y0 * px);
  const path = d3.geoPath(null, ctx);

  const mask = new Float32Array(g.z.length);
  for (let i = 0; i < mask.length; i++) mask[i] = Number.isNaN(g.z[i]) ? 0 : 1;
  // a lightly blurred mask gives a smooth survey edge instead of 25 m stair-steps; narrow fault gaps survive
  const foot = d3.contours().size([nx, ny]).smooth(true).thresholds([0.5])(blur(mask, nx, ny, 1))[0];
  const cg = Float32Array.from(grid, (v) => (Number.isNaN(v) ? NEG : v)); // contouring grid

  let edges = null, cols = null;
  if (o.fill === "linear") {
    const L = lut(o.stops), [d0, d1] = domain, span = d1 - d0 || 1;
    const off = document.createElement("canvas");
    off.width = canvas.width; off.height = canvas.height;
    const octx = off.getContext("2d"), img = octx.createImageData(off.width, off.height), W = off.width, H = off.height;
    for (let Y = 0; Y < H; Y++) {
      const v = (Y + 0.5) / px + y0 - 0.5, j = Math.floor(v), fy = v - j;
      for (let X = 0; X < W; X++) {
        const u = (X + 0.5) / px + x0 - 0.5, i = Math.floor(u);
        const val = bilinear(grid, nx, ny, i, j, u - i, fy);
        if (Number.isNaN(val)) continue;
        const c = L[Math.max(0, Math.min(255, Math.round(((val - d0) / span) * 255)))], p = (Y * W + X) * 4;
        img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();
  } else {
    edges = o.edges || classEdges(smooth, o.diverging ? "sym" : o.method, o.classes);
    cols = classColours(o.stops, edges.length - 1);
    ctx.save(); toGrid();
    ctx.beginPath(); path(foot); ctx.fillStyle = cols[0]; ctx.fill(); ctx.clip();
    d3.contours().size([nx, ny]).thresholds(edges.slice(1, -1))(cg).forEach((p, i) => {
      ctx.beginPath(); path(p); ctx.fillStyle = cols[i + 1]; ctx.fill();
    });
    ctx.restore();
  }

  if (o.shade > 0) {
    const sg = o.sigmaM / cell >= 1.5 ? grid : dilate(blur(g.z, nx, ny, 1.5), nx, ny, 3);
    const off = document.createElement("canvas");
    off.width = nx; off.height = ny;
    off.getContext("2d").putImageData(hillshade(sg, nx, ny, cell, o.ve, o.shade), 0, 0);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  if (o.contours !== "none") {
    const step = o.interval, th = d3.range(Math.ceil(domain[0] / step) * step, domain[1], step);
    ctx.save(); toGrid(); ctx.beginPath(); path(foot); ctx.clip();
    ctx.strokeStyle = token("--ss-text"); ctx.lineJoin = "round";
    d3.contours().size([nx, ny]).thresholds(th)(cg).forEach((c) => {
      const index = Math.round(c.value / step) % 5 === 0;
      if (o.contours === "index" && !index) return;
      ctx.globalAlpha = index ? 0.6 : 0.28; ctx.lineWidth = ((index ? 1.15 : 0.6) * dpr) / px;
      ctx.beginPath(); path(c); ctx.stroke();
    });
    ctx.restore();
  }

  ctx.save(); toGrid();
  ctx.strokeStyle = token("--ss-border"); ctx.lineWidth = dpr / px; ctx.beginPath(); path(foot); ctx.stroke();
  ctx.restore();

  return { fill: o.fill, stops: o.stops, edges, colours: cols, domain, unit: g.unit, method: o.diverging ? "sym" : o.method,
    sigmaM: o.sigmaM, dev, interval: o.contours === "none" ? null : o.interval, view: { x0, y0, k } };
}

// Raw (unsmoothed) value and UTM position under a pointer, in CSS px relative to the canvas.
export function probe(g, info, cssX, cssY) {
  const { x0, y0, k } = info.view, gx = cssX / k + x0, gy = cssY / k + y0;
  const u = gx - 0.5, v = gy - 0.5, i = Math.floor(u), j = Math.floor(v);
  return { z: bilinear(g.z, g.nx, g.ny, i, j, u - i, v - j), easting: g.x0 + gx * g.cell, northing: g.y0 - gy * g.cell };
}
