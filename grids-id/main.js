"use strict";
// MS Grids for InDesign – UXP panel.
// Layout grids for InDesign: columns become InDesign's own margin & column guides, rows are ruler guides,
// and the baseline grid is the document's baseline grid – rows can snap to it, so every module starts and
// ends on a baseline. Applies to the parent page (default), the current page, the spread or all pages.

const ID = require("indesign");
const { app } = ID;
const UI = require("./ms-ui.js");
const Core = require("./core.js");
const Shared = require("./grids-core.js");   // the composition overlays, shared with Photoshop and Illustrator

const $ = (id) => document.getElementById(id);
const STORE = "msgridsid.v1", PRESET_KEY = "msgridsid.presets.v1";
const LABEL = "msgrids";
const TAG_BLOCKS = "msgrids-blocks", TAG_COMP = "msgrids-comp", LAYER_NAME = "MS Grids";
const HIST = "MS Grids";

let P = load();
function load() { try { return Core.sanitize(JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { return Core.sanitize({}); } }
function save() { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) { /* ignore */ } }
function setStatus(msg, err) { const el = $("status"); el.textContent = msg || ""; el.className = err ? "status err" : "status"; }
const fmt = (pt) => (P.unit === "pt" ? pt.toFixed(1) + " pt" : (pt / Core.MM).toFixed(1) + " mm");

// ---------------------------------------------------------------- InDesign helpers
const doc = () => { try { return app.documents.length ? app.activeDocument : null; } catch (e) { return null; } };
const items = (col) => { const out = []; for (let i = 0; i < col.length; i++) out.push(col.item(i)); return out; };
function sideOf(page) {
  try {
    if (page.side === ID.PageSideOptions.LEFT_HAND) return "left";
    if (page.side === ID.PageSideOptions.RIGHT_HAND) return "right";
  } catch (e) { /* ignore */ }
  return "single";
}
// page size in pt (bounds are [y1, x1, y2, x2] in the current units – points inside withPoints)
function sizeOf(page) { const b = page.bounds; return { w: b[3] - b[1], h: b[2] - b[0] }; }
// runs fn with points and page-relative rulers, then restores the user's settings
function withPoints(d, fn) {
  const vp = d.viewPreferences;
  const keep = { h: vp.horizontalMeasurementUnits, v: vp.verticalMeasurementUnits, o: vp.rulerOrigin };
  vp.horizontalMeasurementUnits = ID.MeasurementUnits.POINTS;
  vp.verticalMeasurementUnits = ID.MeasurementUnits.POINTS;
  vp.rulerOrigin = ID.RulerOrigin.PAGE_ORIGIN;
  try { return fn(); } finally { vp.horizontalMeasurementUnits = keep.h; vp.verticalMeasurementUnits = keep.v; vp.rulerOrigin = keep.o; }
}
// one undo step for everything (falls back to plain execution where doScript isn't available)
function asOneStep(name, fn) {
  let started = false, result;
  const wrapped = () => { started = true; result = fn(); };
  try { app.doScript(wrapped, ID.ScriptLanguage.UXPSCRIPT, [], ID.UndoModes.ENTIRE_SCRIPT, name); }
  catch (e) { if (started) throw e; wrapped(); }
  return result;
}
function activePage() { try { return app.activeWindow.activePage; } catch (e) { return null; } }
function targetPages(d, target) {
  const page = activePage();
  if (target === "all") return { pages: items(d.pages), what: "all " + d.pages.length + " pages" };
  if (target === "spread") { const s = app.activeWindow.activeSpread; return { pages: items(s.pages), what: "this spread" }; }
  if (target === "page") return { pages: page ? [page] : [], what: "this page" };
  // parent page of the current page
  const m = page && page.appliedMaster;
  if (!m || !m.isValid) throw new Error("This page has no parent page – choose “Page” or apply a parent page first.");
  return { pages: items(m.pages), parent: m, what: "parent “" + m.name + "”" };
}

// ---------------------------------------------------------------- apply / remove
function removeOurGuides(page) {
  let n = 0;
  for (const g of items(page.guides)) if (g.label === LABEL) { g.remove(); n++; }
  return n;
}
function applyToPage(page, p, guidesToo) {
  const pl = Core.plan(p, Object.assign(sizeOf(page), { side: sideOf(page) }));
  const mp = page.marginPreferences;
  // InDesign's "left" is the inside margin on facing pages – the same as on single pages
  mp.top = pl.margins.top; mp.bottom = pl.margins.bottom; mp.left = pl.margins.inside; mp.right = pl.margins.outside;
  mp.columnCount = pl.columns.count; mp.columnGutter = pl.columns.gutter;
  let n = 0;
  if (guidesToo) {
    removeOurGuides(page);
    for (const gd of pl.guides) {
      const g = page.guides.add();
      g.orientation = gd.dir === "v" ? ID.HorizontalOrVertical.VERTICAL : ID.HorizontalOrVertical.HORIZONTAL;
      g.location = gd.pos;
      g.fitToPage = true;
      g.label = LABEL;
      n++;
    }
  }
  return { n, pl };
}
// ---- blocks and composition overlays: frames and lines on the non-printing layer "MS Grids"
function ourLayer(d) {
  let L = d.layers.itemByName(LAYER_NAME);
  if (!L || !L.isValid) { L = d.layers.add(); L.name = LAYER_NAME; }
  L.printable = false; L.locked = false; L.visible = true;
  return L;
}
function ourColor(d) {
  let c = d.colors.itemByName(LAYER_NAME);
  if (!c || !c.isValid) {
    c = d.colors.add(); c.name = LAYER_NAME;
    c.model = ID.ColorModel.PROCESS; c.space = ID.ColorSpace.RGB; c.colorValue = [0, 170, 255];
  }
  return c;
}
function removeOurItems(page, tag) {
  let n = 0;
  for (const it of items(page.pageItems)) if (it.label === tag || (!tag && (it.label === TAG_BLOCKS || it.label === TAG_COMP))) { it.remove(); n++; }
  return n;
}
function styleItem(it, d, L, tag, weight) {
  it.itemLayer = L; it.label = tag;
  it.strokeColor = ourColor(d); it.strokeWeight = weight || 0.75;
  it.fillColor = d.swatches.itemByName("None");
  return it;
}
function drawBlocks(d, page, pl, p) {
  const L = ourLayer(d);
  removeOurItems(page, TAG_BLOCKS);
  for (const b of pl.blocks) {
    const r = page.rectangles.add();
    r.geometricBounds = [b.y, b.x, b.y + b.h, b.x + b.w];
    styleItem(r, d, L, TAG_BLOCKS);
    if (p.radius > 0) {
      const rr = Math.min(p.radius, b.w / 2, b.h / 2);
      for (const c of ["topLeft", "topRight", "bottomLeft", "bottomRight"]) { r[c + "CornerOption"] = ID.CornerOptions.ROUNDED_CORNER; r[c + "CornerRadius"] = rr; }
    }
  }
  return pl.blocks.length;
}
// segments that continue one another (the stretched golden spiral) become one open path
function chains(shapes) {
  const out = [];
  let cur = null;
  for (const s of shapes) {
    if (s.t !== "seg") continue;
    const a = [s.x1, s.y1], b = [s.x2, s.y2], last = cur && cur.pts[cur.pts.length - 1];
    if (cur && !!s.hl === cur.hl && Math.abs(last[0] - a[0]) < 1e-6 && Math.abs(last[1] - a[1]) < 1e-6) { cur.pts.push(b); continue; }
    cur = { hl: !!s.hl, pts: [a, b] }; out.push(cur);
  }
  return out;
}
function compArea(page, p) {
  const sz = sizeOf(page);
  if (p.compArea !== "margins") return { x: 0, y: 0, w: sz.w, h: sz.h };
  const pl = Core.plan(p, Object.assign(sz, { side: sideOf(page) }));
  return pl.inner;
}
function compShapes(page, p) {
  return Shared.build("composition", { comp: p.comp, flipX: p.flipX, flipY: p.flipY, compRays: p.compRays }, compArea(page, p)).shapes;
}
function drawComposition(d, page, p) {
  const L = ourLayer(d);
  removeOurItems(page, TAG_COMP);
  let n = 0;
  for (const c of chains(compShapes(page, p))) {
    let it;
    if (c.pts.length === 2) { it = page.graphicLines.add(); it.paths.item(0).entirePath = c.pts; }
    else { it = page.polygons.add(); it.paths.item(0).entirePath = c.pts; it.paths.item(0).pathType = ID.PathType.OPEN_PATH; }
    styleItem(it, d, L, TAG_COMP, c.hl ? 1.2 : 0.75);
    n++;
  }
  return n;
}
function applyBaseline(d, p) {
  if (!(p.baseline > 0)) return false;
  const gp = d.gridPreferences;
  gp.baselineDivision = p.baseline;
  gp.baselineStart = 0;
  gp.baselineGridRelativeOption = ID.BaselineGridRelativeOption.TOP_OF_MARGIN_OF_PAGE;
  gp.baselineGridShown = true;
  return true;
}
function apply() {
  const d = doc();
  if (!d) { setStatus("Open a document first.", true); return; }
  const p = Core.sanitize(P);
  try {
    const r = asOneStep(HIST + " · Apply grid", () => withPoints(d, () => {
      const t = targetPages(d, p.target);
      if (!t.pages.length) throw new Error("No page to apply to.");
      if (p.kind === "composition") {
        let lines = 0;
        for (const pg of t.pages) lines += drawComposition(d, pg, p);
        return { t, comp: lines };
      }
      let guides = 0, blocks = 0;
      for (const pg of t.pages) {
        const r = applyToPage(pg, p, true);
        guides += r.n;
        if (p.blocks) blocks += drawBlocks(d, pg, r.pl, p);
        else removeOurItems(pg, TAG_BLOCKS);
      }
      // pages that use the parent get its margins and columns too (their own guides stay)
      if (t.parent) for (const pg of items(d.pages)) { try { if (pg.appliedMaster && pg.appliedMaster.id === t.parent.id) applyToPage(pg, p, false); } catch (e) { /* ignore */ } }
      const base = applyBaseline(d, p);
      return { t, guides, base, blocks };
    }));
    if (r.comp !== undefined) setStatus(`${Shared.COMPOSITIONS.find((c) => c.id === p.comp).name} on ${r.t.what}: ${r.comp} lines on the non-printing layer "${LAYER_NAME}". One undo step.`);
    else setStatus(`Applied to ${r.t.what}: ${p.colsAs === "native" ? p.cols + " columns" : "column guides"}${p.rows ? ", " + p.rows + " rows" : ""}${r.base ? ", baseline " + p.baseline + " pt" : ""}${r.blocks ? ", " + r.blocks + " blocks" : ""}. One undo step.`);
  } catch (e) { setStatus(String(e && e.message || e), true); }
  refreshDoc();
}
function remove() {
  const d = doc();
  if (!d) return;
  try {
    const n = asOneStep(HIST + " · Remove", () => withPoints(d, () => targetPages(d, P.target).pages.reduce((s, pg) => s + removeOurGuides(pg) + removeOurItems(pg), 0)));
    setStatus(n ? `Removed ${n} guides, blocks and overlay lines. Margins and columns stay – change them in Layout › Margins and Columns.` : "Nothing from MS Grids on these pages.");
  } catch (e) { setStatus(String(e && e.message || e), true); }
}

// ---------------------------------------------------------------- preview: the spread, drawn with boxes
let info = null;   // { name, pages: [{ w, h, side }] } – the pages the preview shows
function readInfo() {
  const d = doc();
  if (!d) return { name: null, pages: [{ w: 595.28, h: 841.89, side: "left" }, { w: 595.28, h: 841.89, side: "right" }] };   // A4 spread
  try {
    return withPoints(d, () => {
      let pages;
      if (P.target === "page") { const pg = activePage(); pages = pg ? [pg] : []; }
      else if (P.target === "parent") { const m = activePage() && activePage().appliedMaster; pages = m && m.isValid ? items(m.pages) : [activePage()]; }
      else pages = items(app.activeWindow.activeSpread.pages);
      return { name: d.name, pages: pages.filter(Boolean).map((pg) => Object.assign(sizeOf(pg), { side: sideOf(pg) })) };
    });
  } catch (e) { return { name: d.name, pages: [{ w: 595.28, h: 841.89, side: "single" }] }; }
}
function drawSpread() {
  const box = $("spread"), host = $("previewBox"), pages = info.pages.length ? info.pages : [{ w: 595.28, h: 841.89, side: "single" }];
  const p = Core.sanitize(P), GAP = 0;
  const totalW = pages.reduce((s, pg) => s + pg.w, 0) + GAP * (pages.length - 1), maxH = Math.max(...pages.map((pg) => pg.h));
  const bw = Math.max(200, host.getBoundingClientRect().width || 312) - 24, bh = 196 - 24;
  const k = Math.min(bw / totalW, bh / maxH);
  box.style.width = Math.round(totalW * k) + "px"; box.style.height = Math.round(maxH * k) + "px";
  let html = "", x = 0, first = null;
  for (const pg of pages) {
    const pl = Core.plan(p, pg), m = pl.margins, px = (v) => (v * k).toFixed(1) + "px";
    let inner = `<div class="mg" style="left:${px(m.left)};top:${px(m.top)};width:${px(pl.inner.w)};height:${px(pl.inner.h)}"></div>`;
    // columns (and modules) as tinted fields
    const rows = p.rows > 0 ? p.rows : 1, rowH = p.rows > 0 ? pl.rowH : pl.inner.h, gy = p.rows > 0 ? pl.gy : 0;
    for (let c = 0; c < p.cols; c++) for (let r = 0; r < rows; r++) {
      inner += `<div class="col" style="left:${px(pl.inner.x + c * (pl.colW + pl.gx))};top:${px(pl.inner.y + r * (rowH + gy))};width:${px(pl.colW)};height:${px(rowH)}"></div>`;
    }
    for (const g of pl.guides) inner += g.dir === "v" ? `<div class="gl" style="left:${px(g.pos)};top:0;width:1px;height:100%"></div>` : `<div class="gl" style="top:${px(g.pos)};left:0;height:1px;width:100%"></div>`;
    if (p.kind === "composition") {
      // overlay lines: thin rotated boxes (UXP panels have no canvas)
      inner = "";
      const A = p.compArea === "margins" ? pl.inner : { x: 0, y: 0, w: pg.w, h: pg.h };
      for (const s of Shared.build("composition", { comp: p.comp, flipX: p.flipX, flipY: p.flipY, compRays: p.compRays }, A).shapes) {
        if (s.t !== "seg") continue;
        const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * k, ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
        inner += `<div class="cl${s.hl ? " hl" : ""}" style="left:${px(s.x1)};top:${px(s.y1)};width:${(L + 1.5).toFixed(1)}px;transform:rotate(${ang.toFixed(2)}deg) translate(-0.75px, -50%)"></div>`;
      }
      html += `<div class="pg" style="left:${px(x)};top:${px((maxH - pg.h) / 2)};width:${px(pg.w)};height:${px(pg.h)}">${inner}</div>`;
      if (!first) first = pl;
      x += pg.w + GAP;
      continue;
    }
    if (p.blocks) for (const b of pl.blocks) inner += `<div class="blk" style="left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};border-radius:${(Math.min(p.radius, b.w / 2, b.h / 2) * k).toFixed(1)}px"></div>`;
    if (pl.baseline) { let n = 0; for (let y = pl.inner.y + pl.baseline.division; y <= pl.inner.y + pl.inner.h + 0.01 && n < 160; y += pl.baseline.division, n++) inner += `<div class="bl" style="top:${px(y)}"></div>`; }
    html += `<div class="pg" style="left:${px(x)};top:${px((maxH - pg.h) / 2)};width:${px(pg.w)};height:${px(pg.h)}">${inner}</div>`;
    if (!first) first = pl;
    x += pg.w + GAP;
  }
  box.innerHTML = html;
  // exact numbers under the preview
  const pl = first;
  $("measure").textContent = p.kind === "composition" ? Shared.COMPOSITIONS.find((c) => c.id === p.comp).name + " – on a non-printing layer" : pl ? [`Column ${fmt(pl.colW)}`, p.cols > 1 ? `gutter ${fmt(pl.gx)}` : "", p.rows ? `row ${fmt(pl.rowH)}` : "", p.baseline && p.rows && p.baselineSnap ? `${Math.round(pl.rowH / p.baseline)} lines per row` : ""].filter(Boolean).join(" · ") : "";
}

// ---------------------------------------------------------------- controls
function stepper(parent, c) {
  const row = document.createElement("div");
  row.className = "step";
  row.innerHTML = `<span class="step-label">${UI.esc(c.label)}</span><div class="step-ctl"><div class="step-btn" data-d="-1">−</div><input class="step-num" type="text"><div class="step-btn" data-d="1">+</div></div>`;
  parent.appendChild(row);
  const num = row.querySelector(".step-num");
  const set = (v) => { v = Math.max(c.min, Math.min(c.max, Math.round(v))); num.value = String(v); if (P[c.key] === v) return; P[c.key] = v; changed(); };
  num.value = String(P[c.key]);
  row.querySelectorAll(".step-btn").forEach((b) => b.addEventListener("click", (e) => set(P[c.key] + Number(b.getAttribute("data-d")) * (e.shiftKey ? 5 : 1))));
  num.addEventListener("change", () => { const v = parseFloat(num.value); set(isFinite(v) ? v : P[c.key]); });
}
function segRow(parent, label, key, options) {
  const row = document.createElement("div"); row.className = "field";
  row.innerHTML = `<span class="field-label">${UI.esc(label)}</span><div class="seg grow"></div>`;
  parent.appendChild(row);
  const el = row.querySelector(".seg");
  UI.seg(el, options, (v) => { P[key] = v; changed(true); });
  UI.syncSeg(el, P[key]);
}
function switchRow(parent, label, key, tip) {
  const id = "sw_" + key, wrap = document.createElement("div");
  wrap.innerHTML = `<div class="switch line" data-for="${id}"${tip ? ` title="${UI.esc(tip)}"` : ""}><span class="knob"></span><span class="sw-label">${UI.esc(label)}</span></div><input type="checkbox" id="${id}" class="hidden">`;
  parent.appendChild(wrap);
  $(id).checked = !!P[key];
  wrap.querySelector(".switch").addEventListener("click", () => { $(id).checked = !$(id).checked; P[key] = $(id).checked; UI.syncSwitches(); changed(true); });
}
const unitLabel = () => (P.unit === "%" ? "%" : P.unit);
const range = (mm, pt, pct) => (P.unit === "%" ? pct : P.unit === "pt" ? pt : mm);
function slider(parent, key, label, max, sub) {
  const s = UI.slider(parent, { label, min: 0, max, step: P.unit === "pt" ? 0.5 : 0.1, unit: unitLabel(), def: Core.DEFAULTS[key] }, { get: () => P[key], set: (v) => { P[key] = v; changed(); }, done: () => save() });
  if (sub) s.row.className += " sub";
}
function renderControls() {
  const g = $("gridControls"); g.innerHTML = "";
  stepper(g, { key: "cols", label: "Columns", min: 1, max: 48 });
  stepper(g, { key: "rows", label: "Rows", min: 0, max: 48 });
  segRow(g, "Units", "unit", [{ id: "mm", name: "mm" }, { id: "pt", name: "pt" }, { id: "%", name: "% of page" }]);
  if (P.cols > 1) slider(g, "gutterX", "Column gutter", range(30, 80, 15));
  if (P.rows > 1 && !(P.baseline > 0 && P.baselineSnap)) slider(g, "gutterY", "Row gutter", range(30, 80, 15));
  segRow(g, "Columns", "colsAs", [{ id: "native", name: "InDesign columns" }, { id: "guides", name: "Ruler guides" }]);
  switchRow(g, "Draw the modules as frames", "blocks", "Frames on the non-printing layer \"MS Grids\" – they show in the layout but not in print or export");
  if (P.blocks) UI.slider(g, { label: "Corner radius", min: 0, max: 40, step: 0.5, unit: "pt", def: 0 }, { get: () => P.radius, set: (v) => { P.radius = v; changed(); }, done: () => save() });

  const m = $("marginControls"); m.innerHTML = "";
  switchRow(m, "Same margin on all sides", "linkMargins");
  slider(m, "mTop", P.linkMargins ? "Margins" : "Top", range(80, 220, 30));
  if (!P.linkMargins) {
    slider(m, "mBottom", "Bottom", range(80, 220, 30), true);
    slider(m, "mInside", "Inside", range(80, 220, 30), true);
    slider(m, "mOutside", "Outside", range(80, 220, 30), true);
  }

  const b = $("baseControls"); b.innerHTML = "";
  UI.slider(b, { label: "Leading", min: 0, max: 36, step: 0.5, unit: "pt", def: 0, tip: "Distance between baselines. 0 = leave the document's baseline grid as it is" }, { get: () => P.baseline, set: (v) => { P.baseline = v; changed(); }, done: () => { save(); renderControls(); } });
  if (P.baseline > 0) switchRow(b, "Snap rows and text area to the baseline", "baselineSnap", "Every row is a whole number of lines with one line between rows, so text in every module shares the same baselines");
  $("baseMeta").textContent = P.baseline > 0 ? P.baseline + " pt" : "off";

  const c = $("compControls"); c.innerHTML = "";
  const row = document.createElement("div"); row.className = "field"; row.innerHTML = `<span class="field-label">Overlay</span><div class="seg grow wrap" id="compSeg"></div>`; c.appendChild(row);
  UI.seg($("compSeg"), Shared.COMPOSITIONS, (v) => { P.comp = v; changed(true); });
  UI.syncSeg($("compSeg"), P.comp);
  segRow(c, "Area", "compArea", [{ id: "page", name: "Whole page" }, { id: "margins", name: "Inside margins" }]);
  if (["spiral", "triangles", "dynamic"].includes(P.comp)) { switchRow(c, "Mirror horizontally", "flipX"); switchRow(c, "Mirror vertically", "flipY"); }
  if (P.comp === "radial") stepper(c, { key: "compRays", label: "Rays", min: 4, max: 72 });
  // which sections belong to the kind of grid
  const comp = P.kind === "composition";
  for (const sec of ["presets", "grid", "baseline"]) { const el = document.querySelector(`.sec[data-sec="${sec}"]`); el.style.display = comp ? "none" : ""; }
  document.querySelector('.sec[data-sec="comp"]').style.display = comp ? "" : "none";
  UI.syncSeg($("kindSeg"), P.kind);
  $("apply").textContent = comp ? "Apply overlay" : "Apply grid";
  UI.syncSwitches();
}
const TARGET_INFO = {
  parent: "The parent page of the current page – every page that uses it gets the grid.",
  page: "Only the current page.",
  spread: "The pages of the current spread.",
  all: "Every page of the document.",
};
function renderTop() {
  UI.syncSeg($("targetSeg"), P.target);
  $("targetInfo").textContent = TARGET_INFO[P.target];
  $("docName").textContent = info && info.name ? info.name : "No document – preview on A4";
}
// presets: tiles with a tiny drawing of one page
function renderPresets() {
  const names = Object.keys(Core.PRESETS), pg = { w: 595.28, h: 841.89, side: "right" };
  $("presetTiles").innerHTML = names.map((n) => {
    const pl = Core.plan(Core.PRESETS[n], pg), k = 46 / pg.h, px = (v) => (v * k).toFixed(1) + "px", pr = Core.sanitize(Core.PRESETS[n]);
    let inner = "";
    const rows = pr.rows > 0 ? pr.rows : 1, rowH = pr.rows > 0 ? pl.rowH : pl.inner.h, gy = pr.rows > 0 ? pl.gy : 0;
    for (let c = 0; c < pr.cols; c++) for (let r = 0; r < rows; r++) inner += `<div class="col" style="left:${px(pl.inner.x + c * (pl.colW + pl.gx))};top:${px(pl.inner.y + r * (rowH + gy))};width:${px(pl.colW)};height:${px(rowH)}"></div>`;
    return `<div class="tile" data-n="${UI.esc(n)}" title="${UI.esc(n)}"><div class="mini"><div class="pg" style="left:50%;margin-left:${px(-pg.w / 2)};top:4px;width:${px(pg.w)};height:${px(pg.h)}">${inner}</div></div><div class="lbl">${UI.esc(n)}</div></div>`;
  }).join("");
  $("presetTiles").querySelectorAll(".tile").forEach((el) => el.addEventListener("click", () => {
    const n = el.getAttribute("data-n");
    P = Core.sanitize(Object.assign({}, P, Core.PRESETS[n], { target: P.target, colsAs: P.colsAs }));
    save(); renderControls(); drawSpread(); setStatus(`Preset "${n}" – click Apply grid.`);
  }));
  $("presetMeta").textContent = names.length + " grids";
  const own = loadOwn();
  UI.presetList($("presetList"), Object.keys(own), (n) => { P = Core.sanitize(Object.assign({}, own[n], { target: P.target })); save(); renderControls(); drawSpread(); },
    (n) => { const o = loadOwn(); delete o[n]; saveOwn(o); renderPresets(); });
}
function loadOwn() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveOwn(o) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }

