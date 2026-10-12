// Renders docs/PRD.md into a styled single HTML page for sharing.
//   node scripts/brand/prd-page.cjs <out.html>
const fs = require("fs");
const path = require("path");
const md = fs.readFileSync(path.resolve(__dirname, "../../docs/PRD.md"), "utf8");
const out = process.argv[2];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, "$1<em>$2</em>");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const lines = md.split("\n");
const html = [];
const toc = [];
let i = 0;
let title = "";
let meta = [];
while (i < lines.length) {
  const l = lines[i];
  if (l.startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
    i++;
    html.push(`<pre class="diagram"><code>${esc(buf.join("\n"))}</code></pre>`);
    continue;
  }
  if (l.startsWith("# ")) {
    title = l.slice(2).trim();
    i++;
    continue;
  }
  if (/^\*\*(Product|Owner|Status|Last updated):\*\*/.test(l)) {
    meta.push(l.replace(/^\*\*([^*]+):\*\*\s*/, (_, k) => `<dt>${k}</dt><dd>`) + "</dd>");
    i++;
    continue;
  }
  if (l.startsWith("## ")) {
    const t = l.slice(3).trim();
    const id = slug(t);
    toc.push({ id, t });
    html.push(`<h2 id="${id}">${inline(t)}</h2>`);
    i++;
    continue;
  }
  if (l.startsWith("### ")) {
    html.push(`<h3>${inline(l.slice(4).trim())}</h3>`);
    i++;
    continue;
  }
  if (l.trim() === "---") {
    i++;
    continue;
  }
  if (l.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html.push(
      `<div class="table"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`,
    );
    continue;
  }
  if (/^(\d+\.|-)\s/.test(l)) {
    const ordered = /^\d+\./.test(l);
    const items = [];
    while (i < lines.length && /^(\s*)(\d+\.|-)\s/.test(lines[i])) {
      const m = lines[i].match(/^(\s*)(\d+\.|-)\s(.*)$/);
      if (m[1].length) items[items.length - 1].sub.push(m[3]);
      else items.push({ t: m[3], sub: [] });
      i++;
    }
    const tag = ordered ? "ol" : "ul";
    html.push(`<${tag}>${items.map((it) => `<li>${inline(it.t)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</${tag}>`);
    continue;
  }
  if (l.trim() === "") {
    i++;
    continue;
  }
  const para = [];
  while (i < lines.length && lines[i].trim() && !/^(#|\||```|-\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
  html.push(`<p>${inline(para.join(" "))}</p>`);
}

const page = `<title>Pegasusbound PRD</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: a fixed contents rail beside one reading column; violet brand accent from the product. */
:root {
  --bg: #fbfaff; --surface: #ffffff; --fg: #1c1a33; --muted: #5f5c80; --line: #e7e4f5;
  --accent: #6d3df5; --accent-soft: #f1ecff; --code-bg: #f4f2fc;
  --display: "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif;
  --body: "Inter", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e0d18; --surface: #15132a; --fg: #ece9ff; --muted: #a29fc4; --line: #29264a;
  --accent: #a78bfa; --accent-soft: #221d44; --code-bg: #1b1834; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e0d18; --surface: #15132a; --fg: #ece9ff; --muted: #a29fc4; --line: #29264a;
  --accent: #a78bfa; --accent-soft: #221d44; --code-bg: #1b1834; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 16px/1.65 var(--body); padding-inline: 20px; }
.wrap { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 56px; padding-block: 48px 96px; }
nav { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 24px); align-self: start; font-size: 13.5px; }
nav .mark { display: flex; align-items: center; gap: 10px; font: 800 17px var(--display); margin-bottom: 22px; }
nav .mark span { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #5b3df5, #8b4cf6 55%, #d946ef); display: grid; place-items: center; color: #fff; font-size: 14px; }
nav ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 2px; counter-reset: s; }
nav a { display: block; padding: 5px 10px; border-radius: 7px; color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { background: var(--accent-soft); color: var(--fg); outline: none; }
main { min-width: 0; }
header { padding-bottom: 28px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.eyebrow { font: 600 12px var(--body); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
h1 { font: 800 clamp(34px, 5vw, 48px)/1.08 var(--display); letter-spacing: -.02em; margin: 10px 0 18px; text-wrap: balance; }
dl { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0; font-size: 14px; }
dl div { display: flex; gap: 8px; }
dt { color: var(--muted); }
dd { margin: 0; font-weight: 500; }
h2 { font: 700 26px/1.25 var(--display); letter-spacing: -.01em; margin: 56px 0 14px; padding-top: 8px; text-wrap: balance; scroll-margin-top: 24px; }
h3 { font: 700 18px var(--display); margin: 30px 0 10px; }
p, li { max-width: 68ch; }
p { margin: 0 0 14px; }
ul, ol { padding-left: 22px; margin: 0 0 16px; display: grid; gap: 6px; }
li::marker { color: var(--accent); }
strong { font-weight: 600; }
code { font: 500 .88em var(--mono); background: var(--code-bg); padding: 1px 6px; border-radius: 5px; }
.table { overflow-x: auto; margin: 6px 0 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; font-variant-numeric: tabular-nums; }
th { text-align: left; font: 600 12px var(--body); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--accent-soft); }
th, td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
td:first-child { font-weight: 500; }
pre.diagram { overflow-x: auto; background: var(--code-bg); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; font: 13px/1.5 var(--mono); }
pre.diagram code { background: none; padding: 0; }
.note { margin-top: 56px; padding: 16px 18px; border-radius: 12px; background: var(--accent-soft); color: var(--muted); font-size: 14px; }
@media (max-width: 860px) { .wrap { grid-template-columns: 1fr; gap: 24px; } nav { position: static; } nav ol { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); } }
</style>
<div class="wrap">
  <nav aria-label="Contents">
    <div class="mark"><span aria-hidden="true">✦</span>Pegasusbound</div>
    <ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.t)}</a></li>`).join("")}</ol>
  </nav>
  <main>
    <header>
      <div class="eyebrow">Product requirements document</div>
      <h1>${esc(title.split(":")[0])}: the self-learning outbound engine</h1>
      <dl>${meta.map((m) => `<div>${m}</div>`).join("")}</dl>
    </header>
    ${html.join("\n    ")}
    <p class="note">Section 10 reports a simulation on dummy data (1,000 synthetic prospects, simulated sender). It measures the engine's behaviour, not real-world reply rates.</p>
  </main>
</div>`;
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${toc.length} sections)`);
