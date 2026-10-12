// Screenshots of the Bridged demo workspace, light and dark, for review and the demo video.
//   PLAYWRIGHT_BROWSERS_PATH=D:\DevTools\ms-playwright node shots.mjs <outDir> [route ...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5180";
const API = process.env.API_URL ?? "http://localhost:8080";
const creds = JSON.parse(fs.readFileSync(path.resolve("../../platform/.demo-credentials"), "utf8"));
const out = path.resolve(process.argv[2] ?? "shots");
const themes = (process.env.THEMES ?? "light,dark").split(",");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultNavigationTimeout(180000);
await page.goto(`${APP}/auth/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[name="email"]').waitFor({ timeout: 180000 });
await page.locator('input[name="email"]').fill(creds.email);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(2000);
await page.locator('input[type="password"]').first().fill(creds.password);
await page.getByRole("button", { name: /continue|sign in|log in/i }).first().click();
await page.waitForURL(/\/app\//, { timeout: 90000 }).catch(async (e) => {
  await page.screenshot({ path: path.join(out, "fail.png") });
  console.log("url", page.url());
  throw e;
});
await page.evaluate(async (api) => {
  const token = localStorage.getItem("access_token");
  await fetch(`${api}/v1/auth/me/product-tour`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
}, API);

// Resolve the demo campaign ids so routes can say {audience}, {revenue}, {product}.
const list = await page.evaluate(async (api) => {
  const token = localStorage.getItem("access_token");
  const r = await fetch(`${api}/v1/intel/campaigns`, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}, API);
const rows = list.campaigns ?? list.rows ?? list;
const idOf = (prefix) => (Array.isArray(rows) ? rows : []).find((c) => (c.name ?? c.campaign?.name ?? "").startsWith(prefix))?.campaign?.id ?? "";
const ids = { audience: idOf("Audience"), revenue: idOf("Revenue"), founders: idOf("Founders"), product: idOf("Product") };
fs.writeFileSync(path.join(out, "ids.json"), JSON.stringify(ids, null, 2));
const rankings = {};
for (const [k, id] of Object.entries(ids)) {
  if (!id) continue;
  rankings[k] = await page.evaluate(
    async ({ api, id }) => {
      const token = localStorage.getItem("access_token");
      const r = await fetch(`${api}/v1/intel/campaigns/${id}/ranking`, { headers: { Authorization: `Bearer ${token}` } });
      return r.json();
    },
    { api: API, id },
  );
}
fs.writeFileSync(path.join(out, "rankings.json"), JSON.stringify(rankings, null, 2));
// Self-host-only chrome a hosted user never sees.
const hideChrome = () =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if ((t.toLowerCase() === "self-hosted" || t === "dev") && el.getBoundingClientRect().width < 200) el.style.display = "none";
    }
  });

const routes = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["/app/intelligence", "/app/intelligence/knowledge", "/app/intelligence/{audience}", "/app/intelligence/memory"];

for (const theme of themes) {
  await page.evaluate((t) => localStorage.setItem("theme", t), theme);
  for (const r of routes) {
    const url = r.replace(/\{(\w+)\}/g, (_, k) => ids[k]);
    await page.goto(`${APP}${url}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1800);
    await page.keyboard.press("Escape").catch(() => {});
    await hideChrome();
    const name = `${theme}-${r.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
    await page.screenshot({ path: path.join(out, name) });
    console.log("shot", name);
  }
}
await browser.close();
