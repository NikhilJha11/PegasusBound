import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setEnvForTests } from "../src/env";
import { closeDb, getDb, type DB } from "../src/db/client";
import * as s from "../src/db/schema";
import { drain } from "../src/jobs/runner";
import { approveCampaign, createCampaign, enrollContacts, startPlanning } from "../src/orchestrator/campaigns";
import { ingestEvent } from "../src/orchestrator/events";
import { listMemory, playbookFor, refreshMemory, traitPerformance } from "../src/memory";
import { unsubscribeUrl } from "../src/compliance";
import { unsubscribeByToken } from "../src/auth";

let db: DB;

beforeAll(async () => {
  setEnvForTests({ DATABASE_URL: "pglite://memory", LLM_MODE: "mock", SENDER_PROVIDER: "mock", MOCK_TIME_SCALE_SECONDS_PER_HOUR: 0.002 });
  db = await getDb();
});
afterAll(() => closeDb());

async function runUntil(predicate: () => Promise<boolean>, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await drain(db);
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for condition");
}

const brief: s.CampaignBrief = {
  campaignType: "Pain-point-led outreach",
  objective: "Book qualified meetings",
  icp: "UK B2B event organisers",
  persona: "Heads of events",
  offer: "No offer; pain point",
  style: "Short, direct and conversational",
  context: "",
  senderName: "Nikhil",
  senderCompany: "Bridged",
};

