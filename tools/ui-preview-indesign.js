// Shows the panel UI in a browser (without InDesign): a small fake of InDesign's DOM with one facing-pages
// A4 document, a parent spread, guides, margins and the baseline grid. Good enough to run the self-test.
const SCRIPT_END = "</" + "script>";
const f = document.getElementById("frame");
const base = f.getAttribute("data-plugin");
const noDoc = /nodoc/.test(location.search);

function fakeInDesign() {
  // like InDesign: constants are numbers; values read back are objects that are not === the constants
  let code = 1000;
  const E = (names) => Object.fromEntries(names.map((n) => [n, code++]));
  const back = (E, v) => { const name = Object.keys(E).find((k) => k === String(v) || E[k] === Number(v)); return { valueOf: () => E[name], toString: () => name }; };
  const ID = {
    MeasurementUnits: E(["POINTS", "MILLIMETERS"]), RulerOrigin: E(["PAGE_ORIGIN", "SPREAD_ORIGIN"]),
    HorizontalOrVertical: E(["HORIZONTAL", "VERTICAL"]), PageSideOptions: E(["LEFT_HAND", "RIGHT_HAND", "SINGLE_SIDED"]),
    BaselineGridRelativeOption: E(["TOP_OF_MARGIN_OF_BASELINE_GRID_RELATIVE_OPTION", "TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION"]), ScriptLanguage: E(["UXPSCRIPT"]), UndoModes: E(["ENTIRE_SCRIPT"]),
    ColorModel: E(["PROCESS"]), ColorSpace: E(["RGB"]), CornerOptions: E(["ROUNDED_CORNER", "NONE"]), PathType: E(["OPEN_PATH", "CLOSED_PATH"]),
  };
  // named collections: itemByName returns an invalid object when missing
  const named = (arr, make) => Object.assign(col(arr), {
    itemByName: (n) => arr.find((x) => x.name === n) || { isValid: false },
    add: () => { const o = make(); arr.push(o); return o; },
  });
  const col = (arr) => ({ get length() { return arr.length; }, item: (i) => arr[i], _a: arr });
  let nextId = 1;
  function makeDoc(nPages, facing) {
    const d = { name: "Untitled-" + nextId, isValid: true, viewPreferences: { horizontalMeasurementUnits: "MILLIMETERS", verticalMeasurementUnits: "MILLIMETERS", rulerOrigin: "SPREAD_ORIGIN" },
      gridPreferences: { baselineDivision: 12, baselineStart: 36, baselineGridShown: false, _rel: 0, get baselineGridRelativeOption() { return this._rel; }, set baselineGridRelativeOption(v) { if (v === undefined) throw new Error("Invalid value for baselineGridRelativeOption"); this._rel = v; } }, undoName: "" };
    const W = 595.28, H = 841.89;
    const page = (name, side, master) => {
      const guides = [];
      const pi = [];   // page items: rectangles, graphic lines, polygons
      const pageItem = (kind) => () => {
        const path = { entirePath: [], pathType: "CLOSED_PATH" };
        const it = { kind, label: "", geometricBounds: [0, 0, 0, 0], paths: col([path]), remove: () => pi.splice(pi.indexOf(it), 1) };
        pi.push(it); return it;
      };
      const p = { id: nextId++, name, side, appliedMaster: master, isValid: true, bounds: [0, 0, H, W],
        marginPreferences: { top: 36, bottom: 36, left: 36, right: 36, columnCount: 1, columnGutter: 12 },
        guides: Object.assign(col(guides), { add: () => { let o = ID.HorizontalOrVertical.HORIZONTAL; const g = { get orientation() { return back(ID.HorizontalOrVertical, o); }, set orientation(v) { if (v === undefined) throw new Error("Invalid value for orientation"); o = Number(v); }, location: 0, label: "", fitToPage: false, remove: () => guides.splice(guides.indexOf(g), 1) }; guides.push(g); return g; } }),
        rectangles: { add: pageItem("rectangle") }, graphicLines: { add: pageItem("graphicLine") }, polygons: { add: pageItem("polygon") } };
      Object.defineProperty(p, "pageItems", { get: () => col(pi.slice()) });
      return p;
    };
    const master = { id: nextId++, name: "A-Parent", isValid: true };
    master.pages = col(facing ? [page("A", back(ID.PageSideOptions, "LEFT_HAND"), null), page("A", back(ID.PageSideOptions, "RIGHT_HAND"), null)] : [page("A", back(ID.PageSideOptions, "SINGLE_SIDED"), null)]);
    const pages = [];
    const sideFor = (i) => back(ID.PageSideOptions, !facing ? "SINGLE_SIDED" : i % 2 === 0 ? "RIGHT_HAND" : "LEFT_HAND");
    for (let i = 0; i < nPages; i++) pages.push(page(String(i + 1), sideFor(i), master));
    d.pages = col(pages);
    d.masterSpreads = col([master]);
    d.documentPreferences = {
      get facingPages() { return facing; }, set facingPages(v) { facing = v; },
      set pagesPerDocument(n) { while (pages.length < n) pages.push(page(String(pages.length + 1), sideFor(pages.length), master)); pages.forEach((p, i) => { p.side = sideFor(i); }); },
      pageWidth: W, pageHeight: H,
    };
    d.layers = named([], () => ({ name: "", isValid: true, printable: true, locked: false, visible: true }));
    d.colors = named([], () => ({ name: "", isValid: true }));
    d.swatches = named([{ name: "None", isValid: true }], () => ({}));
    d.spreadOf = (pg) => { const i = pages.indexOf(pg); if (!facing) return [pg]; if (i === 0) return [pages[0]]; const a = i % 2 === 1 ? i : i - 1; return pages.slice(a, a + 2); };
    return d;
  }
  const docs = [];
  const app = { documents: Object.assign(col(docs), { add: () => { const d = makeDoc(1, true); docs.unshift(d); win.doc = d; win.page = d.pages.item(0); return d; } }),
    get activeDocument() { return win.doc; }, activeWindow: null,
    doScript: (fn, lang, args, mode, name) => { fn(); if (win.doc) win.doc.undoName = name; } };
  const win = { doc: null, page: null };
  app.activeWindow = { get activePage() { return win.page; }, set activePage(p) { win.page = p; }, get activeSpread() { return { pages: col(win.doc.spreadOf(win.page)) }; } };
  return { ID, app, win, makeDoc, docs };
}

