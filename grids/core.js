"use strict";
// Morgenstern Grids – geometry and drawing without Photoshop (runs in the panel and in Node).
// build(mode, params, area, ref) turns the settings into guides and shapes; raster() draws the shapes with
// smooth (anti-aliased) edges into an RGBA buffer. All coordinates are document pixels.
//
// Shapes: { t: "seg", x1, y1, x2, y2, hl }  line (hl = highlighted, drawn a bit stronger)
//         { t: "circle", cx, cy, r }  { t: "arc", cx, cy, r, a0, a1 } (radians, clockwise from +x)
//         { t: "dot", cx, cy, r }     { t: "fill", x, y, w, h }  (column / row fill)

const PHI = (1 + Math.sqrt(5)) / 2;

// ---------------------------------------------------------------- settings
const MODES = [
  { id: "layout", name: "Layout" },
  { id: "logo", name: "Logo" },
  { id: "pattern", name: "Pattern" },
  { id: "perspective", name: "Perspective" },
];
const DEFAULTS = {
  // shared style
  color: "#00b4ff", width: 1, opacity: 100, area: "canvas",
  // layout
  output: "guides", cols: 12, rows: 0, unit: "px", gutterX: 20, gutterY: 20, mTop: 40, mRight: 40, mBottom: 40, mLeft: 40, linkMargins: true,
  baseline: 0, baselineOffset: 0, fillOpacity: 12, draw: "both",
  // logo
  logoBox: true, logoCenter: true, logoDiag: true, logoCircles: true, logoGolden: true, logoSpiral: false, logoSquares: 4, logoExtend: true,
  // pattern
  pattern: "square", size: 40, dotSize: 3, offsetX: 0, offsetY: 0,
  // perspective
  points: "2", horizon: 50, vp1: 15, vp2: 85, vp3: 160, rays: 24, verticals: 12, horizontals: 0,
};
const LIMITS = {
  width: [0.25, 50], opacity: [1, 100], cols: [0, 48], rows: [0, 48], gutterX: [0, 2000], gutterY: [0, 2000],
  mTop: [0, 5000], mRight: [0, 5000], mBottom: [0, 5000], mLeft: [0, 5000], baseline: [0, 500], baselineOffset: [0, 500], fillOpacity: [0, 100],
  logoSquares: [0, 24], size: [4, 2000], dotSize: [0.5, 100], offsetX: [-2000, 2000], offsetY: [-2000, 2000],
  horizon: [-50, 150], vp1: [-300, 400], vp2: [-300, 400], vp3: [-400, 500], rays: [2, 120], verticals: [0, 120], horizontals: [0, 120],
};
const CHOICES = { draw: ["both", "lines", "fills"], output: ["guides", "layer", "both"], unit: ["px", "%"], area: ["canvas", "layer"], pattern: ["square", "dot", "diamond", "triangle", "iso", "hex"], points: ["1", "2", "3"] };
const BOOLS = ["linkMargins", "logoBox", "logoCenter", "logoDiag", "logoCircles", "logoGolden", "logoSpiral", "logoExtend"];
function sanitize(p) {
  const o = Object.assign({}, DEFAULTS);
  if (!p || typeof p !== "object") return o;
  for (const k of Object.keys(DEFAULTS)) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (LIMITS[k]) { const n = Number(v); if (isFinite(n)) o[k] = Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], n)); }
    else if (CHOICES[k]) { if (CHOICES[k].indexOf(String(v)) >= 0) o[k] = String(v); }
    else if (BOOLS.indexOf(k) >= 0) o[k] = !!v;
    else if (k === "color") { if (/^#[0-9a-f]{6}$/i.test(String(v))) o[k] = String(v).toLowerCase(); }
  }
  return o;
}

