// Shows the Illustrator panel in a browser. window.__adobe_cep__.evalScript runs the real jsx/host.jsx against
// a small fake of Illustrator's scripting DOM (documents, artboards, layers, groups, paths, guides, selection).
const SCRIPT_END = "</" + "script>";
const f = document.getElementById("frame");
const base = f.getAttribute("data-plugin");

function fakeIllustrator() {
  const E = (names) => Object.fromEntries(names.map((n) => [n, n]));
  const enums = {
    DocumentColorSpace: E(["RGB", "CMYK"]), ExportType: E(["PNG24"]), ElementPlacement: E(["PLACEBEFORE", "PLACEATBEGINNING"]),
    PointType: E(["SMOOTH", "CORNER"]), CoordinateSystem: E(["DOCUMENTCOORDINATESYSTEM", "ARTBOARDCOORDINATESYSTEM"]),
  };
  function RGBColor() { this.red = 0; this.green = 0; this.blue = 0; }
  function ExportOptionsPNG24() {}
  function File(p) { this.fsName = p; this.exists = false; }
  const Folder = { temp: { fsName: "/tmp", getFiles: () => [] } };
  const withMethods = (arr, m) => Object.assign(arr, m);

  // containers: Layer, GroupItem; children[0] is the top of the stacking order
  function container(obj) {
    obj.children = [];
    Object.defineProperty(obj, "pageItems", { get: () => obj.children.slice() });
    Object.defineProperty(obj, "pathItems", { get: () => withMethods(obj.children.filter((c) => c.typename === "PathItem"), {
      add: () => obj._add(pathItem()),
      ellipse: (top, left, w, h) => obj._add(pathItem([[left, top], [left + w, top - h]])),
      rectangle: (top, left, w, h) => obj._add(pathItem([[left, top], [left + w, top - h]])),
      roundedRectangle: (top, left, w, h) => obj._add(pathItem([[left, top], [left + w, top - h]])),
      getByName: (n) => { const r = deep(obj).find((c) => c.typename === "PathItem" && c.name === n); if (!r) throw new Error("No such element"); return r; },
    }) });
    Object.defineProperty(obj, "groupItems", { get: () => withMethods(obj.children.filter((c) => c.typename === "GroupItem"), { add: () => obj._add(groupItem()) }) });
    obj._add = (it) => { it.parent = obj; obj.children.unshift(it); return it; };
    return obj;
  }
  const deep = (c) => { const out = []; for (const k of c.children) { out.push(k); if (k.children) out.push(...deep(k)); } return out; };
  function item(typename) {
    const it = { typename, name: "", note: "", selected: false, opacity: 100, parent: null, guides: false, filled: false, stroked: false, locked: false, hidden: false };
    it.remove = () => { const p = it.parent.children; p.splice(p.indexOf(it), 1); };
    it.move = (target) => { it.remove(); const p = target.parent; p.children.splice(p.children.indexOf(target), 0, it); it.parent = p; };
    Object.defineProperty(it, "layer", { get: () => { let x = it.parent; while (x && x.typename !== "Layer") x = x.parent; return x; } });
    return it;
  }
  function pathItem(pts) {
    const it = item("PathItem");
    it.pathPoints = withMethods([], { add: () => { const pp = { anchor: [0, 0], leftDirection: [0, 0], rightDirection: [0, 0] }; it.pathPoints.push(pp); return pp; } });
    it.setEntirePath = (ps) => { it.pathPoints.length = 0; ps.forEach((p) => it.pathPoints.push({ anchor: p.slice(), leftDirection: p.slice(), rightDirection: p.slice() })); };
    if (pts) it.setEntirePath(pts);
    Object.defineProperty(it, "geometricBounds", { get: () => {
      const xs = it.pathPoints.map((p) => p.anchor[0]), ys = it.pathPoints.map((p) => p.anchor[1]);
      return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
    } });
    return it;
  }
  function groupItem() {
    const it = container(item("GroupItem"));
    it.clipped = false;
    Object.defineProperty(it, "geometricBounds", { get: () => {
      const bs = it.children.map((c) => c.geometricBounds);
      return [Math.min(...bs.map((b) => b[0])), Math.max(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.min(...bs.map((b) => b[3]))];
    } });
    return it;
  }
  function layer(name) { const L = container({ typename: "Layer", name, locked: false, visible: true, layers: [] }); L.remove = () => { const d = L.parent; d._layers.splice(d._layers.indexOf(L), 1); }; return L; }
  let docN = 0;
  function makeDoc(w, h, name) {
    const d = { typename: "Document", name: name || "Untitled-" + (++docN), documentColorSpace: "RGB", _layers: [], _ab: 0 };
    d.artboards = withMethods([{ name: "Artboard 1", artboardRect: [0, 0, w, -h] }], { getActiveArtboardIndex: () => d._ab });
    Object.defineProperty(d, "layers", { get: () => withMethods(d._layers.slice(), {
      add: () => { const L = layer("Layer " + (d._layers.length + 1)); L.parent = d; d._layers.unshift(L); return L; },
      getByName: (n) => { const L = d._layers.find((l) => l.name === n); if (!L) throw new Error("No such element"); return L; },
    }) });
    const all = () => d._layers.flatMap((L) => deep(L));
    Object.defineProperty(d, "groupItems", { get: () => all().filter((c) => c.typename === "GroupItem") });
    Object.defineProperty(d, "pathItems", { get: () => withMethods(all().filter((c) => c.typename === "PathItem"), {
      rectangle: (top, left, w2, h2) => d._layers[d._layers.length - 1]._add(pathItem([[left, top], [left + w2, top - h2]])),
      getByName: (n) => { const r = all().find((c) => c.typename === "PathItem" && c.name === n); if (!r) throw new Error("No such element"); return r; },
    }) });
    // like Illustrator: the topmost selected objects (a selected group hides its children)
    Object.defineProperty(d, "selection", {
      get: () => { const out = []; const walk = (c) => { for (const k of c.children) { if (k.selected) out.push(k); else if (k.children) walk(k); } }; d._layers.forEach(walk); return out; },
      set: (v) => { all().forEach((c) => { c.selected = false; }); if (v) v.forEach((c) => { c.selected = true; }); },
    });
    d.exportFile = () => {};
    const L = layer("Layer 1"); L.parent = d; d._layers.push(L);
    return d;
  }
  const docs = [];
  const app = { coordinateSystem: "ARTBOARDCOORDINATESYSTEM",
    documents: withMethods(docs, { add: (cs, w, h) => { const d = makeDoc(w, h); docs.unshift(d); return d; } }) };
  Object.defineProperty(app, "activeDocument", { get: () => docs[0] });
  // a sample document: A4 poster with a "logo"
  const d = makeDoc(595.28, 841.89, "Poster.ai"); docs.push(d);
  const logo = d.pathItems.rectangle(-300, 200, 200, 120); logo.name = "Logo"; logo.selected = false;
  const env = Object.assign({ app, RGBColor, ExportOptionsPNG24, File, Folder }, enums);
  return env;
}

(async () => {
  const hostSrc = await (await fetch(base + "jsx/host.jsx")).text();
  const html = await (await fetch(base + "index.html")).text();
  const env = fakeIllustrator();
  window.__env = env;
  const names = Object.keys(env);
  const run = new Function(...names, "__code", hostSrc + "\nreturn eval(__code);");
  const cep = { evalScript: (code, cb) => { let r; try { r = run(...names.map((n) => env[n]), code); } catch (e) { console.error(e); r = "EvalScript error."; } setTimeout(() => cb(String(r)), 5); } };
  window.__cep = cep;
  const stub = "<script>window.__adobe_cep__ = parent.__cep;" + SCRIPT_END;
  f.srcdoc = html.replace("<head>", () => `<head><base href="${new URL(base, location.href).href}">` + stub);
})();
