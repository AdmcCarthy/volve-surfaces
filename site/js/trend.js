// Dominant orientation of the steepest gradients of a surface: the fault trend.
//
// Steep ground on a structure map is mostly fault scarps, which strike perpendicular to the direction of steepest
// descent. We take the steepest cells (default top 10 % by gradient magnitude), average their gradient direction as an
// axis (doubled-angle mean, so opposite-facing scarps reinforce each other), and report:
//   strike     azimuth of the trend, degrees clockwise from north, 0 to 180
//   coherence  0 (no preferred direction) to 1 (all steep cells share one axis)
//   facing     azimuth the steep faces net-face (towards deeper ground), or null when scarps face both ways equally
//   light      azimuth to light from so that the steep faces lie in shadow: across the faults, from the side they face away from
import { blur } from "./grid.js";

const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Central difference that bridges nodata: fault gaps hold the steepest ground, so look up to `reach` cells either way
// for the nearest valid neighbour and divide by the distance spanned. Returns [gradient per metre, cells spanned] or null.
function bridged(s, i, stride, count, pos, reach, cell) {
  let lo = -1, hi = -1;
  for (let d = 1; d <= reach && lo < 0; d++) if (pos - d >= 0 && !Number.isNaN(s[i - d * stride])) lo = d;
  for (let d = 1; d <= reach && hi < 0; d++) if (pos + d < count && !Number.isNaN(s[i + d * stride])) hi = d;
  if (lo < 0 && hi < 0) return null;
  const a = lo < 0 ? s[i] : s[i - lo * stride], b = hi < 0 ? s[i] : s[i + hi * stride], span = (lo < 0 ? 0 : lo) + (hi < 0 ? 0 : hi);
  return (b - a) / (span * cell);
}

export function faultTrend(z, nx, ny, cell, { top = 0.005, power = 2, reach = 6, minCoherence = 0.15, fallback = 315 } = {}) {
  const s = blur(z, nx, ny, 1), gE = [], gN = [], mag = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (Number.isNaN(s[i])) continue;
      const e = bridged(s, i, 1, nx, x, reach, cell), south = bridged(s, i, nx, ny, y, reach, cell);
      if (e === null || south === null) continue;
      const n = -south; // rows run south
      gE.push(e); gN.push(n); mag.push(Math.hypot(e, n));
    }
  }
  if (mag.length < 50) return { strike: null, coherence: 0, facing: null, light: fallback, auto: false };
  const sorted = Float32Array.from(mag).sort(), cut = sorted[Math.floor((1 - top) * (sorted.length - 1))];
  let sx = 0, sy = 0, cx = 0, cy = 0, w = 0;
  for (let k = 0; k < mag.length; k++) {
    if (mag[k] < cut) continue;
    const phi = Math.atan2(gE[k], gN[k]); // azimuth of increasing depth (the way the face looks)
    const m = mag[k] ** power;
    sx += m * Math.cos(2 * phi); sy += m * Math.sin(2 * phi);
    cx += m * Math.sin(phi); cy += m * Math.cos(phi); w += m;
  }
  const axis = deg(0.5 * Math.atan2(sy, sx)) % 180, coherence = Math.hypot(sx, sy) / w;
  // net facing along the axis: project the mean (signed) gradient direction on it
  const a = (axis * Math.PI) / 180, net = (cx * Math.sin(a) + cy * Math.cos(a)) / w;
  let facing = null, light = null;
  if (Math.abs(net) > 0.15) { facing = net > 0 ? axis : (axis + 180) % 360; light = (facing + 180) % 360; }
  if (light === null) { // faces split both ways: light along the axis, from the side nearest the usual north-west
    const c1 = axis, c2 = (axis + 180) % 360;
    light = angDiff(c1, fallback) <= angDiff(c2, fallback) ? c1 : c2;
  }
  // a trend that is not preferred in any direction is no guide to the light: fall back to the fixed direction
  return { strike: (axis + 90) % 180, coherence, facing, light: coherence >= minCoherence ? light : fallback, auto: coherence >= minCoherence };
}
