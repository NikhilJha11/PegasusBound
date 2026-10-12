// Captures the two tour shots that need set-up first: the automation builder
// (creates a sample automation in the demo org) and the mailbox warm-up panel.
//   PLAYWRIGHT_BROWSERS_PATH=D:\DevTools\ms-playwright node capture-extra.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:8080";
const EMAIL = process.env.TOUR_EMAIL ?? "dev@pegasusbound.com";
const PASSWORD = process.env.TOUR_PASSWORD ?? "password123"; // repo demo seed value
const OUT = path.resolve("../../platform/web/src/components/app/tour/shots");
const GUIDES = path.resolve("../../platform/docs/public/guides");

const write = (name, buf) => {
  for (const dir of [OUT, GUIDES]) if (fs.existsSync(path.join(dir, `${name}.webp`))) fs.writeFileSync(path.join(dir, `${name}.webp`), buf);
  console.log(`captured ${name}`);
};

async function hideSelfHostChrome(page) {
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("body *")];
    for (const el of els) {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if ((t.toLowerCase() === "self-hosted" || t === "dev") && el.getBoundingClientRect().width < 200) el.style.display = "none";
    }
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "light" });
const page = await context.newPage();
await page.goto(`${APP}/auth/login`);
await page.locator('input[name="email"]').fill(EMAIL);
await page.getByRole("button", { name: /^continue$/i }).click();
await page.waitForTimeout(2500);
const pw = page.locator('input[type="password"]');
if (await pw.count()) {
  await pw.first().fill(PASSWORD);
  await page.getByRole("button", { name: /continue|sign in|log in/i }).first().click();
}
await page.waitForURL(/\/app\//, { timeout: 30000 });

const api = (method, p, body) =>
  page.evaluate(
    async ({ api, method, p, body }) => {
      const token = localStorage.getItem("access_token");
      const r = await fetch(`${api}/v1${p}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { api: API, method, p, body },
  );

// --- automation builder -----------------------------------------------------
const existing = await api("GET", "/automations");
const arrayIn = (b) => (Array.isArray(b) ? b : Object.values(b ?? {}).find(Array.isArray) ?? []);
const list = arrayIn(existing.body);
let automation = Array.isArray(list) ? list.find((a) => a.name?.startsWith("Positive reply")) : null;
if (!automation) {
  const created = await api("POST", "/automations", {
    name: "Positive reply: open a deal and a task",
    enabled: true,
    trigger_event: "campaign.reply_received",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", x: 0, y: 0 },
        { id: "c1", type: "condition", x: 0, y: 140, condition: { field: "intent", operator: "equals", value: "positive" } },
        { id: "a1", type: "action", x: -120, y: 300, action: "pegasusbound.create_deal", config: { deal_pipeline_id: "dddd0b00-0000-0000-0000-000000000001", deal_stage_id: "dddd0b00-0000-0000-0000-000000000011", deal_title: "{{.contact_company}}" } },
        { id: "a2", type: "action", x: -120, y: 440, action: "pegasusbound.create_task", config: { task_title: "Reply to {{.contact_email}}" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "c1", when: "" },
        { id: "e2", source: "c1", target: "a1", when: "true" },
        { id: "e3", source: "a1", target: "a2", when: "" },
      ],
    },
  });
  if (created.status >= 300) console.error("automation create failed", created.status, JSON.stringify(created.body));
  automation = created.body?.automation ?? created.body?.data ?? created.body;
}
if (automation?.id) {
  await page.goto(`${APP}/app/automations/${automation.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  await hideSelfHostChrome(page);
  write("automation-builder", await sharp(await page.screenshot()).resize(1600, 1000).webp({ quality: 82 }).toBuffer());
}

// --- mailbox warm-up panel --------------------------------------------------
const boxes = await api("GET", "/emails?limit=5");
const box = (boxes.body?.data ?? [])[0];
if (box?.id) {
  await page.goto(`${APP}/app/emails?mailbox=${box.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  // The mailbox detail is a full-height panel docked to the right edge.
  const findPanel = () =>
    page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const c = [...document.querySelectorAll("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.right >= vw - 4 && r.height >= vh * 0.9 && r.width >= 480 && r.width <= vw * 0.7)
        .sort((a, b) => a.r.width - b.r.width)[0];
      return c ? { x: c.r.left, y: c.r.top, width: c.r.width, height: c.r.height } : null;
    });
  let clip = await findPanel();
  if (clip) {
    // Open the Warmup tab inside the panel.
    const tabs = page.getByText("Warmup", { exact: true });
    for (let i = 0; i < (await tabs.count()); i++) {
      const b = await tabs.nth(i).boundingBox();
      if (b && b.x >= clip.x - 300) {
        await tabs.nth(i).scrollIntoViewIfNeeded().catch(() => {});
        await tabs.nth(i).click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(2000);
    clip = (await findPanel()) ?? clip;
  }
  await hideSelfHostChrome(page);
  const shot = clip ? await page.screenshot({ clip }) : await page.screenshot();
  write("mailbox-warmup", await sharp(shot).resize(900, 1120, { fit: "cover", position: "top" }).webp({ quality: 82 }).toBuffer());
}

await browser.close();
