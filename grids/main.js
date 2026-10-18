"use strict";
// MS Grids – Photoshop UXP panel.
// Layout grids (columns, rows, gutters, margins, baseline) as real Photoshop guides and/or a layer,
// logo construction grids around the selected layer, pattern grids (square, dot, isometric, triangle,
// hexagon, diamond) and 1-, 2- and 3-point perspective grids. Grid layers are normal pixel layers that keep
// their settings: select one, change the settings, click "Update grid".

const { app, core, action, imaging, constants } = require("photoshop");
const { batchPlay } = action;
const lfs = require("uxp").storage.localFileSystem;
const UI = require("./ms-ui.js");
const Core = require("./core.js");

const $ = (id) => document.getElementById(id);
const HIST = "MS Grids";
const STORE = "msgrids.v1", PRESET_KEY = "msgrids.presets.v1";
const LAYER_PREFIX = "MS Grid · ";
const XMP_NS = "http://ms-grids/1.0/";
const TARGET = [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }];
const MAX_PIXELS = 120e6;
const GUIDE_COLOR = "#00e5ff";

// ---------------------------------------------------------------- state
let S = loadState();               // { mode, params, replaceGuides }
let busy = false, testing = false, editing = null;   // editing: id of the selected grid layer whose settings are loaded
let pv = null;                      // preview source { docId, w, h, docW, docH, rgb, ref }
function loadState() {
  try { const o = JSON.parse(localStorage.getItem(STORE) || "{}"); return { mode: Core.MODES.some((m) => m.id === o.mode) ? o.mode : "layout", params: Core.sanitize(o.params), replaceGuides: o.replaceGuides !== false }; }
  catch (e) { return { mode: "layout", params: Core.sanitize({}), replaceGuides: true }; }
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
  if (m === "layout") return [
    { key: "cols", label: "Columns", min: 0, max: 48, step: 1 },
    { key: "rows", label: "Rows", min: 0, max: 48, step: 1 },
    { seg: "unit", label: "Units", options: [{ id: "px", name: "Pixels" }, { id: "%", name: "% of size" }] },
    { key: "gutterX", label: "Column gutter", min: 0, max: pxOrPct(400, 20), step: pxOrPct(1, 0.1), unit: p.unit, show: () => p.cols > 1 },
    { key: "gutterY", label: "Row gutter", min: 0, max: pxOrPct(400, 20), step: pxOrPct(1, 0.1), unit: p.unit, show: () => p.rows > 1 },
    { sw: "linkMargins", label: "Same margin on all sides" },
    { key: "mTop", label: p.linkMargins ? "Margins" : "Top", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit },
    { key: "mRight", label: "Right", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
    { key: "mBottom", label: "Bottom", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
    { key: "mLeft", label: "Left", min: 0, max: pxOrPct(1000, 40), step: pxOrPct(1, 0.1), unit: p.unit, show: () => !p.linkMargins, sub: true },
    { key: "baseline", label: "Baseline grid", min: 0, max: 100, step: 1, unit: "px", tip: "0 = off. Line every n pixels inside the margins" },
    { key: "baselineOffset", label: "Baseline offset", min: 0, max: 100, step: 1, unit: "px", show: () => p.baseline > 0, sub: true },
  ];
  if (m === "logo") return [
    { note: "Select the logo's layer first – the grid is built around its bounds." },
    { sw: "logoBox", label: "Bounding box" }, { sw: "logoCenter", label: "Centre lines" }, { sw: "logoDiag", label: "Diagonals" },
    { sw: "logoCircles", label: "Circles (inner, outer, ends)" }, { sw: "logoGolden", label: "Golden ratio circles" }, { sw: "logoSpiral", label: "Golden spiral" },
    { sw: "logoExtend", label: "Extend the box edges across the canvas" },
    { key: "logoSquares", label: "Square grid", min: 0, max: 24, step: 1, tip: "Squares across the height of the box, 0 = off" },
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
    { key: "rays", label: "Lines per point", min: 2, max: 120, step: 1 },
    { key: "verticals", label: "Verticals", min: 0, max: 60, step: 1, show: () => p.points !== "3" },
    { key: "horizontals", label: "Horizontals", min: 0, max: 60, step: 1, show: () => p.points === "1" },
  ];
}
let swId = 0;
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
    const s = UI.slider(box, { label: c.label, min: c.min, max: c.max, step: c.step, unit: c.unit || "", tip: c.tip, def: Core.DEFAULTS[c.key] },
      { get: () => P()[c.key], set: (v) => { P()[c.key] = v; changed(false); }, done: () => changed(true) });
    if (c.sub) s.row.className += " sub";
  }
  UI.syncSwitches();
}
function renderStyle() {
  const layout = S.mode === "layout";
  $("outputRow").className = layout ? "field" : "field hidden";
  $("areaRow").className = S.mode === "logo" ? "field hidden" : "field";
  UI.syncSeg($("outputSeg"), P().output);
  UI.syncSeg($("areaSeg"), P().area);
  $("swatch-color").style.backgroundColor = P().color;
  $("hexl-color").textContent = P().color;
  const box = $("styleSliders");
  box.innerHTML = "";
  const layerOut = !layout || P().output !== "guides";
  if (layerOut) {
    UI.slider(box, { label: "Line width", min: 0.25, max: 20, step: 0.25, unit: "px", def: 1 }, { get: () => P().width, set: (v) => { P().width = v; changed(false); }, done: () => changed(true) });
    UI.slider(box, { label: "Opacity", min: 1, max: 100, step: 1, unit: "%", def: 100 }, { get: () => P().opacity, set: (v) => { P().opacity = v; changed(false); }, done: () => changed(true) });
    if (layout) UI.slider(box, { label: "Column fill", min: 0, max: 100, step: 1, unit: "%", def: 12, tip: "Tints the columns (rows) on the layer" }, { get: () => P().fillOpacity, set: (v) => { P().fillOpacity = v; changed(false); }, done: () => changed(true) });
  }
  $("colorRow").className = layerOut ? "field" : "field hidden";
  $("replaceGuidesRow").className = layout && P().output !== "layer" ? "switch line" : "switch line hidden";
  UI.setSwitch("replaceGuides", S.replaceGuides);
}
function renderPresets() {
  const names = Object.keys(Core.PRESETS[S.mode]);
  $("presetChips").innerHTML = names.map((n) => `<div class="chip" data-n="${UI.esc(n)}">${UI.esc(n)}</div>`).join("");
  $("presetChips").querySelectorAll(".chip").forEach((el) => el.addEventListener("click", () => {
    Object.assign(S.params, Core.PRESETS[S.mode][el.getAttribute("data-n")]);
    S.params = Core.sanitize(S.params); renderAll(); changed(true);
    setStatus(`Preset "${el.getAttribute("data-n")}" loaded – click ${editing ? "Update grid" : "Create grid"}.`);
  }));
  $("presetMeta").textContent = names.length + " for " + Core.MODES.find((m) => m.id === S.mode).name;
  const own = loadOwn();
  UI.presetList($("presetList"), Object.keys(own).filter((n) => own[n].mode === S.mode),
    (n) => { S.params = Core.sanitize(Object.assign({}, S.params, own[n].params)); renderAll(); changed(true); },
    (n) => { const o = loadOwn(); delete o[n]; saveOwn(o); renderPresets(); });
}
function loadOwn() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveOwn(o) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }
const MODE_INFO = {
  layout: "Columns, rows, gutters, margins and baseline – as guides, a layer or both.",
  logo: "Construction lines around the selected layer, as a layer.",
  pattern: "A pattern grid over the canvas or the selected layer, as a layer.",
  perspective: "Vanishing point grid as a layer – drag the points in the preview.",
};
function renderMode() {
  UI.syncSeg($("modeSeg"), S.mode);
  $("modeInfo").textContent = MODE_INFO[S.mode];
  $("gridTitle").textContent = Core.MODES.find((m) => m.id === S.mode).name + " grid";
  $("apply").textContent = editing ? "Update grid" : "Create grid";
  $("apply").className = editing ? "btn primary update" : "btn primary";
}
function renderAll() { renderMode(); renderGridControls(); renderStyle(); renderPresets(); }
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
  if (S.mode === "logo") return { area: canvas, ref: ref || null };
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
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:msgrids="${XMP_NS}"><msgrids:params>${json}</msgrids:params></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
async function writeXmp(layerId, mode, p) {
  await batchPlay([{ _obj: "set", _target: [{ _ref: "property", _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }], to: { _obj: "layer", XMPMetadataAsUTF8: xmpFor(mode, p) } }], {});
}
async function readXmp(layerId) {
  try {
    const r = await batchPlay([{ _obj: "get", _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }] }], {});
    const x = r && r[0] && r[0].XMPMetadataAsUTF8, m = x && /<msgrids:params>([\s\S]*?)<\/msgrids:params>/.exec(x);
    if (!m) return null;
    const o = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    return { mode: Core.MODES.some((mm) => mm.id === o.mode) ? o.mode : "layout", params: Core.sanitize(o.params), ref: (o.params && o.params._ref) || null };
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
async function drawPreview() {
  if (!pv) return;
  const p = P(), k = pv.w / pv.docW;
  const fakeDoc = { width: pv.docW, height: pv.docH };
  if (S.mode === "logo" && !pv.ref) { $("dragHint").textContent = "Select the logo's layer"; }
  else $("dragHint").textContent = S.mode === "perspective" ? "Drag the points" : S.mode === "logo" ? "Around: " + pv.refName : "";
  const { area, ref } = regionFor(fakeDoc, p, pv.ref);
  const res = Core.build(S.mode, p, area, ref || { x: pv.docW * 0.35, y: pv.docH * 0.35, w: pv.docW * 0.3, h: pv.docH * 0.3 });
  lastBuild = { res, k };
  const showGuides = S.mode === "layout" && p.output !== "layer", showLayer = S.mode !== "layout" || p.output !== "guides";
  const out = Uint8Array.from(pv.rgb);
  const over = (rgba) => { for (let i = 0, n = pv.w * pv.h; i < n; i++) { const a = rgba[i * 4 + 3] / 255; if (a) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - a) + rgba[i * 4 + c] * a); } };
  if (showLayer) over(Core.raster(res, Object.assign({}, p, { width: Math.max(p.width, 1 / k) }), pv.w, pv.h, 0, 0, k));
  if (showGuides) over(Core.raster({ shapes: res.guides.map((g) => g.dir === "v" ? { t: "seg", x1: g.pos, y1: 0, x2: g.pos, y2: pv.docH } : { t: "seg", x1: 0, y1: g.pos, x2: pv.docW, y2: g.pos }), fills: [] }, { color: GUIDE_COLOR, width: 1 / k, opacity: 100, fillOpacity: 0 }, pv.w, pv.h, 0, 0, k));
  if (S.mode === "perspective" && res.vps) for (const vp of res.vps) mark(out, pv.w, pv.h, vp.x * k, vp.y * k);
  try {
    const d = await imaging.createImageDataFromBuffer(out, { width: pv.w, height: pv.h, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
    try { $("preview").src = "data:image/jpeg;base64," + await imaging.encodeImageData({ imageData: d, base64: true }); } finally { d.dispose(); }
    $("preview").className = S.mode === "perspective" ? "drag" : ""; $("previewMsg").className = "hidden";
  } catch (e) { showPreviewMsg("The preview needs Photoshop 24.2 or newer."); }
}
// small ring for a vanishing point in the preview
function mark(out, w, h, cx, cy) {
  for (let y = Math.floor(cy - 8); y <= cy + 8; y++) for (let x = Math.floor(cx - 8); x <= cx + 8; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), a = Math.max(0, 1.5 - Math.abs(d - 6)) * 0.9 + Math.max(0, 2.2 - d) * 0.5;
    if (a > 0) { const i = (y * w + x) * 3; for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] * (1 - Math.min(1, a)) + 255 * Math.min(1, a)); }
  }
}
// dragging vanishing points in the preview (perspective)
let dragVp = -1;
function previewToDoc(e) {
  const img = $("preview"), r = img.getBoundingClientRect();
  return { x: (e.clientX - r.left) / Math.max(1, r.width) * pv.docW, y: (e.clientY - r.top) / Math.max(1, r.height) * pv.docH };
}
function setVp(i, pt) {
  const p = P();
  const px = Math.round(pt.x / pv.docW * 100), py = Math.round(pt.y / pv.docH * 100);
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
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " · " + Core.MODES.find((m) => m.id === mode).name });
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
  if (mode === "logo" && !rl && !(old && editing)) throw new Error("Select the logo's layer first – the grid is built around it.");
  // when updating a logo grid, keep its box: stored on the grid layer
  let refBox = rl ? boundsOf(rl) : null;
  if (!refBox && old) { const x = await readXmp(old.id); refBox = x && x.ref; }
  const { area, ref } = regionFor(doc, p, refBox);
  if (p.area === "layer" && mode !== "logo" && !refBox) throw new Error("Select a layer for the area, or set Area to Canvas.");
  const res = Core.build(mode, p, area, ref);
  const parts = [];
  // guides
  if (mode === "layout" && p.output !== "layer") {
    if (S.replaceGuides) doc.guides.removeAll();
    for (const g of res.guides) doc.guides.add(g.dir === "v" ? constants.Direction.VERTICAL : constants.Direction.HORIZONTAL, g.pos);
    parts.push(res.guides.length + " guides");
  }
  // layer
  if (mode !== "layout" || p.output !== "guides") {
    if (String(doc.mode).toLowerCase().indexOf("rgb") < 0) throw new Error("Grid layers need an RGB document – Image › Mode › RGB Color. (Guides work in every mode.)");
    const R = docRect(doc), m = Math.ceil(p.width * 1.6) + 2;
    const left = Math.max(0, Math.floor(area.x - m)), top = Math.max(0, Math.floor(area.y - m));
    const right = Math.min(R.w, Math.ceil(area.x + area.w + m)), bottom = Math.min(R.h, Math.ceil(area.y + area.h + m));
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) throw new Error("The grid area is outside the canvas.");
    if (w * h > MAX_PIXELS) throw new Error("The document is too large for a grid layer – use guides or a smaller area.");
    const rgba = Core.raster(res, p, w, h, left, top, 1);
    const name = LAYER_PREFIX + Core.MODES.find((x) => x.id === mode).name;
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
    if (x) {
      editing = l.id; S.mode = x.mode; S.params = Core.sanitize(x.params);
      save(); renderAll();
      setStatus("Grid loaded – change the settings and click Update grid.");
    }
  }
  renderMode();
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
      doc = await app.documents.add({ width: 1200, height: 800, resolution: 72, mode: "RGBColorMode", fill: "white", name: "MS Grids Self-test" });
      // a "logo": filled rectangle on its own layer
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Logo" } }], {});
      const l = doc.activeLayers[0], w = 300, h = 200, buf = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = 30; buf[i * 4 + 1] = 40; buf[i * 4 + 2] = 90; buf[i * 4 + 3] = 255; }
      const d = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      try { await imaging.putPixels({ documentID: doc.id, layerID: l.id, imageData: d, targetBounds: { left: 450, top: 300 } }); } finally { d.dispose(); }
      logoId = l.id;
    }, { commandName: HIST + " self-test" });
    S.replaceGuides = true;

    await check("Layout: guides at the exact positions", async () => {
      use("layout", "12 Column", { output: "guides" }); await apply();
      const exp = Core.build("layout", S.params, docRect(doc)).guides, got = Array.from(doc.guides).map((g) => ({ dir: String(g.direction).toLowerCase().indexOf("vert") >= 0 ? "v" : "h", pos: g.coordinate }));
      const ok = got.length === exp.length && exp.every((e) => got.some((g) => g.dir === e.dir && Math.abs(g.pos - e.pos) < 0.6));
      return { ok, exp: exp.length, got: got.length, sample: got.slice(0, 4) };
    });
    await check("Layout: Replace guides swaps the guides", async () => {
      use("layout", "Rule of Thirds", { output: "guides" }); await apply();
      return { ok: doc.guides.length === 4, n: doc.guides.length };
    });
    await check("Layout: grid layer with pixels and settings stored", async () => {
      use("layout", "6 Column", { output: "layer" }); await apply();
      const l = doc.activeLayers[0], x = await readXmp(l.id), n = await alphaCount(l.id);
      return { ok: String(l.name) === LAYER_PREFIX + "Layout" && !!x && x.params.cols === 6 && n > 1000, n };
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
        const exp = Core.raster(Core.build("layout", S.params, docRect(doc)), S.params, 1200, 800, 0, 0, 1);
        for (let y = 0; y < r.imageData.height; y += 3) for (let x = 0; x < r.imageData.width; x += 3) {
          const ga = c === 4 ? d[(y * r.imageData.width + x) * c + 3] : 255, ea = exp[((y + sb.top) * 1200 + x + sb.left) * 4 + 3];
          if (ga > 4 || ea > 4) { n++; if (Math.abs(ga - ea) > 24) diff++; }
        }
        r.imageData.dispose();
      }, { commandName: HIST + " test read" });
      return { ok: n > 0 && diff / n < 0.01, n, diff };
    });
    await check("Logo: construction grid around the selected layer", async () => {
      await core.executeAsModal(async () => { await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: logoId }], makeVisible: false }], {}); }, { commandName: HIST + " test" });
      editing = null; use("logo", "Full Construction"); await apply();
      const l = doc.activeLayers[0], x = await readXmp(l.id);
      return { ok: String(l.name) === LAYER_PREFIX + "Logo" && x && x.ref && x.ref.x === 450 && x.ref.w === 300 && (await alphaCount(l.id)) > 500, ref: x && x.ref };
    });
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
  UI.seg($("modeSeg"), Core.MODES, (v) => { S.mode = v; editing = null; save(); renderAll(); drawPreview(); });
  UI.seg($("outputSeg"), [{ id: "guides", name: "Guides" }, { id: "layer", name: "Layer" }, { id: "both", name: "Both" }], (v) => { P().output = v; changed(true); });
  UI.seg($("areaSeg"), [{ id: "canvas", name: "Canvas" }, { id: "layer", name: "Selected layer" }], (v) => { P().area = v; changed(true); });
  $("swatch-color").addEventListener("click", () => UI.openColorPop({ pop: $("colorPop"), key: "color", anchor: $("swatch-color"), get: () => P().color, set: (c) => { P().color = c; renderStyle(); changed(false); },
    palette: ["#00b4ff", "#2f5bff", "#7b9cff", "#ff3f6e", "#ff3fa4", "#d24dff", "#00e5ff", "#2fe0c8", "#39ff7a", "#ffe14d", "#ff8a3d", "#ffffff", "#9aa3b0", "#3a4058", "#000000"] }));
  UI.bindSwitch("replaceGuides", (on) => { S.replaceGuides = on; save(); });
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
  img.addEventListener("mousedown", (e) => {
    if (S.mode !== "perspective" || !pv || !lastBuild || !lastBuild.res.vps) return;
    const pt = previewToDoc(e), k = lastBuild.k;
    let best = -1, bd = 1e9;
    lastBuild.res.vps.forEach((vp, i) => { const d = Math.hypot(vp.x - pt.x, vp.y - pt.y) * k; if (d < bd) { bd = d; best = i; } });
    if (bd > 40) return;
    dragVp = best; setVp(dragVp, pt); drawPreview();
  });
  document.addEventListener("mousemove", (e) => { if (dragVp >= 0) { setVp(dragVp, previewToDoc(e)); drawPreview(); } });
  document.addEventListener("mouseup", () => { if (dragVp >= 0) { dragVp = -1; save(); renderGridControls(); } });
  UI.sections("msgrids.sections", { presets: true, grid: true, style: true, more: false });
  renderAll();
  const onPs = debounce(onSelection, 250);
  try { action.addNotificationListener(["select", "open", "close", "make", "delete"], onPs); } catch (e) { /* ignore */ }
  loadPreview();
}
init();
