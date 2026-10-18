"use strict";
// MS Grids for Illustrator – CEP panel.
// Column, module, baseline and composition grids plus logo, pattern and perspective grids, drawn as vector paths:
// guides are Illustrator guides, grids are groups of paths that keep their settings. The maths comes from
// core.js (shared with Photoshop); jsx/host.jsx only reads the document and draws what this file sends.
// Coordinates here: points, relative to the artboard's top-left corner, y down.

// core.js and ms-ui.js are shared with the Photoshop panel (CommonJS modules); each gets its own scope here
function loadModule(name) {
  let src = null;
  try {
    const fs = (window.cep_node && window.cep_node.require ? window.cep_node.require : window.require)("fs");
    let dir = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, "");
    if (/^\/[A-Za-z]:/.test(dir)) dir = dir.slice(1);
    src = fs.readFileSync(dir + "/" + name, "utf8");
  } catch (e) { src = null; }
  if (src === null) { const x = new XMLHttpRequest(); x.open("GET", name, false); x.send(); src = x.responseText; }
  const module = { exports: {} };
  new Function("module", "exports", src)(module, module.exports);
  return module.exports;
}
const Core = loadModule("core.js"), UI = loadModule("ms-ui.js");

const $ = (id) => document.getElementById(id);
// grids from earlier versions ("layout") open as Columns
const uiMode = (m) => (m === "layout" ? "columns" : Core.MODES.some((x) => x.id === m) ? m : "columns");
const isGuideMode = (m) => Core.GUIDE_MODES.includes(m);
const modeName = (m) => (Core.MODES.find((x) => x.id === m) || { name: "Columns" }).name;
const STORE = "msgridsai.v1", PRESET_KEY = "msgridsai.presets.v1";
const GRID_PREFIX = "MS Grid · ";
const NOTE = "msgrids:";
const GUIDE_COLOR = "#00e5ff";
const MAX_ITEMS = 6000;

// ---------------------------------------------------------------- talking to Illustrator
const cep = window.__adobe_cep__;
function host(fn, ...args) {
  return new Promise((resolve, reject) => {
    if (!cep) { reject(new Error("Not running in Illustrator.")); return; }
    cep.evalScript(fn + "(" + args.map((a) => JSON.stringify(a)).join(",") + ")", (r) => {
      if (r === "EvalScript error.") { reject(new Error("Illustrator could not run " + fn + ".")); return; }
      let o;
      try { o = JSON.parse(r); } catch (e) { reject(new Error(fn + ": " + r)); return; }
      if (o && o.error) reject(new Error(o.error)); else resolve(o);
    });
  });
}
const nodeRequire = (window.cep_node && window.cep_node.require) || (typeof window.require === "function" ? window.require : null);