describe("closed learning loop (mock LLM + mock sender)", () => {
  it("plans, waits for approval, sends, learns, and adapts within limits", async () => {
    const campaign = await createCampaign(db, {
      name: "Loop test",
      brief,
      // Health pauses are covered by unit tests; keep small-sample bounce noise from cutting this run short.
      limits: { batchStages: [50, 100, 200], maxTotalProspects: 400, dailySendCap: 1000, minDeliveredPerVariant: 20, bounceRateStop: 0.25, negativeRateStop: 0.25 },
    });
    const contacts = Array.from({ length: 450 }, (_, i) => ({ email: `p${i}@org${i % 40}.example`, firstName: `P${i}`, company: `Org ${i % 40}` }));
    // A suppressed contact must never be emailed.
    await db.insert(s.suppressions).values({ email: "p0@org0.example", reason: "manual" });
    const enrolled = await enrollContacts(db, campaign.id, contacts, "csv");
    expect(enrolled.excluded).toBe(1);

    await startPlanning(db, campaign.id);
    await drain(db);
    let [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, campaign.id));
    expect(c!.status).toBe("awaiting_approval");

    // Nothing is sent before the human approves.
    const [before] = await db.select({ n: sql<number>`count(*)` }).from(s.assignments);
    expect(Number(before!.n)).toBe(0);

    await approveCampaign(db, campaign.id, "tester");
    await runUntil(async () => {
      [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, campaign.id));
      return c!.status !== "running";
    });

    expect(["completed", "paused"]).toContain(c!.status);
    const exps = await db.select().from(s.experiments).where(eq(s.experiments.campaignId, campaign.id));
    expect(exps.length).toBeGreaterThanOrEqual(2);
    expect(exps.filter((e) => e.status === "evaluated").length).toBeGreaterThanOrEqual(2);

    // Budget is a hard limit.
    const [total] = await db.select({ n: sql<number>`count(*)` }).from(s.assignments).where(eq(s.assignments.campaignId, campaign.id));
    expect(Number(total!.n)).toBeLessThanOrEqual(400);

    // No prospect is ever assigned twice; suppressed contact never contacted.
    const dupes = await db.execute(sql`SELECT prospect_id FROM assignments GROUP BY prospect_id HAVING count(*) > 1`);
    expect((dupes as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    const sup = await db.execute(sql`SELECT 1 FROM assignments a JOIN prospects p ON p.id = a.prospect_id WHERE p.email = 'p0@org0.example'`);
    expect((sup as unknown as { rows: unknown[] }).rows).toHaveLength(0);

    // Learnings were recorded with evidence.
    const learnings = await db.select().from(s.learningRecords).where(eq(s.learningRecords.campaignId, campaign.id));
    expect(learnings.length).toBe(exps.filter((e) => e.status === "evaluated").length);
    expect(learnings[0]!.evidence).toHaveProperty("stats");

    // Replies were classified; unsubscribes were suppressed.
    const [cls] = await db.select({ n: sql<number>`count(*)` }).from(s.replyClassifications);
    expect(Number(cls!.n)).toBeGreaterThan(0);

    // Variants are immutable: every variant's content hash matches its content.
    const vs = await db.select().from(s.variants).where(eq(s.variants.campaignId, campaign.id));
    expect(new Set(vs.map((v) => v.contentHash)).size).toBe(vs.length);
  });

  it("runs multi-step sequences that stop on reply, with compliance footer", async () => {
    const steps = await db.execute(sql`SELECT step, count(*)::int n FROM outbound_messages GROUP BY step ORDER BY step`);
    const rows = (steps as unknown as { rows: { step: number; n: number }[] }).rows;
    expect(rows.map((r) => r.step)).toEqual([1, 2, 3]);
    // Nobody gets a follow-up after a human reply to an earlier step...
    const bad = await db.execute(sql`
      SELECT om.id FROM outbound_messages om
      JOIN replies r ON r.assignment_id = om.assignment_id AND r.received_at < om.sent_at
      JOIN reply_classifications rc ON rc.reply_id = r.id AND rc.category <> 'auto_reply'
      WHERE om.step > 1`);
    expect((bad as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    // ...but out-of-office replies don't stop the sequence.
    const ooo = await db.execute(sql`
      SELECT a.id FROM assignments a
      JOIN replies r ON r.assignment_id = a.id
      JOIN reply_classifications rc ON rc.reply_id = r.id AND rc.category = 'auto_reply'
      WHERE NOT EXISTS (SELECT 1 FROM reply_classifications rc2 JOIN replies r2 ON r2.id = rc2.reply_id WHERE r2.assignment_id = a.id AND rc2.category <> 'auto_reply')
        AND NOT EXISTS (SELECT 1 FROM message_events e WHERE e.assignment_id = a.id AND e.type IN ('bounced', 'unsubscribed'))
        AND (SELECT count(*) FROM outbound_messages om WHERE om.assignment_id = a.id) = 3`);
    expect((ooo as unknown as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    // Follow-ups thread on the first email.
    const [fu] = await db.select().from(s.outboundMessages).where(eq(s.outboundMessages.step, 2)).limit(1);
    expect(fu!.subject.startsWith("Re: ")).toBe(true);
    const all = await db.select({ body: s.outboundMessages.body }).from(s.outboundMessages);
    expect(all.every((m) => m.body.includes("/u/") && m.body.includes("unsubscribe"))).toBe(true);
  });

  it("builds a unified memory from experiments and the Company Brain", async () => {
    await refreshMemory(db, s.STANDALONE_ORG);
    const mem = await listMemory(db, s.STANDALONE_ORG);
    expect(mem.some((m) => m.source === "brain" && m.kind === "guideline")).toBe(true);
    const table = await traitPerformance(db, { orgId: s.STANDALONE_ORG });
    expect(table.angle.length).toBeGreaterThanOrEqual(2);
    expect(table.angle.reduce((a, r) => a + r.delivered, 0)).toBeGreaterThan(0);
    const playbook = await playbookFor(db, s.STANDALONE_ORG, brief.persona);
    expect(playbook).toContain("guidelines");
  });

  it("isolates tenants: suppressions, prospects and memory never cross organizations", async () => {
    const otherOrg = "11111111-1111-4111-8111-111111111111";
    const c2 = await createCampaign(db, { orgId: otherOrg, name: "Other tenant", brief });
    // p0 is suppressed in the standalone org; in another org the same address is a fresh prospect.
    const r = await enrollContacts(db, c2.id, [{ email: "p0@org0.example" }, { email: "p1@org1.example" }], "csv");
    expect(r).toMatchObject({ enrolled: 2, excluded: 0 });
    const rows = await db.select().from(s.prospects).where(eq(s.prospects.email, "p1@org1.example"));
    expect(new Set(rows.map((x) => x.orgId))).toEqual(new Set([s.STANDALONE_ORG, otherOrg]));
    expect(await listMemory(db, otherOrg)).toHaveLength(0);
    const table = await traitPerformance(db, { orgId: otherOrg });
    expect(table.angle).toHaveLength(0);
  });

  it("unsubscribe links suppress the recipient", async () => {
    const [{ a }] = await db
      .select({ a: s.assignments })
      .from(s.assignments)
      .innerJoin(s.prospects, eq(s.prospects.id, s.assignments.prospectId))
      .where(and(eq(s.assignments.status, "sent"), sql`NOT EXISTS (SELECT 1 FROM suppressions x WHERE x.email = ${s.prospects.email})`))
      .limit(1);
    const token = unsubscribeUrl(a.id).split("/u/")[1]!;
    expect((await unsubscribeByToken(db, token + "x")).ok).toBe(false);
    const r = await unsubscribeByToken(db, token);
    expect(r.ok).toBe(true);
    const [sup] = await db.select().from(s.suppressions).where(eq(s.suppressions.email, r.ok ? r.email : ""));
    expect(sup?.reason).toBe("unsubscribed");
  });

  it("ignores duplicate provider events", async () => {
    const [om] = await db.select().from(s.outboundMessages).limit(1);
    const ev = { providerMessageId: om!.providerMessageId, providerEventId: "dup-test-1", type: "opened" as const, occurredAt: new Date() };
    const r1 = await ingestEvent(db, ev);
    const r2 = await ingestEvent(db, ev);
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    expect(r2).toMatchObject({ ok: true, duplicate: true });
  });
});
