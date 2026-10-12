import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  assignments,
  campaigns,
  meetings,
  messageEvents,
  outboundMessages,
  prospects,
  replies,
  replyClassifications,
  suppressions,
  variants,
  POSITIVE_CATEGORIES,
  type ReplyCategory,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import type { ProviderEvent } from "../senders";
import { classifyReply, REVIEW_THRESHOLD } from "../agents/classifier";
import { createCrmNote, createCrmTask } from "../crm";
import { audit } from "./util";

async function suppress(db: DB, orgId: string, email: string, reason: "unsubscribed" | "bounced" | "complained", source: string) {
  await db.insert(suppressions).values({ orgId, email: email.toLowerCase(), reason, source }).onConflictDoNothing();
}

async function orgOf(db: DB, campaignId: string) {
  const [c] = await db.select({ orgId: campaigns.orgId }).from(campaigns).where(eq(campaigns.id, campaignId));
  return c!.orgId;
}

/** Ingest one normalised provider event. Idempotent on providerEventId. */
export async function ingestEvent(db: DB, event: ProviderEvent) {
  const [om] = await db.select().from(outboundMessages).where(eq(outboundMessages.providerMessageId, event.providerMessageId));
  const [a] = om
    ? await db.select().from(assignments).where(eq(assignments.id, om.assignmentId))
    : await db.select().from(assignments).where(eq(assignments.providerMessageId, event.providerMessageId));
  if (!a) return { ok: false, reason: "unknown message" } as const;
  return recordAssignmentEvent(db, a, event, om?.step ?? 1);
}

/** Record an event already matched to its assignment (used by every sender). */
export async function recordAssignmentEvent(db: DB, a: typeof assignments.$inferSelect, event: ProviderEvent, step = 1) {
  const [row] = await db
    .insert(messageEvents)
    .values({
      assignmentId: a.id,
      type: event.type,
      providerEventId: event.providerEventId,
      occurredAt: event.occurredAt,
      payload: { ...event.payload, step },
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { ok: true, duplicate: true } as const;

  const [p] = await db.select().from(prospects).where(eq(prospects.id, a.prospectId));
  const org = await orgOf(db, a.campaignId);
  if (["bounced", "unsubscribed", "complained"].includes(event.type) && !a.sequenceStoppedReason) {
    await db.update(assignments).set({ sequenceStoppedReason: event.type }).where(eq(assignments.id, a.id));
  }
  if (event.type === "bounced") await suppress(db, org, p!.email, "bounced", event.providerEventId);
  if (event.type === "unsubscribed") await suppress(db, org, p!.email, "unsubscribed", event.providerEventId);
  if (event.type === "complained") await suppress(db, org, p!.email, "complained", event.providerEventId);
  if (event.type === "replied" && event.replyBody) {
    const [reply] = await db
      .insert(replies)
      .values({
        assignmentId: a.id,
        eventId: row.id,
        fromEmail: event.fromEmail ?? p!.email,
        body: event.replyBody,
        receivedAt: event.occurredAt,
      })
      .onConflictDoNothing()
      .returning();
    if (reply) await enqueue(db, "reply.classify", { replyId: reply.id }, { dedupeKey: `classify:${reply.id}` });
  }
  return { ok: true, duplicate: false } as const;
}

export async function handleClassify(db: DB, replyId: string) {
  const [r] = await db
    .select({ reply: replies, a: assignments, v: variants, p: prospects })
    .from(replies)
    .innerJoin(assignments, eq(assignments.id, replies.assignmentId))
    .innerJoin(variants, eq(variants.id, assignments.variantId))
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .where(eq(replies.id, replyId));
  if (!r) return;
  const c = await classifyReply(r.reply.body, { subject: r.v.subject, angle: r.v.angle });
  const needsReview = c.confidence < REVIEW_THRESHOLD;
  await db.insert(replyClassifications).values({
    replyId,
    category: c.category,
    confidence: c.confidence,
    objection: c.objection,
    reason: c.reason,
    classifier: c.classifier,
    needsReview,
  });
  // Any human reply ends the sequence (even an uncertain one: never follow up on a person who answered).
  if (c.category !== "auto_reply" && !r.a.sequenceStoppedReason) {
    await db.update(assignments).set({ sequenceStoppedReason: "replied" }).where(eq(assignments.id, r.a.id));
  }
  if (!needsReview) await actOnCategory(db, r.a.id, r.a.campaignId, r.p, c.category, r.reply.body);
}

/** Side effects of a (confident or human-confirmed) classification. */
async function actOnCategory(
  db: DB,
  assignmentId: string,
  campaignId: string,
  p: typeof prospects.$inferSelect,
  category: ReplyCategory,
  body: string,
) {
  const org = await orgOf(db, campaignId);
  if (category === "unsubscribe") {
    await suppress(db, org, p.email, "unsubscribed", `reply:${assignmentId}`);
    return;
  }
  if (category === "meeting_requested") {
    await db.insert(meetings).values({ campaignId, assignmentId, bookedAt: new Date(), status: "requested", source: "reply" }).onConflictDoNothing();
    await enqueue(db, "meeting.verify", { assignmentId, attempt: 0 }, { runAt: new Date(Date.now() + 6 * 3600 * 1000), dedupeKey: `meeting:${assignmentId}` });
  }
  if (POSITIVE_CATEGORIES.includes(category)) {
    // Hand hot leads to the humans immediately, inside the CRM they already use.
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;
    const task = await createCrmTask(db, org, p.crmRecordId, `Reply to ${name} (${p.company ?? p.email}): ${category.replace("_", " ")}`);
    const note = await createCrmNote(db, org, p.crmRecordId, `Outbound reply: ${category}`, body);
    await audit(db, campaignId, "engine", "crm.handoff", { prospect: p.email, category, task, note });
  }
}

/** Human review of an ambiguous classification. Appends; never overwrites. */
export async function reviewReply(db: DB, replyId: string, category: ReplyCategory, reviewer: string) {
  const [prev] = await db
    .select()
    .from(replyClassifications)
    .where(eq(replyClassifications.replyId, replyId))
    .orderBy(desc(replyClassifications.createdAt))
    .limit(1);
  await db.insert(replyClassifications).values({
    replyId,
    category,
    confidence: 1,
    objection: prev?.objection ?? null,
    reason: prev && prev.category !== category ? `Human override of ${prev.category}` : "Human confirmed",
    classifier: "human",
    needsReview: false,
    reviewedBy: reviewer,
  });
  const [r] = await db
    .select({ a: assignments, p: prospects, body: replies.body })
    .from(replies)
    .innerJoin(assignments, eq(assignments.id, replies.assignmentId))
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .where(eq(replies.id, replyId));
  if (r) await actOnCategory(db, r.a.id, r.a.campaignId, r.p, category, r.body);
}
