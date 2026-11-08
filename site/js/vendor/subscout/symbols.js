// SubScout symbols: wells, wellbores and installations, after the Sodir Geostandard 3.4 and 3.5 (redrawn, not copied).
// Data is symbols-data.js, generated from tokens/symbols.toml by `subscout symbols`. See styleguide/wellbores.md.
//
// A symbol is a spec { parts, code, muted, layers }. Wells are composed from layers (a base circle, a layer per fluid, technical
// status, function), exactly as the standard composes them. The same spec draws to SVG (a string) or to a Canvas context.
// No colour is stored in a symbol: it draws in the ink you give it (default currentColor), and planned items in the muted tone.
import DATA from "./symbols-data.js";

export const data = DATA;
export const vocabulary = DATA.vocabulary;
const META = DATA.meta;

// ---------------------------------------------------------------- composition
// Mirror of subscout.symbols.layers_for; scripts/symbols_check.py asserts both agree on every example.
//   well: { fluids: "dry" | "coal" | [[fluid, qualifier], ...], technical, fn: { kind, fluid }, zone, exploration, code, planned }
export function layersFor(well = {}) {
  const out = [well.exploration ? `explore.${well.exploration}` : "base"];
  const fl = well.fluids;
  if (fl === "dry") out.push("fluid.dry");
  else if (fl === "coal") out.push("fluid.coal");
  else if (Array.isArray(fl) && fl.length) {
    const have = Object.fromEntries(fl);
    for (const f of DATA.vocabulary.fluids) if (f in have) out.push(`fluid.${f}.${have[f]}`);
  }
  const t = well.technical;
  if (t && t !== "open" && t !== "proposed") out.push(`tech.${t}`);
  const fn = well.fn;
  if (fn) {
    out.push(`fn.${fn.kind}`);
    if (fn.kind === "injection" && fn.fluid) out.push(`fn.injected.${fn.fluid}`);
  }
  if (well.zone) out.push(`zone.${well.zone}`);
  return out;
}

const layerParts = (keys) => keys.flatMap((k) => {
  const l = DATA.layers[k];
  if (!l) throw new Error(`symbols: no layer "${k}"`);
  return l.parts;
});

export function wellSpec(well = {}) {
  const layers = layersFor(well);
  return { layers, parts: layerParts(layers), code: well.code ?? null, muted: !!well.planned };
}
export function classSpec(cls) {
  const k = `class.${cls}`;
  return { layers: [k], parts: layerParts([k]), code: null, muted: false };
}
export function installationSpec(type, { planned = false } = {}) {
  const i = DATA.installations[type];
  if (!i) throw new Error(`symbols: no installation "${type}"`);
  return { layers: [`installation.${type}`], parts: i.parts, code: null, muted: planned, stdColour: i.std_colour ?? null };
}
export const shallowBoreholeSpec = () => ({ layers: ["shallow_borehole"], parts: layerParts(["shallow_borehole"]), code: null, muted: false });
export const trajectoryDash = (kind) => DATA.trajectories[kind].dash; // SVG stroke-dasharray: "" solid, "1 5" approximate, "9 7" planned

// What a symbol means, in words: the standard's own wording when the spec is one of its examples, otherwise the layers joined.
export function describe(well) {
  const key = layersFor(well).join("|");
  const hit = DATA.examples.find((e) => layersFor(e.well).join("|") === key && (e.well.code ?? null) === (well.code ?? null));
  return hit ? hit.label : layersFor(well).map((k) => DATA.layers[k].label).join("; ");
}

// Optional Geostandard hydrocarbon colour for a well (off unless a caller asks): the strongest fluid, oil before gas before condensate.
export function fluidInk(well) {
  if (well.fluids === "dry") return DATA.colours.unknown;
  const fl = Array.isArray(well.fluids) ? Object.fromEntries(well.fluids) : {};
  const f = ["oil", "gas", "condensate"].find((k) => k in fl);
  return f ? DATA.colours[f] : null;
}

