// Gridwork for Illustrator - the Illustrator side (ExtendScript, ES3).
// The panel does all the maths and sends finished shapes in document coordinates; this file only reads the
// document (artboard, selection, grids) and draws. Every function returns a JSON string.

var MSG_LAYER = "Gridwork", MSG_GUIDES = "Gridwork \u00b7 Guides", MSG_NOTE = "gridwork:", MSG_GNOTE = "gridwork-guides:";

// ---------------------------------------------------------------- JSON out (ExtendScript has no JSON object)
function msgJSON(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/[\u0000-\u001f\u2028\u2029]/g, function (c) { var h = c.charCodeAt(0).toString(16); return "\\u" + "0000".substr(h.length) + h; }) + '"';
  }
  var out = [], i;
  if (v instanceof Array) { for (i = 0; i < v.length; i++) out.push(msgJSON(v[i])); return "[" + out.join(",") + "]"; }
  for (var k in v) if (v.hasOwnProperty(k)) out.push(msgJSON(k) + ":" + msgJSON(v[k]));
  return "{" + out.join(",") + "}";
}
function msgErr(e) { return msgJSON({ error: String(e && e.message ? e.message : e) }); }

// every function reads and writes document coordinates, whatever the script setting was
function msgRun(fn) {
  var keep = null;
  try { keep = app.coordinateSystem; app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM; } catch (e) { keep = null; }
  try { return fn(); } catch (e) { return msgErr(e); }
  finally { if (keep !== null) { try { app.coordinateSystem = keep; } catch (e) { /* ignore */ } } }
}

// ---------------------------------------------------------------- reading
function msgDoc() { return app.documents.length ? app.activeDocument : null; }
function msgIsGrid(it) { try { return it.typename === "GroupItem" && String(it.note).indexOf(MSG_NOTE) === 0; } catch (e) { return false; } }
function msgGridOf(it) {
  try { while (it && it.typename !== "Layer" && it.typename !== "Document") { if (msgIsGrid(it)) return it; it = it.parent; } } catch (e) { /* ignore */ }
  return null;
}
function msgIsOurGuide(it) { try { return String(it.note).indexOf(MSG_GNOTE) === 0; } catch (e) { return false; } }
// bounds without strokes; a clipping group counts with its clipping path only
function msgBounds(it) {
  if (it.typename === "GroupItem" && it.clipped) {
    for (var i = 0; i < it.pageItems.length; i++) { var c = it.pageItems[i]; try { if (c.clipping || (c.typename === "CompoundPathItem" && c.pathItems.length && c.pathItems[0].clipping)) return c.geometricBounds; } catch (e) { /* ignore */ } }
  }
  return it.geometricBounds;
}
// the selection: either one of our grids (to edit it) or the bounds of everything else that is selected
function msgSelection(d) {
  var sel = d.selection, grid = null, b = null;
  if (!sel || !(sel instanceof Array)) return { grid: null, ref: null };
  for (var i = 0; i < sel.length; i++) {
    var it = sel[i], g = msgGridOf(it);
    if (g) { grid = g; continue; }
    if (msgIsOurGuide(it)) continue;
    try { if (it.guides) continue; } catch (e) { /* ignore */ }
    var r = msgBounds(it);
    if (!b) b = [r[0], r[1], r[2], r[3]];
    else { b[0] = Math.min(b[0], r[0]); b[1] = Math.max(b[1], r[1]); b[2] = Math.max(b[2], r[2]); b[3] = Math.min(b[3], r[3]); }
  }
  return { grid: grid, ref: b };
}
function msg_info() {
  return msgRun(function () {
    var d = msgDoc();
    if (!d) return msgJSON({ doc: false });
    var i = d.artboards.getActiveArtboardIndex(), a = d.artboards[i], abs = [];
    for (var k = 0; k < d.artboards.length; k++) abs.push(d.artboards[k].artboardRect);
    var s = msgSelection(d), name = "";
    if (s.grid) name = s.grid.name;
    else if (d.selection && d.selection.length === 1) { try { name = d.selection[0].name || d.selection[0].typename; } catch (e) { /* ignore */ } }
    else if (d.selection && d.selection.length > 1) name = d.selection.length + " objects";
    return msgJSON({ doc: true, name: d.name, ab: i, abName: a.name, r: a.artboardRect, abs: abs, ref: s.ref, refName: name, grid: s.grid ? String(s.grid.note) : null,
      rgb: d.documentColorSpace === DocumentColorSpace.RGB });
  });
}
// every grid in the document: its settings (note)
function msg_grids() {
  return msgRun(function () {
    var d = msgDoc(), out = [];
    if (!d) return msgJSON([]);
    for (var i = 0; i < d.groupItems.length; i++) { var g = d.groupItems[i]; if (msgIsGrid(g)) out.push(String(g.note)); }
    return msgJSON(out);
  });
}
// the active artboard as a small PNG for the panel's preview
function msg_preview(maxW, maxH) {
  return msgRun(function () {
    var d = msgDoc();
    if (!d) return msgJSON({ doc: false });
    var r = d.artboards[d.artboards.getActiveArtboardIndex()].artboardRect, w = r[2] - r[0], h = r[1] - r[3];
    var scale = Math.max(1, Math.min(776, Math.min(maxW / w, maxH / h) * 100));
    var old = Folder.temp.getFiles("gridwork-preview*.png");
    for (var i = 0; i < old.length; i++) { try { old[i].remove(); } catch (e) { /* ignore */ } }
    var f = new File(Folder.temp.fsName + "/gridwork-preview.png");
    var o = new ExportOptionsPNG24();
    o.antiAliasing = true; o.transparency = false; o.artBoardClipping = true; o.horizontalScale = scale; o.verticalScale = scale;
    d.exportFile(f, ExportType.PNG24, o);
    // some versions add the artboard's name or number to the file name
    if (!f.exists) { var c = Folder.temp.getFiles("gridwork-preview*.png"); if (c.length) f = c[0]; }
    return msgJSON({ path: f.exists ? f.fsName : null, w: w, h: h });
  });
}