// ---------------------------------------------------------------- state
let S = loadState();               // { mode, params, replaceGuides, autoFit }
let busy = false, testing = false, editing = null;   // editing: id of the selected grid whose settings are loaded
let D = { doc: false };            // what Illustrator reported last (msg_info)
let pv = null;                     // preview { img, docW, docH, ref, refName }
function loadState() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) || "{}");
    return { mode: uiMode(o.mode), params: Core.sanitize(Object.assign({ unit: "mm", gutterX: 5, gutterY: 5, mTop: 15, mRight: 15, mBottom: 15, mLeft: 15, width: 0.5 }, o.params || {})), replaceGuides: o.replaceGuides !== false, autoFit: o.autoFit !== false };
  } catch (e) { return { mode: "columns", params: Core.sanitize({}), replaceGuides: true, autoFit: true }; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function setStatus(msg, err) { const el = $("status"); el.textContent = msg || ""; el.className = err ? "status err" : "status"; }
function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------- controls per mode
const P = () => S.params;
const unitName = (u) => (u === "px" ? "pt" : u);
// slider ranges per unit: points, millimetres, % of the size
const byUnit = (pt, mm, pct) => (P().unit === "%" ? pct : P().unit === "mm" ? mm : pt);
const stepUnit = () => byUnit(1, 0.5, 0.1);
function gridControls() {
  const p = P(), m = S.mode;
  const unitSeg = { seg: "unit", label: "Units", options: [{ id: "mm", name: "mm" }, { id: "px", name: "pt" }, { id: "%", name: "% of size" }] };
  const margins = [
    { sw: "linkMargins", label: "Same margin on all sides" },
    { key: "mTop", label: p.linkMargins ? "Margins" : "Top", min: 0, max: byUnit(600, 200, 40), step: stepUnit(), unit: unitName(p.unit) },
    { key: "mRight", label: "Right", min: 0, max: byUnit(600, 200, 40), step: stepUnit(), unit: unitName(p.unit), show: () => !p.linkMargins, sub: true },
    { key: "mBottom", label: "Bottom", min: 0, max: byUnit(600, 200, 40), step: stepUnit(), unit: unitName(p.unit), show: () => !p.linkMargins, sub: true },
    { key: "mLeft", label: "Left", min: 0, max: byUnit(600, 200, 40), step: stepUnit(), unit: unitName(p.unit), show: () => !p.linkMargins, sub: true },
  ];
  if (m === "columns") return [
    { key: "cols", count: true, label: "Columns", min: 1, max: 48, step: 1 },
    unitSeg,
    { key: "gutterX", label: "Gutter", min: 0, max: byUnit(200, 60, 20), step: stepUnit(), unit: unitName(p.unit), show: () => p.cols > 1 },
  ].concat(margins);
  if (m === "modules") return [
    { key: "cols", count: true, label: "Columns", min: 1, max: 48, step: 1 },
    { key: "rows", count: true, label: "Rows", min: 1, max: 48, step: 1 },
    unitSeg,
    { key: "gutterX", label: "Column gutter", min: 0, max: byUnit(200, 60, 20), step: stepUnit(), unit: unitName(p.unit), show: () => p.cols > 1 },
    { key: "gutterY", label: "Row gutter", min: 0, max: byUnit(200, 60, 20), step: stepUnit(), unit: unitName(p.unit), show: () => p.rows > 1 },
    { key: "radius", label: "Corner radius", min: 0, max: 60, step: 0.5, unit: "pt", tip: "Rounded corners of the blocks" },
  ].concat(margins);
  if (m === "baseline") return [
    { seg: "baseDir", label: "Lines", options: [{ id: "h", name: "Horizontal" }, { id: "v", name: "Vertical" }] },
    { key: "spacing", label: "Spacing", min: 2, max: 72, step: 0.5, unit: "pt" },
    { key: "baselineOffset", label: "Offset", min: 0, max: 72, step: 0.5, unit: "pt", tip: "Where the first line sits, from the margin" },
    unitSeg,
  ].concat(margins);
  if (m === "composition") return [
    { seg: "comp", label: "Overlay", wrap: true, options: Core.COMPOSITIONS },
    { sw: "flipX", label: "Mirror horizontally", show: () => ["spiral", "triangles", "dynamic"].includes(p.comp) },
    { sw: "flipY", label: "Mirror vertically", show: () => ["spiral", "triangles", "dynamic"].includes(p.comp) },
    { key: "compRays", count: true, label: "Rays", min: 4, max: 72, step: 1, show: () => p.comp === "radial" },
  ];
  if (m === "logo") return [
    { note: "Select the logo first – the grid is built around its bounds." },
    { sw: "logoBox", label: "Bounding box" }, { sw: "logoCenter", label: "Centre lines" }, { sw: "logoDiag", label: "Diagonals" },
    { sw: "logoCircles", label: "Circles (inner, outer, ends)" }, { sw: "logoGolden", label: "Golden ratio circles" }, { sw: "logoSpiral", label: "Golden spiral" },
    { sw: "logoExtend", label: "Extend the box edges across the artboard" },
    { key: "logoSquares", count: true, label: "Square grid", min: 0, max: 24, step: 1, tip: "Squares across the height of the box, 0 = off" },
  ];
  if (m === "pattern") return [
    { seg: "pattern", label: "Pattern", wrap: true, options: [{ id: "square", name: "Square" }, { id: "dot", name: "Dots" }, { id: "diamond", name: "Diamond" }, { id: "triangle", name: "Triangle" }, { id: "iso", name: "Isometric" }, { id: "hex", name: "Hexagon" }] },
    { key: "size", label: "Cell size", min: 4, max: 400, step: 1, unit: "pt" },
    { key: "dotSize", label: "Dot radius", min: 0.5, max: 30, step: 0.5, unit: "pt", show: () => p.pattern === "dot" },
    { key: "offsetX", label: "Offset X", min: -200, max: 200, step: 1, unit: "pt" },
    { key: "offsetY", label: "Offset Y", min: -200, max: 200, step: 1, unit: "pt" },
  ];
  return [
    { seg: "points", label: "Type", options: [{ id: "1", name: "1-point" }, { id: "2", name: "2-point" }, { id: "3", name: "3-point" }] },
    { note: "Drag the vanishing points in the preview." },
    { key: "horizon", label: "Horizon", min: -50, max: 150, step: 1, unit: "%" },
    { key: "vp1", label: p.points === "1" ? "Vanishing point" : "Left point", min: -300, max: 400, step: 1, unit: "%" },
    { key: "vp2", label: "Right point", min: -300, max: 400, step: 1, unit: "%", show: () => p.points !== "1" },
    { key: "vp3", label: "Third point (height)", min: -400, max: 500, step: 1, unit: "%", show: () => p.points === "3" },
    { key: "rays", count: true, label: "Lines per point", min: 2, max: 120, step: 1 },
    { key: "verticals", count: true, label: "Verticals", min: 0, max: 60, step: 1, show: () => p.points !== "3" },
    { key: "horizontals", count: true, label: "Horizontals", min: 0, max: 60, step: 1, show: () => p.points === "1" },
  ];
}
let swId = 0;
// counts (columns, rows, lines …): − value +, typing works too, Shift+click steps by 5
function stepper(box, c) {
  const row = document.createElement("div");
  row.className = "step" + (c.sub ? " sub" : "");
  if (c.tip) row.title = c.tip;
  row.innerHTML = `<span class="step-label">${UI.esc(c.label)}</span><div class="step-ctl"><div class="step-btn" data-d="-1">−</div><input class="step-num" type="text"><div class="step-btn" data-d="1">+</div></div>`;
  box.appendChild(row);
  const num = row.querySelector(".step-num");
  const set = (v) => { v = Math.max(c.min, Math.min(c.max, Math.round(v))); num.value = String(v); if (P()[c.key] === v) return; P()[c.key] = v; changed(c.key === "cols" || c.key === "rows"); };
  num.value = String(P()[c.key]);
  row.querySelectorAll(".step-btn").forEach((b) => b.addEventListener("click", (e) => set(P()[c.key] + Number(b.getAttribute("data-d")) * (e.shiftKey ? 5 : 1))));
  num.addEventListener("change", () => { const v = parseFloat(num.value); set(isFinite(v) ? v : P()[c.key]); });
}
function renderGridControls() {
  const box = $("gridControls");
  box.innerHTML = "";
  for (const c of gridControls()) {
    if (c.show && !c.show()) continue;
    if (c.note) { const d = document.createElement("div"); d.className = "hint first"; d.textContent = c.note; box.appendChild(d); continue; }
    if (c.seg) {
      const row = document.createElement("div"); row.className = "field";
      row.innerHTML = `<span class="field-label">${UI.esc(c.label)}</span><div class="seg grow${c.wrap ? " wrap" : ""}"></div>`;
      box.appendChild(row);
      const el = row.querySelector(".seg");
      UI.seg(el, c.options, (v) => { P()[c.seg] = v; changed(true); });
      UI.syncSeg(el, P()[c.seg]);
      continue;
    }
    if (c.sw) {
      const id = "sw" + (++swId);
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="switch line" data-for="${id}"><span class="knob"></span><span class="sw-label">${UI.esc(c.label)}</span></div><input type="checkbox" id="${id}" class="hidden">`;
      box.appendChild(wrap);
      $(id).checked = !!P()[c.sw];
      wrap.querySelector(".switch").addEventListener("click", () => { $(id).checked = !$(id).checked; P()[c.sw] = $(id).checked; UI.syncSwitches(); changed(true); });
      continue;
    }
    if (c.count) { stepper(box, c); continue; }
    const s = UI.slider(box, { label: c.label, min: c.min, max: c.max, step: c.step, unit: c.unit || "", tip: c.tip, def: Core.DEFAULTS[c.key] },
      { get: () => P()[c.key], set: (v) => { P()[c.key] = v; changed(false); }, done: () => changed(true) });
    if (c.sub) s.row.className += " sub";
  }
  UI.syncSwitches();
}
function renderStyle() {
  const layout = isGuideMode(S.mode), fillable = S.mode === "columns" || S.mode === "modules";
  $("outputRow").className = layout ? "field" : "field hidden";
  $("areaRow").className = S.mode === "logo" ? "field hidden" : "field";
  UI.syncSeg($("outputSeg"), P().output);
  UI.syncSeg($("areaSeg"), P().area);
  $("swatch-color").style.backgroundColor = P().color;
  $("hexl-color").textContent = P().color;
  const box = $("styleSliders");
  box.innerHTML = "";
  const layerOut = !layout || P().output !== "guides";
  $("drawRow").className = fillable && layerOut ? "field" : "field hidden";
  UI.syncSeg($("drawSeg"), P().draw);
  if (layerOut) {
    UI.slider(box, { label: "Line width", min: 0.25, max: 20, step: 0.25, unit: "pt", def: 1 }, { get: () => P().width, set: (v) => { P().width = v; changed(false); }, done: () => changed(true) });
    UI.slider(box, { label: "Opacity", min: 1, max: 100, step: 1, unit: "%", def: 100 }, { get: () => P().opacity, set: (v) => { P().opacity = v; changed(false); }, done: () => changed(true) });
    if (fillable && P().draw !== "lines") UI.slider(box, { label: S.mode === "modules" ? "Block fill" : "Column fill", min: 0, max: 100, step: 1, unit: "%", def: 12, tip: "Tints the columns (rows) with filled rectangles" }, { get: () => P().fillOpacity, set: (v) => { P().fillOpacity = v; changed(false); }, done: () => changed(true) });
  }
  $("colorRow").className = layerOut ? "field" : "field hidden";
  $("replaceGuidesRow").className = layout && P().output !== "layer" ? "switch line" : "switch line hidden";
  UI.setSwitch("replaceGuides", S.replaceGuides);
  UI.setSwitch("autoFit", S.autoFit);
}
function renderPresets() {
  const names = Object.keys(Core.PRESETS[S.mode]);
  $("presetTiles").innerHTML = names.map((n) => `<div class="tile" data-n="${UI.esc(n)}" title="${UI.esc(n)}"><div class="ph"></div><div class="lbl">${UI.esc(n)}</div></div>`).join("");
  $("presetTiles").querySelectorAll(".tile").forEach((el) => el.addEventListener("click", () => {
    Object.assign(S.params, Core.PRESETS[S.mode][el.getAttribute("data-n")]);
    S.params = Core.sanitize(S.params); renderAll(); changed(true);
    setStatus(`Preset "${el.getAttribute("data-n")}" loaded – click ${editing ? "Update grid" : "Create grid"}.`);
  }));
  presetPictures(S.mode);
  $("presetMeta").textContent = names.length + " for " + modeName(S.mode);
  const own = loadOwn();
  UI.presetList($("presetList"), Object.keys(own).filter((n) => own[n].mode === S.mode),
    (n) => { S.params = Core.sanitize(Object.assign({}, S.params, own[n].params)); renderAll(); changed(true); },
    (n) => { const o = loadOwn(); delete o[n]; saveOwn(o); renderPresets(); });
}
// small pictures of the presets (on light paper, in the current colour)
const picCache = {};
function rgbaToCanvas(rgba, w, h, bg) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"), img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = bg ? Math.round(bg[k] * (1 - a) + rgba[i * 4 + k] * a) : rgba[i * 4 + k];
    img.data[i * 4 + 3] = bg ? 255 : rgba[i * 4 + 3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function presetPictures(mode) {
  const W = 132, H = 84;
  for (const n of Object.keys(Core.PRESETS[mode])) {
    const key = mode + "/" + n + "/" + P().color;
    if (!picCache[key]) {
      const p = Core.sanitize(Object.assign({}, Core.DEFAULTS, { color: P().color, width: 1, output: "layer", fillOpacity: 14 }, Core.PRESETS[mode][n]));
      const k = mode === "baseline" ? 0.4 : 0.11, area = { x: 0, y: 0, w: W / k, h: H / k };   // baselines: closer, so fine spacings stay visible
      const res = Core.build(mode, p, area, { x: area.w * 0.3, y: area.h * 0.3, w: area.w * 0.4, h: area.h * 0.4 });
      picCache[key] = rgbaToCanvas(Core.raster(res, Object.assign({}, p, { width: 1 / k }), W, H, 0, 0, k), W, H, [242, 240, 235]).toDataURL("image/png");
    }
    const tile = document.querySelector(`#presetTiles .tile[data-n="${n.replace(/"/g, '\\"')}"]`);
    if (tile && tile.firstChild && tile.firstChild.tagName !== "IMG") { const img = document.createElement("img"); img.src = picCache[key]; tile.replaceChild(img, tile.firstChild); }
  }
}
function loadOwn() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveOwn(o) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
const MODE_INFO = {
  columns: "Columns, gutters and margins – as guides, a vector grid or both.",
  modules: "A grid of blocks: columns × rows with gutters and margins – guides, blocks or both.",
  baseline: "Lines at an even spacing, horizontal or vertical – as guides, paths or both.",
  composition: "Composition overlays – rule of thirds, golden ratio, spirals, diagonals – as paths.",
  logo: "Construction lines around the selected logo, as vector paths.",
  pattern: "A pattern grid over the artboard or the selection, as vector paths.",
  perspective: "Vanishing point grid as vector paths – drag the points in the preview.",
};
function renderMode() {
  UI.syncSeg($("modeSeg"), S.mode);
  $("modeInfo").textContent = MODE_INFO[S.mode];
  $("gridTitle").textContent = modeName(S.mode) + " grid";
  $("apply").textContent = editing ? "Update grid" : "Create grid";
  $("apply").className = editing ? "btn primary update" : "btn primary";
  $("remove").className = editing ? "btn small ghost" : "btn small ghost hidden";
  $("clearGuides").className = isGuideMode(S.mode) ? "btn small ghost" : "btn small ghost hidden";
}
function renderAll() { stickyView = null; renderMode(); renderGridControls(); renderStyle(); renderPresets(); }
const savePreview = debounce(() => { save(); drawPreview(); }, 40);
function changed(rebuild) { if (rebuild) { renderGridControls(); renderStyle(); } savePreview(); }

// ---------------------------------------------------------------- geometry → Illustrator
// artboard rect r = [left, top, right, bottom] in document coordinates (y up)
const abSize = (r) => ({ x: 0, y: 0, w: r[2] - r[0], h: r[1] - r[3] });
// a document-coordinate box [l, t, r, b] relative to the artboard
const relBox = (b, r) => (b ? { x: b[0] - r[0], y: r[1] - b[1], w: b[2] - b[0], h: b[1] - b[3] } : null);
function regionFor(p, mode, r, refDoc) {
  const canvas = abSize(r), ref = relBox(refDoc, r);
  if (mode !== "logo" && p.area === "layer" && ref) return { area: ref, ref };
  return { area: canvas, ref };
}
// circular arc (clockwise from +x, y down) as Bézier points [ax, ay, lx, ly, rx, ry] in document coordinates
function arcPoints(s, X, Y) {
  const n = Math.max(1, Math.ceil((s.a1 - s.a0) / (Math.PI / 2) - 1e-9)), th = (s.a1 - s.a0) / n, k = 4 / 3 * Math.tan(th / 4);
  const P0 = (a) => [s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)], T = (a) => [-s.r * Math.sin(a), s.r * Math.cos(a)];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = s.a0 + th * i, p = P0(a), t = T(a);
    const left = i === 0 ? p : [p[0] - k * t[0], p[1] - k * t[1]], right = i === n ? p : [p[0] + k * t[0], p[1] + k * t[1]];
    pts.push([X(p[0]), Y(p[1]), X(left[0]), Y(left[1]), X(right[0]), Y(right[1])]);
  }
  return pts;
}
// the shapes of one grid as items for host.jsx
function toItems(res, p, r) {
  const X = (x) => r[0] + x, Y = (y) => r[1] - y, items = [];
  const lines = p.draw !== "fills" || !(res.fills && res.fills.length), fills = p.draw !== "lines" && p.fillOpacity > 0;
  if (fills) for (const f of res.fills || []) items.push(f.r > 0 ? ["rr", X(f.x), Y(f.y), f.w, f.h, f.r, 1] : ["r", X(f.x), Y(f.y), f.w, f.h]);
  // module blocks: one rounded rectangle each (instead of 4 lines + 4 arcs)
  if (lines && res.blocks) { for (const b of res.blocks) items.push(["rr", X(b.x), Y(b.y), b.w, b.h, b.r, 0]); return items; }
  // segments that continue one another (e.g. the stretched golden spiral) become one path
  let chain = null;
  const flush = () => { if (chain) { items.push(chain.pts.length > 2 ? ["pl", chain.op, chain.wf].concat(chain.pts) : ["l", chain.pts[0][0], chain.pts[0][1], chain.pts[1][0], chain.pts[1][1], chain.op, chain.wf]); chain = null; } };
  if (lines) for (const s of res.shapes) {
    if (s.t === "seg") {
      const op = s.thin ? 55 : 100, wf = s.hl ? 1.6 : 1, a = [X(s.x1), Y(s.y1)], b = [X(s.x2), Y(s.y2)];
      const last = chain && chain.pts[chain.pts.length - 1];
      if (chain && chain.op === op && chain.wf === wf && Math.abs(last[0] - a[0]) < 1e-6 && Math.abs(last[1] - a[1]) < 1e-6) { chain.pts.push(b); continue; }
      flush(); chain = { op, wf, pts: [a, b] }; continue;
    }
    flush();
    if (s.t === "circle") items.push(["e", X(s.cx - s.r), Y(s.cy - s.r), s.r * 2, s.r * 2, 0]);
    else if (s.t === "dot") items.push(["e", X(s.cx - s.r), Y(s.cy - s.r), s.r * 2, s.r * 2, 1]);
    else if (s.t === "arc") items.push(["b", 0, 100].concat(arcPoints(s, X, Y)));
  }
  flush();
  return items;
}
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// everything one Create / Update sends to Illustrator
function payloadFor(mode, p, ab, r, refDoc, replaceId, keepId) {
  const { area, ref } = regionFor(p, mode, r, refDoc);
  const res = Core.build(mode, p, area, ref);
  const out = { ab };
  const guides = isGuideMode(mode) && p.output !== "layer", grid = !isGuideMode(mode) || p.output !== "guides";
  if (guides) {
    // guides across the whole artboard, like Photoshop's guides across the canvas
    const A = abSize(r);
    out.guides = { replace: S.replaceGuides, lines: res.guides.map((g) => (g.dir === "v" ? [r[0] + g.pos, r[1], r[0] + g.pos, r[3]] : [r[0], r[1] - g.pos, r[0] + A.w, r[1] - g.pos])) };
  }
  if (grid) {
    const items = toItems(res, p, r);
    if (items.length > MAX_ITEMS) throw new Error(`That grid would have ${items.length} paths – use a bigger cell size or fewer lines (at most ${MAX_ITEMS}).`);
    const id = keepId || newId();
    out.grid = { name: GRID_PREFIX + modeName(mode), id, replaceId: replaceId || null, color: hexRgb(p.color), width: p.width, opacity: p.opacity, fillOpacity: p.fillOpacity, items,
      note: NOTE + JSON.stringify({ id, mode, params: p, ab, r, ref: refDoc || null }) };
  }
  return { payload: out, res };
}
function parseNote(note) {
  if (!note || note.indexOf(NOTE) !== 0) return null;
  try {
    const o = JSON.parse(note.slice(NOTE.length));
    return { id: o.id, mode: o.mode === "layout" || Core.MODES.some((m) => m.id === o.mode) ? o.mode : "columns", params: Core.sanitize(o.params), ab: o.ab | 0, r: o.r, ref: o.ref || null };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- preview
async function loadPreview() {
  if (!D.doc) { pv = null; showPreviewMsg("Open a document…"); $("docName").textContent = "–"; return; }
  $("docName").textContent = D.name + (D.abName ? " · " + D.abName : "");
  const A = abSize(D.r);
  let img = null;
  try {
    const r = await host("msg_preview", 620, 356);
    if (r && r.path) img = await loadImage(r.path);
  } catch (e) { /* the preview then shows an empty artboard */ }
  pv = { img, docW: A.w, docH: A.h, ref: relBox(D.ref, D.r), refName: D.refName };
  drawPreview();
}
function loadImage(path) {
  return new Promise((resolve) => {
    let src = null;
    try { if (nodeRequire) src = "data:image/png;base64," + nodeRequire("fs").readFileSync(path).toString("base64"); } catch (e) { src = null; }
    if (!src) src = "file://" + (path.charAt(0) === "/" ? "" : "/") + path.replace(/\\/g, "/") + "?t=" + Date.now();
    const im = new Image();
    im.onload = () => resolve(im); im.onerror = () => resolve(null);
    im.src = src;
  });
}
function showPreviewMsg(t) { $("preview").className = "hidden"; $("previewMsg").className = "preview-msg"; $("previewMsg").textContent = t; }
let lastBuild = null;
// What the preview shows, in points: the artboard, or for perspective grids the artboard plus every vanishing
// point. Frozen while a point is dragged so the view doesn't jump.
let view = null, frozenView = null, stickyView = null;
function viewFor(res) {
  const d = { x: 0, y: 0, w: pv.docW, h: pv.docH };
  if (S.mode !== "perspective" || !res.vps) return d;
  let x0 = 0, y0 = 0, x1 = pv.docW, y1 = pv.docH;
  for (const vp of res.vps) { x0 = Math.min(x0, vp.x); y0 = Math.min(y0, vp.y); x1 = Math.max(x1, vp.x); y1 = Math.max(y1, vp.y); }
  const m = 0.1 * Math.max(pv.docW, pv.docH);
  if (x0 < 0) x0 -= m; if (y0 < 0) y0 -= m; if (x1 > pv.docW) x1 += m; if (y1 > pv.docH) y1 += m;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
let raf = 0;
function drawPreview() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawOnce(); }); }
function drawOnce() {
  if (!pv) return;
  const p = P();
  if (S.mode === "logo" && !pv.ref) $("dragHint").textContent = "Select the logo";
  else $("dragHint").textContent = S.mode === "perspective" ? "Drag the points" : S.mode === "logo" ? "Around: " + (pv.refName || "selection") : "";
  const area = S.mode !== "logo" && p.area === "layer" && pv.ref ? pv.ref : { x: 0, y: 0, w: pv.docW, h: pv.docH };
  const res = Core.build(S.mode, p, area, pv.ref || { x: pv.docW * 0.35, y: pv.docH * 0.35, w: pv.docW * 0.3, h: pv.docH * 0.3 });
  let V = frozenView;
  if (!V) {
    const inside = (W) => res.vps && res.vps.every((vp) => vp.x >= W.x && vp.x <= W.x + W.w && vp.y >= W.y && vp.y <= W.y + W.h);
    V = S.mode === "perspective" && stickyView && inside(stickyView) ? stickyView : viewFor(res);
    stickyView = S.mode === "perspective" ? V : null;
  }
  const k = Math.min(620 / V.w, 356 / V.h), W = Math.max(1, Math.round(V.w * k)), H = Math.max(1, Math.round(V.h * k));
  view = { V, k, W, H };
  lastBuild = { res, k };
  const cv = $("preview");
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#1a1f2e"; ctx.fillRect(0, 0, W, H);
  const ax = -V.x * k, ay = -V.y * k, aw = pv.docW * k, ah = pv.docH * k;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(ax, ay, aw, ah);
  if (pv.img) ctx.drawImage(pv.img, ax, ay, aw, ah);
  const showGuides = isGuideMode(S.mode) && p.output !== "layer", showGrid = !isGuideMode(S.mode) || p.output !== "guides";
  const over = (rgba) => ctx.drawImage(rgbaToCanvas(rgba, W, H, null), 0, 0);
  if (showGrid) over(Core.raster(res, Object.assign({}, p, { width: Math.max(p.width * k, 1) / k }), W, H, V.x, V.y, k));
  if (showGuides) over(Core.raster({ shapes: res.guides.map((g) => (g.dir === "v" ? { t: "seg", x1: g.pos, y1: 0, x2: g.pos, y2: pv.docH } : { t: "seg", x1: 0, y1: g.pos, x2: pv.docW, y2: g.pos })), fills: [] }, { color: GUIDE_COLOR, width: 1 / k, opacity: 100, fillOpacity: 0 }, W, H, V.x, V.y, k));
  if (V.x < 0 || V.y < 0 || V.w > pv.docW || V.h > pv.docH) { ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1; ctx.strokeRect(Math.round(ax) + 0.5, Math.round(ay) + 0.5, Math.round(aw) - 1, Math.round(ah) - 1); }
  cv.className = S.mode === "perspective" ? "drag" : ""; $("previewMsg").className = "hidden";
  if (!drag) placeHandles();
}
function placeHandles() {
  const box = $("handles");
  const vps = S.mode === "perspective" && lastBuild && lastBuild.res.vps && view ? lastBuild.res.vps : [];
  const cv = $("preview"), r = cv.getBoundingClientRect(), b = $("previewBox").getBoundingClientRect();
  if (!vps.length || !(r.width > 20 && r.height > 20)) { box.innerHTML = ""; return; }
  while (box.children.length > vps.length) box.removeChild(box.lastChild);
  while (box.children.length < vps.length) { const d = document.createElement("div"); d.className = "vp"; box.appendChild(d); }
  const V = view.V;
  vps.forEach((vp, i) => {
    const el = box.children[i];
    el.style.left = (r.left - b.left + (vp.x - V.x) / V.w * r.width) + "px";
    el.style.top = (r.top - b.top + (vp.y - V.y) / V.h * r.height) + "px";
    el.className = i === dragVp ? "vp active" : "vp";
  });
}
let dragVp = -1, drag = null;
function setVp(i, pt) {
  const p = P();
  const px = Math.round(pt.x / pv.docW * 1000) / 10, py = Math.round(pt.y / pv.docH * 1000) / 10;
  if (i === 0) { p.vp1 = px; p.horizon = py; }
  else if (i === 1) { p.vp2 = px; p.horizon = py; }
  else { p.vp3 = py; }
  S.params = Core.sanitize(p);
}