// ---------------------------------------------------------------- drawing
const fmt = (n) => +n.toFixed(2);

function svgPart(p, ink) {
  const fill = p.fill ? ink : "none", dash = p.dash ? ` stroke-dasharray="${META.stroke * 1.2} ${META.stroke * 1.2}"` : "";
  switch (p.k) {
    case "circle": return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${fill}"${dash}/>`;
    case "line": return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"${dash}/>`;
    case "rect": return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}"${dash}/>`;
    case "path": return `<path d="${p.d}" fill="${fill}"${dash}/>`;
    case "text": return `<text x="${p.x}" y="${p.y}" font-size="${p.size}" text-anchor="middle" dominant-baseline="central" fill="${ink}" stroke="none" font-family="inherit">${p.text}</text>`;
  }
  return "";
}

// An SVG string. `size` in px. Below META.min_size_px a plain dot; letter codes drop below META.code_min_size_px.
export function symbolSvg(spec, { size = 24, ink = "currentColor", title = "", code = true } = {}) {
  const color = spec.muted ? "var(--ss-text-muted)" : ink;
  if (size < META.min_size_px) return `<svg viewBox="-50 -50 100 100" width="${size}" height="${size}" aria-hidden="true"><circle r="22" fill="${color}"/></svg>`;
  const body = spec.parts.map((p) => svgPart(p, "currentColor")).join("");
  const letter = code && spec.code && size >= META.code_min_size_px
    ? `<text x="30" y="36" font-size="22" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none">${spec.code}</text>` : "";
  return `<svg viewBox="-50 -50 100 100" width="${size}" height="${size}" role="img"${title ? ` aria-label="${title}"` : ' aria-hidden="true"'} style="color:${color}" fill="none" stroke="currentColor" stroke-width="${META.stroke}" stroke-linecap="round" stroke-linejoin="round">${title ? `<title>${title}</title>` : ""}${body}${letter}</svg>`;
}

// Canvas: draw a spec centred on (x, y), `size` px across the whole box. `ink` and `mutedInk` are resolved CSS colours.
// Defaults are the page's text and muted-text tokens, so a symbol follows the theme without a raw colour in this file.
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function drawSymbol(ctx, spec, x, y, size, { ink = token("--ss-text"), mutedInk = token("--ss-text-muted"), code = true } = {}) {
  const color = spec.muted ? mutedInk : ink, s = size / 100;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = META.stroke; ctx.lineCap = ctx.lineJoin = "round";
  if (size < META.min_size_px) { ctx.beginPath(); ctx.arc(0, 0, 22, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); return; }
  for (const p of spec.parts) {
    ctx.setLineDash(p.dash ? [META.stroke * 1.2, META.stroke * 1.2] : []);
    if (p.k === "text") { ctx.font = `${p.size}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.text, p.x, p.y); continue; }
    ctx.beginPath();
    if (p.k === "circle") ctx.arc(p.cx, p.cy, p.r, 0, 2 * Math.PI);
    else if (p.k === "line") { ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); }
    else if (p.k === "rect") ctx.rect(p.x, p.y, p.w, p.h);
    else if (p.k === "path") { const path = new Path2D(p.d); if (p.fill) ctx.fill(path); ctx.stroke(path); continue; }
    if (p.fill) ctx.fill();
    ctx.stroke();
  }
  if (code && spec.code && size >= META.code_min_size_px) { ctx.setLineDash([]); ctx.font = "22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(spec.code, 30, 36); }
  ctx.restore();
}

// Legend rows for a list of well descriptions used on a map: [{ spec, label }], de-duplicated, in first-use order.
export function legend(wells) {
  const seen = new Set();
  return wells.flatMap((w) => {
    const key = layersFor(w).join("|") + (w.code ?? "");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ spec: wellSpec(w), label: describe(w) }];
  });
}
