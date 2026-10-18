// Checks without Photoshop: geometry, presets and drawing. Run: node tools/check.js
const Core = require("../grids/core.js");
let bad = 0;
const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? "ok   " : "FAIL ") + name + (extra !== undefined ? "  " + extra : "")); };
const A = { x: 0, y: 0, w: 1200, h: 800 };
const pos = (r, d) => r.guides.filter((g) => g.dir === d).map((g) => Math.round(g.pos * 100) / 100).sort((a, b) => a - b);

// layout
{ const r = Core.build("layout", { cols: 2, rows: 0, gutterX: 20, mTop: 40, linkMargins: true, unit: "px" }, A);
  check("2 columns, gutter 20, margin 40: guide positions", JSON.stringify(pos(r, "v")) === JSON.stringify([40, 590, 610, 1160]), pos(r, "v").join()); }
{ const r = Core.build("layout", { cols: 3, rows: 3, gutterX: 0, gutterY: 0, mTop: 0, linkMargins: true, unit: "px" }, A);
  check("rule of thirds: 2 + 2 guides", pos(r, "v").join() === "400,800" && pos(r, "h").join() === "266.67,533.33", pos(r, "v") + " / " + pos(r, "h")); }
{ const r = Core.build("layout", { cols: 1, rows: 0, unit: "%", linkMargins: false, mTop: 10, mRight: 20, mBottom: 30, mLeft: 5 }, A);
  check("margins in % of the size, each side", pos(r, "v").join() === "60,960" && pos(r, "h").join() === "80,560", pos(r, "v") + " / " + pos(r, "h")); }
{ const r = Core.build("layout", { cols: 0, rows: 0, mTop: 50, linkMargins: true, baseline: 20, unit: "px" }, A);
  const base = r.guides.filter((g) => g.dir === "h" && g.pos > 50 && g.pos < 750);
  check("baseline grid every 20 px inside the margins", base.length === 34 && Math.abs(base[1].pos - base[0].pos - 20) < 1e-6, base.length); }
{ const r = Core.build("layout", { cols: 12, gutterX: 20, mTop: 40, linkMargins: true }, A);
  check("no duplicate guides", new Set(r.guides.map((g) => g.dir + g.pos.toFixed(3))).size === r.guides.length); }
// logo
{ const ref = { x: 400, y: 300, w: 300, h: 200 }, r = Core.build("logo", Core.PRESETS.logo["Full Construction"], A, ref);
  const inner = r.shapes.find((s) => s.t === "circle" && s.r === 100);
  check("logo: inner circle fits the box height, centred", inner && inner.cx === 550 && inner.cy === 400);
  const gold = r.shapes.filter((s) => s.t === "circle" && Math.abs(s.cy + s.r - 500) < 1e-6).map((s) => s.r * 2);
  check("logo: golden circles step down by φ and sit on the base line", gold.length >= 5 && gold.every((d, i) => !i || Math.abs(gold[i - 1] / d - Core.PHI) < 1e-6 || Math.abs(d - 200) < 1e-6)); }
// pattern
{ const r = Core.build("pattern", { pattern: "square", size: 100 }, A);
  check("square 100: 13 vertical + 9 horizontal lines", r.shapes.length === 22, r.shapes.length); }
{ const r = Core.build("pattern", { pattern: "dot", size: 100 }, A); check("dots 100: 13 × 9", r.shapes.length === 117, r.shapes.length); }
{ const r = Core.build("pattern", { pattern: "iso", size: 40 }, A);
  const ok = r.shapes.every((s) => s.x1 >= -1e-6 && s.x2 <= 1200 + 1e-6 && Math.min(s.y1, s.y2) >= -1e-6 && Math.max(s.y1, s.y2) <= 800 + 1e-6);
  check("isometric lines stay inside the area", ok && r.shapes.length > 40, r.shapes.length); }
{ const B = { x: 300, y: 200, w: 200, h: 100 }, r = Core.build("pattern", { pattern: "hex", size: 30 }, B);
  check("hexagons clipped to a small area", r.shapes.length > 10 && r.shapes.every((s) => Math.min(s.x1, s.x2) >= 300 - 1e-6 && Math.max(s.x1, s.x2) <= 500 + 1e-6)); }
