"use strict";
// Gridwork – Photoshop UXP panel.
// Column, module (blocks) and baseline grids as real Photoshop guides and/or a layer, composition overlays
// (rule of thirds, golden ratio, spirals, diagonals …), pattern grids (square, dot, isometric, triangle,
// hexagon, diamond) and 1-, 2- and 3-point perspective grids. Grid layers are normal pixel layers that keep
// their settings: select one, change the settings, click "Update grid".

const { app, core, action, imaging, constants } = require("photoshop");
const { batchPlay } = action;
const lfs = require("uxp").storage.localFileSystem;
const UI = require("./ui.js");
const Core = require("./core.js");

const $ = (id) => document.getElementById(id);
// Photoshop has no logo grids (that lives in Illustrator); grids from earlier versions ("layout") open as Columns
const MODES = Core.MODES.filter((m) => m.id !== "logo");
const uiMode = (m) => (m === "layout" ? "columns" : MODES.some((x) => x.id === m) ? m : "columns");
const isGuideMode = (m) => Core.GUIDE_MODES.includes(m);
const modeName = (m) => (Core.MODES.find((x) => x.id === m) || { name: "Columns" }).name;
const HIST = "Gridwork";
const STORE = "gridwork.v1", PRESET_KEY = "gridwork.presets.v1";
const LAYER_PREFIX = "Gridwork · ";
const XMP_NS = "http://gridwork/1.0/";
const TARGET = [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }];
const MAX_PIXELS = 120e6;
const GUIDE_COLOR = "#00e5ff";

