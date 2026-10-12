import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import * as s from "./db/schema";
import { variantCounts } from "./orchestrator/stats";
import { capacityFor, sentTodayByMailbox } from "./senders/mailboxes";

/**
 * Read models for the dashboard. Every function is scoped to one
 * organization; campaign-level reads return null when the campaign belongs to
 * another tenant, so callers can answer 404 without leaking existence.
 */

export async function getConnections(d: DB, orgId: string) {
  return d.select().from(s.connections).where(eq(s.connections.orgId, orgId)).orderBy(asc(s.connections.createdAt));
}

export async function getDashboard(d: DB, orgId: string) {
  const campaigns = await d.select().from(s.campaigns).where(eq(s.campaigns.orgId, orgId)).orderBy(desc(s.campaigns.createdAt));
  const out = [];
  for (const c of campaigns) {
    const counts = [...(await variantCounts(d, c.id)).values()];
    const sum = (k: keyof (typeof counts)[number]) => counts.reduce((a, x) => a + (x[k] as number), 0);
    const [exp] = await d.select({ n: sql<number>`count(*) filter (where status = 'evaluated')` }).from(s.experiments).where(eq(s.experiments.campaignId, c.id));
    const [learning] = await d
      .select()
      .from(s.learningRecords)
      .where(eq(s.learningRecords.campaignId, c.id))
      .orderBy(desc(s.learningRecords.createdAt))
      .limit(1);
    const [review] = await d.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT DISTINCT ON (rc.reply_id) rc.needs_review FROM reply_classifications rc
        JOIN replies r ON r.id = rc.reply_id JOIN assignments a ON a.id = r.assignment_id
        WHERE a.campaign_id = ${c.id} ORDER BY rc.reply_id, rc.created_at DESC) x
      WHERE x.needs_review`).then((r) => (r as unknown as { rows: { n: number }[] }).rows);
    out.push({
      campaign: c,
      sent: sum("sent"),
      delivered: sum("delivered"),
      positive: sum("positive"),
      meetings: sum("meetings"),
      experimentsDone: Number(exp?.n ?? 0),
      latestLearning: learning ?? null,
      needsReview: Number(review?.n ?? 0),
    });
  }
  return out;
}

export async function getCampaignDetail(d: DB, orgId: string, id: string) {
  const [campaign] = await d.select().from(s.campaigns).where(and(eq(s.campaigns.id, id), eq(s.campaigns.orgId, orgId)));
  if (!campaign) return null;
  const experiments = await d.select().from(s.experiments).where(eq(s.experiments.campaignId, id)).orderBy(desc(s.experiments.seq));
  const arms = experiments.length
    ? await d
        .select()
        .from(s.experimentArms)
        .where(inArray(s.experimentArms.experimentId, experiments.map((e) => e.id)))
    : [];
  const variants = await d.select().from(s.variants).where(eq(s.variants.campaignId, id)).orderBy(asc(s.variants.label));
  const counts = await variantCounts(d, id);
  const learnings = await d.select().from(s.learningRecords).where(eq(s.learningRecords.campaignId, id)).orderBy(desc(s.learningRecords.createdAt));
  const audit = await d.select().from(s.auditLog).where(eq(s.auditLog.campaignId, id)).orderBy(desc(s.auditLog.createdAt)).limit(40);
  const enrollment = await d
    .select({ status: s.enrollments.status, n: sql<number>`count(*)` })
    .from(s.enrollments)
    .where(eq(s.enrollments.campaignId, id))
    .groupBy(s.enrollments.status);
  const repliesRes = await d.execute(sql`
    SELECT r.id, r.body, r.received_at, p.email, p.first_name, p.company, v.label,
      l.category, l.confidence, l.needs_review, l.reason, l.classifier
    FROM replies r
    JOIN assignments a ON a.id = r.assignment_id
    JOIN prospects p ON p.id = a.prospect_id
    JOIN variants v ON v.id = a.variant_id
    LEFT JOIN LATERAL (
      SELECT * FROM reply_classifications rc WHERE rc.reply_id = r.id ORDER BY rc.created_at DESC LIMIT 1
    ) l ON true
    WHERE a.campaign_id = ${id}
    ORDER BY l.needs_review DESC NULLS FIRST, r.received_at DESC
    LIMIT 100`);
  const replies = (repliesRes as unknown as { rows: ReplyRow[] }).rows;
  return { campaign, experiments, arms, variants, counts, learnings, audit, enrollment, replies };
}

export interface ReplyRow {
  id: string;
  body: string;
  received_at: string;
  email: string;
  first_name: string | null;
  company: string | null;
  label: string;
  category: string | null;
  confidence: number | null;
  needs_review: boolean | null;
  reason: string | null;
  classifier: string | null;
}

export async function getLearnings(d: DB, orgId: string) {
  return d
    .select({ l: s.learningRecords, campaignName: s.campaigns.name })
    .from(s.learningRecords)
    .innerJoin(s.campaigns, eq(s.campaigns.id, s.learningRecords.campaignId))
    .where(eq(s.campaigns.orgId, orgId))
    .orderBy(desc(s.learningRecords.createdAt))
    .limit(200);
}

export async function pendingExperimentFor(d: DB, campaignId: string) {
  const [e] = await d
    .select()
    .from(s.experiments)
    .where(and(eq(s.experiments.campaignId, campaignId), eq(s.experiments.status, "pending_approval")))
    .limit(1);
  return e ?? null;
}

// ---------------------------------------------------------------------------
// Leads inbox
// ---------------------------------------------------------------------------

export interface LeadRow {
  assignment_id: string | null;
  enrollment_status: string;
  exclusion_reason: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  label: string | null;
  steps_sent: number;
  last_activity: string | null;
  state: string;
  category: string | null;
  meeting_status: string | null;
}

export const LEAD_FILTERS = ["all", "replied", "positive", "review", "meetings", "in_sequence", "bounced", "unsubscribed", "not_contacted"] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];

export async function getLeads(d: DB, orgId: string, campaignId: string, filter: LeadFilter, q: string) {
  const [owned] = await d.select({ id: s.campaigns.id }).from(s.campaigns).where(and(eq(s.campaigns.id, campaignId), eq(s.campaigns.orgId, orgId)));
  if (!owned) return null;
  const res = await d.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.assignment_id) r.assignment_id, rc.category, rc.needs_review, r.received_at
      FROM replies r JOIN reply_classifications rc ON rc.reply_id = r.id
      WHERE rc.category <> 'auto_reply'
      ORDER BY r.assignment_id, r.received_at DESC, rc.created_at DESC
    ),
    ev AS (
      SELECT assignment_id,
        bool_or(type = 'bounced') AS bounced,
        bool_or(type = 'unsubscribed') AS unsub,
        max(occurred_at) AS last_event
      FROM message_events GROUP BY assignment_id
    )
    SELECT a.id AS assignment_id, en.status AS enrollment_status, en.exclusion_reason,
      p.email, p.first_name, p.last_name, p.company, p.title, v.label,
      (SELECT count(*)::int FROM outbound_messages om WHERE om.assignment_id = a.id) AS steps_sent,
      greatest(ev.last_event, l.received_at) AS last_activity,
      CASE
        WHEN a.id IS NULL THEN CASE WHEN en.status = 'excluded' THEN 'excluded' ELSE 'not_contacted' END
        WHEN ev.bounced THEN 'bounced'
        WHEN ev.unsub OR l.category = 'unsubscribe' THEN 'unsubscribed'
        WHEN l.needs_review THEN 'review'
        WHEN l.category IN ('positive_interest', 'meeting_requested', 'referral') THEN 'positive'
        WHEN l.category IS NOT NULL THEN 'replied'
        WHEN a.status IN ('queued', 'sending') THEN 'queued'
        WHEN a.status IN ('failed', 'skipped') THEN a.status
        WHEN a.sequence_stopped_reason IS NULL THEN 'in_sequence'
        ELSE 'finished'
      END AS state,
      l.category, m.status AS meeting_status
    FROM enrollments en
    JOIN prospects p ON p.id = en.prospect_id
    LEFT JOIN assignments a ON a.prospect_id = en.prospect_id AND a.campaign_id = en.campaign_id
    LEFT JOIN variants v ON v.id = a.variant_id
    LEFT JOIN latest l ON l.assignment_id = a.id
    LEFT JOIN ev ON ev.assignment_id = a.id
    LEFT JOIN meetings m ON m.assignment_id = a.id
    WHERE en.campaign_id = ${campaignId}
      AND (${q} = '' OR p.email ILIKE ${"%" + q + "%"} OR p.company ILIKE ${"%" + q + "%"} OR p.first_name ILIKE ${"%" + q + "%"})
    ORDER BY (a.id IS NULL), greatest(ev.last_event, l.received_at) DESC NULLS LAST, p.email
    LIMIT 2000`);
  let rows = (res as unknown as { rows: LeadRow[] }).rows;
  const counts: Record<string, number> = { all: rows.length };
  const match = (r: LeadRow, f: LeadFilter) =>
    f === "all" ||
    (f === "replied" && ["replied", "positive", "review"].includes(r.state)) ||
    (f === "meetings" && !!r.meeting_status) ||
    (f === "not_contacted" && ["not_contacted", "excluded"].includes(r.state)) ||
    r.state === f;
  for (const f of LEAD_FILTERS) counts[f] = rows.filter((r) => match(r, f)).length;
  rows = rows.filter((r) => match(r, filter));
  return { rows: rows.slice(0, 500), counts, truncated: rows.length > 500 };
}

