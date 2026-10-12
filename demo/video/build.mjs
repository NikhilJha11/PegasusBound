// Builds demo/video/pegasusbound-demo.mp4: narration (tts.ps1) + the animated
// page (video.html) recorded at 1080p, muxed with ffmpeg.
//   cd scripts/brand && PLAYWRIGHT_BROWSERS_PATH=D:\DevTools\ms-playwright node ../../demo/video/build.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(DIR, "../../scripts/brand/package.json"));
const { chromium } = require("playwright");
const ffmpeg = require("ffmpeg-static");
const GAP = 0.6;

// 1. Narration: one WAV with a short gap after every line.
const lines = JSON.parse(fs.readFileSync(path.join(DIR, "narration.json"), "utf8"));
const pcm = [];
const timeline = [];
let fmt;
for (const l of lines) {
  const buf = fs.readFileSync(path.join(DIR, "audio", `${l.id}.wav`));
  const dataAt = buf.indexOf("data") + 8;
  fmt ??= buf.subarray(0, dataAt - 8);
  const data = buf.subarray(dataAt);
  const rate = buf.readUInt32LE(28); // bytes per second
  pcm.push(data, Buffer.alloc(Math.round((GAP * rate) / 2) * 2));
  timeline.push({ id: l.id, text: l.caption ?? l.text, dur: data.length / rate + GAP });
}
const audio = Buffer.concat(pcm);
const header = Buffer.from(fmt);
header.writeUInt32LE(36 + audio.length, 4);
const wav = Buffer.concat([header, Buffer.from("data"), Buffer.alloc(4), audio]);
wav.writeUInt32LE(audio.length, header.length + 4);
fs.writeFileSync(path.join(DIR, "narration.wav"), wav);
const total = timeline.reduce((a, s) => a + s.dur, 0);
console.log(`narration ${total.toFixed(1)}s over ${timeline.length} scenes`);

// 2. Record the page.
const raw = path.join(DIR, "raw");
fs.rmSync(raw, { recursive: true, force: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: raw, size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const created = Date.now();
await page.goto(pathToFileURL(path.join(DIR, "video.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const started = Date.now();
await page.evaluate((t) => window.play(t), timeline);
await page.waitForTimeout(total * 1000 + 1200);
await context.close();
await browser.close();
const webm = fs.readdirSync(raw).find((f) => f.endsWith(".webm"));
const offset = (started - created) / 1000;

// 3. Mux: trim the lead-in so the first frame lines up with the narration.
const out = path.join(DIR, "pegasusbound-demo.mp4");
execFileSync(ffmpeg, [
  "-y", "-ss", offset.toFixed(2), "-i", path.join(raw, webm), "-i", path.join(DIR, "narration.wav"),
  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "160k", "-t", (total + 0.8).toFixed(2), "-movflags", "+faststart", out,
], { stdio: "inherit" });
console.log(`wrote ${out}`);
