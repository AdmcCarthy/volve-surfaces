// The closure analysis layer: structural highs, their spill points, and the closures at a chosen depth. Meets the layer contract (contract.js).
//
// Data: closures.json from scripts/structure.py (docs/contacts-structure.md): per depth horizon, the highs of the grid with crest, relief,
// and spill {z, xy, kind "saddle" | "edge", to}. A saddle spill is where the closure joins a shallower high; an edge spill is where the
// closure reaches the edge of the data, so the surface does not close it. For an edge spill `spill_if_edge_is_wall` gives the saddle
// that would limit it if the edge were only the limit of mapping.
//
// A closure is not a trap: it says where the surface could hold a contact, not that it does. Nothing here is a seal analysis.
import { token } from "../style/ramps.js";

export async function loadClosures(base) {
  const res = await fetch(`${base}/closures.json`);
  return res.ok ? res.json() : null;
}

const fmt = d3.format(",.0f");

// opts: { horizon (grid id), minRelief (m, highs below it are not drawn), contact (m; draws the closures at that depth, or null) }
export function createClosuresLayer(g, data, opts = {}) {
  const o = { minRelief: 10, contact: null, ...opts };
  const rec = data.horizons[opts.horizon ?? g.id];
  const highs = (rec?.highs ?? []).filter((h) => (h.relief ?? 0) >= o.minRelief || (h.relief == null && h.spill));
  const edgeOnes = highs.filter((h) => h.spill?.kind === "edge").length;
  const { nx, ny, cell } = g;

  // closures at the contact: cells connected, through cells at or above the contact, to the crest of a drawn high. A closure is open when a high
  // inside it spills to the edge of the data at or above that depth (the merge tree knows: the edge is not a limit the surface provides).
  const cellOf = (xy) => { const x = Math.floor((xy[0] - g.x0) / cell), y = Math.floor((g.y0 - xy[1]) / cell); return x < 0 || y < 0 || x >= nx || y >= ny ? -1 : y * nx + x; };
  function region() {
    if (o.contact == null) return null;
    const lab = new Int16Array(nx * ny), comps = [];
    for (const h of highs) {
      const s = cellOf(h.crest);
      if (h.z > o.contact || s < 0 || lab[s]) continue;
      const id = comps.length + 1, stack = [s];
      lab[s] = id;
      let n = 0;
      while (stack.length) {
        const i = stack.pop(), x = i % nx, y = (i - x) / nx;
        n++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const j = yy * nx + xx;
          if (g.z[j] <= o.contact && !lab[j]) { lab[j] = id; stack.push(j); }
        }
      }
      comps.push({ id, highs: [], area: (n * cell * cell) / 1e6, open: false });
    }
    for (const h of rec?.highs ?? []) { // every high counts for openness, drawn or not: a small high on the edge still leaks the whole closure
      const s = cellOf(h.crest), c = s >= 0 && lab[s] ? comps[lab[s] - 1] : null;
      if (!c) continue;
      if (highs.includes(h)) c.highs.push(h.id);
      if (h.spill?.kind === "edge" && h.spill.z <= o.contact) c.open = true;
    }
    return { lab, comps };
  }
  const reach = region();

  const xs = highs.flatMap((h) => [h.crest[0], h.spill?.xy[0] ?? h.crest[0]]), ys = highs.flatMap((h) => [h.crest[1], h.spill?.xy[1] ?? h.crest[1]]);

  return {
    id: "closures",
    kind: "closures",
    crs: data.crs,
    count: highs.length,
    reach,
    bounds: () => (xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1]),

    draw(ctx, view) {
      const dpr = view.dpr, ink = token("--ss-text"), paper = token("--ss-surface"), accent = token("--ss-accent");
      ctx.font = `600 ${10.5 * dpr}px ${token("--ss-font-body")}`; ctx.textBaseline = "middle";
      // closures at the contact: the outline of each connected area, solid if the surface closes it, dashed if it reaches the data edge
      if (reach) {
        const ps = view.scale * dpr, pc = ps * cell, tx = (g.x0 - view.x0) * ps, ty = (view.y0 - g.y0) * ps;
        for (const c of reach.comps) {
          const m = Float32Array.from(reach.lab, (v) => (v === c.id ? 1 : 0));
          const shape = d3.contours().size([nx, ny]).smooth(true).thresholds([0.5])(m)[0];
          ctx.save(); ctx.setTransform(pc, 0, 0, pc, tx, ty);
          ctx.beginPath(); d3.geoPath(null, ctx)(shape);
          ctx.globalAlpha = 0.08; ctx.fillStyle = ink; ctx.fill();
          ctx.globalAlpha = 1; ctx.strokeStyle = paper; ctx.lineWidth = (4.5 * dpr) / pc; ctx.setLineDash([]); ctx.stroke(); ctx.strokeStyle = ink; ctx.lineWidth = (2 * dpr) / pc; ctx.setLineDash(c.open ? [(6 * dpr) / pc, (4 * dpr) / pc] : []); ctx.stroke();
          ctx.restore();
        }
      }
      for (const h of highs) {
        const [cx, cy] = view.project(...h.crest), r = 4.5 * dpr;
        // crest: a filled triangle
        ctx.fillStyle = ink; ctx.strokeStyle = paper; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); ctx.closePath(); ctx.stroke(); ctx.fill();
        if (!h.spill) continue;
        const [sx, sy] = view.project(...h.spill.xy), edge = h.spill.kind === "edge";
        // spill point: a ring with a cross (a saddle) or a ring with a gap (the edge of the data)
        ctx.strokeStyle = paper; ctx.lineWidth = 4 * dpr; ctx.beginPath(); ctx.arc(sx, sy, 5 * dpr, 0, 2 * Math.PI); ctx.stroke();
        ctx.strokeStyle = ink; ctx.lineWidth = 1.6 * dpr; ctx.setLineDash(edge ? [3 * dpr, 2.5 * dpr] : []);
        ctx.beginPath(); ctx.arc(sx, sy, 5 * dpr, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
        if (!edge) { ctx.beginPath(); ctx.moveTo(sx - 3 * dpr, sy - 3 * dpr); ctx.lineTo(sx + 3 * dpr, sy + 3 * dpr); ctx.moveTo(sx - 3 * dpr, sy + 3 * dpr); ctx.lineTo(sx + 3 * dpr, sy - 3 * dpr); ctx.stroke(); }
        const w = h.spill_if_edge_is_wall, text = `${h.id} spill ${fmt(h.spill.z)}${edge ? " (data edge)" : ""}${w ? `, ${fmt(w.z)} if the edge is a limit` : ""}`;
        ctx.textAlign = "left"; ctx.strokeStyle = paper; ctx.lineWidth = 3 * dpr; ctx.lineJoin = "round"; ctx.strokeText(text, sx + 9 * dpr, sy); ctx.fillStyle = ink; ctx.fillText(text, sx + 9 * dpr, sy);
      }
    },

    legend: () => [
      { kind: "note", label: `Closure analysis (${highs.length} highs with at least ${o.minRelief} m of relief, ${edgeOnes} open at the data edge): triangle = crest; ring with a cross = saddle spill; dashed ring = the closure reaches the edge of the data. A closure is where the surface could hold a contact, not a proven trap.` },
      ...(reach ? [{ kind: "note", label: `Closures at ${fmt(o.contact)} m: solid outline = closed by the surface, dashed = open at the data edge.` }] : []),
    ],

    facts: () => {
      const rows = [{ label: "Closures", value: `${highs.length} structural highs of at least ${o.minRelief} m closure relief on this horizon; spill points from the merge tree of the 25 m grid (not the smoothed display surface). Interpreted from the grid, not from fault seal.`, level: "Derived" }];
      const main = highs.filter((h) => h.spill).sort((a, b) => b.relief - a.relief).slice(0, 3);
      if (main.length) rows.push({ label: "Largest highs", value: main.map((h) => `${h.id} crest ${fmt(h.z)} m, relief ${fmt(h.relief)} m, ${h.spill.kind === "edge" ? "open at the data edge at" : "spills at"} ${fmt(h.spill.z)} m${h.spill_if_edge_is_wall ? ` (${fmt(h.spill_if_edge_is_wall.z)} m if the edge is a limit)` : ""}`).join("; ") + "." });
      if (reach) rows.push({ label: "At the contact", value: reach.comps.map((c) => `${c.highs[0]}: ${c.area.toFixed(1)} km² ${c.open ? "open at the data edge" : "closed"}`).join("; ") + "." });
      return rows;
    },

    probe(x, y) {
      for (const h of highs) {
        if (Math.hypot(x - h.crest[0], y - h.crest[1]) < 60) return { layer: "closures", label: `${h.id} crest ${fmt(h.z)} m, relief ${fmt(h.relief ?? 0)} m` };
        if (h.spill && Math.hypot(x - h.spill.xy[0], y - h.spill.xy[1]) < 60) return { layer: "closures", label: `${h.id} spill ${fmt(h.spill.z)} m (${h.spill.kind})` };
      }
      return null;
    },
  };
}
