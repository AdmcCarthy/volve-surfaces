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

// Edge-preserving smoothing (Perona-Malik anisotropic diffusion, as used for seismic surfaces and structure-oriented
// filtering): noise and gentle roughness are diffused away, steps such as fault throws are not, and nothing flows
// across nodata (fault gaps, survey edge). `sigmaCells` is the equivalent Gaussian width where the surface is smooth.
// The edge threshold K is the 85th percentile of neighbour differences, so only the steepest 15 % of steps are protected.
export function edgePreserve(z, nx, ny, sigmaCells) {
  if (!(sigmaCells > 0)) return z;
  const diffs = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = z[y * nx + x];
      if (Number.isNaN(v)) continue;
      if (x < nx - 1 && !Number.isNaN(z[y * nx + x + 1])) diffs.push(Math.abs(z[y * nx + x + 1] - v));
      if (y < ny - 1 && !Number.isNaN(z[(y + 1) * nx + x])) diffs.push(Math.abs(z[(y + 1) * nx + x] - v));
    }
  }
  diffs.sort((a, b) => a - b);
  const K = Math.max(1e-3, diffs[Math.floor(0.85 * (diffs.length - 1))] || 1e-3);
  const dt = 0.2, iters = Math.max(1, Math.round((sigmaCells * sigmaCells) / 2 / dt));
  let a = Float32Array.from(z);
  for (let it = 0; it < iters; it++) {
    const b = Float32Array.from(a);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x, v = a[i];
        if (Number.isNaN(v)) continue;
        let flux = 0;
        for (const j of [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1]) {
          if (j < 0 || Number.isNaN(a[j])) continue;
          const d = a[j] - v;
          flux += Math.exp(-((d / K) ** 2)) * d;
        }
        b[i] = v + dt * flux;
      }
    }
    a = b;
  }
  return a;
}

// Bicubic (Catmull-Rom) upsampling by an integer factor u: passes through every original value, so the data are not
// changed, and contours drawn on the denser grid lose the 25 m stair-steps. Node I of the result sits at I / u.
export function upsample(z, nx, ny, u) {
  if (u <= 1) return { z, nx, ny, u: 1 };
  const nx2 = (nx - 1) * u + 1, ny2 = (ny - 1) * u + 1;
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const c = (v, n) => Math.max(0, Math.min(n - 1, v));
  const tmp = new Float32Array(nx2 * ny);
  for (let y = 0; y < ny; y++) {
    for (let X = 0; X < nx2; X++) {
      const i = Math.floor(X / u), t = (X % u) / u, r = y * nx;
      tmp[y * nx2 + X] = t === 0 ? z[r + i] : cr(z[r + c(i - 1, nx)], z[r + i], z[r + c(i + 1, nx)], z[r + c(i + 2, nx)], t);
    }
  }
  const out = new Float32Array(nx2 * ny2);
  for (let Y = 0; Y < ny2; Y++) {
    const j = Math.floor(Y / u), t = (Y % u) / u;
    for (let X = 0; X < nx2; X++) {
      out[Y * nx2 + X] = t === 0 ? tmp[j * nx2 + X] : cr(tmp[c(j - 1, ny) * nx2 + X], tmp[j * nx2 + X], tmp[c(j + 1, ny) * nx2 + X], tmp[c(j + 2, ny) * nx2 + X], t);
    }
  }
  return { z: out, nx: nx2, ny: ny2, u };
}

// Class edges at a fixed step between a rounded minimum and maximum: [min, min + step, ..., max]. At most `cap` classes.
export function stepEdges(min, max, step, cap = 80) {
  const n = Math.max(1, Math.min(cap, Math.round((max - min) / step)));
  return d3.range(n + 1).map((i) => min + i * step);
}

// Largest of the usual steps that still gives about eight or more classes over the range.
export const STEPS = [1, 2, 5, 10, 20, 50, 100, 200];
export function autoStep(lo, hi) {
  const ok = STEPS.filter((s) => (hi - lo) / s >= 8);
  return ok.length ? ok[ok.length - 1] : STEPS[0];
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
