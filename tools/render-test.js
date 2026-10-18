// Renders every preset of every mode onto a test canvas without Photoshop: docs/images/<mode>.png
// node tools/render-test.js [out-dir]
const fs = require("fs"), path = require("path");
const Core = require("../grids/core.js");
const { encodePNG } = require("./png.js");
const OUT = process.argv[2] || path.join(__dirname, "..", "docs", "images");
fs.mkdirSync(OUT, { recursive: true });
const W = 600, H = 400, PAD = 10, COLS = 3, BG = [7, 10, 18], PAPER = [244, 242, 238];
for (const m of Core.MODES) {
  const names = Object.keys(Core.PRESETS[m.id]), rows = Math.ceil(names.length / COLS);
  const SW = W, SH = H, CW = COLS * (SW + PAD) + PAD, CH = rows * (SH + PAD) + PAD;
  const px = new Uint8Array(CW * CH * 3);
  for (let i = 0; i < CW * CH; i++) px.set(BG, i * 3);
  names.forEach((n, k) => {
    const p = Core.sanitize(Object.assign({}, Core.DEFAULTS, { color: "#2f5bff", width: 1.5, output: "layer" }, Core.PRESETS[m.id][n]));
    const area = { x: 0, y: 0, w: SW, h: SH }, ref = { x: 210, y: 130, w: 180, h: 140 };
    const t0 = Date.now(), res = Core.build(m.id, p, area, ref), rgba = Core.raster(res, p, SW, SH, 0, 0, 1);
    const ox = PAD + (k % COLS) * (SW + PAD), oy = PAD + Math.floor(k / COLS) * (SH + PAD);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4, a = rgba[i + 3] / 255, j = ((oy + y) * CW + ox + x) * 3;
      // a fake logo for the logo mode
      const inLogo = m.id === "logo" && Math.hypot((x - 300) / 70, (y - 200) / 55) < 1 && Math.hypot((x - 300) / 35, (y - 200) / 28) > 1;
      const base = inLogo ? [30, 30, 40] : PAPER;
      for (let c = 0; c < 3; c++) px[j + c] = Math.round(base[c] * (1 - a) + rgba[i + c] * a);
    }
    console.log(`${m.id.padEnd(12)} ${n.padEnd(22)} ${res.shapes.length} shapes, ${res.guides.length} guides, ${Date.now() - t0} ms`);
  });
  fs.writeFileSync(path.join(OUT, m.id + ".png"), encodePNG(CW, CH, px, 3));
}
