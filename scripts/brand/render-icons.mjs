// Renders Pegasusbound icons from the SVG sources in this folder into the fork.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const P = path.resolve("../../platform");
const icon = fs.readFileSync("app-icon.svg");
const mark = fs.readFileSync("mark.svg");
const markWhite = fs.readFileSync("mark-white.svg");

const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

const targets = {
  "web/public": { favicons: [16, 32, 48, 96], apple: true, manifest: [192, 512] },
  "site/public": { favicons: [16, 32, 48, 96], apple: true },
  "admin/public": { favicons: [16, 32], apple: true, extra: { "icon-192.png": 192, "icon-512.png": 512 } },
};

for (const [dir, t] of Object.entries(targets)) {
  const out = path.join(P, dir);
  const icoSources = [];
  for (const s of t.favicons) {
    const buf = await png(icon, s);
    fs.writeFileSync(path.join(out, `favicon-${s}x${s}.png`), buf);
    if (s <= 48) icoSources.push(buf);
  }
  fs.writeFileSync(path.join(out, "favicon.ico"), await pngToIco(icoSources));
  if (t.apple) fs.writeFileSync(path.join(out, "apple-touch-icon.png"), await png(icon, 180));
  for (const s of t.manifest ?? []) fs.writeFileSync(path.join(out, `web-app-manifest-${s}x${s}.png`), await png(icon, s));
  for (const [name, s] of Object.entries(t.extra ?? {})) fs.writeFileSync(path.join(out, name), await png(icon, s));
}

// Site brand assets
const brand = path.join(P, "site/public/brand");
fs.writeFileSync(path.join(brand, "app-icon.png"), await png(icon, 512));
fs.writeFileSync(path.join(brand, "pegasusbound-logo.png"), await png(mark, 512));
fs.writeFileSync(path.join(brand, "pegasusbound-logo-steel.png"), await png(mark, 512));
fs.writeFileSync(path.join(brand, "pegasusbound-logo-white.png"), await png(markWhite, 512));
fs.writeFileSync(path.join(P, "docs/assets/logo-light.svg"), mark);
fs.writeFileSync(path.join(P, "docs/assets/logo-dark.svg"), markWhite);
console.log("icons rendered");
