// Demo workspace, finish an interrupted phase 2 (backfill onward). Phase 2: run the real engine for "Bridged" on 1,000 synthetic
// prospects, then lay the run out over the past six weeks.
//
// The engine runs on its scaled mock clock (MOCK_TIME_SCALE_SECONDS_PER_HOUR):
// every timestamp it writes during the run is real time at that compression.
// Afterwards each one is mapped back to simulated time, ending a few hours ago,
// so the dashboards read like six weeks of live operation.
//
// Run through scripts/demo/run.ps1 (it stops the intel container meanwhile and
// passes the database URL). Needs phase 1 (account.ts) first.
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

const SCALE = Number(process.env.DEMO_SCALE ?? 0.5); // real seconds per simulated hour
Object.assign(process.env, {
  LLM_MODE: "mock",
  SENDER_PROVIDER: "mock",
  MOCK_OUTCOMES: "traits",
  MOCK_TIME_SCALE_SECONDS_PER_HOUR: String(SCALE),
  DATABASE_SCHEMA: "intel",
  APP_URL: "https://app.pegasusbound.com",
});
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (use run.ps1)");

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const creds = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/.demo-credentials"), "utf8")) as { email: string; orgId: string };
const ORG = creds.orgId;
if (!ORG) throw new Error("Run account.ts first");

const { getDb, closeDb } = await import("../../src/db/client");
const s = await import("../../src/db/schema");
const { drain } = await import("../../src/jobs/runner");
const { approveCampaign, createCampaign, enrollContacts, resumeCampaign, startPlanning } = await import("../../src/orchestrator/campaigns");
const { refreshMemory } = await import("../../src/memory");
const { prospectsFor, SEGMENTS } = await import("./data");

const db = await getDb();
const rows = <T,>(r: unknown) => (r as { rows: T[] }).rows;

// ---------------------------------------------------------------------------
// Reset any previous demo run for this org (documents and their memory stay).
// ---------------------------------------------------------------------------
async function reset() {
  const ids = rows<{ id: string }>(await db.execute(sql`SELECT id FROM campaigns WHERE org_id = ${ORG}`)).map((r) => r.id);
  if (ids.length) {
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    await db.execute(sql`DELETE FROM reply_classifications WHERE reply_id IN (SELECT r.id FROM replies r JOIN assignments a ON a.id = r.assignment_id WHERE a.campaign_id IN (${list}))`);
    for (const t of ["replies", "message_events", "outbound_messages"]) {
      await db.execute(sql.raw(`DELETE FROM ${t} WHERE assignment_id IN (SELECT id FROM assignments WHERE campaign_id IN (${ids.map((i) => `'${i}'`).join(",")}))`));
    }
    await db.execute(sql`DELETE FROM meetings WHERE campaign_id IN (${list})`);
    await db.execute(sql`DELETE FROM learning_records WHERE campaign_id IN (${list})`);
    await db.execute(sql`DELETE FROM experiment_arms WHERE experiment_id IN (SELECT id FROM experiments WHERE campaign_id IN (${list}))`);
    for (const t of ["assignments", "enrollments", "platform_campaigns", "audit_log"]) {
      await db.execute(sql.raw(`DELETE FROM ${t} WHERE campaign_id IN (${ids.map((i) => `'${i}'`).join(",")})`));
    }
    await db.execute(sql`DELETE FROM variants WHERE campaign_id IN (${list})`);
    await db.execute(sql`DELETE FROM experiments WHERE campaign_id IN (${list})`);
    await db.execute(sql`DELETE FROM campaigns WHERE id IN (${list})`);
  }
  await db.execute(sql`DELETE FROM prospects WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM suppressions WHERE org_id = ${ORG}`);
  await db.execute(sql`DELETE FROM memory_entries WHERE org_id = ${ORG} AND source IN ('experiment', 'brain')`);
  console.log(`reset: removed ${ids.length} previous demo campaigns`);
}

