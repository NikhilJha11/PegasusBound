import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setEnvForTests } from "../src/env";
import { closeDb, getDb, type DB } from "../src/db/client";
import * as s from "../src/db/schema";
import { drain } from "../src/jobs/runner";
import { approveCampaign, createCampaign, enrollContacts, pauseCampaign, startPlanning } from "../src/orchestrator/campaigns";
import { drainPlatformOutbox, platformCampaignName, toPlatformTemplate } from "../src/platform/bridge";
import { encryptJson } from "../src/crypto";

/**
 * The bridge against a fake Pegasusbound platform: campaigns, steps, contact
 * enrollment, start/stop, and the event outbox the Go backend writes.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
let db: DB;
let server: http.Server;
const calls: { method: string; path: string; body: unknown; idem?: string }[] = [];
let nextCampaign = 1;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method!, path: req.url!, body, idem: req.headers["idempotency-key"] as string | undefined });
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization !== "Bearer pgsbd_test_key") {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      if (req.method === "POST" && req.url === "/v1/campaigns") return res.end(JSON.stringify({ id: `pc-${nextCampaign++}` }));
      const steps = req.url!.match(/^\/v1\/campaigns\/(pc-\d+)\/steps$/);
      if (steps) return res.end(JSON.stringify({ data: [{ id: `${steps[1]}-s1` }, { id: `${steps[1]}-s2` }, { id: `${steps[1]}-s3` }] }));
      if (req.method === "POST" && req.url === "/v1/contacts") return res.end(JSON.stringify(body));
      if (/\/(start|stop)$/.test(req.url!)) return res.end(JSON.stringify({ status: "ok" }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  setEnvForTests({ DATABASE_URL: "pglite://memory", LLM_MODE: "mock", PLATFORM_API_URL: `http://127.0.0.1:${port}`, MOCK_TIME_SCALE_SECONDS_PER_HOUR: 0.002 });
  db = await getDb();
  // The table the Go backend's intelsink writes (migration 000291).
  await db.execute(sql`CREATE TABLE IF NOT EXISTS intelligence_event_outbox (
    id BIGSERIAL PRIMARY KEY, organization_id UUID NOT NULL, event_type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), claimed_until TIMESTAMPTZ)`);
  await db.insert(s.orgCredentials).values({ orgId: ORG, secret: encryptJson({ key: "pgsbd_test_key" }) });
});

afterAll(async () => {
  await closeDb();
  server.close();
});

const brief: s.CampaignBrief = {
  campaignType: "Pain-point-led outreach",
  objective: "Book qualified meetings",
  icp: "UK B2B event organisers",
  persona: "Heads of events",
  offer: "",
  style: "Short",
  context: "",
  senderName: "Nikhil",
  senderCompany: "Pegasusbound",
};

const emit = (event_type: string, data: Record<string, unknown>) =>
  db.execute(sql`INSERT INTO intelligence_event_outbox (organization_id, event_type, data) VALUES (${ORG}, ${event_type}, ${JSON.stringify(data)}::jsonb)`);

describe("platform bridge", () => {
  it("converts merge fields to platform templates", () => {
    expect(toPlatformTemplate("Hi {{first_name}} at {{company}}")).toBe(
      "Hi {{if .FirstName}}{{.FirstName}}{{else}}there{{end}} at {{if .Company}}{{.Company}}{{else}}your team{{end}}",
    );
  });

  it("keeps platform campaign names within 50 characters", () => {
    for (const title of ["Heads of events · UK B2B event organisers and exhibitors", "Événements · Directeurs marketing · Île-de-France · 2026", "展示会の主催者向けキャンペーン・東京・大阪・名古屋"]) {
      const n = platformCampaignName(title, 12, "V14");
      expect(Buffer.byteLength(n, "utf8")).toBeLessThanOrEqual(50);
      expect(n.endsWith(" #12 V14")).toBe(true);
    }
    expect(platformCampaignName("Short", 1, "V1")).toBe("AI: Short #1 V1");
    expect(platformCampaignName("Heads   of events", 2, "V3")).toBe("AI: Heads of events #2 V3");
  });

  it("runs an experiment arm as a platform campaign and learns from platform events", async () => {
    const campaign = await createCampaign(db, {
      orgId: ORG,
      name: "Bridge test",
      brief,
      senderProvider: "platform",
      limits: { batchStages: [40, 80], maxTotalProspects: 120, dailySendCap: 100, observationHours: 1, followUpDelaysDays: [3, 4] },
    });
    await enrollContacts(db, campaign.id, Array.from({ length: 60 }, (_, i) => ({ email: `lead${i}@org.example`, firstName: `L${i}` })), "csv");
    await startPlanning(db, campaign.id);
    await drain(db);
    await approveCampaign(db, campaign.id, "owner@org.example");
    await drain(db);

    // One platform campaign per arm, with the sequence as steps and stop-on-reply.
    const creates = calls.filter((c) => c.method === "POST" && c.path === "/v1/campaigns");
    // The mock brief has a proof point, so the angle test has three arms.
    expect(creates).toHaveLength(3);
    const firstBody = creates[0]!.body as { steps: { wait_after: number; thread_reply?: boolean; body_plain: string }[]; stop_on_reply: boolean };
    expect(firstBody.stop_on_reply).toBe(true);
    expect(firstBody.steps.map((st) => st.wait_after)).toEqual([0, 3, 4]);
    expect(firstBody.steps[1]!.thread_reply).toBe(true);
    expect(firstBody.steps[0]!.body_plain).toContain("{{.FirstName}}");
    expect(creates.every((c) => c.idem)).toBe(true);

    // 40 leads enrolled across the arms, all idempotently.
    const enrolls = calls.filter((c) => c.path === "/v1/contacts");
    expect(enrolls.reduce((n, c) => n + (c.body as unknown[]).length, 0)).toBe(40);
    const assigned = await db.select().from(s.assignments).where(eq(s.assignments.campaignId, campaign.id));
    expect(assigned.every((a) => a.status === "enrolled")).toBe(true);

    // Platform reports sends, a positive reply and a bounce.
    const links = await db.select().from(s.platformCampaigns).where(eq(s.platformCampaigns.campaignId, campaign.id));
    const leadOf = async (a: (typeof assigned)[number]) => (await db.select().from(s.prospects).where(eq(s.prospects.id, a.prospectId)))[0]!;
    for (const a of assigned) {
      const pc = links.find((l) => l.variantId === a.variantId)!;
      const p = await leadOf(a);
      await emit("campaign.email_sent", {
        campaign_id: pc.platformCampaignId,
        contact_email: p.email,
        sequence_id: pc.stepIds[0],
        _task_id: `task-${a.id}`,
        _subject: "Hello",
        _body_text: `Hi ${p.firstName}`,
        from_email: "sender@pegasusbound.example",
      });
    }
    const a0 = assigned[0]!;
    const pc0 = links.find((l) => l.variantId === a0.variantId)!;
    await emit("campaign.reply_received", { campaign_id: pc0.platformCampaignId, contact_email: (await leadOf(a0)).email, _body_text: "Interested, tell me more.", _message_id: "m1" });
    const a1 = assigned[1]!;
    await emit("campaign.email_bounced", { campaign_id: links.find((l) => l.variantId === a1.variantId)!.platformCampaignId, contact_email: (await leadOf(a1)).email, reason: "mailbox full" });
    // An event about a campaign the engine doesn't manage is ignored and cleared.
    await emit("campaign.email_sent", { campaign_id: "someone-elses", contact_email: "x@y.example" });

    while ((await drainPlatformOutbox(db)) > 0);
    await drain(db);

    const left = (await db.execute(sql`SELECT count(*)::int n FROM intelligence_event_outbox`)) as unknown as { rows: { n: number }[] };
    expect(left.rows[0]!.n).toBe(0);
    const sent = await db.select().from(s.assignments).where(eq(s.assignments.campaignId, campaign.id));
    expect(sent.filter((a) => a.status === "sent")).toHaveLength(40);
    const outbound = await db.select().from(s.outboundMessages).where(eq(s.outboundMessages.assignmentId, a0.id));
    expect(outbound[0]).toMatchObject({ step: 1, subject: "Hello" });
    const [cls] = await db
      .select({ category: s.replyClassifications.category })
      .from(s.replyClassifications)
      .innerJoin(s.replies, eq(s.replies.id, s.replyClassifications.replyId))
      .where(eq(s.replies.assignmentId, a0.id));
    expect(cls?.category).toBe("positive_interest");
    const [sup] = await db.select().from(s.suppressions).where(eq(s.suppressions.email, (await leadOf(a1)).email));
    expect(sup).toMatchObject({ orgId: ORG, reason: "bounced" });

    // Re-delivering the same events changes nothing (idempotent).
    await emit("campaign.reply_received", { campaign_id: pc0.platformCampaignId, contact_email: (await leadOf(a0)).email, _body_text: "Interested, tell me more.", _message_id: "m1" });
    while ((await drainPlatformOutbox(db)) > 0);
    const replies = await db.select().from(s.replies).where(eq(s.replies.assignmentId, a0.id));
    expect(replies).toHaveLength(1);

    // Pausing the AI campaign stops the platform campaigns behind it.
    calls.length = 0;
    await pauseCampaign(db, campaign.id, "user", "test");
    expect(calls.filter((c) => c.path.endsWith("/stop"))).toHaveLength(3);
  });
});