let drawT = null;
function changed(rebuild) {
  if (rebuild) renderControls();
  clearTimeout(drawT); drawT = setTimeout(() => { save(); drawSpread(); }, 30);
}
function refreshDoc() { info = readInfo(); renderTop(); drawSpread(); }
// follow the active document and page (InDesign panels get no reliable event for page changes)
let lastKey = "";
setInterval(() => {
  let key = "";
  try { const d = doc(), pg = activePage(); key = d ? d.name + "|" + (pg ? pg.name + "|" + (pg.appliedMaster ? pg.appliedMaster.name : "") : "") : ""; } catch (e) { key = "?"; }
  if (key !== lastKey) { lastKey = key; refreshDoc(); }
}, 1200);

// ---------------------------------------------------------------- self-test
function selfTest() {
  const results = [], keep = Object.assign({}, P);
  const check = (name, fn) => { try { const r = fn(); results.push({ name, ok: !!(r && r.ok), r }); } catch (e) { results.push({ name, ok: false, r: String(e && e.stack || e) }); } };
  let d = null;
  try {
    d = app.documents.add();
    const dp = d.documentPreferences;
    withPoints(d, () => { dp.facingPages = true; dp.pageWidth = 595.28; dp.pageHeight = 841.89; dp.pagesPerDocument = 4; });
    const ours = (pg) => items(pg.guides).filter((g) => g.label === LABEL);
    const near = (a, b) => Math.abs(a - b) < 0.05;
    const goTo = (i) => { app.activeWindow.activePage = d.pages.item(i); };

    check("Parent page: 12 InDesign columns and margins", () => {
      goTo(1); P = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS["12 Column"], { target: "parent", colsAs: "native" })); apply();
      return withPoints(d, () => {
        const m = activePage().appliedMaster, mp = m.pages.item(1).marginPreferences;
        return { ok: mp.columnCount === 12 && near(mp.top, 15 * Core.MM) && near(mp.columnGutter, 4 * Core.MM), cols: mp.columnCount, top: mp.top };
      });
    });
    check("Document pages using the parent get the columns", () => withPoints(d, () => { const mp = d.pages.item(2).marginPreferences; return { ok: mp.columnCount === 12, cols: mp.columnCount }; }));
    check("Swiss 6 × 8: row guides on the parent, snapped to the baseline", () => {
      P = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS["Swiss 6 × 8"], { target: "parent" })); apply();
      return withPoints(d, () => {
        const m = activePage().appliedMaster, pg = m.pages.item(1), g = ours(pg), pl = Core.plan(P, Object.assign(sizeOf(pg), { side: sideOf(pg) }));
        const okPos = pl.guides.every((e) => g.some((x) => near(x.location, e.pos)));
        return { ok: g.length === pl.guides.length && okPos && Math.abs(pl.rowH / P.baseline - Math.round(pl.rowH / P.baseline)) < 0.01, n: g.length, expected: pl.guides.length };
      });
    });
    check("Baseline grid set on the document", () => { const gp = d.gridPreferences; return { ok: near(gp.baselineDivision, 11), division: gp.baselineDivision }; });
    check("Apply again: guides are replaced, not doubled", () => {
      apply();
      return withPoints(d, () => { const pg = activePage().appliedMaster.pages.item(1), pl = Core.plan(P, Object.assign(sizeOf(pg), { side: sideOf(pg) })); return { ok: ours(pg).length === pl.guides.length, n: ours(pg).length }; });
    });
    check("This page only, columns as ruler guides – facing pages mirror the margins", () => {
      goTo(1); P = Core.sanitize(Object.assign({}, Core.DEFAULTS, { cols: 2, rows: 0, unit: "mm", gutterX: 5, linkMargins: false, mTop: 10, mBottom: 10, mInside: 20, mOutside: 10, colsAs: "guides", target: "page" })); apply();
      return withPoints(d, () => {
        const pg = d.pages.item(1), side = sideOf(pg), xs = ours(pg).filter((g) => g.orientation === ID.HorizontalOrVertical.VERTICAL).map((g) => g.location).sort((a, b) => a - b);
        const expFirst = (side === "left" ? 10 : 20) * Core.MM;
        return { ok: xs.length >= 4 && near(xs[0], expFirst), side, first: xs[0], expFirst };
      });
    });
    const tagged = (pg, tag) => items(pg.pageItems).filter((it) => it.label === tag);
    check("Blocks: one frame per module on the non-printing layer", () => {
      goTo(1); P = Core.sanitize(Object.assign({}, Core.DEFAULTS, Core.PRESETS["Swiss 6 × 8"], { target: "parent", blocks: true, radius: 4 })); apply();
      const pg = activePage().appliedMaster.pages.item(1), n = tagged(pg, TAG_BLOCKS).length, L = d.layers.itemByName(LAYER_NAME);
      return { ok: n === 48 && L.isValid && L.printable === false, n, printable: L.isValid ? L.printable : null };
    });
    check("Blocks off again: the frames are gone", () => {
      P.blocks = false; apply();
      return { ok: tagged(activePage().appliedMaster.pages.item(1), TAG_BLOCKS).length === 0 };
    });
    check("Composition: dynamic symmetry = 2 diagonals + 4 reciprocals", () => {
      goTo(1); P = Core.sanitize(Object.assign({}, Core.DEFAULTS, { kind: "composition", comp: "dynamic", target: "page" })); apply();
      const n = tagged(d.pages.item(1), TAG_COMP).length; return { ok: n === 6, n };
    });
    check("Composition: golden spiral as a few paths, replacing the overlay", () => {
      P.comp = "spiral"; apply();
      const n = tagged(d.pages.item(1), TAG_COMP).length; return { ok: n > 5 && n < 40, n };
    });
    check("Remove: guides, blocks and overlays on the page", () => { remove(); return { ok: ours(d.pages.item(1)).length === 0 && tagged(d.pages.item(1), TAG_COMP).length === 0 }; });
  } catch (e) { results.push({ name: "Self-test setup", ok: false, r: String(e && e.stack || e) }); }
  P = Core.sanitize(keep); save(); renderControls(); refreshDoc();
  const bad = results.filter((r) => !r.ok);
  try { console.log("MS Grids self-test", JSON.stringify(results)); } catch (e) { /* ignore */ }
  setStatus(`Self-test: ${results.length - bad.length} / ${results.length} ok` + (bad.length ? " – failed: " + bad.map((b) => b.name + " " + JSON.stringify(b.r).slice(0, 160)).join("; ") : ". Close the test document without saving."), bad.length > 0);
}

