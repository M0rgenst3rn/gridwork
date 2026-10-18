// Creates the plugin icons: a 3 × 3 grid with a bold outer frame.
const fs = require("fs"), path = require("path");
const { encodePNG } = require("./png.js");
const dir = path.join(__dirname, "..", "grids", "icons");
fs.mkdirSync(dir, { recursive: true });
function icon(size, file) {
  const rgba = new Uint8Array(size * size * 4), p = size * 0.14, s = size - 2 * p, lw = Math.max(1, size / 16);
  const lines = [p, p + s / 3, p + 2 * s / 3, p + s];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    if (cx < p - lw || cx > p + s + lw || cy < p - lw || cy > p + s + lw) continue;
    let a = 0;
    for (const [k, l] of lines.entries()) {
      const w = k === 0 || k === 3 ? lw * 1.4 : lw * 0.8, str = k === 0 || k === 3 ? 1 : 0.7;
      a = Math.max(a, Math.max(0, Math.min(1, w / 2 + 0.5 - Math.abs(cx - l))) * str, Math.max(0, Math.min(1, w / 2 + 0.5 - Math.abs(cy - l))) * str);
    }
    const i = (y * size + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 225; rgba[i + 3] = Math.round(a * 255);
  }
  fs.writeFileSync(path.join(dir, file), encodePNG(size, size, rgba, 4));
}
icon(23, "icon@1x.png"); icon(46, "icon@2x.png"); icon(48, "plugin@1x.png"); icon(96, "plugin@2x.png");
console.log("icons written:", fs.readdirSync(dir).join(", "));
