// The hydrocarbon contacts layer (docs/contacts.md). Meets the layer contract (contract.js).
//
// Fill: colour is the height of the column above the deepest contact, continuous (or stepped, at a class step), in the fluid's own hue
// (oil ochre, gas haematite: SubScout tokens). Where the contact is uncertain the fill fades with the probability that the contact is at
// least that deep. Lines: each contact at its depth, and where there is a range or a distribution its low, likely and high cases dashed.
// Segments: a barrier is a hatched line, and a fill never crosses it, so two segments can hold two different contacts. Wells that
// prove a fluid are drawn with the SubScout well symbols (oil: filled circle; water-bearing: the dry-well symbol).
import { computeFill, fluidAt, probAt, quantiles } from "../surface/fill.js";
import { autoStep } from "../surface/grid.js";
import { bilinear } from "../surface/render.js";
import { hueRamp, lut, classColours, token } from "../style/ramps.js";
import { drawSymbol, wellSpec, symbolSvg, fluidInk, data as symbolData } from "../vendor/subscout/symbols.js";

export async function loadContacts(base) {
  const res = await fetch(`${base}/contacts.json`);
  return res.ok ? res.json() : null;
}

const FLUID_HUE = { oil: "ochre", gas: "haematite" };
const FLUID_NAME = { oil: "Oil", gas: "Gas" };
const KIND_NAME = { OWC: "oil-water contact", GOC: "gas-oil contact", GWC: "gas-water contact", ODT: "oil down to" };
const fmt = d3.format(",.0f"), fmt1 = d3.format(",.1f");
const shortWell = (n) => n.replace(/^NO 15\/9-/, "").replace(/^19 /, "19");