// ---------------------------------------------------------------- apply
async function apply() {
  if (busy) return;
  if (!D.doc) { setStatus("Open a document first.", true); return; }
  busy = true;
  const p = Core.sanitize(P()), mode = S.mode;
  try {
    if (mode === "logo" && !D.ref) {
      // updating a logo grid without a selection keeps its box
      const old = editing && parseNote(D.grid);
      if (!old || !old.ref) throw new Error("Select the logo first – the grid is built around it.");
    }
    if (p.area === "layer" && mode !== "logo" && !D.ref) throw new Error("Select something for the area, or set Area to Artboard.");
    const old = editing ? parseNote(D.grid) : null;
    // every artboard at once: one grid (and guides) per artboard, each fitted to its own size
    if (p.area === "all" && !old) {
      setStatus("Drawing on " + D.abs.length + " artboards…");
      let guides = 0, grids = 0;
      for (let i = 0; i < D.abs.length; i++) {
        const { payload: pl } = payloadFor(mode, p, i, D.abs[i], null, null);
        if (pl.grid) pl.grid.select = false;
        const r = await host("msg_apply", pl);
        guides += r.guides || 0; if (pl.grid) grids++;
      }
      setStatus(`Done: ${D.abs.length} artboards` + (guides ? `, ${guides} guides` : "") + (grids ? `, ${grids} grids` : "") + ".");
      busy = false; await poll(true);
      return;
    }
    const refDoc = D.ref || (old && old.ref) || null;
    const { payload } = payloadFor(mode, p, D.ab, D.r, refDoc, old ? old.id : null);
    setStatus("Drawing…");
    const r = await host("msg_apply", payload);
    const parts = [];
    if (payload.guides) parts.push(r.guides + " guides");
    if (payload.grid) { parts.push(old ? "grid updated" : `grid "${payload.grid.name}" (${r.items} paths)`); editing = payload.grid.id; lastGrid = payload.grid.note; }
    renderMode();
    setStatus("Done: " + parts.join(" + ") + ".");
  } catch (e) { setStatus(String(e && e.message || e), true); }
  finally { busy = false; }
  await poll(true);
}
async function removeGrid() {
  if (!editing) { setStatus("Select a grid (\"" + GRID_PREFIX + "…\") to remove it.", true); return; }
  await host("msg_removeGrid", editing);
  editing = null; renderMode(); setStatus("Grid removed."); await poll(true);
}
async function clearGuides() {
  const r = await host("msg_clearGuides");
  setStatus(r.n ? `Removed ${r.n} guides from this artboard.` : "There were no MS Grids guides on this artboard.");
  await poll(true);
}