// Recover the run window after an interrupted backfill: the first campaign's
// creation is the run start; the audit log (already mapped) gives its mapped time.
const [w] = rows<{ r0: string; t0: string; r1: string }>(
  await db.execute(sql`SELECT
    (SELECT min(created_at) FROM campaigns WHERE org_id = ${ORG}) r0,
    (SELECT min(l.created_at) FROM audit_log l JOIN campaigns c ON c.id = l.campaign_id WHERE c.org_id = ${ORG}) t0,
    (SELECT max(o.sent_at) FROM outbound_messages o JOIN assignments a ON a.id = o.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG}) r1`),
);
const LIMITS = {
  batchStages: [90, 100, 120, 150],
  dailySendCap: 90,
  observationHours: 48,
  followUpDelaysDays: [2, 3],
  minDeliveredPerVariant: 20,
  maxExperiments: 6,
  requireApprovalForNewCopy: false,
  bounceRateStop: 0.08,
  negativeRateStop: 0.08,
};
const r0 = new Date(w!.r0);
const r1 = new Date(new Date(w!.r1).getTime() + 120_000);
const T0 = new Date(w!.t0).getTime();
const END = T0 + ((r1.getTime() - r0.getTime()) / 1000 / SCALE) * 3600_000;
console.log('window', r0.toISOString(), r1.toISOString(), 'T0', new Date(T0).toISOString());
// ---------------------------------------------------------------------------
// Backfill: map run time onto the last six weeks.
// ---------------------------------------------------------------------------
const K = 3600 / SCALE; // simulated seconds per real second
const cols = rows<{ t: string; c: string }>(
  await db.execute(sql`SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = 'intel' AND data_type LIKE 'timestamp%' AND table_name NOT IN ('jobs', 'users', 'knowledge_documents', 'org_context', 'org_credentials', 'connections', 'mailboxes')`),
);
const r0s = r0.toISOString();
for (const { t, c } of cols) {
  // Only rows written during this run fall at or after r0.
  await db.execute(
    sql.raw(
      `UPDATE "${t}" SET "${c}" = to_timestamp(${T0 / 1000} + extract(epoch from ("${c}" - timestamptz '${r0s}')) * ${K}) WHERE "${c}" >= timestamptz '${r0s}' AND "${c}" < timestamptz '${new Date(r1.getTime() + 3600_000).toISOString()}'`,
    ),
  );
}
// Documents were uploaded the day before the first campaign.
const before = new Date(T0 - 26 * 3600_000).toISOString();
await db.execute(sql`UPDATE knowledge_documents SET created_at = ${before}::timestamptz + (random() * interval '3 hours') WHERE org_id = ${ORG}`);
await db.execute(sql`UPDATE org_context SET updated_at = ${before}::timestamptz + interval '3 hours' WHERE org_id = ${ORG}`);
await db.execute(sql`UPDATE memory_entries SET created_at = ${before}::timestamptz + interval '3 hours', updated_at = ${before}::timestamptz + interval '3 hours' WHERE org_id = ${ORG} AND source = 'document'`);

// Meetings: most booked calls happen and most of those qualify.
await db.execute(sql`
  UPDATE meetings m SET
    status = CASE WHEN x.r < 0.72 THEN 'held' WHEN x.r < 0.82 THEN 'no_show' ELSE 'booked' END,
    qualified = CASE WHEN x.r < 0.72 THEN (x.r2 < 0.74) ELSE NULL END,
    notes = CASE WHEN x.r < 0.72 AND x.r2 < 0.74 THEN 'Qualified: fits ICP, pilot discussed' WHEN x.r < 0.72 THEN 'Held: not a fit right now' ELSE m.notes END
  FROM (SELECT id, random() r, random() r2 FROM meetings) x, campaigns c
  WHERE x.id = m.id AND c.id = m.campaign_id AND c.org_id = ${ORG} AND m.booked_at < ${new Date(END - 24 * 3600_000).toISOString()}::timestamptz`);

await refreshMemory(db, ORG);

// ---------------------------------------------------------------------------
// One new campaign planned today, so the demo shows memory applied up front.
// ---------------------------------------------------------------------------
const next = SEGMENTS.find((g) => g.startDay < 0)!;
const contacts = prospectsFor(next);
const c4 = await createCampaign(db, { orgId: ORG, createdBy: creds.email, name: next.name, brief: next.brief, limits: { ...LIMITS, maxTotalProspects: contacts.length }, senderProvider: "mock" });
await enrollContacts(db, c4.id, contacts, "csv");
await startPlanning(db, c4.id);
const r2 = new Date();
await db.execute(sql`UPDATE jobs SET run_at = run_at + interval '100 years' WHERE status = 'pending' AND created_at < ${r2}`);
for (let i = 0; i < 50; i++) {
  await drain(db, { maxJobs: 50 }).catch(() => {});
  const [c] = rows<{ status: string }>(await db.execute(sql`SELECT status FROM campaigns WHERE id = ${c4.id}`));
  if (c?.status !== "planning") break;
}
await db.execute(sql`DELETE FROM jobs WHERE created_at >= ${r2}`);
await db.execute(sql`UPDATE jobs SET run_at = now() WHERE status = 'pending' AND run_at > now() + interval '50 years'`);
console.log(`planned "${next.name}" (awaiting approval)`);

const totals = rows<Record<string, number>>(
  await db.execute(sql`SELECT
    (SELECT count(*)::int FROM prospects WHERE org_id = ${ORG}) prospects,
    (SELECT count(*)::int FROM outbound_messages o JOIN assignments a ON a.id = o.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG}) emails,
    (SELECT count(*)::int FROM replies r JOIN assignments a ON a.id = r.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG}) replies,
    (SELECT count(*)::int FROM meetings m JOIN campaigns c ON c.id = m.campaign_id WHERE c.org_id = ${ORG}) meetings,
    (SELECT count(*)::int FROM experiments e JOIN campaigns c ON c.id = e.campaign_id WHERE c.org_id = ${ORG}) experiments,
    (SELECT count(*)::int FROM variants v JOIN campaigns c ON c.id = v.campaign_id WHERE c.org_id = ${ORG}) variants,
    (SELECT count(*)::int FROM memory_entries WHERE org_id = ${ORG} AND active) memory`),
)[0];
console.log("totals:", totals);
await closeDb();