(async () => {
  const get = async (p) => (await fetch(base + p)).text();
  const html = await get("index.html");
  const main = await get("main.js");
  const mods = {};
  const scan = async (src) => {
    for (const m of src.matchAll(/require\("\.\/([^"]+)"\)/g)) {
      if (mods[m[1]] !== undefined) continue;
      mods[m[1]] = "";
      mods[m[1]] = await get(m[1]);
      await scan(mods[m[1]]);
    }
  };
  await scan(main);
  const defs = Object.keys(mods).map((n) => `window.__defs[${JSON.stringify(n)}] = function (module, exports, require) {\n${mods[n]}\n};`).join("\n");
  const stub = "<script>" + `
  window.__defs = {}; window.__cache = {};
  ` + defs + `
  const F = (` + fakeInDesign.toString() + `)();
  if (!${noDoc}) { const d = F.makeDoc(6, true); F.docs.push(d); F.win.doc = d; F.win.page = d.pages.item(2); d.name = "Magazine.indd"; }
  window.__fake = F;
  const indesign = Object.assign({ app: F.app }, F.ID);
  window.require = (n) => {
    if (n === "indesign") return indesign;
    if (n === "uxp") return { entrypoints: { setup: () => {} } };
    const k = n.replace("./", "");
    if (window.__cache[k]) return window.__cache[k].exports;
    const module = { exports: {} }; window.__cache[k] = module;
    window.__defs[k](module, module.exports, window.require);
    return module.exports;
  };
  ` + SCRIPT_END;
  const doc = html
    .replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, h) => `<link rel="stylesheet" href="${base}${h}">`)
    .replace("<head>", () => `<head><base href="${new URL(base, location.href).href}">`)
    .replace("</head>", () => stub + "</head>")
    .replace('<script src="main.js"></' + 'script>', () => "<script>" + main + SCRIPT_END);
  f.srcdoc = doc;
})();