// ---------------------------------------------------------------- following Illustrator
// Illustrator gives CEP panels no reliable selection or artboard events, so the panel asks once a second.
let lastDocKey = "", lastGrid = null, lastRef = "", lastAbs = "";
async function poll(force) {
  if (busy && force !== true) return;
  let info;
  try { info = await host("msg_info"); } catch (e) { info = { doc: false }; }
  D = info;
  const docKey = info.doc ? [info.name, info.ab, info.r.join(",")].join("|") : "";
  const absKey = info.doc ? info.name + "|" + JSON.stringify(info.abs) : "";
  const refKey = info.doc ? JSON.stringify(info.ref) + "|" + info.refName : "";
  // selecting a grid loads its settings
  if (info.grid !== lastGrid && !testing) {
    lastGrid = info.grid;
    const g = parseNote(info.grid);
    if (g) { editing = g.id; S.mode = uiMode(g.mode); S.params = g.params; save(); renderAll(); setStatus("Grid loaded – change the settings and click Update grid."); }
    else if (editing) { editing = null; }
    renderMode();
  }
  // an artboard changed size: fit its grids (before reloading the preview)
  if (absKey !== lastAbs) {
    const sameDoc = lastAbs && lastAbs.split("|")[0] === absKey.split("|")[0];
    lastAbs = absKey;
    if (sameDoc && S.autoFit && !testing) await fitToArtboards();
  }
  if (force === true || docKey !== lastDocKey) { lastDocKey = docKey; lastRef = refKey; await loadPreview(); }
  else if (refKey !== lastRef) { lastRef = refKey; if (pv) { pv.ref = relBox(info.ref, info.r); pv.refName = info.refName; drawPreview(); } }
}
// grids whose artboard changed size are drawn again for the new size (logo grids keep their box)
async function fitToArtboards() {
  if (!D.doc) return 0;
  let n = 0;
  busy = true;
  try {
    const notes = await host("msg_grids");
    for (const note of notes) {
      const g = parseNote(note);
      if (!g || g.mode === "logo") continue;
      const r = D.abs[g.ab];
      if (!r || !g.r || r.every((v, i) => Math.abs(v - g.r[i]) < 0.01)) continue;
      const keep = S.replaceGuides;
      S.replaceGuides = true;
      const pl = payloadFor(g.mode, g.params, g.ab, r, g.ref, g.id, g.id).payload;
      pl.grid.select = false;   // fitting doesn't change the selection
      try { await host("msg_apply", pl); n++; }
      finally { S.replaceGuides = keep; }
    }
  } finally { busy = false; }
  if (n) setStatus(`Artboard changed – ${n} grid${n > 1 ? "s" : ""} fitted to the new size.`);
  return n;
}