// ---------------------------------------------------------------- wiring
function init() {
  UI.seg($("kindSeg"), [{ id: "layout", name: "Layout grid" }, { id: "composition", name: "Composition" }], (v) => { P.kind = v; save(); renderControls(); drawSpread(); setStatus(""); });
  UI.seg($("targetSeg"), [{ id: "parent", name: "Parent" }, { id: "page", name: "Page" }, { id: "spread", name: "Spread" }, { id: "all", name: "All" }], (v) => { P.target = v; save(); refreshDoc(); });
  $("apply").addEventListener("click", apply);
  $("remove").addEventListener("click", remove);
  $("resetAll").addEventListener("click", () => { P = Core.sanitize({ target: P.target }); save(); renderControls(); drawSpread(); });
  $("presetSave").addEventListener("click", () => {
    const n = String($("presetName").value).trim();
    if (!n) { setStatus("Type a name for the preset first.", true); return; }
    const o = loadOwn(); o[n] = Object.assign({}, P); saveOwn(o); $("presetName").value = ""; renderPresets(); setStatus(`Saved "${n}".`);
  });
  $("selfTest").addEventListener("click", selfTest);
  UI.sections("msgridsid.sections", { presets: true, grid: true, margins: true, baseline: true, comp: true, more: false });
  renderControls(); renderPresets(); refreshDoc();
}
init();
