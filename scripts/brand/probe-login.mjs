import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage();
await p.goto("http://localhost:5173/auth/login"); await p.waitForTimeout(3000);
console.log(p.url());
console.log(await p.evaluate(() => [...document.querySelectorAll("input,button")].map(e => `${e.tagName} type=${e.type} name=${e.name} id=${e.id} ph=${e.placeholder} aria=${e.getAttribute("aria-label")} text=${(e.textContent||"").trim().slice(0,30)}`).join("\n")));
await b.close();