// ---------------------------------------------------------------- self-test
async function selfTest() {
  if (busy) return;
  const results = [], saved = JSON.parse(JSON.stringify(S));
  testing = true;
  const check = async (name, fn) => {
    try { const r = await fn(); results.push({ name, ok: !!(r && r.ok), r }); }
    catch (e) { results.push({ name, ok: false, r: String(e && e.stack || e) }); }
    setStatus(`Self-test: ${results.length} – ${name}`);
  };
  const use = (mode, preset, extra) => { S.mode = mode; S.params = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS[mode][preset], extra || {})); editing = null; };
  const state = () => host("msg_testState");
  const near = (a, b) => Math.abs(a - b) < 0.05;
  try {
    const t = await host("msg_testNew"), r = t.r, A = abSize(r);
    await poll(true);
    S.replaceGuides = true;
    await check("Columns: guides at the exact positions", async () => {
      use("columns", "12 Column", { output: "guides", unit: "px" }); await apply();
      const exp = Core.build("columns", S.params, A).guides, got = (await state()).guides;
      const pos = (g) => (Math.abs(g[0] - g[2]) < 0.01 ? { dir: "v", pos: g[0] - r[0] } : { dir: "h", pos: r[1] - g[1] });
      const ok = got.length === exp.length && exp.every((e) => got.map(pos).some((g) => g.dir === e.dir && near(g.pos, e.pos)));
      return { ok, exp: exp.length, got: got.length };
    });
    await check("Modules: Replace guides swaps the guides (rule of thirds = 4)", async () => {
      use("modules", "Rule of Thirds", { output: "guides" }); await apply();
      const n = (await state()).guides.length; return { ok: n === 4, n };
    });
    await check("Columns in mm: margins of 15 mm", async () => {
      use("columns", "12 Column", { output: "guides", unit: "mm", mTop: 15, linkMargins: true }); await apply();
      const g = (await state()).guides, xs = g.filter((x) => Math.abs(x[0] - x[2]) < 0.01).map((x) => x[0] - r[0]).sort((a, b) => a - b);
      return { ok: xs.length > 0 && near(xs[0], 15 * 72 / 25.4), first: xs[0] };
    });
    await check("Baseline: one guide per line", async () => {
      use("baseline", "Baseline 24", { output: "guides" }); await apply();
      const n = (await state()).guides.length, exp = Core.build("baseline", S.params, A).guides.length;
      return { ok: n === exp && exp > 10, n, exp };
    });
    await check("Modules: one rounded rectangle per block (+ fills)", async () => {
      use("modules", "6 × 4 Blocks", { output: "layer", draw: "both", fillOpacity: 12 }); await apply();
      const g = (await state()).grids.find((x) => x.sel);
      return { ok: !!g && g.n === 48, n: g && g.n };
    });
    await check("Columns: vector grid with settings stored", async () => {
      use("columns", "6 Column", { output: "layer", unit: "px" }); await apply();
      const s = await state(), g = s.grids.map((x) => Object.assign(x, { n2: parseNote(x.note) })).find((x) => x.n2 && x.n2.mode === "columns" && x.sel);
      return { ok: !!g && g.n2.params.cols === 6 && g.n > 6 && g.sel, n: g && g.n };
    });
    await check("Update replaces the selected grid (no second grid)", async () => {
      await poll(true);
      const before = (await state()).grids.length; S.params.cols = 4; await apply();
      const s = await state(), g = s.grids.map((x) => parseNote(x.note)).filter(Boolean);
      return { ok: s.grids.length === before && g.some((x) => x.params.cols === 4), before, after: s.grids.length };
    });
    await check("Logo: construction grid around the selection", async () => {
      await host("msg_testSelect", "logo"); await poll(true);
      use("logo", "Full Construction"); await apply();
      const g = (await state()).grids.map((x) => parseNote(x.note)).filter((x) => x && x.mode === "logo")[0];
      const ref = g && relBox(g.ref, r);
      return { ok: !!ref && near(ref.x, 450) && near(ref.y, 300) && near(ref.w, 300) && near(ref.h, 200), ref };
    });
    await check("Composition: golden spiral is one path per curve, not hundreds", async () => {
      await host("msg_testSelect", "none"); await poll(true);
      use("composition", "Golden Spiral"); await apply();
      const g = (await state()).grids.find((x) => x.sel); return { ok: !!g && g.n > 5 && g.n < 40, n: g && g.n };
    });
    for (const c of Core.COMPOSITIONS) {
      await check("Composition: " + c.name, async () => {
        use("composition", c.name); await apply();
        const g = (await state()).grids.find((x) => x.sel); return { ok: !!g && g.n >= 2, n: g && g.n };
      });
    }
    await check("All artboards: one grid per artboard", async () => {
      const before = (await state()).grids.length;
      use("modules", "Modular 4 × 4", { output: "layer", area: "all" }); await apply();
      const after = (await state()).grids.length;
      return { ok: after === before + D.abs.length, before, after, artboards: D.abs.length };
    });
    for (const pat of ["square", "dot", "iso", "hex"]) {
      await check("Pattern: " + pat, async () => {
        await host("msg_testSelect", "none"); await poll(true);
        use("pattern", "Square 40", { pattern: pat, area: "canvas" }); await apply();
        const g = (await state()).grids.find((x) => x.sel); return { ok: !!g && g.n > 20, n: g && g.n };
      });
    }
    await check("Pattern on the selection's area only", async () => {
      await host("msg_testSelect", "logo"); await poll(true);
      use("pattern", "Square 40", { area: "layer" }); await apply();
      const g = (await state()).grids.find((x) => x.sel), b = g && relBox(g.b, r);
      return { ok: !!b && b.x >= 448 && b.y >= 298 && b.x + b.w <= 752 && b.y + b.h <= 502, b };
    });
    for (const pre of Object.keys(Core.PRESETS.perspective)) {
      await check("Perspective: " + pre, async () => {
        await host("msg_testSelect", "none"); await poll(true);
        use("perspective", pre); await apply();
        const g = (await state()).grids.find((x) => x.sel); return { ok: !!g && g.n > 10, n: g && g.n };
      });
    }
    await check("Artboard size change: grids are fitted to the new artboard", async () => {
      await host("msg_testSelect", "none"); await poll(true);
      use("pattern", "Square 40", { area: "canvas" }); await apply();
      const r2 = (await host("msg_testResize")).r;
      testing = false; S.autoFit = true; await poll(); testing = true;
      const s = await state(), fitted = s.grids.map((x) => ({ n: parseNote(x.note), b: x.b })).filter((x) => x.n && x.n.mode === "pattern" && x.n.params.area === "canvas" && x.n.r.every((v, i) => near(v, r2[i])));
      const b = fitted[0] && relBox(fitted[0].b, r2);
      return { ok: !!b && b.x < 2 && b.y < 2 && b.w > A.w + 290, b };
    });
    await check("Remove deletes the selected grid", async () => {
      await poll(true);
      const before = (await state()).grids.length; await removeGrid(); const after = (await state()).grids.length;
      return { ok: after === before - 1, before, after };
    });
    await check("Clear grid guides", async () => { await clearGuides(); return { ok: (await state()).guides.length === 0 }; });
  } catch (e) { results.push({ name: "Self-test setup", ok: false, r: String(e && e.stack || e) }); }
  S = saved; editing = null; save(); renderAll();
  await poll(true); lastGrid = D.grid;   // the selected test grid is not loaded into the panel
  testing = false;
  const bad = results.filter((x) => !x.ok);
  try { console.log("MS Grids self-test", JSON.stringify(results)); } catch (e) { /* ignore */ }
  setStatus(`Self-test: ${results.length - bad.length} / ${results.length} ok` + (bad.length ? " – failed: " + bad.map((b) => b.name + " " + JSON.stringify(b.r).slice(0, 140)).join("; ") : ". The test document stays open, close it without saving."), bad.length > 0);
}

