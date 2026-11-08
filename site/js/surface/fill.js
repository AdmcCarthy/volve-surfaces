// Where the hydrocarbons are: the fill of a structure by contact, per fault segment (docs/contacts.md). No drawing, no Volve.
//
// A segment is a seed, a limit and barriers. The fill starts at the seed and spreads through neighbouring cells shallower than the
// deepest contact (4-connected), stopping at nodata (fault heave in the surface), at the accumulation outline when there is one, and at
// barrier lines (sealing faults). It is OPEN where it reaches the survey edge or the outline: the trap is then not closed by the surface
// and the display says so. Depths are positive down, the same datum as the surface.
//
// Contacts of a segment (records of docs/modules.md): kind "OWC" | "GOC" | "GWC", depth, optionally range {min, likely, max} or a discrete
// distribution [{depth, p}] (p in percent) for the deepest contact. Without a distribution the contact is a single level.

// ---------------------------------------------------------------- rasterising limits onto the grid (canvas, no external geometry code)
function raster(g, draw) {
  const c = document.createElement("canvas");
  c.width = g.nx; c.height = g.ny;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = ctx.strokeStyle = "white"; ctx.lineJoin = ctx.lineCap = "round";
  draw(ctx, (x, y) => [(x - g.x0) / g.cell, (g.y0 - y) / g.cell]);
  const d = ctx.getImageData(0, 0, g.nx, g.ny).data, out = new Uint8Array(g.nx * g.ny);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}
export const polygonMask = (g, xy) => raster(g, (ctx, to) => { ctx.beginPath(); xy.forEach(([x, y], i) => { const [a, b] = to(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.fill(); });
export const lineMask = (g, xy, widthCells = 2) => raster(g, (ctx, to) => { ctx.lineWidth = widthCells; ctx.beginPath(); xy.forEach(([x, y], i) => { const [a, b] = to(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); });

// Binary closing (3x3, `n` times): fills the narrow fault gaps inside the survey and leaves the exterior, which is what "open" means.
function exteriorMask(g, n = 4) {
  const { nx, ny } = g;
  let a = Uint8Array.from(g.z, (v) => (Number.isNaN(v) ? 0 : 1));
  const pass = (src, dilateIt) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let v = dilateIt ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy, inside = xx >= 0 && yy >= 0 && xx < nx && yy < ny;
            const s = inside ? src[yy * nx + xx] : dilateIt ? 0 : 1; // outside the frame is neutral
            if (dilateIt && s) v = 1;
            if (!dilateIt && !s) v = 0;
          }
        }
        out[y * nx + x] = v;
      }
    }
    return out;
  };
  for (let i = 0; i < n; i++) a = pass(a, true);
  for (let i = 0; i < n; i++) a = pass(a, false);
  return Uint8Array.from(a, (v) => 1 - v); // 1 = outside the (closed) survey
}

// ---------------------------------------------------------------- contacts of a segment
// The model of a segment's contacts: the gas-oil contact, the deepest ("base") contact, and the deepest it could be.
export function segmentModel(contacts) {
  const goc = contacts.find((c) => c.kind === "GOC") ?? null;
  const base = contacts.find((c) => c.kind === "OWC") ?? contacts.find((c) => c.kind === "GWC") ?? null;
  const deepest = base ?? goc;
  if (!deepest) return null;
  const spread = (c) => c.distribution ? Math.max(...c.distribution.map((d) => d.depth)) : c.range ? c.range.max : c.depth;
  return { goc, base, deepest, likely: deepest.depth, maxDepth: Math.max(spread(deepest), deepest.depth), gasOnly: !contacts.some((c) => c.kind === "OWC") && !!contacts.find((c) => c.kind === "GWC") };
}

// Which fluid fills a cell at depth z: gas above the gas-oil contact (or the gas-water contact), oil above the oil-water contact.
export function fluidAt(model, z) {
  if (!model) return null;
  const { goc, base } = model;
  if (model.gasOnly) return z <= base.depth ? "gas" : null;
  if (goc && z <= goc.depth) return "gas";
  if (base && base.kind === "OWC" && z <= base.depth) return "oil";
  return null;
}