// Ready-made settings per mode (only the values that differ)
const PRESETS = {
  layout: {
    "12 Column": { cols: 12, rows: 0, unit: "px", gutterX: 20, linkMargins: true, mTop: 40, mRight: 40, mBottom: 40, mLeft: 40, baseline: 0 },
    "6 Column": { cols: 6, rows: 0, unit: "px", gutterX: 24, linkMargins: true, mTop: 48, mRight: 48, mBottom: 48, mLeft: 48 },
    "Rule of Thirds": { cols: 3, rows: 3, unit: "px", gutterX: 0, gutterY: 0, linkMargins: true, mTop: 0, mRight: 0, mBottom: 0, mLeft: 0 },
    "Modular 4 × 4": { cols: 4, rows: 4, unit: "%", gutterX: 2, gutterY: 2, linkMargins: true, mTop: 6, mRight: 6, mBottom: 6, mLeft: 6 },
    "Swiss 6 × 8": { cols: 6, rows: 8, unit: "%", gutterX: 1.5, gutterY: 1.2, linkMargins: false, mTop: 5, mRight: 5, mBottom: 8, mLeft: 5 },
    "Golden Canon": { cols: 1, rows: 1, unit: "%", gutterX: 0, gutterY: 0, mTop: 11.11, mRight: 22.22, mBottom: 22.22, mLeft: 11.11, linkMargins: false },
    "Magazine + Baseline": { cols: 4, rows: 0, unit: "%", gutterX: 2, linkMargins: false, mTop: 7, mRight: 6, mBottom: 9, mLeft: 6, baseline: 14, baselineOffset: 0 },
    "Social Post 3 × 3": { cols: 3, rows: 3, unit: "%", gutterX: 1, gutterY: 1, linkMargins: true, mTop: 4, mRight: 4, mBottom: 4, mLeft: 4 },
    "Center Lines": { cols: 2, rows: 2, unit: "px", gutterX: 0, gutterY: 0, linkMargins: true, mTop: 0, mRight: 0, mBottom: 0, mLeft: 0 },
  },
  logo: {
    "Full Construction": { logoBox: true, logoCenter: true, logoDiag: true, logoCircles: true, logoGolden: true, logoSpiral: false, logoSquares: 4, logoExtend: true },
    "Golden Ratio": { logoBox: true, logoCenter: false, logoDiag: false, logoCircles: false, logoGolden: true, logoSpiral: true, logoSquares: 0, logoExtend: false },
    "Circles Only": { logoBox: false, logoCenter: true, logoDiag: false, logoCircles: true, logoGolden: true, logoSpiral: false, logoSquares: 0, logoExtend: false },
    "Square Grid": { logoBox: true, logoCenter: true, logoDiag: false, logoCircles: false, logoGolden: false, logoSpiral: false, logoSquares: 8, logoExtend: true },
    "Minimal": { logoBox: true, logoCenter: true, logoDiag: true, logoCircles: false, logoGolden: false, logoSpiral: false, logoSquares: 0, logoExtend: false },
  },
  pattern: {
    "Square 40": { pattern: "square", size: 40 }, "Fine Square 10": { pattern: "square", size: 10 }, "Dot Grid": { pattern: "dot", size: 32, dotSize: 2.5 },
    "Isometric": { pattern: "iso", size: 40 }, "Triangles": { pattern: "triangle", size: 48 }, "Hexagons": { pattern: "hex", size: 36 }, "Diamonds": { pattern: "diamond", size: 40 },
  },
  perspective: {
    "1-Point Room": { points: "1", horizon: 50, vp1: 50, rays: 24, verticals: 10, horizontals: 8 },
    "2-Point Street": { points: "2", horizon: 45, vp1: -20, vp2: 120, rays: 24, verticals: 14 },
    "2-Point Close": { points: "2", horizon: 50, vp1: 15, vp2: 85, rays: 20, verticals: 10 },
    "3-Point Worm's Eye": { points: "3", horizon: 85, vp1: 0, vp2: 100, vp3: -120, rays: 20 },
    "3-Point Bird's Eye": { points: "3", horizon: 15, vp1: 0, vp2: 100, vp3: 220, rays: 20 },
  },
};

