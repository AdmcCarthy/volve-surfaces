// PNG export: the map with its scale bar, then the title box, location map, colour bar, method and attribution, on one sheet.
// Drawn on a canvas (not a screenshot of the page), in the tokens of the scheme on screen, so the file reads on its own.
import { token, interpolator } from "../style/ramps.js";

const DISCLAIMER = "Not connected with, sponsored or endorsed by Equinor or the former Volve licence partners. Provided as is, with no warranty; the data may contain errors and omissions. Maps are smoothed for readability and are not for engineering decisions.";

// words wrapped to `max` px; returns the lines
function wrap(ctx, text, max) {
  const lines = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(t).width > max) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// parts: { map (canvas), title, sub, rows [[k, v]], info (surface legend), entries [{label}], facts [{label, value}], attribution, locator (canvas or null), note }
export function sheetCanvas(parts, u = parts.map.width / parts.mapCssWidth) {
  const M = 24 * u, W = parts.map.width + 2 * M, inner = parts.map.width;
  const ink = token("--ss-text"), muted = token("--ss-text-muted"), subtle = token("--ss-text-subtle"), line = token("--ss-border");
  const body = token("--ss-font-body"), mono = token("--ss-font-mono");
  const paint = (ctx, dry) => {
    let y = M;
    const text = (s, x, size, weight, colour, family = body) => {
      ctx.font = `${weight} ${size * u}px ${family}`; ctx.fillStyle = colour; ctx.textBaseline = "top";
      if (!dry) ctx.fillText(s, x, y);
    };
    const para = (s, x, width, size, weight, colour, gap = 3, family = body) => {
      ctx.font = `${weight} ${size * u}px ${family}`;
      for (const l of wrap(ctx, s, width)) { text(l, x, size, weight, colour, family); y += (size + gap) * u; }
    };
    text(parts.title, M, 17, 600, ink); y += 24 * u;
    para(parts.sub, M, inner, 11.5, 400, muted, 3); y += 4 * u;
    text("Generalised for display", M, 10.5, 600, subtle); y += 20 * u;
    if (!dry) ctx.drawImage(parts.map, M, y);
    y += parts.map.height + 14 * u;
    // title box: rows in two columns, the location map at the right
    const locW = parts.locator ? 220 * u : 0, boxTop = y, colW = (inner - locW - (locW ? 24 * u : 0) - 16 * u) / 2, half = Math.ceil(parts.rows.length / 2);
    let yEnd = y;
    [parts.rows.slice(0, half), parts.rows.slice(half)].forEach((col, ci) => {
      y = boxTop + 10 * u;
      col.forEach(([k, v]) => {
        const x = M + 10 * u + ci * (colW + 8 * u);
        text(k, x, 9.5, 600, subtle);
        const yk = y; ctx.font = `500 ${11 * u}px ${body}`;
        const ls = wrap(ctx, v, colW - 112 * u);
        ls.forEach((l, i) => { y = yk + i * 14 * u; text(l, x + 104 * u, 11, 500, ink); });
        y = yk + Math.max(ls.length, 1) * 14 * u + 4 * u;
      });
      yEnd = Math.max(yEnd, y);
    });
    if (parts.locator) {
      const lw = locW, lh = (parts.locator.height / parts.locator.width) * lw;
      if (!dry) ctx.drawImage(parts.locator, M + inner - lw - 8 * u, boxTop + 8 * u, lw, lh);
      yEnd = Math.max(yEnd, boxTop + lh + 16 * u);
    }
    if (!dry) { ctx.strokeStyle = line; ctx.lineWidth = u; ctx.beginPath(); ctx.roundRect(M, boxTop, inner, yEnd - boxTop + 4 * u, 6 * u); ctx.stroke(); }
    y = yEnd + 20 * u;
    // colour bar
    const info = parts.info, [d0, d1] = info.domain, bw = Math.min(inner, 640 * u), f = d3.format(d1 - d0 >= 20 ? ",.0f" : ",.1f");
    if (!dry) {
      if (info.fill === "stepped") {
        const n = info.colours.length;
        info.colours.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(M + (bw * i) / n, y, bw / n + 0.5, 12 * u); });
      } else {
        const interp = interpolator(info.stops), g = ctx.createLinearGradient(M, 0, M + bw, 0);
        for (let i = 0; i <= 24; i++) g.addColorStop(i / 24, interp(i / 24));
        ctx.fillStyle = g; ctx.fillRect(M, y, bw, 12 * u);
      }
    }
    y += 16 * u;
    const ticks = info.fill === "stepped" ? info.edges.filter((_, i) => i % Math.ceil(info.colours.length / 8) === 0).map((e) => [(e - info.edges[0]) / (info.edges.at(-1) - info.edges[0]), e]) : d3.ticks(d0, d1, 6).map((v) => [(v - d0) / (d1 - d0), v]);
    ticks.forEach(([p, v]) => { ctx.textAlign = "center"; text(f(v), M + bw * p, 10, 400, muted); ctx.textAlign = "left"; });
    y += 15 * u;
    text(info.unit === "m" ? "metres, positive down" : info.unit === "ms" ? "milliseconds two-way time" : info.unit, M, 10, 400, muted); y += 18 * u;
    if (parts.entries.length) { para(`Layers: ${parts.entries.map((e) => e.label).join("; ")}.`, M, inner, 10.5, 400, muted, 3); y += 6 * u; }
    for (const r of parts.facts) { para(`${r.label.toUpperCase()}  ${r.value}`, M, inner, 10, 400, ink, 3, mono); y += 3 * u; }
    y += 8 * u;
    para(parts.attribution, M, inner, 10, 400, muted, 3);
    para(DISCLAIMER, M, inner, 10, 400, muted, 3);
    return y + M;
  };
  const probe = document.createElement("canvas").getContext("2d");
  const H = Math.ceil(paint(probe, true));
  const c = document.createElement("canvas");
  c.width = Math.ceil(W); c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = token("--ss-surface"); ctx.fillRect(0, 0, c.width, c.height);
  paint(ctx, false);
  return c;
}

export function downloadPng(canvas, name) {
  canvas.toBlob((b) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}
