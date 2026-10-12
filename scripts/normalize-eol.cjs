// Normalize text files to LF (a Windows checkout converted them to CRLF, which
// breaks shell scripts in Linux containers and gofmt). Keeps .bat/.cmd/.ps1 as CRLF.
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[2] ?? "platform");
const SKIP = new Set(["node_modules", ".git", "dist"]);
const BIN = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|mp4|mov|webm|pdf|zip|gz|tgz|br|wasm|keystore|der|p12|bin|car)$/i;
const KEEP_CRLF = /\.(bat|cmd|ps1)$/i;
let n = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.isFile() && !BIN.test(e.name) && !KEEP_CRLF.test(e.name)) {
      const b = fs.readFileSync(f);
      if (b.includes(0) || !b.includes(13)) continue;
      const s = b.toString("utf8");
      const t = s.replace(/\r\n/g, "\n");
      if (t !== s) { fs.writeFileSync(f, t); n++; }
    }
  }
})(root);
console.log(`normalized ${n} files to LF`);
