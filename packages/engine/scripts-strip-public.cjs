// drizzle-kit qualifies foreign keys with "public". The engine shares the
// platform's database inside its own schema, so references must stay
// unqualified (resolved via search_path) or they'd point at platform tables.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "drizzle");
let n = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, "utf8");
  const t = s.replace(/"public"\./g, "");
  if (t !== s) {
    fs.writeFileSync(p, t);
    n++;
  }
}
console.log(`stripped "public". from ${n} migration(s)`);