// ---------------------------------------------------------------- drawing
function msgLayer(d, name, create) {
  var L = null;
  try { L = d.layers.getByName(name); } catch (e) { L = null; }
  if (!L && create) { L = d.layers.add(); L.name = name; }
  if (L) { L.locked = false; L.visible = true; }
  return L;
}
function msgColor(c) { var col = new RGBColor(); col.red = c[0]; col.green = c[1]; col.blue = c[2]; return col; }
function msgFindGrid(d, id) {
  if (!id) return null;
  var key = '"id":"' + id + '"';
  for (var i = 0; i < d.groupItems.length; i++) { var g = d.groupItems[i]; if (msgIsGrid(g) && String(g.note).indexOf(key) >= 0) return g; }
  return null;
}
function msgRemoveGuides(d, ab) {
  var L = msgLayer(d, MSG_GUIDES, false), n = 0;
  if (!L) return 0;
  for (var i = L.pathItems.length - 1; i >= 0; i--) { var p = L.pathItems[i]; if (String(p.note) === MSG_GNOTE + ab) { p.remove(); n++; } }
  if (!L.pageItems.length) L.remove();
  return n;
}
// P: { ab, guides: { lines: [[x1,y1,x2,y2]...], replace }, grid: { name, note, id, replaceId, color, width, opacity, fillOpacity, items } }
// items: ["l", x1, y1, x2, y2, opacity, widthFactor] line | ["b", closed, opacity, [ax,ay,lx,ly,rx,ry]...] curve
//        ["pl", opacity, widthFactor, [x,y]...] polyline | ["rr", left, top, w, h, radius, filled] rounded rectangle
//        ["e", left, top, w, h, filled] circle / dot | ["r", left, top, w, h] column fill
function msg_apply(P) {
  return msgRun(function () {
    var d = msgDoc();
    if (!d) throw new Error("Open a document first.");
    var out = { ok: true };
    if (P.guides) {
      if (P.guides.replace) msgRemoveGuides(d, P.ab);
      var GL = msgLayer(d, MSG_GUIDES, true);
      for (var i = 0; i < P.guides.lines.length; i++) {
        var g = P.guides.lines[i], p = GL.pathItems.add();
        p.setEntirePath([[g[0], g[1]], [g[2], g[3]]]);
        p.note = MSG_GNOTE + P.ab; p.guides = true;
      }
      out.guides = P.guides.lines.length;
    }
    if (P.grid) {
      var G = P.grid, old = msgFindGrid(d, G.replaceId), L = msgLayer(d, MSG_LAYER, true);
      if (old) { try { old.parent.locked = false; } catch (e) { /* ignore */ } }
      var grp = L.groupItems.add(), col = msgColor(G.color), n = 0;
      grp.name = G.name;
      for (var j = 0; j < G.items.length; j++) {
        var it = G.items[j], t = it[0], s;
        if (t === "l") {
          s = grp.pathItems.add(); s.setEntirePath([[it[1], it[2]], [it[3], it[4]]]);
          s.filled = false; s.stroked = true; s.strokeColor = col; s.strokeWidth = G.width * it[6];
          if (it[5] < 100) s.opacity = it[5];
        } else if (t === "b") {
          s = grp.pathItems.add();
          for (var k = 3; k < it.length; k++) { var q = it[k], pp = s.pathPoints.add(); pp.anchor = [q[0], q[1]]; pp.leftDirection = [q[2], q[3]]; pp.rightDirection = [q[4], q[5]]; pp.pointType = PointType.SMOOTH; }
          s.closed = !!it[1]; s.filled = false; s.stroked = true; s.strokeColor = col; s.strokeWidth = G.width;
          if (it[2] < 100) s.opacity = it[2];
        } else if (t === "e") {
          s = grp.pathItems.ellipse(it[2], it[1], it[3], it[4]);
          if (it[5]) { s.filled = true; s.fillColor = col; s.stroked = false; }
          else { s.filled = false; s.stroked = true; s.strokeColor = col; s.strokeWidth = G.width; }
        } else if (t === "rr") {
          // rounded rectangle (module block): outline or fill
          s = grp.pathItems.roundedRectangle(it[2], it[1], it[3], it[4], it[5], it[5]);
          if (it[6]) { s.filled = true; s.fillColor = col; s.stroked = false; s.opacity = G.fillOpacity; }
          else { s.filled = false; s.stroked = true; s.strokeColor = col; s.strokeWidth = G.width; }
        } else if (t === "pl") {
          // open polyline: ["pl", opacity, widthFactor, [x, y], ...]
          var pts = [];
          for (var m = 3; m < it.length; m++) pts.push([it[m][0], it[m][1]]);
          s = grp.pathItems.add(); s.setEntirePath(pts);
          s.filled = false; s.stroked = true; s.strokeColor = col; s.strokeWidth = G.width * it[2];
          if (it[1] < 100) s.opacity = it[1];
        } else if (t === "r") {
          s = grp.pathItems.rectangle(it[2], it[1], it[3], it[4]);
          s.filled = true; s.fillColor = col; s.stroked = false; s.opacity = G.fillOpacity;
        } else continue;
        n++;
      }
      grp.opacity = G.opacity;
      grp.note = G.note;
      // an update takes the old grid's place in the stacking order
      var wasSelected = false;
      if (old) { try { wasSelected = old.selected; } catch (e) { /* ignore */ } grp.move(old, ElementPlacement.PLACEBEFORE); old.remove(); }
      // a new grid is selected; when fitting, the selection stays as it was
      if (G.select !== false) { d.selection = null; grp.selected = true; } else if (wasSelected) grp.selected = true;
      out.items = n;
    }
    return msgJSON(out);
  });
}
function msg_removeGrid(id) {
  return msgRun(function () {
    var d = msgDoc(), g = d && msgFindGrid(d, id);
    if (!g) throw new Error("Select a grid (\"Gridwork \u00b7 \u2026\") to remove it.");
    var L = g.layer;
    g.remove();
    try { if (L.name === MSG_LAYER && !L.pageItems.length && !L.layers.length) L.remove(); } catch (e) { /* ignore */ }
    return msgJSON({ ok: true });
  });
}
function msg_clearGuides() {
  return msgRun(function () {
    var d = msgDoc();
    if (!d) return msgJSON({ n: 0 });
    return msgJSON({ n: msgRemoveGuides(d, d.artboards.getActiveArtboardIndex()) });
  });
}

