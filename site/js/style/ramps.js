// Colour ramps read from the SubScout tokens (--ss-data-seq-<hue>-1..7, --ss-data-div-<name>-1..9), so light, dark
// and any future palette change come from tokens.css and never from hex in this repo.

export const RAMPS = {
  fjord: { kind: "seq", name: "fjord", label: "Fjord", note: "Tide preset" },
  cobalt: { kind: "seq", name: "cobalt", label: "Cobalt", note: "Signal preset" },
  shale: { kind: "seq", name: "shale", label: "Shale", note: "Frost preset" },
  div: { kind: "div", name: "default", label: "Cobalt to ochre", note: "default diverging" },
  div_fjord: { kind: "div", name: "fjord_ochre", label: "Fjord to ochre", note: "Frost diverging" },
};

export const token = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

// Stops of a named ramp for the current scheme, low to high. The strongest colour is always the deepest.
export function stopsOf(key) {
  const r = RAMPS[key], n = r.kind === "seq" ? 7 : 9;
  return Array.from({ length: n }, (_, i) => token(`--ss-data-${r.kind}-${r.name}-${i + 1}`));
}

// Seven stops of a hue's own ladder (--ss-<hue>-N), for fills that are not a data ramp: fluids on a map. Step order is light to strong in
// the light scheme and dark to bright in the dark one, like the sequential ramps.
export function hueRamp(hue, steps = [3, 5, 7, 8, 9, 11, 12]) {
  return steps.map((i) => token(`--ss-${hue}-${i}`));
}

// Continuous ramp t in [0, 1] -> colour (piecewise through the stops in Lab, as a sequential ramp should blend).
export const interpolator = (stops) => d3.piecewise(d3.interpolateLab, stops);

// One colour per class: the stops themselves when the counts match, otherwise samples along the ramp.
export function classColours(stops, n) {
  if (n === stops.length) return stops.slice();
  const f = interpolator(stops);
  return n === 1 ? [f(0.5)] : d3.range(n).map((i) => f(i / (n - 1)));
}

// 256-entry lookup table of [r, g, b] for fast per-pixel colouring.
export function lut(stops) {
  const f = interpolator(stops);
  return Array.from({ length: 256 }, (_, i) => { const c = d3.rgb(f(i / 255)); return [c.r, c.g, c.b]; });
}
