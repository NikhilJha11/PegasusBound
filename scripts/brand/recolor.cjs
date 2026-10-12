// Re-hues the dashboard's accent ramp ("sky" utilities) to the Pegasusbound
// violet in every theme block of theme-dark.css. Idempotent.
//   node scripts/brand/recolor.cjs
const fs = require("fs");
const path = require("path");
const file = path.resolve(__dirname, "../../platform/web/src/styles/theme-dark.css");
const HUE = 292;
let s = fs.readFileSync(file, "utf8");
let n = 0;
s = s.replace(/(--color-sky-\d+:\s*oklch\()([\d.]+%)\s+([\d.]+)\s+([\d.]+)/g, (_, pre, l, c, h) => {
  n++;
  const chroma = Math.min(0.27, Number(c) * 1.35).toFixed(3);
  return `${pre}${l} ${chroma} ${HUE}`;
});
// Focus rings and selection used the old sky-400.
s = s.replace(/oklch\(74\.6% 0\.16 232\.661/g, () => (n++, `oklch(72% 0.2 ${HUE}`));
fs.writeFileSync(file, s);
console.log(`recoloured ${n} values`);
