"use strict";
// Morgenstern Grids for InDesign – grid maths without InDesign (runs in the panel and in Node).
// Everything is in points (pt), relative to the page's top-left corner. plan(params, page) returns what to
// set on one page: InDesign margins and columns, ruler guides, and the baseline grid.

const MM = 72 / 25.4;   // points per millimetre

const DEFAULTS = {
  unit: "mm",                // mm | pt | % (of the page size)
  cols: 12, rows: 0, gutterX: 5, gutterY: 5,
  linkMargins: true, mTop: 15, mBottom: 15, mInside: 15, mOutside: 15,
  colsAs: "native",          // native = InDesign's own margin & column guides | guides = ruler guides
  baseline: 0,               // leading in pt, 0 = off
  baselineSnap: true,        // rows (and the inner height) snap to whole baseline steps
  target: "parent",          // parent | page | spread | all
  kind: "layout",            // layout = margins, columns, rows, baseline | composition = overlay lines
  blocks: false,             // also draw the modules as frames (non-printing layer)
  radius: 0,                 // corner radius of the blocks, pt
  comp: "thirds", flipX: false, flipY: false, compRays: 16,   // composition overlay (see grids-core.js)
  compArea: "page",          // page | margins
};
const LIMITS = { cols: [1, 48], rows: [0, 48], gutterX: [0, 500], gutterY: [0, 500], mTop: [0, 2000], mBottom: [0, 2000], mInside: [0, 2000], mOutside: [0, 2000], baseline: [0, 72], radius: [0, 100], compRays: [4, 72] };
const CHOICES = { unit: ["mm", "pt", "%"], colsAs: ["native", "guides"], target: ["parent", "page", "spread", "all"], kind: ["layout", "composition"],
  comp: ["thirds", "phi", "spiral", "triangles", "dynamic", "armature", "diagonal", "radial", "cross"], compArea: ["page", "margins"] };
function sanitize(p) {
  const o = Object.assign({}, DEFAULTS);
  if (!p || typeof p !== "object") return o;
  for (const k of Object.keys(DEFAULTS)) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (LIMITS[k]) { const n = Number(v); if (isFinite(n)) o[k] = Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], n)); }
    else if (CHOICES[k]) { if (CHOICES[k].indexOf(String(v)) >= 0) o[k] = String(v); }
    else o[k] = !!v;
  }
  if (o.cols < 1) o.cols = 1;
  return o;
}

// Presets: proportions in % so they fit any format; baseline in pt
const PRESETS = {
  "12 Column": { unit: "mm", cols: 12, rows: 0, gutterX: 4, linkMargins: true, mTop: 15, baseline: 0 },
  "6 Column": { unit: "mm", cols: 6, rows: 0, gutterX: 5, linkMargins: true, mTop: 18, baseline: 0 },
  "Magazine": { unit: "mm", cols: 3, rows: 0, gutterX: 5, linkMargins: false, mTop: 15, mBottom: 22, mInside: 18, mOutside: 15, baseline: 12, baselineSnap: true },
  "Swiss 6 × 8": { unit: "%", cols: 6, rows: 8, gutterX: 2, gutterY: 1.4, linkMargins: false, mTop: 6, mBottom: 10, mInside: 7, mOutside: 7, baseline: 11, baselineSnap: true },
  "Modular 4 × 6": { unit: "%", cols: 4, rows: 6, gutterX: 2.5, gutterY: 1.8, linkMargins: true, mTop: 7, baseline: 0 },
  "Golden Canon": { unit: "%", cols: 1, rows: 0, gutterX: 0, gutterY: 0, linkMargins: false, mTop: 11.11, mBottom: 22.22, mInside: 11.11, mOutside: 22.22, baseline: 0 },
  "Book 2 Column": { unit: "%", cols: 2, rows: 0, gutterX: 4, linkMargins: false, mTop: 9, mBottom: 15, mInside: 10, mOutside: 13, baseline: 12, baselineSnap: true },
  "Newspaper 5": { unit: "mm", cols: 5, rows: 0, gutterX: 4, linkMargins: false, mTop: 12, mBottom: 14, mInside: 10, mOutside: 10, baseline: 10, baselineSnap: true },
  "Poster 3 × 3": { unit: "%", cols: 3, rows: 3, gutterX: 2, gutterY: 2, linkMargins: true, mTop: 5, baseline: 0 },
  "Rule of Thirds": { unit: "%", cols: 3, rows: 3, gutterX: 0, gutterY: 0, linkMargins: true, mTop: 0, baseline: 0 },
};

