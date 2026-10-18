"use strict";
// Checks for the Illustrator panel without Illustrator: node tools/check-illustrator.js
// The shared files must be the same as the Photoshop panel's; host.jsx must be plain ASCII ES3-style script.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
for (const f of ["core.js", "ms-ui.js", "ms-ui.css"]) ok(fs.readFileSync(path.join(root, "grids", f), "utf8") === fs.readFileSync(path.join(root, "grids-ai", f), "utf8"), f + " is the same as in grids/");
const jsx = fs.readFileSync(path.join(root, "grids-ai/jsx/host.jsx"), "utf8");
ok(!/[^\x00-\x7f]/.test(jsx), "host.jsx is ASCII only (ExtendScript reads files without BOM in the system encoding)");
ok(!/\b(let|const)\s|=>|`/.test(jsx.replace(/\/\/.*$/gm, "")), "host.jsx uses no ES6 (let, const, arrow functions, template strings)");
try { new Function(jsx); ok(true, "host.jsx parses"); } catch (e) { ok(false, "host.jsx parses: " + e.message); }
const man = fs.readFileSync(path.join(root, "grids-ai/CSXS/manifest.xml"), "utf8");
ok(/Host Name="ILST"/.test(man) && /<ScriptPath>\.\/jsx\/host\.jsx<\/ScriptPath>/.test(man), "manifest names Illustrator and host.jsx");
console.log(fails ? fails + " failed" : "all ok");
process.exit(fails ? 1 : 0);