// ---------------------------------------------------------------- state
let S = loadState();               // { mode, params, replaceGuides }
let busy = false, testing = false, editing = null;   // editing: id of the selected grid layer whose settings are loaded
let pv = null;                      // preview source { docId, w, h, docW, docH, rgb, ref }
function loadState() {
  try { const o = JSON.parse(localStorage.getItem(STORE) || "{}"); return { mode: uiMode(o.mode), params: Core.sanitize(o.params), replaceGuides: o.replaceGuides !== false, autoFit: o.autoFit !== false }; }
  catch (e) { return { mode: "columns", params: Core.sanitize({}), replaceGuides: true, autoFit: true }; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function setStatus(msg, err) { const el = $("status"); el.textContent = msg || ""; el.className = err ? "status err" : "status"; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------------------------------------------------------------- log
const logLines = [];
let logTimer = null;
function log(msg, data) {
  logLines.push(new Date().toISOString() + " " + msg + (data !== undefined ? " " + JSON.stringify(data) : ""));
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => { try { const f = await (await lfs.getDataFolder()).createFile("grids-log.txt", { overwrite: true }); await f.write(logLines.join("\n") + "\n"); } catch (e) { /* ignore */ } }, 300);
}

// ---------------------------------------------------------------- controls per mode
const P = () => S.params;
const pxOrPct = (px, pct) => (P().unit === "%" ? pct : px);
function gridControls() {
  const p = P(), m = S.mode;
  const unitSeg = { seg: "unit", label: "Units", options: [{ id: "px", name: "Pixels" }, { id: "%", name: "% of size" }] };
  const margins = [
    { sw: "linkMargins", label: "Same margin on all sides" },
    { key: "mTop", label: p.linkMargins ? "Margins" : "Top", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit },
    { key: "mRight", label: "Right", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
    { key: "mBottom", label: "Bottom", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
    { key: "mLeft", label: "Left", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
  ];
  if (m === "columns") return [
    { key: "cols", count: true, label: "Columns", min: 1, max: 48, step: 1 },
    unitSeg,
    { key: "gutterX", label: "Gutter", min: 0, max: pxOrPct(400, 20), step: pxOrPct(1, 0.1), unit: p.unit, show: () => p.cols > 1 },
  ].concat(margins);
  if (m === "modules") return [
    { key: "cols", count: true, label: "Columns", min: 1, max: 48, step: 1 },
    { key: "rows", count: true, label: "Rows", min: 1, max: 48, step: 1 },
    unitSeg,
    { key: "gutterX", label: "Column gutter", min: 0, max: pxOrPct(400, 20), step: pxOrPct(1, 0.1), unit: p.unit, show: () => p.cols > 1 },
    { key: "gutterY", label: "Row gutter", min: 0, max: pxOrPct(400, 20), step: pxOrPct(1, 0.1), unit: p.unit, show: () => p.rows > 1 },
    { key: "radius", label: "Corner radius", min: 0, max: 100, step: 1, unit: "px", tip: "Rounded corners of the blocks on the layer" },
  ].concat(margins);
  if (m === "baseline") return [
    { seg: "baseDir", label: "Lines", options: [{ id: "h", name: "Horizontal" }, { id: "v", name: "Vertical" }] },
    { key: "spacing", label: "Spacing", min: 2, max: 200, step: 1, unit: "px" },
    { key: "baselineOffset", label: "Offset", min: 0, max: 200, step: 1, unit: "px", tip: "Where the first line sits, from the margin" },
    unitSeg,
  ].concat(margins);
  if (m === "composition") return [
    { seg: "comp", label: "Overlay", wrap: true, options: Core.COMPOSITIONS },
    { sw: "flipX", label: "Mirror horizontally", show: () => ["spiral", "triangles", "dynamic"].includes(p.comp) },
    { sw: "flipY", label: "Mirror vertically", show: () => ["spiral", "triangles", "dynamic"].includes(p.comp) },
    { key: "compRays", count: true, label: "Rays", min: 4, max: 72, step: 1, show: () => p.comp === "radial" },
  ];
  if (m === "pattern") return [
    { seg: "pattern", label: "Pattern", wrap: true, options: [{ id: "square", name: "Square" }, { id: "dot", name: "Dots" }, { id: "diamond", name: "Diamond" }, { id: "triangle", name: "Triangle" }, { id: "iso", name: "Isometric" }, { id: "hex", name: "Hexagon" }] },
    { key: "size", label: "Cell size", min: 4, max: 400, step: 1, unit: "px" },
    { key: "dotSize", label: "Dot radius", min: 0.5, max: 30, step: 0.5, unit: "px", show: () => p.pattern === "dot" },
    { key: "offsetX", label: "Offset X", min: -200, max: 200, step: 1, unit: "px" },
    { key: "offsetY", label: "Offset Y", min: -200, max: 200, step: 1, unit: "px" },
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
  const set = (v) => { v = Math.max(c.min, Math.min(c.max, Math.round(v))); num.value = String(v); if (P()[c.key] === v) return; P()[c.key] = v; changed(c.key === "cols" || c.key === "rows" || c.key === "baseline"); };
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
  $("areaRow").className = "field";
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
    UI.slider(box, { label: "Line width", min: 0.25, max: 20, step: 0.25, unit: "px", def: 1 }, { get: () => P().width, set: (v) => { P().width = v; changed(false); }, done: () => changed(true) });
    UI.slider(box, { label: "Opacity", min: 1, max: 100, step: 1, unit: "%", def: 100 }, { get: () => P().opacity, set: (v) => { P().opacity = v; changed(false); }, done: () => changed(true) });
    if (fillable && P().draw !== "lines") UI.slider(box, { label: S.mode === "modules" ? "Block fill" : "Column fill", min: 0, max: 100, step: 1, unit: "%", def: 12, tip: "Tints the columns or blocks on the layer" }, { get: () => P().fillOpacity, set: (v) => { P().fillOpacity = v; changed(false); }, done: () => changed(true) });
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
// small pictures of the presets, drawn once per mode (on light paper, in the current colour)
const picCache = {};
let picToken = 0;
async function presetPictures(mode) {
  const token = ++picToken, W = 132, H = 84;
  for (const n of Object.keys(Core.PRESETS[mode])) {
    const key = mode + "/" + n + "/" + P().color;
    if (!picCache[key]) {
      const p = Core.sanitize(Object.assign({}, Core.DEFAULTS, { color: P().color, width: 1, output: "layer", fillOpacity: 14 }, Core.PRESETS[mode][n]));
      const k = mode === "baseline" ? 0.4 : 0.11, area = { x: 0, y: 0, w: W / k, h: H / k };   // baselines: closer, so fine spacings stay visible
      const res = Core.build(mode, p, area, { x: area.w * 0.3, y: area.h * 0.3, w: area.w * 0.4, h: area.h * 0.4 });
      const rgba = Core.raster(res, Object.assign({}, p, { width: 1 / k }), W, H, 0, 0, k), rgb = new Uint8Array(W * H * 3);
      for (let i = 0; i < W * H; i++) { const al = rgba[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round([242, 240, 235][c] * (1 - al) + rgba[i * 4 + c] * al); }
      try {
        const d = await imaging.createImageDataFromBuffer(rgb, { width: W, height: H, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
        try { picCache[key] = "data:image/jpeg;base64," + await imaging.encodeImageData({ imageData: d, base64: true }); } finally { d.dispose(); }
      } catch (e) { return; }   // older Photoshop: the tiles keep their names only
    }
    if (token !== picToken) return;
    const tile = document.querySelector(`#presetTiles .tile[data-n="${n.replace(/"/g, '\\"')}"]`);
    if (tile && tile.firstChild && tile.firstChild.tagName !== "IMG") { const img = document.createElement("img"); img.src = picCache[key]; tile.replaceChild(img, tile.firstChild); }
    await sleep(0);
  }
}
function loadOwn() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveOwn(o) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
const MODE_INFO = {
  columns: "Columns, gutters and margins – as guides, a layer or both.",
  modules: "A grid of blocks: columns × rows with gutters and margins – guides, a layer of blocks, or both.",
  baseline: "Lines at an even spacing, horizontal or vertical – as guides, a layer or both.",
  composition: "Composition overlays – rule of thirds, golden ratio, spirals, diagonals – as a layer.",
  pattern: "A pattern grid over the canvas or the selected layer, as a layer.",
  perspective: "Vanishing point grid as a layer – drag the points in the preview.",
};
function renderMode() {
  UI.syncSeg($("modeSeg"), S.mode);
  $("modeInfo").textContent = MODE_INFO[S.mode];
  $("gridTitle").textContent = modeName(S.mode) + " grid";
  $("apply").textContent = editing ? "Update grid" : "Create grid";
  $("apply").className = editing ? "btn primary update" : "btn primary";
  // quiet, contextual actions: only where they make sense
  $("remove").className = editing ? "btn small ghost" : "btn small ghost hidden";
  $("clearGuides").className = isGuideMode(S.mode) ? "btn small ghost" : "btn small ghost hidden";
}
function renderAll() { stickyView = null; renderMode(); renderGridControls(); renderStyle(); renderPresets(); }
// rebuild: the set of controls may change (e.g. units, pattern type)
const savePreview = debounce(() => { save(); drawPreview(); }, 60);
function changed(rebuild) { if (rebuild) { renderGridControls(); renderStyle(); } savePreview(); }

// ---------------------------------------------------------------- document helpers
function boundsOf(layer) { const b = layer.boundsNoEffects || layer.bounds; return { x: Math.floor(b.left), y: Math.floor(b.top), w: Math.ceil(b.right) - Math.floor(b.left), h: Math.ceil(b.bottom) - Math.floor(b.top) }; }
function docRect(doc) { return { x: 0, y: 0, w: Math.round(Number(doc.width)), h: Math.round(Number(doc.height)) }; }
// the selected layer, unless it is one of our grid layers
function refLayer(doc) {
  const l = doc && doc.activeLayers && doc.activeLayers[0];
  if (!l || String(l.name).startsWith(LAYER_PREFIX)) return null;
  const b = boundsOf(l);
  return b.w > 0 && b.h > 0 ? l : null;
}
// area the grid fills, and the logo's box
function regionFor(doc, p, ref) {
  const canvas = docRect(doc);
  if (p.area === "layer" && ref) return { area: ref, ref };
  return { area: canvas, ref: ref || null };
}
function to8bit(data, cs) {
  if (cs === 8) return data;
  const out = new Uint8Array(data.length), f = cs === 16 ? 255 / 32768 : 255;
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(data[i] * f)));
  return out;
}
function fromBuf8(buf, doc) {
  const depth = String(doc.bitsPerChannel || "");
  if (depth.indexOf("16") >= 0) { const out = new Uint16Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = Math.round(buf[i] * 32768 / 255); return out; }
  if (depth.indexOf("32") >= 0) { const out = new Float32Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = buf[i] / 255; return out; }
  return buf;
}

// ---------------------------------------------------------------- XMP (settings on the grid layer)
function xmpFor(mode, p) {
  const json = JSON.stringify({ mode, params: p }).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:gridwork="${XMP_NS}"><gridwork:params>${json}</gridwork:params></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
async function writeXmp(layerId, mode, p) {
  await batchPlay([{ _obj: "set", _target: [{ _ref: "property", _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }], to: { _obj: "layer", XMPMetadataAsUTF8: xmpFor(mode, p) } }], {});
}
async function readXmp(layerId) {
  try {
    const r = await batchPlay([{ _obj: "get", _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }] }], {});
    const x = r && r[0] && r[0].XMPMetadataAsUTF8, m = x && /<gridwork:params>([\s\S]*?)<\/gridwork:params>/.exec(x);
    if (!m) return null;
    const o = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    return { mode: o.mode === "layout" || Core.MODES.some((mm) => mm.id === o.mode) ? o.mode : "columns", params: Core.sanitize(o.params), ref: (o.params && o.params._ref) || null };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- preview
let pvToken = 0;
async function loadPreview() {
  const doc = app.activeDocument;
  if (!doc) { pv = null; showPreviewMsg("Open a document…"); $("docName").textContent = "–"; return; }
  $("docName").textContent = doc.name;
  const token = ++pvToken, R = docRect(doc), k = Math.min(1, 620 / R.w, 356 / R.h);
  const tw = Math.max(1, Math.round(R.w * k)), th = Math.max(1, Math.round(R.h * k));
  try {
    let src = null;
    await core.executeAsModal(async () => {
      const res = await imaging.getPixels({ documentID: doc.id, sourceBounds: { left: 0, top: 0, right: R.w, bottom: R.h }, targetSize: { width: tw, height: th }, colorSpace: "RGB", componentSize: 8 });
      const id = res.imageData, raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8), c = id.components, n = id.width * id.height;
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = c === 4 || c === 2 ? raw[i * c + c - 1] / 255 : 1, chk = ((i % id.width) >> 3) + (((i / id.width) | 0) >> 3) & 1 ? 0xcc : 0xee;
        for (let ch = 0; ch < 3; ch++) { const v = c >= 3 ? raw[i * c + ch] : raw[i * c]; rgb[i * 3 + ch] = Math.round(v * a + chk * (1 - a)); }
      }
      src = { w: id.width, h: id.height, rgb };
      id.dispose();
    }, { commandName: HIST + " preview" });
    if (token !== pvToken) return;
    const rl = refLayer(doc);
    pv = { docId: doc.id, w: src.w, h: src.h, docW: R.w, docH: R.h, rgb: src.rgb, ref: rl ? boundsOf(rl) : null, refName: rl ? rl.name : null };
    drawPreview();
  } catch (e) { pv = null; showPreviewMsg("The preview needs Photoshop 24.2 or newer."); log("preview", String(e && e.message || e)); }
}
function showPreviewMsg(t) { $("preview").className = "hidden"; $("previewMsg").className = "preview-msg"; $("previewMsg").textContent = t; }
let lastBuild = null;
// What the preview shows, in document pixels: the canvas, or for perspective grids the canvas plus every
// vanishing point (they often sit outside). Frozen while a point is dragged so the view doesn't jump.
let view = null, frozenView = null, stickyView = null;   // stickyView: kept while every point fits, so the preview doesn't re-zoom after a drag
function viewFor(res) {
  const d = { x: 0, y: 0, w: pv.docW, h: pv.docH };
  if (S.mode !== "perspective" || !res.vps) return d;
  let x0 = 0, y0 = 0, x1 = pv.docW, y1 = pv.docH;
  for (const vp of res.vps) { x0 = Math.min(x0, vp.x); y0 = Math.min(y0, vp.y); x1 = Math.max(x1, vp.x); y1 = Math.max(y1, vp.y); }
  const m = 0.1 * Math.max(pv.docW, pv.docH);   // room for the handles
  if (x0 < 0) x0 -= m; if (y0 < 0) y0 -= m; if (x1 > pv.docW) x1 += m; if (y1 > pv.docH) y1 += m;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
let drawing = false, drawAgain = false;
async function drawPreview() {
  if (!pv) return;
  if (drawing) { drawAgain = true; return; }   // one render at a time; the newest settings win
  drawing = true;
  try { do { drawAgain = false; await drawOnce(); } while (drawAgain); } finally { drawing = false; }
}
async function drawOnce() {
  const p = P();
  const fakeDoc = { width: pv.docW, height: pv.docH };
  $("dragHint").textContent = S.mode === "perspective" ? "Drag the points" : "";
  const { area, ref } = regionFor(fakeDoc, p, pv.ref);
  const res = Core.build(S.mode, p, area, ref || { x: pv.docW * 0.35, y: pv.docH * 0.35, w: pv.docW * 0.3, h: pv.docH * 0.3 });
  let V = frozenView;
  if (!V) {
    const inside = (W) => res.vps && res.vps.every((vp) => vp.x >= W.x && vp.x <= W.x + W.w && vp.y >= W.y && vp.y <= W.y + W.h);
    V = S.mode === "perspective" && stickyView && inside(stickyView) ? stickyView : viewFor(res);
    stickyView = S.mode === "perspective" ? V : null;
  }
  // output size: fit the view into the preview box
  const k = Math.min(620 / V.w, 356 / V.h), W = Math.max(1, Math.round(V.w * k)), H = Math.max(1, Math.round(V.h * k));
  view = { V, k, W, H };
  lastBuild = { res, k };
  // the document thumbnail, placed into the view (outside the canvas: dark)
  const out = new Uint8Array(W * H * 3), ks = pv.w / pv.docW;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = V.x + (x + 0.5) / k, dy = V.y + (y + 0.5) / k, o = (y * W + x) * 3;
    if (dx < 0 || dy < 0 || dx >= pv.docW || dy >= pv.docH) { out[o] = 26; out[o + 1] = 31; out[o + 2] = 46; continue; }
    const sx = Math.min(pv.w - 1, Math.floor(dx * ks)), sy = Math.min(pv.h - 1, Math.floor(dy * ks)), si = (sy * pv.w + sx) * 3;
    out[o] = pv.rgb[si]; out[o + 1] = pv.rgb[si + 1]; out[o + 2] = pv.rgb[si + 2];
  }
  const showGuides = isGuideMode(S.mode) && p.output !== "layer", showLayer = !isGuideMode(S.mode) || p.output !== "guides";
  const over = (rgba) => { for (let i = 0, n = W * H; i < n; i++) { const a = rgba[i * 4 + 3] / 255; if (a) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - a) + rgba[i * 4 + c] * a); } };
  if (showLayer) over(Core.raster(res, Object.assign({}, p, { width: Math.max(p.width, 1 / k) }), W, H, V.x, V.y, k));
  if (showGuides) over(Core.raster({ shapes: res.guides.map((g) => g.dir === "v" ? { t: "seg", x1: g.pos, y1: 0, x2: g.pos, y2: pv.docH } : { t: "seg", x1: 0, y1: g.pos, x2: pv.docW, y2: g.pos }), fills: [] }, { color: GUIDE_COLOR, width: 1 / k, opacity: 100, fillOpacity: 0 }, W, H, V.x, V.y, k));
  if (V.x < 0 || V.y < 0 || V.w > pv.docW || V.h > pv.docH) over(Core.raster({ shapes: [[0, 0, pv.docW, 0], [pv.docW, 0, pv.docW, pv.docH], [pv.docW, pv.docH, 0, pv.docH], [0, pv.docH, 0, 0]].map(([a1, b1, a2, b2]) => ({ t: "seg", x1: a1, y1: b1, x2: a2, y2: b2 })), fills: [] }, { color: "#ffffff", width: 1 / k, opacity: 60, fillOpacity: 0 }, W, H, V.x, V.y, k));
  try {
    const d = await imaging.createImageDataFromBuffer(out, { width: W, height: H, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    try { $("preview").src = "data:image/jpeg;base64," + await imaging.encodeImageData({ imageData: d, base64: true }); } finally { d.dispose(); }
    $("preview").className = S.mode === "perspective" ? "drag" : ""; $("previewMsg").className = "hidden";
  } catch (e) { showPreviewMsg("The preview needs Photoshop 24.2 or newer."); }
  if (!drag) placeHandles();
}
// Vanishing point handles: real elements over the preview. While dragging, the handle moves with the mouse
// at once; the grid behind it follows as fast as the preview can be redrawn.
function placeHandles() {
  const box = $("handles");
  const vps = S.mode === "perspective" && lastBuild && lastBuild.res.vps && view ? lastBuild.res.vps : [];
  const img = $("preview"), r = img.getBoundingClientRect(), b = $("previewBox").getBoundingClientRect();
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
// dragging vanishing points in the preview (perspective)
let dragVp = -1, drag = null;   // drag: { i, mx, my, x0, y0, scale, V, el, hx, hy }
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
  const doc = app.activeDocument;
  if (!doc) { setStatus("Open a document first.", true); return; }
  busy = true;
  const p = Core.sanitize(P()), mode = S.mode;
  try {
    let msg = "";
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " · " + modeName(mode) });
      try { msg = await applyIn(doc, mode, p); }
      finally { await ctx.hostControl.resumeHistory(hid, true); }
    }, { commandName: HIST });
    setStatus(msg);
    log("apply", { mode, p });
  } catch (e) {
    setStatus(String(e && e.message || e), true);
    log("apply failed", String(e && e.stack || e));
  } finally { busy = false; }
  await loadPreview();
}
async function applyIn(doc, mode, p) {
  const active = doc.activeLayers && doc.activeLayers[0];
  const old = active && String(active.name).startsWith(LAYER_PREFIX) && (await readXmp(active.id)) ? active : null;
  const rl = refLayer(doc);
  // when updating a logo grid, keep its box: stored on the grid layer
  let refBox = rl ? boundsOf(rl) : null;
  if (!refBox && old) { const x = await readXmp(old.id); refBox = x && x.ref; }
  const { area, ref } = regionFor(doc, p, refBox);
  if (p.area === "layer" && !refBox) throw new Error("Select a layer for the area, or set Area to Canvas.");
  const res = Core.build(mode, p, area, ref);
  const parts = [];
  // guides
  if (isGuideMode(mode) && p.output !== "layer") {
    if (S.replaceGuides) doc.guides.removeAll();
    for (const g of res.guides) doc.guides.add(g.dir === "v" ? constants.Direction.VERTICAL : constants.Direction.HORIZONTAL, g.pos);
    parts.push(res.guides.length + " guides");
  }
  // layer
  if (!isGuideMode(mode) || p.output !== "guides") {
    if (String(doc.mode).toLowerCase().indexOf("rgb") < 0) throw new Error("Grid layers need an RGB document – Image › Mode › RGB Color. (Guides work in every mode.)");
    const R = docRect(doc), m = Math.ceil(p.width * 1.6) + 2;
    const left = Math.max(0, Math.floor(area.x - m)), top = Math.max(0, Math.floor(area.y - m));
    const right = Math.min(R.w, Math.ceil(area.x + area.w + m)), bottom = Math.min(R.h, Math.ceil(area.y + area.h + m));
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) throw new Error("The grid area is outside the canvas.");
    if (w * h > MAX_PIXELS) throw new Error("The document is too large for a grid layer – use guides or a smaller area.");
    const rgba = Core.raster(res, p, w, h, left, top, 1);
    const name = LAYER_PREFIX + modeName(mode);
    // a new grid sits above the selected layer; an update replaces the old grid layer in place
    if (old) await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: old.id }], makeVisible: false }], {});
    await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } }], {});
    const layer = doc.activeLayers[0];
    const d = await imaging.createImageDataFromBuffer(fromBuf8(rgba, doc), { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: d, targetBounds: { left, top } }); } finally { d.dispose(); }
    await writeXmp(layer.id, mode, Object.assign({}, p, { _ref: ref || null }));
    if (old) { await batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _id: old.id }] }], {}); await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false }], {}); }
    editing = layer.id;
    parts.push(old ? "grid layer updated" : "grid layer \"" + name + "\"");
  }
  renderMode();
  return "Done: " + parts.join(" + ") + ".";
}
async function removeGrid() {
  const doc = app.activeDocument, l = doc && doc.activeLayers && doc.activeLayers[0];
  if (!l || !String(l.name).startsWith(LAYER_PREFIX)) { setStatus("Select a grid layer (\"" + LAYER_PREFIX + "…\") to remove it.", true); return; }
  await core.executeAsModal(async () => { await batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _id: l.id }] }], {}); }, { commandName: HIST + " · Remove" });
  editing = null; renderMode(); setStatus("Grid layer removed."); await loadPreview();
}
async function clearGuides() {
  const doc = app.activeDocument;
  if (!doc) return;
  const n = doc.guides.length;
  await core.executeAsModal(async () => { doc.guides.removeAll(); }, { commandName: HIST + " · Clear guides" });
  setStatus(n ? `Removed ${n} guides.` : "There were no guides.");
  await loadPreview();
}
// selecting a grid layer loads its settings
async function onSelection(force) {
  if (busy || (testing && force !== true)) return;
  const doc = app.activeDocument, l = doc && doc.activeLayers && doc.activeLayers[0];
  editing = null;
  if (l && String(l.name).startsWith(LAYER_PREFIX)) {
    const x = await readXmp(l.id);
    if (x && x.mode === "logo") setStatus("This logo grid was made by an earlier version – it stays as it is.");
    else if (x) {
      editing = l.id; S.mode = uiMode(x.mode); S.params = Core.sanitize(x.params);
      save(); renderAll();
      setStatus("Grid loaded – change the settings and click Update grid.");
    }
  }
  renderMode();
  await loadPreview();
}

