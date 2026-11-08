// Map furniture drawn on the canvas, so any export carries it: scale bar and north arrow. The frame is always north-up.
import { token } from "../style/ramps.js";

const NICE = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

// The longest round length that fits in a quarter of the map width.
export const niceLength = (widthM) => NICE.filter((n) => n <= widthM * 0.25).pop() ?? NICE[0];

export function drawScaleBar(ctx, view) {
  const { dpr } = view, widthM = view.width / view.scale, len = niceLength(widthM), px = len * view.scale * dpr, u = dpr;
  const ink = token("--ss-text"), paper = token("--ss-surface"), font = `600 ${11 * u}px ${token("--ss-font-body")}`;
  const unitLabel = (m) => (len >= 1000 ? `${m / 1000}` : `${m}`);
  const pad = 8 * u, x = 12 * u, h = 5 * u, boxW = px + 2 * pad + 50 * u, boxH = 40 * u, y = view.height * dpr - 12 * u - boxH;
  ctx.save();
  ctx.fillStyle = paper; ctx.globalAlpha = 0.86;
  ctx.beginPath(); ctx.roundRect(x, y, boxW, boxH, 6 * u); ctx.fill();
  ctx.globalAlpha = 1;
  const bx = x + pad, by = y + 22 * u, n = 4;
  ctx.strokeStyle = ink; ctx.lineWidth = u;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? paper : ink;
    ctx.fillRect(bx + (px * i) / n, by, px / n, h);
  }
  ctx.strokeRect(bx, by, px, h);
  ctx.fillStyle = ink; ctx.font = font; ctx.textBaseline = "alphabetic";
  [[0, "0"], [0.5, unitLabel(len / 2)], [1, `${unitLabel(len)} ${len >= 1000 ? "km" : "m"}`]].forEach(([f, t]) => {
    ctx.textAlign = f === 1 ? "left" : "center";
    ctx.fillText(t, bx + px * f - (f === 1 ? 4 * u : 0), by - 4 * u);
  });
  // north arrow: a half-filled arrowhead over an N, at the right of the box
  const ax = x + boxW - 14 * u, ay = y + 6 * u;
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 6 * u, ay + 18 * u); ctx.lineTo(ax, ay + 14 * u); ctx.closePath(); ctx.fill();
  ctx.fillStyle = paper;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 6 * u, ay + 18 * u); ctx.lineTo(ax, ay + 14 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.fillText("N", ax, ay + 31 * u);
  ctx.restore();
  return { lengthM: len, widthPx: px };
}