// opts: { caseId, prepared (the surface layer's prepared grid), fill, lines, wells, barrier, outline, fade, colour: "continuous" | "stepped", columnStep,
//         standard: the Geostandard colours (6.12) and contact-line styles (6.27) instead of the SubScout hues; off by default, not colour-vision safe }
export function createContactsLayer(g, data, opts = {}) {
  const o = { fill: true, lines: true, wells: true, barrier: true, outline: true, fade: true, colour: "continuous", columnStep: null, standard: false, ...opts };
  const kase = data.cases.find((c) => c.id === o.caseId) ?? data.cases[0];
  const setup = {
    outline: data.outline?.xy ?? null,
    barriers: (data.barriers ?? []).map((b) => b.xy),
    segments: data.segments.map((s) => ({ id: s.id, name: s.name, seed: s.seed, contacts: kase.contacts.filter((c) => !c.segment || c.segment === s.id) })),
  };
  const fill = computeFill(g, setup);
  const used = fill.segments.filter((s) => s.model && !s.empty);
  const fluids = [...new Set(used.flatMap((s) => [s.model.goc ? "gas" : null, s.model.base ? (s.model.gasOnly ? "gas" : "oil") : null].filter(Boolean)))];
  const colMax = Math.max(1, ...fill.segments.map((s) => s.columnMax)), step = o.columnStep ?? autoStep(0, colMax);
  const px = { cache: null }; // per-draw colour tables

  function colours() {
    const out = {};
    for (const f of fluids) {
      // the Geostandard gives one colour per fluid: the ramp runs from the page surface to that colour, so a thin column is pale and a thick one full
      const std = symbolData.colours[f], surf = d3.rgb(token("--ss-surface"));
      const stops = o.standard ? d3.range(7).map((i) => d3.interpolateRgb(surf, std)(0.15 + (0.85 * i) / 6)) : hueRamp(FLUID_HUE[f]);
      const n = Math.max(2, Math.ceil(colMax / step));
      out[f] = { stops, lut: lut(stops), classes: classColours(stops, n).map((c) => { const k = d3.rgb(c); return [k.r, k.g, k.b]; }), classCss: classColours(stops, n), n };
    }
    return out;
  }

  const [bx0, by0, bx1, by1] = (() => {
    const pts = data.outline?.xy ?? data.segments.map((s) => s.seed);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.min(...xs) - 500, Math.min(...ys) - 500, Math.max(...xs) + 500, Math.max(...ys) + 500];
  })();

  // contact lines to draw for one segment: the contacts, and their low/likely/high cases when there are some
  const linesFor = (seg) => seg.contacts.flatMap((c) => {
    const out = [{ depth: c.depth, kind: c.kind, main: true, text: `${c.kind} ${fmt(c.depth)}` }];
    const q = c.distribution ? quantiles(c.distribution) : null;
    if (q) out.push(...["P90", "P50", "P10"].map((k) => ({ depth: q[k], kind: c.kind, main: false, text: `${k} ${fmt(q[k])}` })));
    if (c.range) out.push(...[["min", c.range.min], ["max", c.range.max]].filter(([, d]) => d !== c.depth).map(([k, d]) => ({ depth: d, kind: c.kind, main: false, text: `${k} ${fmt(d)}` })));
    return out;
  });

  return {
    id: "contacts",
    kind: "contacts",
    crs: data.crs,
    fill,
    caseUsed: kase,
    bounds: () => [bx0, by0, bx1, by1],

    draw(ctx, view) {
      const dpr = view.dpr, ps = view.scale * dpr, pc = ps * g.cell, W = Math.round(view.width * dpr), H = Math.round(view.height * dpr);
      const tx = (g.x0 - view.x0) * ps, ty = (view.y0 - g.y0) * ps, { nx, ny } = g;
      const prepared = o.prepared ?? { fine: { z: g.z, nx, ny, u: 1 } }, fine = prepared.fine, U = fine.u;
      const toGrid = () => ctx.setTransform(pc, 0, 0, pc, tx, ty);
      const sh = (0.5 - 0.5 / U) * pc, toFine = () => ctx.setTransform(pc / U, 0, 0, pc / U, tx + sh, ty + sh);
      const path = d3.geoPath(null, ctx), ink = token("--ss-text"), surface = token("--ss-surface");
      const C = colours(); px.cache = C;

      // ---- fill: per device pixel, so the edge follows the contact exactly and the colour is continuous
      if (o.fill && used.length) {
        const off = document.createElement("canvas");
        off.width = W; off.height = H;
        const octx = off.getContext("2d"), img = octx.createImageData(W, H);
        const gxs = Float64Array.from({ length: W }, (_, X) => (view.x0 + (X + 0.5) / ps - g.x0) / g.cell);
        const gys = Float64Array.from({ length: H }, (_, Y) => (g.y0 - view.y0 + (Y + 0.5) / ps) / g.cell);
        for (let Y = 0; Y < H; Y++) {
          const gy = gys[Y], row = Math.floor(gy);
          if (row < 0 || row >= ny) continue;
          const v = (gy - 0.5) * U, j = Math.floor(v), fy = v - j;
          for (let X = 0; X < W; X++) {
            const gx = gxs[X], col = Math.floor(gx);
            if (col < 0 || col >= nx) continue;
            const k = fill.labels[row * nx + col];
            if (!k) continue;
            const seg = fill.segments[k - 1], m = seg.model, u = (gx - 0.5) * U, i = Math.floor(u);
            const z = bilinear(fine.z, fine.nx, fine.ny, i, j, u - i, fy);
            if (Number.isNaN(z) || z > m.maxDepth) continue;
            const P = o.fade ? probAt(m, z) : z <= m.likely ? 1 : 0;
            if (P < 0.03) continue;
            const f = fluidAt(m, Math.min(z, m.likely)) ?? (m.gasOnly ? "gas" : "oil"), col_ = C[f];
            const column = Math.max(0, m.likely - z);
            const c = o.colour === "stepped" ? col_.classes[Math.min(col_.n - 1, Math.floor(column / step))] : col_.lut[Math.min(255, Math.round((column / colMax) * 255))];
            const p = (Y * W + X) * 4;
            img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = Math.round(255 * 0.82 * P);
          }
        }
        octx.putImageData(img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0);
      }

      // ---- accumulation outline: the limit the fill is held to
      if (o.outline && data.outline) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = token("--ss-text-muted"); ctx.lineWidth = 1.1 * dpr; ctx.setLineDash([2 * dpr, 4 * dpr]);
        ctx.beginPath(); data.outline.xy.forEach(([x, y], i) => { const [a, b] = view.project(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.stroke(); ctx.restore();
      }

      // ---- contact lines, clipped to each segment's fill so they never run into another segment
      const labels = [];
      if (o.lines && used.length) {
        const cg = Float32Array.from(fine.z, (v) => (Number.isNaN(v) ? -1e9 : v));
        fill.segments.forEach((seg, k) => {
          if (!seg.model || seg.empty) return;
          const grown = new Float32Array(nx * ny);
          for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
            let hit = 0;
            for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < nx && yy < ny && fill.labels[yy * nx + xx] === k + 1) { hit = 1; break; } }
            grown[y * nx + x] = hit;
          }
          const region = d3.contours().size([nx, ny]).smooth(true).thresholds([0.5])(grown)[0];
          linesFor(setup.segments[k]).forEach((L, li) => {
            ctx.save(); toGrid(); ctx.beginPath(); path(region); ctx.clip(); toFine();
            ctx.strokeStyle = ink; ctx.lineJoin = ctx.lineCap = "round";
            const f = (u) => (u * dpr * U) / pc, std = o.standard && L.main && (L.kind === "OWC" || L.kind === "GWC"); // Geostandard 6.27: black 1.5 pt with a coloured 1 pt dash
            ctx.lineWidth = f(std ? 1.5 : L.main ? 2.2 : 1.1);
            ctx.setLineDash(L.kind === "GOC" ? [f(8), f(3), f(2), f(3)] : L.main ? [] : [f(5), f(4)]);
            ctx.globalAlpha = L.main ? 1 : 0.8;
            const cs = d3.contours().size([fine.nx, fine.ny]).thresholds([L.depth])(cg)[0];
            ctx.beginPath(); path(cs); ctx.stroke();
            if (std) { ctx.strokeStyle = symbolData.colours[L.kind === "OWC" ? "red" : "oil"]; ctx.lineWidth = f(1); ctx.setLineDash([f(4), f(4)]); ctx.beginPath(); path(cs); ctx.stroke(); }
            ctx.restore();
            // main lines are labelled at their east-most point inside the segment's fill, the low and high cases (short text) at the north-most
            let best = null;
            for (const poly of cs.coordinates) for (const ring of poly) for (const [fx, fy] of ring) {
              const gx = (fx - 0.5) / U + 0.5, gy = (fy - 0.5) / U + 0.5, ci = Math.floor(gx), ri = Math.floor(gy);
              if (ci < 0 || ri < 0 || ci >= nx || ri >= ny || fill.labels[ri * nx + ci] !== k + 1) continue;
              if (!best || (L.main ? gx > best.gx : gy < best.gy)) best = { gx, gy };
            }
            if (best && (L.main || /^P\d/.test(L.text))) labels.push({ x: g.x0 + best.gx * g.cell, y: g.y0 - best.gy * g.cell, text: L.main ? L.text : L.text.split(" ")[0], main: L.main });
          });
        });
      }

      // ---- segment barriers: a hatched line (ticks on both sides), clipped to the outline when there is one
      if (o.barrier) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (data.outline) { ctx.beginPath(); data.outline.xy.forEach(([x, y], i) => { const [a, b] = view.project(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.clip(); }
        ctx.strokeStyle = ink; ctx.lineJoin = ctx.lineCap = "round";
        for (const b of data.barriers ?? []) {
          const pts = b.xy.map(([x, y]) => view.project(x, y));
          ctx.lineWidth = 1.8 * dpr; ctx.setLineDash([]); ctx.beginPath(); pts.forEach(([a, c], i) => (i ? ctx.lineTo(a, c) : ctx.moveTo(a, c))); ctx.stroke();
          ctx.lineWidth = 1 * dpr; ctx.beginPath();
          let carry = 0;
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, step = 9 * dpr, tick = 5 * dpr;
            for (let d = step - carry; d < len; d += step) { const x = x0 + ux * d, y = y0 + uy * d; ctx.moveTo(x - uy * tick, y + ux * tick); ctx.lineTo(x + uy * tick, y - ux * tick); }
            carry = (carry + len) % step;
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- wells that prove a fluid: SubScout symbols, with a halo label
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const fontPx = 11 * dpr, font = `${fontPx}px ${token("--ss-font-body") || "sans-serif"}`;
      const halo = (text, x, y, align = "left") => { ctx.font = font; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 3.5 * dpr; ctx.strokeStyle = surface; ctx.strokeText(text, x, y); ctx.fillStyle = ink; ctx.fillText(text, x, y); };
      if (o.wells) {
        for (const e of data.evidence ?? []) {
          const [x, y] = view.project(...e.xy), well = e.fluid === "oil" ? { fluids: [["oil", "proven"]] } : { fluids: "dry" }, spec = wellSpec(well);
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = surface; ctx.beginPath(); ctx.arc(x, y, 11 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
          drawSymbol(ctx, spec, x, y, 34 * dpr, { ink: o.standard ? (fluidInk(well) ?? ink) : ink, mutedInk: token("--ss-text-muted") });
          halo(shortWell(e.well), x + 14 * dpr, y);
        }
      }
      // contact labels last, so nothing covers them; a vertical offset keeps neighbouring lines apart
      const placed = [];
      labels.sort((a, b) => Number(b.main) - Number(a.main)).forEach((L) => {
        const [x, y] = view.project(L.x, L.y);
        if (placed.some((p) => p.text === L.text && Math.hypot(p.x - x, p.y - y) < 60 * dpr)) return; // two segments share a contact: label it once
        let yy = y;
        for (let tries = 0; tries < 4 && placed.some((p) => Math.abs(p.y - yy) < 12 * dpr && Math.abs(p.x - x) < 70 * dpr); tries++) yy += 12 * dpr; // step down off a neighbour
        placed.push({ text: L.text, x, y: yy });
        halo(L.text, x + 6 * dpr, yy);
      });
    },

    legend() {
      const C = px.cache ?? colours(), out = [];
      for (const f of o.fill ? fluids : []) {
        const base = used.find((s) => (f === "gas" ? s.model.goc || s.model.gasOnly : s.model.base && !s.model.gasOnly));
        const what = f === "gas" ? "gas-oil contact" : base?.model.base?.kind === "OWC" ? "oil-water contact" : "contact";
        out.push({ kind: "bar", label: `${FLUID_NAME[f]} column above the ${what} (m)${o.colour === "stepped" ? `, ${step} m classes` : ""}`, domain: [0, colMax], ...(o.colour === "stepped" ? { colours: C[f].classCss } : { stops: C[f].stops }) });
      }
      if (o.fill && o.fade && used.some((s) => s.model.deepest.distribution || s.model.deepest.range)) out.push({ kind: "fade", label: used.some((s) => s.model.deepest.distribution) ? "Opacity: probability that the contact is at least this deep (PUD Table 3.5)" : "Opacity: probability that the contact is at least this deep (triangular on min, likely, max)" });
      if (o.lines) {
        out.push(o.standard ? { kind: "line", label: "Contact, base or likely case (Geostandard: black, with a red dash for oil-water, green for gas-water)", width: 1.6, over: { colour: symbolData.colours.red, dash: "3 3", width: 1 } } : { kind: "line", label: "Contact, base or likely case", width: 2.2 });
        if (setup.segments.some((s) => s.contacts.some((c) => c.distribution || c.range))) out.push({ kind: "line", label: "Contact, low and high cases", width: 1.1, dash: "5 4", alpha: 0.8 });
        if (setup.segments.some((s) => s.contacts.some((c) => c.kind === "GOC"))) out.push({ kind: "line", label: "Gas-oil contact", width: 2, dash: "8 3 2 3" });
      }
      if (o.barrier && (data.barriers ?? []).length) out.push({ kind: "hatch", label: "Segment barrier: fills and contacts do not merge across it" });
      if (o.outline && data.outline) out.push({ kind: "line", label: "Accumulation limit (the PUD model outline)", width: 1.1, dash: "2 4", alpha: 0.7 });
      if (o.standard) out.push({ kind: "note", label: "Geostandard colours (6.12, 6.27), as the standard has them: oil green against gas red is not colour-vision safe." });
      if (o.wells && (data.evidence ?? []).length) {
        out.push({ kind: "symbol", svg: symbolSvg(wellSpec({ fluids: [["oil", "proven"]] }), { size: 26 }), label: "Well with oil" });
        if (data.evidence.some((e) => e.fluid === "water")) out.push({ kind: "symbol", svg: symbolSvg(wellSpec({ fluids: "dry" }), { size: 26 }), label: "Well with water in the reservoir" });
      }
      return out;
    },

    facts() {
      const rows = [], f = fmt, seg = fill.segments, area = (s) => `${d3.format(".1f")(s.area_km2)} km²`;
      rows.push({ label: "Contacts", value: `${kase.label}${kase.status === "superseded" ? ": superseded" : ""}. ${kase.note ?? ""}`.trim() });
      for (const c of kase.contacts) {
        const q = c.distribution ? quantiles(c.distribution) : null, where = c.segment ? ` (${c.segment} segment)` : "";
        const mean = c.quantiles?.mean ?? null;
        rows.push({ label: c.kind, value: `${f(c.depth)} m below mean sea level${where}${c.role ? `, ${c.role}` : ""}${q ? `. P90 ${f(q.P90)}, P50 ${f(q.P50)}, P10 ${f(q.P10)} m${mean ? `, mean ${f(mean)} m` : ""}` : c.range ? `. Range ${f(c.range.min)} to ${f(c.range.max)} m` : ""}. ${c.source ?? ""}` });
      }
      for (const s of seg) {
        const why = s.empty ? "no fill: the well position is below every contact" : s.merged ? "the barrier does not divide it from another segment" : `${area(s)} of top reservoir shallower than the contact${s.open ? ", open to the survey edge" : s.limitedByOutline ? ", held by the model outline" : ", closed within the data"}`;
        rows.push({ label: s.name, value: `${why}. Map area, not a volume.` });
      }
      if ((data.evidence ?? []).length) rows.push({ label: "Wells", value: data.evidence.map((e) => `${shortWell(e.well)}: ${e.fluid} ${e.fluid === "oil" ? `${f(e.top)} to ${f(e.base)}` : `from ${f(e.top)}`} m`).join("; ") });
      for (const p of data.checks ?? []) if (p.case === kase.id) rows.push({ label: "Check", value: p.problem });
      if (o.standard) rows.push({ label: "Colours", value: "Geostandard 6.12 (oil green, gas red) and 6.27 (contact lines black with a coloured dash). Not colour-vision safe: oil against gas is a red-green pair. SubScout colours are the default." });
      if (data.georeference) rows.push({ label: "Digitised", value: `Barrier and outline traced from ${data.georeference.figure.split(", the")[0]}, placed by two wells: approximate to about ${data.georeference.accuracy_m} m.` });
      return rows;
    },

    // the fill under a map position: segment, fluid, column
    probe(x, y) {
      const col = Math.floor((x - g.x0) / g.cell), row = Math.floor((g.y0 - y) / g.cell);
      if (col < 0 || row < 0 || col >= g.nx || row >= g.ny) return null;
      const k = fill.labels[row * g.nx + col], z = g.z[row * g.nx + col];
      if (!k || Number.isNaN(z)) return null;
      const s = fill.segments[k - 1], fl = fluidAt(s.model, Math.min(z, s.model.likely));
      return { layer: "contacts", label: `${s.name}: ${fl ?? "hydrocarbons"}, column ${fmt1(Math.max(0, s.model.likely - z))} m` + (o.fade ? `, probability ${Math.round(probAt(s.model, z) * 100)} %` : ""), value: null };
    },
  };
}
