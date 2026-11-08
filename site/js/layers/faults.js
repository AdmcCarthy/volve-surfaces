// The faults layer: fault polygons and fault sticks as styled lines. Meets the layer contract (contract.js).
//
// Records (docs/modules.md): { id, kind: "polygon" (closed heave polygon) | "trace" (a fault line) | "stick", name, type: "normal" | "reverse" | "strike-slip" | "unknown",
// certainty: "certain" | "uncertain" | "unknown", horizon?, xy: [[x, y], ...], closed? } in EPSG:25831, and for a normal fault whose
// downthrown side is known, downthrown: "left" | "right" of the digitising direction.
//
// Style follows the Geostandard 1.3.3 and 6.26.1: a fault is a black line (the --ss-text token); a normal fault carries short ticks
// on its downthrown side; an uncertain one is dashed. Nothing is invented: a fault of unknown type is a plain line with no ticks.
import { token } from "../style/ramps.js";

export async function loadFaults(base) {
  const res = await fetch(`${base}/faults.json`);
  if (!res.ok) return null; // not every data set has faults
  return res.json();
}

const TICK_PX = 6, TICK_EVERY_PX = 22;

// `show`: { polygons, sticks }. `horizon` picks the fault polygons that belong to the surface on screen (polygons name a horizon;
// records without one, such as synthetic faults, always show).
export function createFaultLayer(data, { polygons = true, sticks = false, horizon = null } = {}) {
  const feats = data.features.filter((f) => (f.kind === "stick" ? sticks : polygons && (!f.horizon || f.horizon === horizon)));
  const xs = feats.flatMap((f) => f.xy.map((p) => p[0])), ys = feats.flatMap((f) => f.xy.map((p) => p[1]));
  const polys = feats.filter((f) => f.kind !== "stick"), stk = feats.filter((f) => f.kind === "stick");

  function line(ctx, view, f) {
    ctx.beginPath();
    f.xy.forEach(([x, y], i) => { const [px, py] = view.project(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    if (f.closed) ctx.closePath();
    ctx.stroke();
  }

  // ticks on the downthrown side of a normal fault, every TICK_EVERY_PX along the line
  function ticks(ctx, view, f) {
    const side = f.downthrown === "left" ? 1 : f.downthrown === "right" ? -1 : 0;
    if (f.type !== "normal" || !side) return;
    const tick = (TICK_PX * view.dpr) / (view.scale * view.dpr), every = TICK_EVERY_PX / view.scale;
    ctx.beginPath();
    for (let i = 1; i < f.xy.length; i++) {
      const [x0, y0] = f.xy[i - 1], [x1, y1] = f.xy[i], len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) continue;
      const nx = (-(y1 - y0) / len) * side, ny = ((x1 - x0) / len) * side; // left normal in map coordinates
      for (let d = every / 2; d < len; d += every) {
        const x = x0 + ((x1 - x0) * d) / len, y = y0 + ((y1 - y0) * d) / len;
        ctx.moveTo(...view.project(x, y)); ctx.lineTo(...view.project(x + nx * tick, y + ny * tick));
      }
    }
    ctx.stroke();
  }

  return {
    id: "faults",
    kind: "faults",
    crs: data.crs,
    count: feats.length,
    bounds: () => (xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1]),
    draw(ctx, view) {
      ctx.strokeStyle = token("--ss-text"); ctx.lineJoin = ctx.lineCap = "round";
      ctx.globalAlpha = 0.5; ctx.lineWidth = 0.9 * view.dpr; ctx.setLineDash([]);
      stk.forEach((f) => line(ctx, view, f));
      ctx.globalAlpha = 0.95; ctx.lineWidth = 1.5 * view.dpr;
      polys.forEach((f) => { ctx.setLineDash(f.certainty === "uncertain" ? [5 * view.dpr, 4 * view.dpr] : []); line(ctx, view, f); ticks(ctx, view, f); });
      ctx.setLineDash([]);
    },
    legend() {
      const out = [];
      if (polys.length) out.push({ kind: "line", label: polys[0].horizon ? `Fault polygons at ${polys[0].name.split(", ")[1]}` : "Faults", width: 1.8 });
      if (stk.length) out.push({ kind: "line", label: "Fault sticks (plan view of the picks)", width: 1, alpha: 0.5 });
      return out;
    },
    facts() {
      const rows = [];
      if (polys.length) rows.push({ label: "Faults", value: `${polys.length} interpreted fault polygons${stk.length ? ` and ${stk.length} fault sticks` : ""}. ${data.note ?? ""}`.trim() });
      else if (stk.length) rows.push({ label: "Faults", value: `${stk.length} interpreted fault sticks. ${data.note ?? ""}`.trim() });
      const m = polys.filter((f) => f.attrs);
      if (m.length) {
        const th = m.map((f) => f.attrs.throw_m).sort((a, b) => a - b), med = th[Math.floor(th.length / 2)], big = m.filter((f) => (f.attrs.ratio ?? 0) > 1).length;
        rows.push({ label: "Fault throw", value: `Measured on ${m.length} faults from the surface either side (regional dip removed): median ${Math.round(med)} m, ${big} with throw over the Hugin thickness. Measurements, not a fault-seal analysis: any fault, however small, may hold or pass fluid; sealing depends on things outside this viewer. Hover a fault for its numbers.`, level: "Derived" });
      }
      return rows;
    },
    // the nearest fault within 30 m of a point
    probe(x, y) {
      let best = null, bd = 30;
      for (const f of feats) {
        for (let i = 1; i < f.xy.length; i++) {
          const [x0, y0] = f.xy[i - 1], [x1, y1] = f.xy[i], dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
          const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
          if (d < bd) { bd = d; best = f; }
        }
      }
      const a = best?.attrs;
      // throw and thickness are measurements; the ratio is a juxtaposition indicator, not a seal analysis (any fault may hold or pass fluid)
      return best ? { layer: "faults", label: a ? `${best.name}: throw about ${Math.round(a.throw_m)} m${a.ratio != null ? `, ${a.ratio.toFixed(1)} of the Hugin thickness` : ""} (measured, not a seal analysis)` : best.name, value: null } : null;
    },
  };
}
