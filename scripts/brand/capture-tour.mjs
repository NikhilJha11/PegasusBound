// Re-captures the product tour screenshots from the rebranded app.
//   PLAYWRIGHT_BROWSERS_PATH=D:\DevTools\ms-playwright node capture-tour.mjs [--probe]
// Needs the local stack running and the demo seed loaded
// (`docker compose --profile seed run --rm seed`). Logs in as a seeded demo user.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:18025";
const EMAIL = process.env.TOUR_EMAIL ?? "dev@pegasusbound.com";
const PASSWORD = process.env.TOUR_PASSWORD ?? "password123"; // repo demo seed value
const OUT = path.resolve("../../platform/web/src/components/app/tour/shots");
const GUIDES = path.resolve("../../platform/docs/public/guides");
const probe = process.argv.includes("--probe");

async function latestLoginCode(since) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${EMAIL}`)}&limit=5`).then((r) => r.json());
    const msg = (res.messages ?? []).find((m) => new Date(m.Created).getTime() >= since);
    if (msg) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json());
      const code = (full.Text ?? "").match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("No login code arrived in Mailpit");
}

async function login(page) {
  await page.goto(`${APP}/auth/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  const started = Date.now() - 2000;
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForTimeout(2500);
  // Step two is a password and/or an emailed code, depending on instance settings.
  const pw = page.locator('input[type="password"]');
  if (await pw.count()) {
    await pw.first().fill(PASSWORD);
    await page.getByRole("button", { name: /continue|sign in|log in/i }).first().click();
    await page.waitForTimeout(2500);
  }
  if (page.url().includes("/confirm") || (await page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]').count())) {
    const code = await latestLoginCode(started);
    const boxes = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]');
    if ((await boxes.count()) > 1) for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code[i]);
    else await boxes.first().fill(code);
    await page.waitForTimeout(2500);
  }
  await page.waitForURL(/\/app\//, { timeout: 30000 });
}

// Shot name → dashboard route (first campaign / first automation resolved at runtime).
const SHOTS = [
  ["accounts", "/app/emails"],
  ["sending-domains", "/app/emails/domains"],
  ["campaigns", "/app/campaigns"],
  ["contacts", "/app/contacts"],
  ["analytics", "/app/analytics"],
  ["deliverability", "/app/deliverability"],
  ["unibox", "/app/unibox"],
  ["deals", "/app/crm/deals"],
  ["automations", "/app/automations"],
];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  // Close any tour / dialog that opened on first visit.
  for (const name of [/skip/i, /close/i]) {
    const b = page.getByRole("button", { name });
    if (await b.count()) await b.first().click().catch(() => {});
  }
  await page.keyboard.press("Escape").catch(() => {});
  // Hide self-host-only chrome that a hosted SaaS user never sees:
  // the SELF-HOSTED / dev badges and the "Pegasusbound Cloud" pool upsells.
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("body *")];
    for (const el of els) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      // A small badge whose whole text is the label (icon children allowed).
      if ((t.toLowerCase() === "self-hosted" || t === "dev") && el.getBoundingClientRect().width < 200) el.style.display = "none";
    }
    for (const el of els) {
      const t = el.textContent ?? "";
      if (/Pegasusbound Cloud/.test(t) && el.children.length && el.getBoundingClientRect().height < 140 && el.getBoundingClientRect().height > 30) {
        el.style.display = "none";
      }
    }
  });
  await page.waitForTimeout(500);
}

async function save(page, name, size = { width: 1600, height: 1000 }) {
  const png = await page.screenshot({ type: "png" });
  const webp = await sharp(png).resize(size.width, size.height, { fit: "cover", position: "top" }).webp({ quality: 82 }).toBuffer();
  for (const dir of [OUT, GUIDES]) if (fs.existsSync(path.join(dir, `${name}.webp`))) fs.writeFileSync(path.join(dir, `${name}.webp`), webp);
  console.log(`captured ${name}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: "light" });
const page = await context.newPage();
await login(page);
// Mark the product tour as done for this demo user, so it never covers a shot.
await page.evaluate(async (api) => {
  const token = localStorage.getItem("access_token");
  await fetch(`${api}/v1/auth/me/product-tour`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
}, process.env.API_URL ?? "http://localhost:8080");
await page.reload();
await page.waitForTimeout(2000);
if (probe) {
  console.log("logged in at", page.url());
  await page.screenshot({ path: "probe.png" });
  await browser.close();
  process.exit(0);
}

for (const [name, route] of SHOTS) {
  await page.goto(`${APP}${route}`);
  await settle(page);
  await save(page, name);
}

// Campaign detail and steps: the first campaign in the list.
await page.goto(`${APP}/app/campaigns`);
await settle(page);
const firstCampaign = page.locator('a[href^="/app/campaigns/"]').first();
const href = await firstCampaign.getAttribute("href");
if (href) {
  await page.goto(`${APP}${href}`);
  await settle(page);
  await save(page, "campaign-overview");
  await page.goto(`${APP}${href}/steps`);
  await settle(page);
  await save(page, "campaign-steps");
}

// Automation builder: the first automation.
await page.goto(`${APP}/app/automations`);
await settle(page);
const firstAutomation = page.locator('a[href^="/app/automations/"]').first();
const aHref = await firstAutomation.getAttribute("href").catch(() => null);
if (aHref) {
  await page.goto(`${APP}${aHref}`);
  await settle(page);
  await save(page, "automation-builder");
}

// Add-account dialog.
await page.goto(`${APP}/app/emails`);
await settle(page);
await page.getByRole("button", { name: /add account/i }).first().click().catch(() => {});
await page.waitForTimeout(1200);
await save(page, "add-account");

// Mailbox warm-up panel: open the first mailbox, portrait crop.
await page.keyboard.press("Escape");
await page.goto(`${APP}/app/emails`);
await settle(page);
await page.locator("table tbody tr").first().click().catch(() => {});
await page.waitForTimeout(1500);
const panel = page.locator('[role="dialog"], [data-state="open"]').last();
if (await panel.count()) {
  const png = await panel.screenshot({ type: "png" });
  const webp = await sharp(png).resize(900, 1120, { fit: "cover", position: "top" }).webp({ quality: 82 }).toBuffer();
  for (const dir of [OUT, GUIDES]) if (fs.existsSync(path.join(dir, "mailbox-warmup.webp"))) fs.writeFileSync(path.join(dir, "mailbox-warmup.webp"), webp);
  console.log("captured mailbox-warmup");
}

// Assistant avatar: the new brand mark.
const avatar = await sharp(fs.readFileSync("app-icon.svg"), { density: 384 }).resize(256, 256).webp({ quality: 90 }).toBuffer();
fs.writeFileSync(path.join(OUT, "pegasusbound-avatar.webp"), avatar);
console.log("rendered avatar");

await browser.close();