// ---------------------------------------------------------------- wiring
function init() {
  UI.seg($("modeSeg"), Core.MODES.map((m) => ({ id: m.id, name: m.id === "composition" ? "Comp" : m.id === "perspective" ? "Persp." : m.name })), (v) => { S.mode = v; editing = null; save(); renderAll(); drawPreview(); });
  UI.seg($("outputSeg"), [{ id: "guides", name: "Guides" }, { id: "layer", name: "Paths" }, { id: "both", name: "Both" }], (v) => { P().output = v; changed(true); });
  UI.seg($("areaSeg"), [{ id: "canvas", name: "Artboard" }, { id: "all", name: "All artboards" }, { id: "layer", name: "Selection" }], (v) => { P().area = v; changed(true); });
  $("swatch-color").addEventListener("click", () => UI.openColorPop({ pop: $("colorPop"), key: "color", anchor: $("swatch-color"), get: () => P().color, set: (c) => { P().color = c; renderStyle(); changed(false); presetPictures(S.mode); },
    palette: ["#00b4ff", "#2f5bff", "#7b9cff", "#ff3f6e", "#ff3fa4", "#d24dff", "#00e5ff", "#2fe0c8", "#39ff7a", "#ffe14d", "#ff8a3d", "#ffffff", "#9aa3b0", "#3a4058", "#000000"] }));
  UI.bindSwitch("replaceGuides", (on) => { S.replaceGuides = on; save(); });
  UI.bindSwitch("autoFit", (on) => { S.autoFit = on; save(); });
  UI.seg($("drawSeg"), [{ id: "both", name: "Lines + fills" }, { id: "lines", name: "Lines" }, { id: "fills", name: "Fills" }], (v) => { P().draw = v; changed(true); });
  $("apply").addEventListener("click", apply);
  $("remove").addEventListener("click", () => removeGrid().catch((e) => setStatus(String(e.message || e), true)));
  $("clearGuides").addEventListener("click", () => clearGuides().catch((e) => setStatus(String(e.message || e), true)));
  $("refreshPreview").addEventListener("click", () => poll(true));
  $("resetMode").addEventListener("click", () => { const keep = { color: P().color }; S.params = Core.sanitize(Object.assign({}, Core.DEFAULTS, keep)); save(); renderAll(); drawPreview(); });
  $("presetSave").addEventListener("click", () => {
    const n = String($("presetName").value).trim();
    if (!n) { setStatus("Type a name for the preset first.", true); return; }
    const o = loadOwn(); o[n] = { mode: S.mode, params: Object.assign({}, S.params) }; saveOwn(o); $("presetName").value = ""; renderPresets(); setStatus(`Saved "${n}".`);
  });
  $("selfTest").addEventListener("click", selfTest);
  // drag vanishing points: the nearest point follows the mouse by the distance it moved
  const cv = $("preview"), box = $("previewBox");
  box.addEventListener("mousedown", (e) => {
    if (S.mode !== "perspective" || !pv || !lastBuild || !lastBuild.res.vps || !view) return;
    const r = cv.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (!(r.width > 20 && r.height > 20)) return;
    const V = view.V, scale = V.w / r.width;
    const pt = { x: V.x + (e.clientX - r.left) * scale, y: V.y + (e.clientY - r.top) * scale };
    let best = -1, bd = 1e9;
    lastBuild.res.vps.forEach((vp, i) => { const d = Math.hypot(vp.x - pt.x, vp.y - pt.y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    const vp = lastBuild.res.vps[best], el = $("handles").children[best];
    drag = { i: best, mx: e.clientX, my: e.clientY, x0: vp.x, y0: vp.y, scale, V, el, hx: el ? parseFloat(el.style.left) : 0, hy: el ? parseFloat(el.style.top) : 0, bw: b.width, bh: b.height };
    frozenView = V; dragVp = best;
    if (el) el.className = "vp active";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.mx, dy = e.clientY - drag.my, V = drag.V, m = 0.1 * Math.max(V.w, V.h);
    const x = Math.max(V.x - m, Math.min(V.x + V.w + m, drag.x0 + dx * drag.scale));
    const y = Math.max(V.y - m, Math.min(V.y + V.h + m, drag.y0 + dy * drag.scale));
    if (drag.el) { drag.el.style.left = (drag.hx + (x - drag.x0) / drag.scale) + "px"; drag.el.style.top = (drag.hy + (y - drag.y0) / drag.scale) + "px"; }
    setVp(drag.i, { x, y });
    drawPreview();
  });
  const up = () => { if (!drag) return; drag = null; dragVp = -1; frozenView = null; save(); renderGridControls(); drawPreview(); };
  document.addEventListener("mouseup", up);
  document.addEventListener("mouseleave", up);
  window.addEventListener("resize", () => { if (!drag) placeHandles(); });
  UI.sections("msgridsai.sections", { presets: true, grid: true, style: true, more: false });
  renderAll();
  poll(true);
  setInterval(() => { if (!busy && !testing && !drag) poll(); }, 1000);
}
init();