// Probability that hydrocarbons are present at depth z, i.e. that the deepest contact is at least z.
//   distribution  exceedance of the discrete contacts, interpolated between them (the stated contacts are the only mass: nothing below the last)
//   range         a triangular distribution on min, likely, max (an assumption, stated on the map)
//   single value  1 above the contact, 0 below
export function probAt(model, z) {
  const c = model.deepest;
  if (c.distribution) {
    const d = [...c.distribution].sort((a, b) => a.depth - b.depth);
    const exceed = d.map((r) => d.filter((s) => s.depth >= r.depth).reduce((t, s) => t + s.p, 0) / 100);
    if (z <= d[0].depth) return 1;
    for (let i = 1; i < d.length; i++) if (z <= d[i].depth) return exceed[i - 1] + ((exceed[i] - exceed[i - 1]) * (z - d[i - 1].depth)) / (d[i].depth - d[i - 1].depth);
    return 0;
  }
  if (c.range) {
    const { min, likely, max } = c.range;
    if (z <= min) return 1;
    if (z >= max) return 0;
    return z <= likely ? 1 - (z - min) ** 2 / ((max - min) * (likely - min || 1)) : (max - z) ** 2 / ((max - min) * (max - likely || 1));
  }
  return z <= c.depth ? 1 : 0;
}

// Exceedance quantiles (oilfield convention: P90 is the low case) of a discrete distribution.
export function quantiles(dist) {
  const d = [...dist].sort((a, b) => a.depth - b.depth), exceed = (x) => d.filter((s) => s.depth >= x).reduce((t, s) => t + s.p, 0);
  const q = (p) => Math.max(...d.filter((r) => exceed(r.depth) >= p).map((r) => r.depth));
  return { P90: q(90), P50: q(50), P10: q(10) };
}

// ---------------------------------------------------------------- the fill
// setup: { outline: [[x, y], ...] | null, barriers: [[[x, y], ...], ...], segments: [{ id, name, seed: [x, y], contacts: [...] }] }
// Returns { labels (0 = none, k = segment k-1), segments: [{ id, name, model, area_km2, open, merged, empty, seedDepth, columnMax }] }.
export function computeFill(g, setup) {
  const { nx, ny, cell } = g, N = nx * ny;
  const inside = setup.outline ? polygonMask(g, setup.outline) : null;
  const blocked = new Uint8Array(N);
  for (const b of setup.barriers ?? []) lineMask(g, b, 2).forEach((v, i) => { if (v) blocked[i] = 1; });
  const exterior = exteriorMask(g), labels = new Uint8Array(N), out = [];
  setup.segments.forEach((seg, k) => {
    const model = segmentModel(seg.contacts), info = { id: seg.id, name: seg.name, model, area_km2: 0, open: false, openAt: [], merged: false, empty: false, seedDepth: null, columnMax: 0 };
    out.push(info);
    if (!model) { info.empty = true; return; }
    // the seed cell: the nearest valid cell to the seed position
    const sx = Math.floor((seg.seed[0] - g.x0) / cell), sy = Math.floor((g.y0 - seg.seed[1]) / cell);
    let seed = -1, best = 1e9;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= nx || y >= ny || Number.isNaN(g.z[y * nx + x])) continue;
      if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; seed = y * nx + x; }
    }
    if (seed < 0) { info.empty = true; return; }
    info.seedDepth = g.z[seed];
    if (info.seedDepth > model.maxDepth) { info.empty = true; return; } // the seed is below every contact: no fill
    if (labels[seed]) { info.merged = true; return; } // already claimed by another segment: the barrier does not divide them
    const free = (i) => !Number.isNaN(g.z[i]) && g.z[i] <= model.maxDepth && !blocked[i] && (!inside || inside[i]);
    if (!free(seed)) { info.empty = true; return; }
    const queue = [seed]; labels[seed] = k + 1;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h], x = i % nx, y = (i - x) / nx;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) { info.open = true; continue; }
        const j = yy * nx + xx;
        if (labels[j]) { if (labels[j] !== k + 1) info.merged = true; continue; }
        if (exterior[j]) { info.open = true; continue; }
        if (inside && !inside[j] && !Number.isNaN(g.z[j]) && g.z[j] <= model.maxDepth && !blocked[j]) { info.openAt.push("outline"); continue; }
        if (!free(j)) continue;
        labels[j] = k + 1; queue.push(j);
      }
    }
    let area = 0, cmax = 0;
    for (const i of queue) { if (g.z[i] <= model.likely) { area++; cmax = Math.max(cmax, model.likely - g.z[i]); } }
    info.area_km2 = (area * cell * cell) / 1e6; info.columnMax = cmax; info.limitedByOutline = info.openAt.length > 0;
  });
  return { labels, segments: out };
}
