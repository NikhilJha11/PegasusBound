// Demo workspace, phase 1: the "Nikhil · Bridged" account on the local stack,
// Intelligence turned on, and the Bridged knowledge documents uploaded through
// the real API (backend proxy → intel → document pipeline).
//   npx tsx scripts/demo/account.ts
// Credentials are generated once and kept in platform/.demo-credentials (gitignored).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API = process.env.API_URL ?? "http://localhost:8080";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:18025";
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CREDS = path.join(ROOT, "platform/.demo-credentials");
const DOCS = path.join(ROOT, "demo/bridged/docs");
const EMAIL = process.env.DEMO_EMAIL ?? "nikhil@bridged.media";

type Creds = { email: string; password: string; orgId?: string };

function loadCreds(): Creds {
  if (fs.existsSync(CREDS)) return JSON.parse(fs.readFileSync(CREDS, "utf8"));
  const c = { email: EMAIL, password: `${crypto.randomBytes(12).toString("base64url")}!9a` };
  fs.writeFileSync(CREDS, JSON.stringify(c, null, 2));
  return c;
}

async function call<T = any>(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const r = await fetch(`${API}/v1${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: r.status, body: parsed };
}

async function mailCode(to: string, since: number) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=5`).then((r) => r.json());
    const msg = (res.messages ?? []).find((m: any) => new Date(m.Created).getTime() >= since);
    if (msg) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json());
      const code = String(full.Text ?? "").match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No code for ${to} arrived in Mailpit`);
}

const tokenOf = (b: any): string | undefined => b?.access_token ?? b?.token?.access_token ?? b?.tokens?.access_token;

async function signIn(c: Creds): Promise<string> {
  const since = Date.now() - 2000;
  const login = await call("POST", "/auth/login", { email: c.email, password: c.password });
  if (login.status < 300) {
    if (tokenOf(login.body)) return tokenOf(login.body)!;
    if (login.body?.session) {
      const code = await mailCode(c.email, since);
      const conf = await call("POST", "/auth/login/confirm", { session: login.body.session, code });
      if (tokenOf(conf.body)) return tokenOf(conf.body)!;
      throw new Error(`login confirm failed: ${conf.status} ${JSON.stringify(conf.body)}`);
    }
  }
  // Not registered yet.
  const reg = await call("POST", "/auth/register", { email: c.email, password: c.password });
  if (reg.status >= 300) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)} (login said ${login.status} ${JSON.stringify(login.body)})`);
  if (tokenOf(reg.body)) return tokenOf(reg.body)!;
  const code = await mailCode(c.email, since);
  const conf = await call("POST", "/auth/register/confirm", { session: reg.body.session, code });
  if (!tokenOf(conf.body)) throw new Error(`register confirm failed: ${conf.status} ${JSON.stringify(conf.body)}`);
  console.log(`registered ${c.email}`);
  return tokenOf(conf.body)!;
}

const KIND: Record<string, string> = {
  "bridged-icp.md": "icp",
  "bridged-product.pdf": "product",
  "bridged-product.md": "product",
  "bridged-case-studies.md": "case_study",
  "bridged-brand-voice.md": "brand",
  "bridged-email-samples.txt": "email_samples",
};
const MIME: Record<string, string> = { ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf" };

const creds = loadCreds();
const token = await signIn(creds);

const me = await call("GET", "/auth/me", undefined, token);
const needsOnboarding = JSON.stringify(me.body).includes('"onboarding_completed":false') || me.body?.user?.onboarded === false;
await call("PATCH", "/organization/current", { name: "Bridged", timezone: "Asia/Kolkata" }, token).then((r) => r.status >= 300 && console.warn("org rename:", r.status, JSON.stringify(r.body)));
const onb = await call("PATCH", "/auth/me/onboarding", { first_name: "Nikhil", last_name: "Bridged", referral_source: "other", role: "founder", team_size: "2-10" }, token);
if (onb.status >= 300) console.warn("onboarding:", onb.status, JSON.stringify(onb.body), needsOnboarding ? "" : "(may already be complete)");
await call("PUT", "/auth/me/product-tour", undefined, token);

const org = await call("GET", "/organization/current", undefined, token);
creds.orgId = org.body?.id ?? org.body?.organization?.id ?? creds.orgId;
fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
console.log(`org ${org.body?.name ?? "?"} ${creds.orgId}`);

const setup = await call("POST", "/intel/setup", {}, token);
console.log("intelligence on:", setup.status, JSON.stringify(setup.body));

// Upload the knowledge documents (skip ones already uploaded; --reset re-uploads).
const existing = await call("GET", "/intel/documents", undefined, token);
if (process.argv.includes("--reset")) {
  for (const d of existing.body?.documents ?? []) await call("DELETE", `/intel/documents/${d.id}`, undefined, token);
  existing.body.documents = [];
}
const have = new Set<string>((existing.body?.documents ?? []).filter((d: any) => d.status === "ready").map((d: any) => d.filename));
const files = fs.readdirSync(DOCS).filter((f) => KIND[f]);
// Prefer the PDF of the product doc when both exist.
const pick = files.filter((f) => !(f === "bridged-product.md" && files.includes("bridged-product.pdf")));
for (const f of pick) {
  if (have.has(f)) {
    console.log(`already uploaded ${f}`);
    continue;
  }
  const data = fs.readFileSync(path.join(DOCS, f)).toString("base64");
  const r = await call("POST", "/intel/documents", { kind: KIND[f], filename: f, mimeType: MIME[path.extname(f)] ?? "", data }, token);
  console.log(`upload ${f}:`, r.status, r.body?.document?.statusDetail ?? JSON.stringify(r.body));
}
const docs = await call("GET", "/intel/documents", undefined, token);
const ctx = docs.body?.context;
console.log(
  "understanding layer:",
  ctx ? { icp: ctx.icp.length, personas: ctx.personas.length, pains: ctx.painPoints.length, value: ctx.valueProps.length, proof: ctx.proofPoints.length, voiceRules: ctx.voice?.rules?.length, examples: ctx.examples.length } : null,
);