// When the canvas changes size, every grid layer is drawn again for the new canvas (logo grids keep their
// box). Layout grids that also made guides get fresh guides.
function allLayers(c, out) { for (const l of c.layers || []) { out.push(l); if (l.layers) allLayers(l, out); } return out; }
async function fitToCanvas() {
  if (!S.autoFit || busy || testing) return;
  const doc = app.activeDocument;
  if (!doc) return;
  const grids = allLayers(doc, []).filter((l) => String(l.name).startsWith(LAYER_PREFIX));
  if (!grids.length) return;
  busy = true;
  let n = 0;
  try {
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " · Fit to canvas" });
      const keep = S.replaceGuides;
      try {
        for (const l of grids) {
          const x = await readXmp(l.id);
          if (!x || x.mode === "logo") continue;   // logo grids from earlier versions keep their box
          await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: l.id }], makeVisible: false }], {});
          S.replaceGuides = true;
          await applyIn(doc, x.mode, x.params);
          n++;
        }
      } finally { S.replaceGuides = keep; await ctx.hostControl.resumeHistory(hid, true); }
    }, { commandName: HIST + " · Fit to canvas" });
  } finally { busy = false; }
  if (n) setStatus(`Canvas changed – ${n} grid layer${n > 1 ? "s" : ""} fitted to the new size.`);
  log("fit", { n });
  await loadPreview();
}