export interface ThreadItem {
  kind: "out" | "in" | "event";
  at: string;
  step?: number;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  category?: string | null;
  confidence?: number | null;
  needsReview?: boolean | null;
  reason?: string | null;
  replyId?: string;
  event?: string;
}

export async function getThread(d: DB, orgId: string, assignmentId: string) {
  const [row] = await d
    .select({ a: s.assignments, p: s.prospects, v: s.variants, c: s.campaigns })
    .from(s.assignments)
    .innerJoin(s.prospects, eq(s.prospects.id, s.assignments.prospectId))
    .innerJoin(s.variants, eq(s.variants.id, s.assignments.variantId))
    .innerJoin(s.campaigns, eq(s.campaigns.id, s.assignments.campaignId))
    .where(and(eq(s.assignments.id, assignmentId), eq(s.campaigns.orgId, orgId)));
  if (!row) return null;
  const out = await d.select().from(s.outboundMessages).where(eq(s.outboundMessages.assignmentId, assignmentId));
  const inRes = await d.execute(sql`
    SELECT r.id, r.body, r.from_email, r.received_at, l.category, l.confidence, l.needs_review, l.reason
    FROM replies r
    LEFT JOIN LATERAL (SELECT * FROM reply_classifications rc WHERE rc.reply_id = r.id ORDER BY rc.created_at DESC LIMIT 1) l ON true
    WHERE r.assignment_id = ${assignmentId}`);
  const inbound = (inRes as unknown as { rows: { id: string; body: string; from_email: string; received_at: string; category: string | null; confidence: number | null; needs_review: boolean | null; reason: string | null }[] }).rows;
  const events = await d.select().from(s.messageEvents).where(eq(s.messageEvents.assignmentId, assignmentId));
  const [meeting] = await d.select().from(s.meetings).where(eq(s.meetings.assignmentId, assignmentId));

  const items: ThreadItem[] = [
    ...out.map((m) => ({ kind: "out" as const, at: new Date(m.sentAt).toISOString(), step: m.step, from: m.fromEmail ?? row.c.brief.senderName, to: m.toEmail, subject: m.subject, body: m.body })),
    ...inbound.map((r) => ({
      kind: "in" as const,
      at: new Date(r.received_at).toISOString(),
      from: r.from_email,
      body: r.body,
      category: r.category,
      confidence: r.confidence,
      needsReview: r.needs_review,
      reason: r.reason,
      replyId: r.id,
    })),
    ...events
      .filter((e) => ["bounced", "unsubscribed", "complained", "opened"].includes(e.type))
      .map((e) => ({ kind: "event" as const, at: new Date(e.occurredAt).toISOString(), event: e.type })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  const pendingSteps = row.v.followUps.length + 1 - out.length;
  return { assignment: row.a, prospect: row.p, variant: row.v, campaign: row.c, items, meeting: meeting ?? null, pendingSteps: row.a.sequenceStoppedReason ? 0 : pendingSteps };
}

export async function getMailboxes(d: DB, orgId: string) {
  const rows = await d.select().from(s.mailboxes).where(eq(s.mailboxes.orgId, orgId)).orderBy(asc(s.mailboxes.createdAt));
  const sent = await sentTodayByMailbox(d);
  return rows.map((m) => ({ ...m, secret: undefined, sentToday: sent.get(m.id) ?? 0, capacity: capacityFor(m) }));
}