// ---------------------------------------------------------------- self-test helpers
function msg_testNew() {
  return msgRun(function () {
    var d = app.documents.add(DocumentColorSpace.RGB, 1200, 800), r = d.artboards[0].artboardRect;
    var logo = d.pathItems.rectangle(r[1] - 300, r[0] + 450, 300, 200);
    logo.name = "Logo"; logo.filled = true; logo.fillColor = msgColor([30, 40, 90]); logo.stroked = false;
    d.selection = null; logo.selected = true;
    return msgJSON({ r: r });
  });
}
function msg_testSelect(what) {
  return msgRun(function () {
    var d = msgDoc(); d.selection = null;
    if (what === "logo") d.pathItems.getByName("Logo").selected = true;
    return msgJSON({ ok: true });
  });
}
// what the test checks: our guides on artboard 0 and every grid with its item count and bounds
function msg_testState() {
  return msgRun(function () {
    var d = msgDoc(), L = msgLayer(d, MSG_GUIDES, false), guides = [], grids = [];
    if (L) for (var i = 0; i < L.pathItems.length; i++) { var p = L.pathItems[i]; if (p.guides) guides.push([p.pathPoints[0].anchor[0], p.pathPoints[0].anchor[1], p.pathPoints[1].anchor[0], p.pathPoints[1].anchor[1]]); }
    for (var j = 0; j < d.groupItems.length; j++) { var g = d.groupItems[j]; if (msgIsGrid(g)) grids.push({ note: String(g.note), n: g.pageItems.length, b: g.geometricBounds, sel: g.selected }); }
    return msgJSON({ guides: guides, grids: grids, r: d.artboards[0].artboardRect });
  });
}
function msg_testResize() {
  return msgRun(function () {
    var d = msgDoc(), r = d.artboards[0].artboardRect;
    d.artboards[0].artboardRect = [r[0] - 150, r[1] + 50, r[2] + 150, r[3] - 50];
    return msgJSON({ r: d.artboards[0].artboardRect });
  });
}