// ---------------------------------------------------------------- geometry helpers
// area: { x, y, w, h } in document pixels
const seg = (x1, y1, x2, y2, hl) => ({ t: "seg", x1, y1, x2, y2, hl: !!hl });
// infinite line through (px, py) with direction (dx, dy), clipped to the rectangle -> segment or null
function clipLine(px, py, dx, dy, r) {
  let t0 = -Infinity, t1 = Infinity;
  const slab = (p, d, lo, hi) => {
    if (Math.abs(d) < 1e-12) return p >= lo && p <= hi;
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(px, dx, r.x, r.x + r.w) || !slab(py, dy, r.y, r.y + r.h)) return null;
  return seg(px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1);
}
// ray from (px, py) in direction (dx, dy), clipped to the rectangle
function clipRay(px, py, dx, dy, r) {
  const s = clipLine(px, py, dx, dy, r);
  if (!s) return null;
  const t = (x, y) => (Math.abs(dx) > Math.abs(dy) ? (x - px) / dx : (y - py) / dy);
  let a = t(s.x1, s.y1), b = t(s.x2, s.y2);
  if (a > b) { const tmp = a; a = b; b = tmp; }
  if (b < 0) return null;
  a = Math.max(0, a);
  return seg(px + dx * a, py + dy * a, px + dx * b, py + dy * b);
}
// a family of parallel lines: angle (degrees), spacing between lines, through point (ox, oy)
function family(angle, spacing, ox, oy, r) {
  const a = angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => (x - ox) * nx + (y - oy) * ny);
  const lo = Math.ceil(Math.min(...corners) / spacing), hi = Math.floor(Math.max(...corners) / spacing), out = [];
  for (let k = lo; k <= hi; k++) { const s = clipLine(ox + nx * k * spacing, oy + ny * k * spacing, dx, dy, r); if (s) out.push(s); }
  return out;
}