// ---------------------------------------------------------------- self-test
async function selfTest() {
  if (busy) return;
  const results = [], saved = JSON.parse(JSON.stringify(S)), t0 = Date.now();
  testing = true;
  const check = async (name, fn) => {
    try { const r = await fn(); results.push({ name, ok: !!(r && r.ok), r }); }
    catch (e) { results.push({ name, ok: false, r: String(e && e.stack || e) }); }
    setStatus(`Self-test: ${results.length} – ${name}`);
  };
  let doc = null, logoId = null;
  const alphaCount = async (layerId) => {
    let n = 0;
    await core.executeAsModal(async () => {
      const r = await imaging.getPixels({ documentID: doc.id, layerID: layerId, colorSpace: "RGB", componentSize: 8 });
      const d = to8bit(await r.imageData.getData({ chunky: true }), r.imageData.componentSize || 8), c = r.imageData.components;
      for (let i = c - 1; i < d.length; i += c) if (d[i] > 8) n++;
      r.imageData.dispose();
    }, { commandName: HIST + " test read" });
    return n;
  };
  const use = (mode, preset, extra) => { S.mode = mode; S.params = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS[mode][preset], extra || {})); editing = null; };
  const grids = () => doc.layers.filter((l) => String(l.name).startsWith(LAYER_PREFIX));
  try {
    await core.executeAsModal(async () => {
      doc = await app.documents.add({ width: 1200, height: 800, resolution: 72, mode: "RGBColorMode", fill: "white", name: "Gridwork Self-test" });
      // a filled rectangle on its own layer (area for "Selected layer")
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Shape" } }], {});
      const l = doc.activeLayers[0], w = 300, h = 200, buf = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = 30; buf[i * 4 + 1] = 40; buf[i * 4 + 2] = 90; buf[i * 4 + 3] = 255; }
      const d = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      try { await imaging.putPixels({ documentID: doc.id, layerID: l.id, imageData: d, targetBounds: { left: 450, top: 300 } }); } finally { d.dispose(); }
      logoId = l.id;
    }, { commandName: HIST + " self-test" });
    S.replaceGuides = true;

    await check("Columns: guides at the exact positions", async () => {
      use("columns", "12 Column", { output: "guides" }); await apply();
      const exp = Core.build("columns", S.params, docRect(doc)).guides, got = Array.from(doc.guides).map((g) => ({ dir: String(g.direction).toLowerCase().indexOf("vert") >= 0 ? "v" : "h", pos: g.coordinate }));
      const ok = got.length === exp.length && exp.every((e) => got.some((g) => g.dir === e.dir && Math.abs(g.pos - e.pos) < 0.6));
      return { ok, exp: exp.length, got: got.length, sample: got.slice(0, 4) };
    });
    await check("Modules: Replace guides swaps the guides (rule of thirds = 4)", async () => {
      use("modules", "Rule of Thirds", { output: "guides" }); await apply();
      return { ok: doc.guides.length === 4, n: doc.guides.length };
    });
    await check("Baseline: one guide per line", async () => {
      use("baseline", "Baseline 24", { output: "guides" }); await apply();
      const exp = Core.build("baseline", S.params, docRect(doc)).guides.length;
      return { ok: doc.guides.length === exp && exp > 20, n: doc.guides.length, exp };
    });
    await check("Modules: layer of blocks with rounded corners", async () => {
      use("modules", "6 × 4 Blocks", { output: "layer", draw: "both" }); await apply();
      const l = doc.activeLayers[0], x = await readXmp(l.id), n = await alphaCount(l.id);
      return { ok: String(l.name) === LAYER_PREFIX + "Modules" && !!x && x.params.rows === 4 && n > 5000, n };
    });
    await check("Columns: grid layer with pixels and settings stored", async () => {
      use("columns", "6 Column", { output: "layer" }); await apply();
      const l = doc.activeLayers[0], x = await readXmp(l.id), n = await alphaCount(l.id);
      return { ok: String(l.name) === LAYER_PREFIX + "Columns" && !!x && x.params.cols === 6 && n > 1000, n };
    });
    await check("Update replaces the selected grid layer (no second layer)", async () => {
      const before = grids().length; await onSelection(true); S.params.cols = 4; await apply();
      const l = doc.activeLayers[0], x = await readXmp(l.id);
      return { ok: grids().length === before && x && x.params.cols === 4, before, after: grids().length };
    });
    await check("Layer pixels match the engine", async () => {
      const l = doc.activeLayers[0];
      let diff = 0, n = 0;
      await core.executeAsModal(async () => {
        const r = await imaging.getPixels({ documentID: doc.id, layerID: l.id, sourceBounds: { left: 0, top: 0, right: 1200, bottom: 800 }, colorSpace: "RGB", componentSize: 8 });
        const d = to8bit(await r.imageData.getData({ chunky: true }), r.imageData.componentSize || 8), c = r.imageData.components, sb = r.sourceBounds || { left: 0, top: 0 };
        const exp = Core.raster(Core.build("columns", S.params, docRect(doc)), S.params, 1200, 800, 0, 0, 1);
        for (let y = 0; y < r.imageData.height; y += 3) for (let x = 0; x < r.imageData.width; x += 3) {
          const ga = c === 4 ? d[(y * r.imageData.width + x) * c + 3] : 255, ea = exp[((y + sb.top) * 1200 + x + sb.left) * 4 + 3];
          if (ga > 4 || ea > 4) { n++; if (Math.abs(ga - ea) > 24) diff++; }
        }
        r.imageData.dispose();
      }, { commandName: HIST + " test read" });
      return { ok: n > 0 && diff / n < 0.01, n, diff };
    });
    for (const c of Core.COMPOSITIONS) {
      await check("Composition: " + c.name, async () => { editing = null; use("composition", c.name, { area: "canvas" }); await apply(); return { ok: (await alphaCount(doc.activeLayers[0].id)) > 300 }; });
    }
    for (const pat of ["square", "dot", "iso", "hex"]) {
      await check("Pattern: " + pat, async () => {
        editing = null; await core.executeAsModal(async () => { await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: logoId }], makeVisible: false }], {}); }, { commandName: HIST + " test" });
        use("pattern", "Square 40", { pattern: pat, area: "canvas" }); await apply();
        return { ok: (await alphaCount(doc.activeLayers[0].id)) > 500 };
      });
    }
    await check("Pattern on the selected layer's area only", async () => {
      editing = null; await core.executeAsModal(async () => { await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: logoId }], makeVisible: false }], {}); }, { commandName: HIST + " test" });
      use("pattern", "Square 40", { area: "layer" }); await apply();
      const b = boundsOf(doc.activeLayers[0]);
      return { ok: b.x >= 440 && b.y >= 290 && b.x + b.w <= 760 && b.y + b.h <= 510, b };
    });
    for (const pre of Object.keys(Core.PRESETS.perspective)) {
      await check("Perspective: " + pre, async () => { editing = null; use("perspective", pre); await apply(); return { ok: (await alphaCount(doc.activeLayers[0].id)) > 500 }; });
    }
    await check("Canvas size change: grid layers are fitted to the new canvas", async () => {
      editing = null; use("pattern", "Square 40", { area: "canvas" }); await apply();
      const id = doc.activeLayers[0].id;
      await core.executeAsModal(async () => { await batchPlay([{ _obj: "canvasSize", width: { _unit: "pixelsUnit", _value: 1500 }, height: { _unit: "pixelsUnit", _value: 900 }, horizontal: { _enum: "horizontalLocation", _value: "center" }, vertical: { _enum: "verticalLocation", _value: "center" } }], {}); }, { commandName: HIST + " test" });
      testing = false; S.autoFit = true; await fitToCanvas(); testing = true;
      // the pattern layer was drawn again (new id) and now covers the whole new canvas
      let hit = null;
      for (const l of grids()) { const x = await readXmp(l.id), b = boundsOf(l); if (x && x.mode === "pattern" && x.params.area === "canvas" && b.x <= 2 && b.y <= 2 && b.x + b.w >= 1498 && b.y + b.h >= 898) hit = { id: l.id, b }; }
      return { ok: !!hit && hit.id !== id && !grids().some((l) => l.id === id), hit };
    });
        await check("Remove deletes the selected grid layer", async () => {
      const before = grids().length; await removeGrid(); return { ok: grids().length === before - 1, before, after: grids().length };
    });
    await check("Clear guides", async () => { await clearGuides(); return { ok: doc.guides.length === 0 }; });
  } catch (e) { results.push({ name: "Self-test setup", ok: false, r: String(e && e.stack || e) }); }
  testing = false; S = saved; editing = null; save(); renderAll();
  const bad = results.filter((r) => !r.ok);
  log("SELFTEST", { secs: Math.round((Date.now() - t0) / 1000), results });
  setStatus(`Self-test: ${results.length - bad.length} / ${results.length} ok` + (bad.length ? " – failed: " + bad.map((b) => b.name).join("; ") : ". The test document stays open, close it without saving."), bad.length > 0);
}