// perspective
for (const n of Object.keys(Core.PRESETS.perspective)) {
  const p = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS.perspective[n])), r = Core.build("perspective", p, A);
  const rays = r.shapes.filter((s) => !s.thin && !s.hl).length;
  check("perspective " + n + ": rays for every point", rays >= p.rays * r.vps.length * 0.7, rays + " rays, " + r.vps.length + " points");
}
// drawing
{ const p = Core.sanitize({ color: "#ff0000", width: 1, opacity: 100, fillOpacity: 0 }), r = Core.build("layout", { cols: 2, gutterX: 0, mTop: 0, linkMargins: true }, { x: 0, y: 0, w: 100, h: 50 });
  const px = Core.raster(r, p, 100, 50, 0, 0, 1);
  check("a 1 px line is crisp (one full pixel column next to the guide)", px[(10 * 100 + 50) * 4 + 3] === 255 && px[(10 * 100 + 49) * 4 + 3] === 0 && px[(10 * 100 + 51) * 4 + 3] === 0, [49, 50, 51].map((x) => px[(10 * 100 + x) * 4 + 3]).join()); }
{ const p = Core.sanitize({ width: 2 }), r = { shapes: [{ t: "circle", cx: 50, cy: 50, r: 30 }], fills: [] }, px = Core.raster(r, p, 100, 100, 0, 0, 1);
  let soft = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0 && px[i] < 255) soft++;
  check("circles are anti-aliased", soft > 100, soft); }
{ const p = Core.sanitize({}), t0 = Date.now(); Core.raster(Core.build("pattern", { pattern: "square", size: 10 }, { x: 0, y: 0, w: 4000, h: 3000 }), p, 4000, 3000, 0, 0, 1);
  const ms = Date.now() - t0; check("12 MP fine square grid draws in under 3 s", ms < 3000, ms + " ms"); }
// layer look: lines only / fills only
{ const r = Core.build("layout", { cols: 4, gutterX: 40, mTop: 40, linkMargins: true }, { x: 0, y: 0, w: 400, h: 200 });
  const a = (draw) => { const px = Core.raster(r, Core.sanitize({ draw, fillOpacity: 50 }), 400, 200, 0, 0, 1); return [px[(100 * 400 + 20) * 4 + 3], px[(100 * 400 + 80) * 4 + 3]]; };   // margin pixel, column pixel
  const L = a("lines"), F = a("fills"), B = a("both");
  check("layer look: lines only has no column fill, fills only has no lines", L[1] === 0 && F[1] > 100 && B[1] > 100 && a("fills")[0] === 0, JSON.stringify({ L, F, B })); }
// modules, baseline, compositions
{ const r = Core.build("modules", Object.assign({}, Core.DEFAULTS, Core.PRESETS.modules["6 × 4 Blocks"]), A);
  const inA = r.blocks.every((b) => b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= 1200 + 1e-6 && b.y + b.h <= 800 + 1e-6);
  check("modules 6 × 4: 24 rounded blocks inside the area", r.blocks.length === 24 && inA && r.blocks.every((b) => b.r > 0), r.blocks.length); }
{ const r = Core.build("modules", Object.assign({}, Core.DEFAULTS, { cols: 3, rows: 3, gutterX: 0, gutterY: 0, mTop: 0, linkMargins: true, unit: "px" }), A);
  check("modules 3 × 3 without margins: 2 + 2 guides, none on the edge", pos(r, "v").join() === "400,800" && pos(r, "h").join() === "266.67,533.33", pos(r, "v") + " / " + pos(r, "h")); }
{ const r = Core.build("baseline", Object.assign({}, Core.DEFAULTS, { spacing: 20, offset: 0, baseDir: "h", mTop: 0, linkMargins: true, unit: "px" }), A);
  const p = pos(r, "h"); check("baseline every 20 px", p.length >= 38 && p.every((v, i) => !i || Math.abs(v - p[i - 1] - 20) < 1e-6), p.length); }
{ const r = Core.build("baseline", Object.assign({}, Core.DEFAULTS, { spacing: 20, baseDir: "v", mTop: 0, linkMargins: true, unit: "px" }), A);
  check("vertical baseline: only vertical guides", pos(r, "h").length === 0 && pos(r, "v").length >= 58, pos(r, "v").length); }
for (const n of Object.keys(Core.PRESETS.composition)) {
  const r = Core.build("composition", Object.assign({}, Core.DEFAULTS, Core.PRESETS.composition[n]), A);
  const inA = r.shapes.every((s) => s.t !== "seg" || [s.x1, s.x2].every((x) => x >= -1e-3 && x <= 1200 + 1e-3) && [s.y1, s.y2].every((y) => y >= -1e-3 && y <= 800 + 1e-3));
  check("composition " + n + ": lines inside the area", r.shapes.length > 0 && inA, r.shapes.length);
}
{ const p = Object.assign({}, Core.DEFAULTS, Core.PRESETS.composition["Golden Spiral"]);
  const a = Core.build("composition", p, A), b = Core.build("composition", Object.assign({}, p, { flipX: true }), A);
  const mx = (r) => r.shapes.filter((s) => s.t === "seg").reduce((m, s) => m + s.x1 + s.x2, 0);
  check("mirroring the spiral flips it left to right", Math.abs(mx(a) + mx(b) - 2400 * a.shapes.filter((s) => s.t === "seg").length) < 1, ""); }
// settings
{ const s = Core.sanitize({ cols: 999, color: "red", pattern: "stars", width: "2" }); check("settings are clamped and checked", s.cols === 48 && s.color === Core.DEFAULTS.color && s.pattern === "square" && s.width === 2); }
console.log(bad ? bad + " FAILED" : "all ok");
process.exit(bad ? 1 : 0);