// ---------------------------------------------------------------- the four grid kinds
function layout(p, A) {
  const ux = p.unit === "%" ? A.w / 100 : 1, uy = p.unit === "%" ? A.h / 100 : 1;
  const mT = p.mTop * uy, mB = (p.linkMargins ? p.mTop : p.mBottom) * uy;
  const mL = (p.linkMargins ? p.mTop : p.mLeft) * ux, mR = (p.linkMargins ? p.mTop : p.mRight) * ux;
  const inner = { x: A.x + mL, y: A.y + mT, w: Math.max(0, A.w - mL - mR), h: Math.max(0, A.h - mT - mB) };
  const guides = [], shapes = [], fills = [];
  const v = (x) => guides.push({ dir: "v", pos: x }), hz = (y) => guides.push({ dir: "h", pos: y });
  // margins
  if (mL > 0 || mR > 0 || mT > 0 || mB > 0) { v(inner.x); v(inner.x + inner.w); hz(inner.y); hz(inner.y + inner.h); }
  // columns: edges of every column
  const gx = p.gutterX * ux, gy = p.gutterY * uy;
  if (p.cols > 0) {
    const cw = (inner.w - gx * (p.cols - 1)) / p.cols;
    for (let i = 0; i < p.cols; i++) {
      const x0 = inner.x + i * (cw + gx);
      if (i > 0 || mL > 0) v(x0);
      if (i < p.cols - 1 || mR > 0) v(x0 + cw);
      if (gx === 0 && i > 0) { /* shared edge already added */ }
      fills.push({ t: "fill", x: x0, y: inner.y, w: cw, h: inner.h });
    }
  }
  if (p.rows > 0) {
    const rh = (inner.h - gy * (p.rows - 1)) / p.rows;
    for (let i = 0; i < p.rows; i++) {
      const y0 = inner.y + i * (rh + gy);
      if (i > 0 || mT > 0) hz(y0);
      if (i < p.rows - 1 || mB > 0) hz(y0 + rh);
      if (!(p.cols > 0)) fills.push({ t: "fill", x: inner.x, y: y0, w: inner.w, h: rh });
    }
  }
  // the area's own edges as lines on the layer (guides at the canvas edge are pointless)
  const uniq = (list) => { const seen = new Set(); return list.filter((g) => { const k = g.dir + Math.round(g.pos * 100); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const main = uniq(guides);
  for (const g of main) shapes.push(g.dir === "v" ? seg(g.pos, A.y, g.pos, A.y + A.h) : seg(A.x, g.pos, A.x + A.w, g.pos));
  // baseline grid: layer lines (and guides) every n px inside the margins
  const base = [];
  if (p.baseline > 0) {
    const step = p.baseline * (p.unit === "%" ? 1 : 1);
    for (let y = inner.y + p.baselineOffset + step; y <= inner.y + inner.h + 0.001; y += step) { base.push({ dir: "h", pos: y }); shapes.push(Object.assign(seg(inner.x, y, inner.x + inner.w, y), { thin: true })); }
  }
  return { guides: main.concat(base), shapes, fills, inner };
}

function logo(p, A, ref) {
  const R = ref || A, shapes = [];
  const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  if (p.logoExtend) {
    for (const x of [R.x, R.x + R.w]) shapes.push(Object.assign(seg(x, A.y, x, A.y + A.h), { thin: true }));
    for (const y of [R.y, R.y + R.h]) shapes.push(Object.assign(seg(A.x, y, A.x + A.w, y), { thin: true }));
  }
  if (p.logoBox) { shapes.push(seg(R.x, R.y, R.x + R.w, R.y, true), seg(R.x + R.w, R.y, R.x + R.w, R.y + R.h, true), seg(R.x + R.w, R.y + R.h, R.x, R.y + R.h, true), seg(R.x, R.y + R.h, R.x, R.y, true)); }
  if (p.logoCenter) shapes.push(seg(cx, R.y, cx, R.y + R.h), seg(R.x, cy, R.x + R.w, cy));
  if (p.logoDiag) {
    shapes.push(seg(R.x, R.y, R.x + R.w, R.y + R.h), seg(R.x + R.w, R.y, R.x, R.y + R.h));
    // the square's diagonals too when the box is wide or tall
    const s = Math.min(R.w, R.h);
    if (Math.abs(R.w - R.h) > 1) {
      const x0 = cx - s / 2, y0 = cy - s / 2;
      shapes.push(Object.assign(seg(x0, y0, x0 + s, y0 + s), { thin: true }), Object.assign(seg(x0 + s, y0, x0, y0 + s), { thin: true }));
    }
  }
  if (p.logoCircles) {
    const s = Math.min(R.w, R.h);
    shapes.push({ t: "circle", cx, cy, r: s / 2 }, { t: "circle", cx, cy, r: Math.hypot(R.w, R.h) / 2 });
    if (Math.abs(R.w - R.h) > 1) {
      // circles in both ends of a wide (or tall) box
      if (R.w > R.h) shapes.push({ t: "circle", cx: R.x + s / 2, cy, r: s / 2 }, { t: "circle", cx: R.x + R.w - s / 2, cy, r: s / 2 });
      else shapes.push({ t: "circle", cx, cy: R.y + s / 2, r: s / 2 }, { t: "circle", cx, cy: R.y + R.h - s / 2, r: s / 2 });
    }
  }
  if (p.logoGolden) {
    // circles whose diameters step down by the golden ratio, sitting on the box's base line
    let d = Math.min(R.w, R.h);
    for (let k = 0; k < 5; k++) { shapes.push({ t: "circle", cx, cy: R.y + R.h - d / 2, r: d / 2 }); d /= PHI; }
  }
  if (p.logoSpiral) {
    // golden rectangle subdivision with its spiral, fitted into the box
    let x = R.x, y = R.y, w = R.w, h = R.h;
    for (let k = 0; k < 9 && w > 1 && h > 1; k++) {
      const dir = k % 4;
      if (dir === 0) { const s = Math.min(h, w); shapes.push(seg(x + s, y, x + s, y + h)); shapes.push({ t: "arc", cx: x + s, cy: y + s, r: s, a0: Math.PI, a1: Math.PI * 1.5 }); x += s; w -= s; }
      else if (dir === 1) { const s = Math.min(w, h); shapes.push(seg(x, y + s, x + w, y + s)); shapes.push({ t: "arc", cx: x, cy: y + s, r: s, a0: Math.PI * 1.5, a1: Math.PI * 2 }); y += s; h -= s; }
      else if (dir === 2) { const s = Math.min(h, w); shapes.push(seg(x + w - s, y, x + w - s, y + h)); shapes.push({ t: "arc", cx: x + w - s, cy: y + h - s, r: s, a0: 0, a1: Math.PI * 0.5 }); w -= s; }
      else { const s = Math.min(w, h); shapes.push(seg(x, y + h - s, x + w, y + h - s)); shapes.push({ t: "arc", cx: x + w, cy: y + h - s, r: s, a0: Math.PI * 0.5, a1: Math.PI }); h -= s; }
    }
  }
  if (p.logoSquares > 0) {
    const step = Math.min(R.w, R.h) / p.logoSquares;
    for (let x = cx % step; x <= A.x + A.w; x += step) if (x >= R.x - 0.01 && x <= R.x + R.w + 0.01) shapes.push(Object.assign(seg(x, R.y, x, R.y + R.h), { thin: true }));
    for (let y = cy % step; y <= A.y + A.h; y += step) if (y >= R.y - 0.01 && y <= R.y + R.h + 0.01) shapes.push(Object.assign(seg(R.x, y, R.x + R.w, y), { thin: true }));
  }
  return { guides: [], shapes, fills: [] };
}

function pattern(p, A) {
  const s = p.size, ox = A.x + p.offsetX, oy = A.y + p.offsetY, shapes = [];
  const h3 = s * Math.sqrt(3) / 2;
  if (p.pattern === "square") shapes.push(...family(0, s, ox, oy, A), ...family(90, s, ox, oy, A));
  else if (p.pattern === "diamond") shapes.push(...family(45, s / Math.SQRT2, ox, oy, A), ...family(135, s / Math.SQRT2, ox, oy, A));
  else if (p.pattern === "triangle") shapes.push(...family(0, h3, ox, oy, A), ...family(60, h3, ox, oy, A), ...family(120, h3, ox, oy, A));
  else if (p.pattern === "iso") shapes.push(...family(90, h3, ox, oy, A), ...family(30, h3, ox, oy, A), ...family(150, h3, ox, oy, A));
  else if (p.pattern === "dot") {
    const x0 = ox - Math.ceil((ox - A.x) / s) * s, y0 = oy - Math.ceil((oy - A.y) / s) * s;
    for (let y = y0; y <= A.y + A.h + 0.001; y += s) for (let x = x0; x <= A.x + A.w + 0.001; x += s) if (x >= A.x - 0.001 && y >= A.y - 0.001) shapes.push({ t: "dot", cx: x, cy: y, r: p.dotSize });
  } else if (p.pattern === "hex") {
    // flat-topped hexagons, side = size / 2
    const r = s / 2, w = r * 1.5, hh = r * Math.sqrt(3);
    const c0 = Math.floor((A.x - ox) / w) - 1, c1 = Math.ceil((A.x + A.w - ox) / w) + 1;
    const r0 = Math.floor((A.y - oy) / hh) - 1, r1 = Math.ceil((A.y + A.h - oy) / hh) + 1;
    const pts = [0, 1, 2, 3, 4, 5].map((k) => [Math.cos(k * Math.PI / 3) * r, Math.sin(k * Math.PI / 3) * r]);
    for (let c = c0; c <= c1; c++) for (let rr = r0; rr <= r1; rr++) {
      const cx = ox + c * w, cy = oy + rr * hh + (c & 1 ? hh / 2 : 0);
      // three edges per hexagon (the other three belong to the neighbours)
      for (const k of [0, 1, 2]) {
        const a = pts[k], b = pts[(k + 1) % 6];
        const sg = clipSeg(cx + a[0], cy + a[1], cx + b[0], cy + b[1], A);
        if (sg) shapes.push(sg);
      }
    }
  }
  return { guides: [], shapes, fills: [] };
}
function clipSeg(x1, y1, x2, y2, r) {
  const l = clipLine(x1, y1, x2 - x1, y2 - y1, r);
  if (!l) return null;
  // keep the part between t=0 and t=1
  const dx = x2 - x1, dy = y2 - y1, t = (x, y) => (Math.abs(dx) > Math.abs(dy) ? (x - x1) / dx : (y - y1) / dy);
  let a = t(l.x1, l.y1), b = t(l.x2, l.y2);
  if (a > b) { const tmp = a; a = b; b = tmp; }
  a = Math.max(0, a); b = Math.min(1, b);
  if (a >= b) return null;
  return seg(x1 + dx * a, y1 + dy * a, x1 + dx * b, y1 + dy * b);
}

function perspective(p, A) {
  const shapes = [], hy = A.y + A.h * p.horizon / 100;
  const vps = [{ x: A.x + A.w * p.vp1 / 100, y: hy }];
  if (p.points !== "1") vps.push({ x: A.x + A.w * p.vp2 / 100, y: hy });
  if (p.points === "3") vps.push({ x: A.x + A.w * ((p.vp1 + p.vp2) / 200), y: A.y + A.h * p.vp3 / 100 });
  const hz = clipLine(A.x, hy, 1, 0, A);
  if (hz) { hz.hl = true; shapes.push(hz); }
  // rays: evenly spaced angles over the part of the area each vanishing point sees
  for (const vp of vps) {
    const angs = [[A.x, A.y], [A.x + A.w, A.y], [A.x, A.y + A.h], [A.x + A.w, A.y + A.h]].map(([x, y]) => Math.atan2(y - vp.y, x - vp.x));
    const e = 0.5, inside = vp.x > A.x + e && vp.x < A.x + A.w - e && vp.y > A.y + e && vp.y < A.y + A.h - e;   // on the edge counts as outside
    let a0, a1;
    if (inside) { a0 = -Math.PI; a1 = Math.PI; }
    else {
      // unwrap around the direction to the area's centre so the span is continuous
      const mid = Math.atan2(A.y + A.h / 2 - vp.y, A.x + A.w / 2 - vp.x);
      const rel = angs.map((a) => { let d = a - mid; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; });
      a0 = mid + Math.min(...rel); a1 = mid + Math.max(...rel);
    }
    const n = p.rays, full = inside;
    for (let k = 0; k < n; k++) {
      const a = full ? a0 + (a1 - a0) * k / n : a0 + (a1 - a0) * (k + 0.5) / n;
      const r = clipRay(vp.x, vp.y, Math.cos(a), Math.sin(a), A);
      if (r) shapes.push(r);
    }
  }
  // verticals (1- and 2-point), evenly across the area; horizontals for 1-point rooms
  if (p.points !== "3" && p.verticals > 0) for (let k = 1; k <= p.verticals; k++) { const x = A.x + A.w * k / (p.verticals + 1); shapes.push(Object.assign(seg(x, A.y, x, A.y + A.h), { thin: true })); }
  if (p.points === "1" && p.horizontals > 0) for (let k = 1; k <= p.horizontals; k++) { const y = A.y + A.h * k / (p.horizontals + 1); shapes.push(Object.assign(seg(A.x, y, A.x + A.w, y), { thin: true })); }
  return { guides: [], shapes, fills: [], vps };
}

function build(mode, params, area, ref) {
  const p = sanitize(params);
  if (mode === "logo") return logo(p, area, ref);
  if (mode === "pattern") return pattern(p, area);
  if (mode === "perspective") return perspective(p, area);
  return layout(p, area);
}

// ---------------------------------------------------------------- drawing
// Draws shapes into an RGBA buffer of size w*h whose top-left sits at document point (ox, oy), scaled by k
// (k < 1 for the panel preview). Lines are anti-aliased; overlapping lines don't get darker.
function raster(res, p, w, h, ox, oy, k) {
  p = sanitize(p); k = k || 1;
  const cov = new Float32Array(w * h), fill = new Float32Array(w * h);
  const lw = Math.max(0.6, p.width * k);
  const X = (x) => (x - ox) * k, Y = (y) => (y - oy) * k;
  // crisp 1-pixel lines: axis-aligned lines with an odd width sit on pixel centres
  const snap = (v) => (Math.round(lw) % 2 === 1 && Math.abs(lw - Math.round(lw)) < 0.01 ? Math.floor(v) + 0.5 : Math.round(v));
  const put = (i, c) => { if (c > cov[i]) cov[i] = c; };
  function line(x1, y1, x2, y2, width, strength) {
    if (x1 === x2) { x1 = x2 = snap(x1); } else if (y1 === y2) { y1 = y2 = snap(y1); }
    const R = width / 2 + 0.5, dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1e-9;
    const yA = Math.max(0, Math.floor(Math.min(y1, y2) - R)), yB = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + R));
    const len = Math.sqrt(L2), nx = -dy / len, ny = dx / len;
    for (let y = yA; y <= yB; y++) {
      const py = y + 0.5;
      let xa, xb;
      if (Math.abs(nx) > 1e-6) {
        // |nx*(px-x1) + ny*(py-y1)| <= R  ->  px range
        const c = ny * (py - y1);
        let a = x1 + (-R - c) / nx, b = x1 + (R - c) / nx;
        if (a > b) { const t = a; a = b; b = t; }
        xa = Math.max(a, Math.min(x1, x2) - R); xb = Math.min(b, Math.max(x1, x2) + R);
      } else { xa = Math.min(x1, x2) - R; xb = Math.max(x1, x2) + R; }
      const i0 = Math.max(0, Math.floor(xa - 0.5)), i1 = Math.min(w - 1, Math.ceil(xb));
      for (let x = i0; x <= i1; x++) {
        const px = x + 0.5;
        let t = ((px - x1) * dx + (py - y1) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
        const c = Math.min(1, width / 2 + 0.5 - d);
        if (c > 0) put(y * w + x, c * strength);
      }
    }
  }
  function ring(cx, cy, r, a0, a1, width) {
    const R = width / 2 + 0.5, yA = Math.max(0, Math.floor(cy - r - R)), yB = Math.min(h - 1, Math.ceil(cy + r + R));
    const arc = a0 !== undefined;
    for (let y = yA; y <= yB; y++) {
      const dy = y + 0.5 - cy, ox2 = (r + R) * (r + R) - dy * dy;
      if (ox2 < 0) continue;
      const oxr = Math.sqrt(ox2), ir2 = (r - R) * (r - R) - dy * dy, ixr = r > R && ir2 > 0 ? Math.sqrt(ir2) : 0;
      for (const [s0, s1] of [[cx - oxr, cx - ixr], [cx + ixr, cx + oxr]]) {
        const i0 = Math.max(0, Math.floor(s0 - 0.5)), i1 = Math.min(w - 1, Math.ceil(s1));
        for (let x = i0; x <= i1; x++) {
          const ddx = x + 0.5 - cx, d = Math.abs(Math.hypot(ddx, dy) - r);
          const c = Math.min(1, width / 2 + 0.5 - d);
          if (c <= 0) continue;
          if (arc) { let a = Math.atan2(dy, ddx); if (a < 0) a += 2 * Math.PI; if (a < a0 - 1e-9 || a > a1 + 1e-9) continue; }
          put(y * w + x, c);
        }
      }
    }
  }
  function dot(cx, cy, r) {
    const yA = Math.max(0, Math.floor(cy - r - 1)), yB = Math.min(h - 1, Math.ceil(cy + r + 1));
    const xA = Math.max(0, Math.floor(cx - r - 1)), xB = Math.min(w - 1, Math.ceil(cx + r + 1));
    for (let y = yA; y <= yB; y++) for (let x = xA; x <= xB; x++) { const c = Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)); if (c > 0) put(y * w + x, c); }
  }
  const lines = p.draw !== "fills" || !(res.fills && res.fills.length), fills = p.draw !== "lines";
  for (const s of lines ? res.shapes : []) {
    if (s.t === "seg") line(X(s.x1), Y(s.y1), X(s.x2), Y(s.y2), s.hl ? lw * 1.6 : lw, s.thin ? 0.55 : 1);
    else if (s.t === "circle") ring(X(s.cx), Y(s.cy), s.r * k, undefined, undefined, lw);
    else if (s.t === "arc") ring(X(s.cx), Y(s.cy), s.r * k, s.a0, s.a1, lw);
    else if (s.t === "dot") dot(X(s.cx), Y(s.cy), Math.max(0.5, s.r * k));
  }
  if (fills && p.fillOpacity > 0) for (const f of res.fills || []) {
    const x0 = X(f.x), y0 = Y(f.y), x1 = X(f.x + f.w), y1 = Y(f.y + f.h);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      const cy = Math.min(1, y + 1 - y0, y1 - y);
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) fill[y * w + x] = Math.max(fill[y * w + x], Math.max(0, Math.min(cy, x + 1 - x0, x1 - x)));
    }
  }
  const n = parseInt(p.color.slice(1), 16), cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;
  const out = new Uint8Array(w * h * 4), op = p.opacity / 100, fo = p.fillOpacity / 100;
  for (let i = 0; i < w * h; i++) {
    const a = Math.max(cov[i] * op, fill[i] * fo * op);
    if (a <= 0) continue;
    out[i * 4] = cr; out[i * 4 + 1] = cg; out[i * 4 + 2] = cb; out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

module.exports = { MODES, DEFAULTS, PRESETS, sanitize, build, raster, layout, logo, pattern, perspective, clipLine, family, PHI };