// ---------------------------------------------------------------- wiring
function init() {
  UI.seg($("modeSeg"), MODES.map((m) => ({ id: m.id, name: m.id === "composition" ? "Comp" : m.id === "perspective" ? "Persp." : m.name, tip: m.name })), (v) => { S.mode = v; editing = null; save(); renderAll(); drawPreview(); });
  UI.seg($("outputSeg"), [{ id: "guides", name: "Guides" }, { id: "layer", name: "Layer" }, { id: "both", name: "Both" }], (v) => { P().output = v; changed(true); });
  UI.seg($("areaSeg"), [{ id: "canvas", name: "Canvas" }, { id: "layer", name: "Selected layer" }], (v) => { P().area = v; changed(true); });
  $("swatch-color").addEventListener("click", () => UI.openColorPop({ pop: $("colorPop"), key: "color", anchor: $("swatch-color"), get: () => P().color, set: (c) => { P().color = c; renderStyle(); changed(false); presetPictures(S.mode); },
    palette: ["#00b4ff", "#2f5bff", "#7b9cff", "#ff3f6e", "#ff3fa4", "#d24dff", "#00e5ff", "#2fe0c8", "#39ff7a", "#ffe14d", "#ff8a3d", "#ffffff", "#9aa3b0", "#3a4058", "#000000"] }));
  UI.bindSwitch("replaceGuides", (on) => { S.replaceGuides = on; save(); });
  UI.bindSwitch("autoFit", (on) => { S.autoFit = on; save(); });
  UI.seg($("drawSeg"), [{ id: "both", name: "Lines + fills" }, { id: "lines", name: "Lines" }, { id: "fills", name: "Fills" }], (v) => { P().draw = v; changed(true); });
  $("apply").addEventListener("click", apply);
  $("remove").addEventListener("click", () => removeGrid().catch((e) => setStatus(String(e.message || e), true)));
  $("clearGuides").addEventListener("click", () => clearGuides().catch((e) => setStatus(String(e.message || e), true)));
  $("refreshPreview").addEventListener("click", loadPreview);
  $("resetMode").addEventListener("click", () => { const keep = { color: P().color }; S.params = Core.sanitize(Object.assign({}, Core.DEFAULTS, keep)); save(); renderAll(); drawPreview(); });
  $("presetSave").addEventListener("click", () => {
    const n = String($("presetName").value).trim();
    if (!n) { setStatus("Type a name for the preset first.", true); return; }
    const o = loadOwn(); o[n] = { mode: S.mode, params: Object.assign({}, S.params) }; saveOwn(o); $("presetName").value = ""; renderPresets(); setStatus(`Saved "${n}".`);
  });
  $("selfTest").addEventListener("click", selfTest);
  // drag vanishing points
  const img = $("preview");
  // Dragging: the nearest point is grabbed and then follows the mouse by the distance it moved. The view and
  // the preview's size on screen are measured once at the start – while the preview image reloads, Photoshop
  // can report a wrong size for a moment, which made points jump far away.
  const box = $("previewBox");
  box.addEventListener("mousedown", (e) => {
    if (S.mode !== "perspective" || !pv || !lastBuild || !lastBuild.res.vps || !view) return;
    const r = img.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (!(r.width > 20 && r.height > 20)) return;
    const V = view.V, scale = V.w / r.width;   // document pixels per screen pixel
    const pt = { x: V.x + (e.clientX - r.left) * scale, y: V.y + (e.clientY - r.top) * scale };
    let best = -1, bd = 1e9;
    lastBuild.res.vps.forEach((vp, i) => { const d = Math.hypot(vp.x - pt.x, vp.y - pt.y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    const vp = lastBuild.res.vps[best], el = $("handles").children[best];
    drag = { i: best, mx: e.clientX, my: e.clientY, x0: vp.x, y0: vp.y, scale, V, el,
      hx: el ? parseFloat(el.style.left) : 0, hy: el ? parseFloat(el.style.top) : 0, bw: b.width, bh: b.height };
    frozenView = V; dragVp = best;
    if (el) el.className = "vp active";
    e.preventDefault();
  });
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.mx, dy = e.clientY - drag.my;
    if (!isFinite(dx) || !isFinite(dy)) return;
    // stay within the visible view (plus a little), so a point can't run off on its own
    const V = drag.V, m = 0.1 * Math.max(V.w, V.h);
    const x = Math.max(V.x - m, Math.min(V.x + V.w + m, drag.x0 + dx * drag.scale));
    const y = Math.max(V.y - m, Math.min(V.y + V.h + m, drag.y0 + dy * drag.scale));
    // the handle first – immediately, 1:1 with the mouse
    if (drag.el) { drag.el.style.left = (drag.hx + (x - drag.x0) / drag.scale) + "px"; drag.el.style.top = (drag.hy + (y - drag.y0) / drag.scale) + "px"; }
    setVp(drag.i, { x, y });
    drawPreview();
  };
  const up = () => { if (!drag) return; drag = null; dragVp = -1; frozenView = null; save(); renderGridControls(); drawPreview(); };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.addEventListener("mouseleave", up);
  img.addEventListener("load", () => { if (!drag) placeHandles(); });
  UI.sections("gridwork.sections", { presets: true, grid: true, style: true, more: false });
  renderAll();
  const onPs = debounce(onSelection, 250);
  try { action.addNotificationListener(["select", "open", "close", "make", "delete"], onPs); } catch (e) { /* ignore */ }
  const onSize = debounce(() => fitToCanvas().catch((e) => log("fit failed", String(e && e.stack || e))), 400);
  try { action.addNotificationListener(["canvasSize", "imageSize", "crop", "trim", "rotateEventEnum"], onSize); } catch (e) { /* ignore */ }
  loadPreview();
}
init();
