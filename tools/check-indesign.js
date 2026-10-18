"use strict";
// Checks for the grid maths without InDesign: node tools/check-indesign.js
const { MM, PRESETS, DEFAULTS, sanitize, plan } = require("../grids-id/core.js");

let fails = 0, n = 0;
function ok(cond, msg) { n++; if (!cond) { fails++; console.log("FAIL " + msg); } }
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const A4 = { w: 210 * MM, h: 297 * MM };

// defaults
ok(JSON.stringify(sanitize({})) === JSON.stringify(DEFAULTS), "sanitize({}) gives the defaults");
ok(sanitize({ cols: 999 }).cols === 48 && sanitize({ cols: -3 }).cols === 1, "cols are clamped");
ok(sanitize({ unit: "px" }).unit === "mm", "unknown unit falls back");
ok(sanitize({ target: "spread" }).target === "spread", "target is kept");

// 12 columns, 15 mm margins on a single A4 page
{
  const r = plan({ cols: 12, gutterX: 5, mTop: 15 }, Object.assign({ side: "single" }, A4));
  ok(near(r.margins.top, 15 * MM) && near(r.margins.left, 15 * MM) && near(r.margins.right, 15 * MM), "linked margins");
  ok(r.columns.count === 12 && near(r.columns.gutter, 5 * MM), "native columns");
  ok(near(r.colW * 12 + r.gx * 11, r.inner.w), "columns fill the text area");
  ok(r.guides.length === 0, "native columns need no ruler guides");
}

// inside / outside swap on left pages
{
  const p = { linkMargins: false, mTop: 10, mBottom: 20, mInside: 25, mOutside: 12 };
  const L = plan(p, Object.assign({ side: "left" }, A4)), R = plan(p, Object.assign({ side: "right" }, A4));
  ok(near(L.margins.left, 12 * MM) && near(L.margins.right, 25 * MM), "left page: outside on the left");
  ok(near(R.margins.left, 25 * MM) && near(R.margins.right, 12 * MM), "right page: inside on the left");
  ok(near(L.margins.inside, R.margins.inside), "inside stays the same value");
}

// columns as ruler guides
{
  const r = plan({ cols: 3, gutterX: 5, colsAs: "guides", mTop: 10 }, Object.assign({ side: "single" }, A4));
  const v = r.guides.filter((g) => g.dir === "v").length, h = r.guides.filter((g) => g.dir === "h").length;
  ok(r.columns.count === 1 && r.columns.gutter === 0, "guides mode keeps one InDesign column");
  ok(v === 6 && h === 2, "3 columns = 6 vertical + 2 horizontal guides (got " + v + "/" + h + ")");
}

// gutter 0: no doubled guides
{
  const r = plan({ cols: 3, rows: 3, gutterX: 0, gutterY: 0, colsAs: "guides", mTop: 0 }, Object.assign({ side: "single" }, A4));
  const keys = r.guides.map((g) => g.dir + g.pos.toFixed(3));
  ok(new Set(keys).size === keys.length, "no doubled guides with gutter 0");
  ok(r.guides.length === 8, "rule of thirds as guides = 8 lines (got " + r.guides.length + ")");
}

// baseline snapping
{
  const r = plan(PRESETS["Swiss 6 × 8"], Object.assign({ side: "right" }, A4));
  ok(r.baseline && r.baseline.division === 11, "Swiss: 11 pt baseline");
  ok(near(r.gy, 11), "row gutter = one line");
  ok(near(r.rowH % 11, 0) || near(r.rowH % 11, 11), "rows are whole lines (" + r.rowH + ")");
  ok(near(r.inner.h, r.rowH * 8 + r.gy * 7), "text height = rows + gutters");
  ok(r.margins.bottom >= 0 && near(r.margins.top + r.inner.h + r.margins.bottom, A4.h), "margins + text height = page height");
  const m = plan(PRESETS["Magazine"], Object.assign({ side: "left" }, A4));
  ok(near(m.inner.h % 12, 0) || near(m.inner.h % 12, 12), "Magazine: text height is whole 12 pt lines");
}

// every preset works on several formats
const formats = [A4, { w: 148 * MM, h: 210 * MM }, { w: 1080, h: 1350 }, { w: 841 * MM, h: 1189 * MM }, { w: 100, h: 100 }];
for (const [name, pr] of Object.entries(PRESETS)) {
  for (const f of formats) for (const side of ["left", "right", "single"]) {
    const r = plan(pr, Object.assign({ side }, f));
    const bad = [r.colW, r.inner.w, r.inner.h, r.margins.top, r.margins.bottom].some((x) => !isFinite(x) || x < -1e-6);
    ok(!bad, name + " on " + Math.round(f.w) + "×" + Math.round(f.h) + " " + side + " has valid numbers");
    ok(r.guides.every((g) => g.pos >= -1e-6 && g.pos <= (g.dir === "v" ? f.w : f.h) + 1e-6), name + " guides stay on the page");
  }
}

// the shared grid maths is a copy of grids/core.js
ok(require("fs").readFileSync(require("path").join(__dirname, "..", "grids", "core.js"), "utf8") === require("fs").readFileSync(require("path").join(__dirname, "..", "grids-id", "grids-core.js"), "utf8"), "grids-id/grids-core.js is the same as grids/core.js");

console.log((n - fails) + " / " + n + " ok");
process.exit(fails ? 1 : 0);
