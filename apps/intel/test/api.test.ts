import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, drain, getDb, setEnvForTests } from "@iole/engine";
import { buildApp } from "../src/app";
import { PERM, sign } from "../src/auth";

const SECRET = "test-internal-token-0123456789";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = PERM.manageCampaigns | PERM.sendCampaigns | PERM.manageSettings | PERM.viewCampaigns;

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  setEnvForTests({ DATABASE_URL: "pglite://memory", LLM_MODE: "mock" });
  await getDb();
  app = buildApp({ internalToken: SECRET });
});
afterAll(() => closeDb());

function headers(org: string, perms = OWNER, user = "user-1", tsOffset = 0) {
  const ts = String(Math.floor(Date.now() / 1000) + tsOffset);
  return {
    "content-type": "application/json",
    "x-intel-org": org,
    "x-intel-user": user,
    "x-intel-perms": String(perms),
    "x-intel-ts": ts,
    "x-intel-sig": sign(SECRET, org, user, String(perms), ts),
  };
}

const call = (method: string, path: string, h: Record<string, string>, body?: unknown) =>
  app.request(`/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });

const brief = {
  campaignType: "Pain-point-led outreach",
  objective: "Book qualified meetings",
  icp: "UK B2B event organisers",
  persona: "Heads of events",
  senderName: "Nikhil",
  senderCompany: "Pegasusbound",
};
const csv = ["email,first name,company", ...Array.from({ length: 30 }, (_, i) => `p${i}@org${i}.example,P${i},Org ${i}`)].join("\n");

describe("intel API security", () => {
  it("rejects unsigned, forged and stale requests", async () => {
    expect((await app.request("/api/campaigns")).status).toBe(401);
    const forged = { ...headers(ORG_A), "x-intel-org": ORG_B }; // signature was for ORG_A
    expect((await call("GET", "/campaigns", forged)).status).toBe(401);
    expect((await call("GET", "/campaigns", headers(ORG_A, OWNER, "u", -3600))).status).toBe(401);
    expect((await call("GET", "/campaigns", headers(ORG_A))).status).toBe(200);
  });

  it("enforces workspace permissions", async () => {
    const viewer = headers(ORG_A, PERM.viewCampaigns);
    expect((await call("GET", "/campaigns", viewer)).status).toBe(200);
    expect((await call("POST", "/campaigns", viewer, { brief, audience: { source: "csv", csv } })).status).toBe(403);
    expect((await call("POST", "/memory", viewer, { kind: "guideline", text: "Be kind" })).status).toBe(403);
    expect((await call("GET", "/campaigns", headers(ORG_A, 0))).status).toBe(403);
  });

  it("isolates organizations completely", async () => {
    const created = await call("POST", "/campaigns", headers(ORG_A), { brief, audience: { source: "csv", csv } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await drain(await getDb());

    const mine = await call("GET", `/campaigns/${id}`, headers(ORG_A));
    expect(mine.status).toBe(200);
    const detail = (await mine.json()) as { campaign: { status: string; senderProvider: string } };
    expect(detail.campaign).toMatchObject({ status: "awaiting_approval", senderProvider: "platform" });

    // Another tenant sees nothing and can't act on the id.
    const b = headers(ORG_B);
    expect((await call("GET", `/campaigns/${id}`, b)).status).toBe(404);
    expect((await call("POST", `/campaigns/${id}/approve`, b)).status).toBe(404);
    expect((await call("POST", `/campaigns/${id}/pause`, b)).status).toBe(404);
    expect((await call("GET", `/campaigns/${id}/leads`, b)).status).toBe(404);
    expect((await call("GET", `/campaigns/${id}/formats`, b)).status).toBe(404);
    const list = (await (await call("GET", "/campaigns", b)).json()) as { campaigns: unknown[] };
    expect(list.campaigns).toHaveLength(0);

    // Variants of A's campaign can't be edited from B either.
    const full = (await (await call("GET", `/campaigns/${id}`, headers(ORG_A))).json()) as { variants: { id: string }[] };
    const v = full.variants[0]!.id;
    expect((await call("PATCH", `/variants/${v}`, b, { subject: "x", body: "y", followUps: [] })).status).toBe(404);
    expect((await call("PATCH", `/variants/${v}`, headers(ORG_A), { subject: "New subject", body: "Hi {{first_name}}", followUps: [] })).status).toBe(200);
  });

  it("validates input", async () => {
    const res = await call("POST", "/campaigns", headers(ORG_A), { brief: { ...brief, icp: "" }, audience: { source: "csv", csv } });
    expect(res.status).toBe(400);
  });

  it("keeps memory per organization", async () => {
    expect((await call("POST", "/memory", headers(ORG_A), { kind: "guideline", text: "Never mention competitors" })).status).toBe(201);
    const a = (await (await call("GET", "/memory", headers(ORG_A))).json()) as { entries: unknown[] };
    const b = (await (await call("GET", "/memory", headers(ORG_B))).json()) as { entries: unknown[] };
    expect(a.entries.length).toBeGreaterThan(0);
    expect(b.entries).toHaveLength(0);
  });
});
