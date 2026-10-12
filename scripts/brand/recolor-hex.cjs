// Swaps hard-coded sky-blue hex colours (SVG strokes, chart fills, gradients)
// for the matching Pegasus violet shade across the dashboard source.
//   node scripts/brand/recolor-hex.cjs
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../platform/web/src");
const MAP = {
  "#f0f9ff": "#f5f3ff",
  "#e0f2fe": "#ede9fe",
  "#bae6fd": "#ddd6fe",
  "#7dd3fc": "#c4b5fd",
  "#38bdf8": "#a78bfa",
  "#0ea5e9": "#8b5cf6",
  "#0284c7": "#7c3aed",
  "#0369a1": "#6d28d9",
  "#075985": "#5b21b6",
  "#0c4a6e": "#4c1d95",
};
const re = new RegExp(Object.keys(MAP).join("|"), "gi");
let files = 0;
let hits = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name)) {
      const s = fs.readFileSync(p, "utf8");
      let n = 0;
      const out = s.replace(re, (m) => (n++, MAP[m.toLowerCase()]));
      if (n) fs.writeFileSync(p, out), files++, (hits += n);
    }
  }
})(ROOT);
console.log(`recoloured ${hits} colours in ${files} files`);
