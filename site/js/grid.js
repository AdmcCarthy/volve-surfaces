// Grid loading, NaN-aware smoothing, gap extrapolation and class breaks. No DOM, no colour.

export async function loadSet(base) {
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`${base}/manifest.json: ${res.status}`);
  return { base, m: await res.json(), cache: new Map() };
}

// Decode a Uint16 grid (z = offset + value * scale) into a Float32Array with NaN for nodata. Row 0 is north.
export async function loadGrid(set, id) {
  if (set.cache.has(id)) return set.cache.get(id);
  const { m } = set, h = m.horizons.find((x) => x.id === id);
  if (!h) throw new Error(`unknown horizon ${id}`);
  const res = await fetch(`${set.base}/${h.file}`);
  if (!res.ok) throw new Error(`${h.file}: ${res.status}`);
  const q = new Uint16Array(await res.arrayBuffer()), z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] === m.nodata ? NaN : h.offset + q[i] * h.scale;
  const g = { id, label: h.label, unit: h.unit, domain: h.domain, nx: m.nx, ny: m.ny, cell: m.cell, x0: m.origin.x, y0: m.origin.y, z, meta: h, manifest: m };
  set.cache.set(id, g);
  return g;
}

// A derived grid on the same frame (thickness, residual): NaN wherever the inputs are NaN.
export function derived(base, id, label, unit, z) {
  return { ...base, id, label, unit, z, meta: { ...base.meta, derived: true } };
}

function convolve(src, nx, ny, k, r, horizontal) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let t = -r; t <= r; t++) {
        const xx = horizontal ? x + t : x, yy = horizontal ? y : y + t;
        if (xx >= 0 && xx < nx && yy >= 0 && yy < ny) s += src[yy * nx + xx] * k[t + r];
      }
      out[y * nx + x] = s;
    }
  }
  return out;
}

// Gaussian blur that ignores nodata (normalised convolution): the footprint and fault gaps are unchanged.
export function blur(z, nx, ny, sigma) {
  if (!(sigma > 0)) return z;
  const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  const v = new Float32Array(z.length), w = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) if (!Number.isNaN(z[i])) { v[i] = z[i]; w[i] = 1; }
  const bv = convolve(convolve(v, nx, ny, k, r, true), nx, ny, k, r, false);
  const bw = convolve(convolve(w, nx, ny, k, r, true), nx, ny, k, r, false);
  const out = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) out[i] = Number.isNaN(z[i]) ? NaN : bv[i] / bw[i];
  return out;
}

// How far the smoothed surface is from the source, over valid cells (same unit as z).
export function deviation(a, b) {
  let n = 0, s2 = 0, max = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    const d = Math.abs(a[i] - b[i]);
    s2 += d * d; n++; if (d > max) max = d;
  }
  return { rms: n ? Math.sqrt(s2 / n) : 0, max };
}

// Extend values a few cells into nodata (neighbour mean), so contours and bilinear sampling reach the footprint edge.
export function dilate(z, nx, ny, passes = 3) {
  let a = Float32Array.from(z);
  for (let p = 0; p < passes; p++) {
    const b = Float32Array.from(a);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (!Number.isNaN(a[i])) continue;
        let s = 0, c = 0;
        if (x > 0 && !Number.isNaN(a[i - 1])) { s += a[i - 1]; c++; }
        if (x < nx - 1 && !Number.isNaN(a[i + 1])) { s += a[i + 1]; c++; }
        if (y > 0 && !Number.isNaN(a[i - nx])) { s += a[i - nx]; c++; }
        if (y < ny - 1 && !Number.isNaN(a[i + nx])) { s += a[i + nx]; c++; }
        if (c) b[i] = s / c;
      }
    }
    a = b;
  }
  return a;
}

export function extent(z) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < z.length; i++) { const v = z[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

// Class edges [min, ..., max] (length = classes + 1).
//   nice     round step (1, 2, 5 x 10^n) giving about n classes: readable numbers, the house default
//   equal    exactly n classes of equal width
//   quantile n classes with equal area
//   sym      n classes of equal width, symmetric about zero (for residuals and differences)
export function classEdges(z, method, n) {
  const [lo, hi] = extent(z);
  if (method === "equal") return d3.range(n + 1).map((i) => lo + ((hi - lo) * i) / n);
  if (method === "sym") { const m = Math.max(Math.abs(lo), Math.abs(hi)); return d3.range(n + 1).map((i) => -m + (2 * m * i) / n); }
  if (method === "quantile") {
    const v = Array.from(z).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    const e = d3.range(n + 1).map((i) => v[Math.min(v.length - 1, Math.round((i / n) * (v.length - 1)))]);
    return e.filter((x, i) => i === 0 || x > e[i - 1]);
  }
  const step = d3.tickStep(lo, hi, n);
  const inner = d3.range(Math.ceil(lo / step) * step, hi, step).filter((x) => x > lo);
  return [lo, ...inner, hi];
}
