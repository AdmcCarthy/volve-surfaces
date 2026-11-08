// Dominant orientations of the steepest gradients of a surface: the fault trends.
//
// Steep ground on a structure map is mostly fault scarps, which strike perpendicular to the direction of steepest
// descent. We take the steepest cells (top 0.5 % by gradient magnitude, weighted by magnitude squared), build a histogram
// of their gradient axis (opposite-facing scarps share an axis) and look for one trend, or two when a second, clearly
// separate trend exists about a quadrant away (60 to 90 degrees, e.g. NE-SW against SE-NW) with enough weight.
//
// Each trend reports:
//   strike     azimuth of the fault trend, degrees clockwise from north, 0 to 180
//   coherence  0 (no preferred direction) to 1 (all its steep cells share one axis)
//   facing     azimuth its steep faces net-face (towards deeper ground), or null when they face both ways equally
//   light      azimuth to light from so that those faces lie in shadow: across the faults, from the side they face away from
//   share      fraction of the steepness this trend accounts for (shares sum to 1)
import { blur } from "./grid.js";

const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const axDiff = (a, b) => Math.min(Math.abs(a - b) % 180, 180 - (Math.abs(a - b) % 180)); // axial: 0 to 90

// Central difference that bridges nodata: fault gaps hold the steepest ground, so look up to `reach` cells either way
// for the nearest valid neighbour and divide by the distance spanned. Returns the gradient per metre, or null.
function bridged(s, i, stride, count, pos, reach, cell) {
  let lo = -1, hi = -1;
  for (let d = 1; d <= reach && lo < 0; d++) if (pos - d >= 0 && !Number.isNaN(s[i - d * stride])) lo = d;
  for (let d = 1; d <= reach && hi < 0; d++) if (pos + d < count && !Number.isNaN(s[i + d * stride])) hi = d;
  if (lo < 0 && hi < 0) return null;
  const a = lo < 0 ? s[i] : s[i - lo * stride], b = hi < 0 ? s[i] : s[i + hi * stride], span = (lo < 0 ? 0 : lo) + (hi < 0 ? 0 : hi);
  return (b - a) / (span * cell);
}

// Axis, coherence, net facing and light of a set of steep cells (index list into the arrays).
function summarise(idx, phi, wt, fallback) {
  let sx = 0, sy = 0, cx = 0, cy = 0, w = 0;
  for (const k of idx) {
    sx += wt[k] * Math.cos(2 * phi[k]); sy += wt[k] * Math.sin(2 * phi[k]);
    cx += wt[k] * Math.sin(phi[k]); cy += wt[k] * Math.cos(phi[k]); w += wt[k];
  }
  const axis = deg(0.5 * Math.atan2(sy, sx)) % 180, coherence = Math.hypot(sx, sy) / w, a = (axis * Math.PI) / 180;
  const net = (cx * Math.sin(a) + cy * Math.cos(a)) / w; // signed: do the scarps mostly face one way along the axis?
  let facing = null, light;
  if (Math.abs(net) > 0.15) { facing = net > 0 ? axis : (axis + 180) % 360; light = (facing + 180) % 360; }
  else { const c1 = axis, c2 = (axis + 180) % 360; light = angDiff(c1, fallback) <= angDiff(c2, fallback) ? c1 : c2; } // split: nearest north-west
  return { strike: (axis + 90) % 180, axis, coherence, facing, light, weight: w };
}

export function faultTrend(z, nx, ny, cell, { top = 0.005, power = 2, reach = 6, minCoherence = 0.15, minShare = 0.4, fallback = 315 } = {}) {
  const none = { trends: [{ strike: null, coherence: 0, facing: null, light: fallback, share: 1 }], auto: false, strike: null, coherence: 0, light: fallback };
  const s = blur(z, nx, ny, 1), gE = [], gN = [], mag = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (Number.isNaN(s[i])) continue;
      const e = bridged(s, i, 1, nx, x, reach, cell), south = bridged(s, i, nx, ny, y, reach, cell);
      if (e === null || south === null) continue;
      gE.push(e); gN.push(-south); mag.push(Math.hypot(e, -south)); // rows run south
    }
  }
  if (mag.length < 50) return none;
  const sorted = Float32Array.from(mag).sort(), cut = sorted[Math.floor((1 - top) * (sorted.length - 1))];
  const phi = [], wt = [], all = [];
  for (let k = 0; k < mag.length; k++) {
    if (mag[k] < cut) continue;
    phi.push(Math.atan2(gE[k], gN[k])); wt.push(mag[k] ** power); all.push(phi.length - 1); // azimuth of increasing depth
  }

  // histogram of the gradient axis, 5 degree bins, smoothed circularly (axial period 180)
  const NB = 36, hist = new Float64Array(NB);
  all.forEach((k) => { hist[Math.floor(((deg(phi[k]) % 180) / 180) * NB) % NB] += wt[k]; });
  const sm = Float64Array.from(hist, (_, b) => { let v = 0; for (let d = -3; d <= 3; d++) v += hist[(b + d + NB) % NB] * Math.exp(-(d * d) / 8); return v; });
  const p1 = sm.indexOf(Math.max(...sm)), binDist = (a, b) => Math.min(Math.abs(a - b), NB - Math.abs(a - b));
  let p2 = -1;
  for (let b = 0; b < NB; b++) if (binDist(b, p1) >= 12 && (p2 < 0 || sm[b] > sm[p2])) p2 = b; // 60 to 90 degrees from the first
  const second = p2 >= 0 && sm[p2] >= minShare * sm[p1];

  let found = [summarise(all, phi, wt, fallback)];
  if (second) {
    const c1 = ((p1 + 0.5) / NB) * 180, c2 = ((p2 + 0.5) / NB) * 180, g1 = [], g2 = [];
    all.forEach((k) => {
      const a = deg(phi[k]) % 180, d1 = axDiff(a, c1), d2 = axDiff(a, c2);
      if (d1 <= 30 && d1 <= d2) g1.push(k); else if (d2 <= 30) g2.push(k);
    });
    const two = [summarise(g1, phi, wt, fallback), summarise(g2, phi, wt, fallback)].filter((t) => t.coherence >= minCoherence).sort((x, y) => y.weight - x.weight);
    if (two.length === 2 && axDiff(two[0].axis, two[1].axis) >= 60) found = two; // about a quadrant apart, after refinement
  }
  const total = found.reduce((t, f) => t + f.weight, 0);
  const trends = found.filter((t) => t.coherence >= minCoherence).map((t) => ({ strike: t.strike, coherence: t.coherence, facing: t.facing, light: t.light, share: t.weight / total }));
  if (!trends.length) return none;
  return { trends, auto: true, strike: trends[0].strike, coherence: trends[0].coherence, light: trends[0].light };
}
