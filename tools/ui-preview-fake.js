// Shows the panel UI in a browser (without Photoshop): Photoshop/UXP are mocked.
// Open ui-preview.html; it names the plugin folder in data-plugin (e.g. "../glow/").
const SCRIPT_END = "</" + "script>";
const f = document.getElementById("frame");
const base = f.getAttribute("data-plugin");
(async () => {
  const get = async (p) => (await fetch(base + p)).text();
  const html = await get("index.html");
  const main = await get("main.js");
  // collect every local module that main.js (and its modules) load via require("./x.js")
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
  const bmp = (buf, w, h) => { const row = (w * 3 + 3) & ~3, size = 54 + row * h, b = new Uint8Array(size), dv = new DataView(b.buffer);
    b[0] = 66; b[1] = 77; dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, -h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3, o = 54 + y * row + x * 3; b[o] = buf[i + 2]; b[o + 1] = buf[i + 1]; b[o + 2] = buf[i]; }
    let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); };
  window.__bmp = bmp;
  const fakeImaging = { getPixels: async (o) => { const w = o.targetSize.width, h = o.targetSize.height, d = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { d[i*4] = 200; d[i*4+1] = 190 + (i % w) / w * 40; d[i*4+2] = 170; d[i*4+3] = 255; } return { imageData: { width: w, height: h, components: 4, componentSize: 8, getData: async () => d, dispose: () => {} } }; },
    createImageDataFromBuffer: async (buf, o) => ({ buf, w: o.width, h: o.height, dispose: () => {} }), encodeImageData: async (o) => bmp(o.imageData.buf, o.imageData.w, o.imageData.h) };
  const fake = { app: { activeDocument: { id: 1, name: "Test.psd", width: 1200, height: 800, activeLayers: [], layers: [] }, version: "test", documents: [], foregroundColor: { rgb: { red: 0, green: 0, blue: 0 } } }, core: { executeAsModal: async (fn) => fn({ hostControl: { suspendHistory: async () => 1, resumeHistory: async () => {} } }) },
    action: { batchPlay: async () => [{}], addNotificationListener: () => {} }, imaging: fakeImaging, constants: {} };
  const uxp = { storage: { localFileSystem: { getDataFolder: async () => ({ createFile: async () => ({ write: async () => {} }), getEntry: async () => { throw 1; }, getEntries: async () => [] }), getFileForSaving: async () => null }, formats: { utf8: "utf8", binary: "binary" } }, entrypoints: { setup: () => {} } };
  window.require = (n) => {
    if (n === "photoshop") return fake;
    if (n === "uxp") return uxp;
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