// side: "left" | "right" | "single" (left pages have the inside margin on the right)
function plan(params, page) {
  const p = sanitize(params), W = page.w, H = page.h, side = page.side || "single";
  const ux = p.unit === "%" ? W / 100 : p.unit === "mm" ? MM : 1, uy = p.unit === "%" ? H / 100 : p.unit === "mm" ? MM : 1;
  const top = p.mTop * uy;
  let bottom = (p.linkMargins ? p.mTop : p.mBottom) * uy;
  const inside = (p.linkMargins ? p.mTop : p.mInside) * ux, outside = (p.linkMargins ? p.mTop : p.mOutside) * ux;
  let left = side === "left" ? outside : inside, right = side === "left" ? inside : outside;
  // margins never take more than 90 % of the page (tiny formats with mm values)
  const fitPair = (a, b, size) => { const s = a + b > size * 0.9 ? (size * 0.9) / (a + b) : 1; return [a * s, b * s]; };
  [left, right] = fitPair(left, right, W);
  let top2; [top2, bottom] = fitPair(top, bottom, H);
  const top0 = top2;
  // gutters never take more than half the text area, so columns and rows keep a positive size
  const fitGutter = (g, space, n) => (n > 1 ? Math.min(g, (space * 0.5) / (n - 1)) : g);
  const gx = fitGutter(p.gutterX * ux, W - left - right, p.cols);
  let gy = fitGutter(p.gutterY * uy, H - top0 - bottom, p.rows);
  // baseline: the text area gets a whole number of lines; with rows, the row gutter is one line and every
  // row is a whole number of lines – so text in each module sits on the same baselines
  const base = p.baseline > 0 ? p.baseline : 0;
  let innerH = Math.max(0, H - top0 - bottom), rowH = 0;
  const fitsLines = p.rows > 0 ? (innerH - base * (p.rows - 1)) / p.rows >= base : innerH >= base;
  if (base && p.baselineSnap && fitsLines) {
    if (p.rows > 0) {
      gy = base;
      const per = Math.max(1, Math.floor((innerH - gy * (p.rows - 1)) / base / p.rows));   // lines per row
      rowH = per * base;
      innerH = rowH * p.rows + gy * (p.rows - 1);
    } else innerH = Math.floor(innerH / base) * base;
    bottom = Math.max(0, H - top0 - innerH);
  }
  const inner = { x: left, y: top0, w: Math.max(0, W - left - right), h: innerH };
  const colW = (inner.w - gx * (p.cols - 1)) / p.cols;
  if (!rowH && p.rows > 0) rowH = (inner.h - gy * (p.rows - 1)) / p.rows;
  const guides = [];
  if (p.colsAs === "guides") {
    guides.push({ dir: "v", pos: inner.x }, { dir: "v", pos: inner.x + inner.w });
    for (let i = 0; i < p.cols; i++) { const x0 = inner.x + i * (colW + gx); if (i > 0) guides.push({ dir: "v", pos: x0 }); if (i < p.cols - 1) guides.push({ dir: "v", pos: x0 + colW }); }
    guides.push({ dir: "h", pos: inner.y }, { dir: "h", pos: inner.y + inner.h });
  }
  for (let i = 0; i < p.rows; i++) { const y0 = inner.y + i * (rowH + gy); if (i > 0) guides.push({ dir: "h", pos: y0 }); if (i < p.rows - 1) guides.push({ dir: "h", pos: y0 + rowH }); }
  // no doubles (e.g. gutter 0)
  const seen = new Set(), uniq = guides.filter((g) => { const k = g.dir + g.pos.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  // the modules (one row when there are no rows), for frames on the non-printing layer
  const blocks = [], nr = p.rows > 0 ? p.rows : 1, bh = p.rows > 0 ? rowH : inner.h, by = p.rows > 0 ? gy : 0;
  for (let j = 0; j < nr; j++) for (let i = 0; i < p.cols; i++) blocks.push({ x: inner.x + i * (colW + gx), y: inner.y + j * (bh + by), w: colW, h: bh });
  return {
    blocks,
    margins: { top: top0, bottom, inside: side === "left" ? right : left, outside: side === "left" ? left : right, left, right },
    columns: { count: p.colsAs === "native" ? p.cols : 1, gutter: p.colsAs === "native" ? gx : 0 },
    guides: uniq,
    baseline: base ? { division: base, start: 0, relativeToMargin: true } : null,
    inner, colW, rowH, gx, gy,
  };
}

const toUnit = (pt, unit) => (unit === "mm" ? pt / MM : pt);
module.exports = { MM, DEFAULTS, PRESETS, sanitize, plan, toUnit };
