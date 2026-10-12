import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  assignments,
  campaigns,
  enrollments,
  experimentArms,
  experiments,
  messageEvents,
  outboundMessages,
  prospects,
  replies,
  replyClassifications,
  suppressions,
  variants,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { getSender } from "../senders";
import { pickMailbox } from "../senders/mailboxes";
import { complianceFooter, listUnsubscribeHeaders } from "../compliance";
import { enrollExperiment } from "../platform/bridge";
import { env } from "../env";
import { audit, campaignHoursToMs, renderTemplate, seededShuffle, campaignDayStart, campaignNextDay } from "./util";

type Campaign = typeof campaigns.$inferSelect;
type Assignment = typeof assignments.$inferSelect;
type Prospect = typeof prospects.$inferSelect;
type Variant = typeof variants.$inferSelect;

/** Assign the next slice of eligible prospects to this experiment's arms, balanced round-robin. */
async function assignBatch(db: DB, experimentId: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [exp] = await t.select().from(experiments).where(eq(experiments.id, experimentId));
    if (!exp) return 0;
    const [assigned] = await t.select({ n: sql<number>`count(*)` }).from(assignments).where(eq(assignments.experimentId, experimentId));
    const need = exp.batchSize - Number(assigned?.n ?? 0);
    if (need <= 0) return 0;

    const [campaign] = await t.select().from(campaigns).where(eq(campaigns.id, exp.campaignId));
    const [total] = await t.select({ n: sql<number>`count(*)` }).from(assignments).where(eq(assignments.campaignId, exp.campaignId));
    const budget = Math.min(need, campaign!.limits.maxTotalProspects - Number(total?.n ?? 0));
    if (budget <= 0) return 0;

    const arms = await t
      .select({ variantId: experimentArms.variantId })
      .from(experimentArms)
      .innerJoin(variants, eq(variants.id, experimentArms.variantId))
      .where(and(eq(experimentArms.experimentId, experimentId), inArray(variants.status, ["active", "champion"])))
      .orderBy(asc(variants.label));
    if (arms.length === 0) return 0;

    const pool = await t
      .select({ id: enrollments.id, prospectId: enrollments.prospectId })
      .from(enrollments)
      .where(and(eq(enrollments.campaignId, exp.campaignId), eq(enrollments.status, "eligible")))
      .orderBy(asc(enrollments.createdAt))
      .limit(budget * 3);
    const picked = seededShuffle(pool, experimentId).slice(0, budget);
    if (picked.length === 0) return 0;

    await t.insert(assignments).values(
      picked.map((p, i) => ({
        campaignId: exp.campaignId,
        experimentId,
        variantId: arms[i % arms.length]!.variantId,
        prospectId: p.prospectId,
        idempotencyKey: `${exp.campaignId}:${p.prospectId}`,
      })),
    );
    await t.update(enrollments).set({ status: "assigned" }).where(inArray(enrollments.id, picked.map((p) => p.id)));
    return picked.length;
  });
}

async function campaignSentToday(db: DB, campaignId: string, senderProvider: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(outboundMessages)
    .innerJoin(assignments, eq(assignments.id, outboundMessages.assignmentId))
    .where(and(eq(assignments.campaignId, campaignId), gte(outboundMessages.sentAt, campaignDayStart(senderProvider))));
  return Number(row?.n ?? 0);
}

function messageDomain(fromEmail?: string | null) {
  if (fromEmail?.includes("@")) return fromEmail.split("@")[1]!;
  try {
    return new URL(env().APP_URL).hostname || "outbound.local";
  } catch {
    return "outbound.local";
  }
}

export type StepResult = "sent" | "already_sent" | "skipped" | "no_capacity" | "failed";

/**
 * Send one step of a sequence. At-most-once: the outbound_messages row is
 * inserted (unique per assignment+step) *before* the provider call, so a
 * crash can never produce a duplicate email — at worst one is lost and
 * shows up as failed.
 */
export async function sendStep(db: DB, campaign: Campaign, a: Assignment, p: Prospect, v: Variant, step: number): Promise<StepResult> {
  const sender = getSender(campaign.senderProvider);
  const [sup] = await db
    .select()
    .from(suppressions)
    .where(and(eq(suppressions.orgId, campaign.orgId), eq(suppressions.email, p.email)));
  if (sup) {
    if (step === 1) await db.update(assignments).set({ status: "skipped", error: `suppressed: ${sup.reason}` }).where(eq(assignments.id, a.id));
    else await db.update(assignments).set({ sequenceStoppedReason: `suppressed: ${sup.reason}` }).where(eq(assignments.id, a.id));
    return "skipped";
  }

  const mailbox = sender.usesMailboxes ? await pickMailbox(db, campaign.orgId, a.mailboxId) : null;
  if (sender.usesMailboxes && !mailbox) return "no_capacity";

  const previous = await db.select().from(outboundMessages).where(eq(outboundMessages.assignmentId, a.id)).orderBy(asc(outboundMessages.step));
  const first = previous.find((m) => m.step === 1);
  const subject1 = renderTemplate(v.subject, p);
  const content = step === 1 ? v.body : v.followUps[step - 2]?.body;
  if (!content) return "skipped";
  const subject = step === 1 ? subject1 : `Re: ${first?.subject ?? subject1}`;
  const body = renderTemplate(content, p) + complianceFooter(campaign.brief, a.id);
  const messageIdHeader = `<iole.${a.id}.${step}@${messageDomain(mailbox?.email)}>`;

  const [claim] = await db
    .insert(outboundMessages)
    .values({
      assignmentId: a.id,
      step,
      mailboxId: mailbox?.id ?? null,
      fromEmail: mailbox?.email ?? null,
      toEmail: p.email,
      subject,
      body,
      messageIdHeader,
      providerMessageId: messageIdHeader,
      sentAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (!claim) return "already_sent";

  try {
    const res = await sender.send(db, {
      idempotencyKey: `${a.idempotencyKey}:${step}`,
      to: p.email,
      fromName: campaign.brief.senderName,
      subject,
      body,
      step,
      messageIdHeader,
      inReplyTo: first?.messageIdHeader,
      references: previous.map((m) => m.messageIdHeader),
      headers: listUnsubscribeHeaders(a.id),
      mailbox,
      meta: { campaignId: campaign.id, variantId: v.id, contentHash: v.contentHash, assignmentId: a.id, traits: v.traits, persona: campaign.brief.persona },
    });
    const now = new Date();
    if (res.providerMessageId !== messageIdHeader || res.fromEmail) {
      await db
        .update(outboundMessages)
        .set({ providerMessageId: res.providerMessageId, fromEmail: res.fromEmail ?? claim.fromEmail })
        .where(eq(outboundMessages.id, claim.id));
    }
    await db
      .insert(messageEvents)
      .values({ assignmentId: a.id, type: "sent", providerEventId: `sent:${a.idempotencyKey}:${step}`, occurredAt: now, payload: { step } })
      .onConflictDoNothing();
    if (sender.usesMailboxes) {
      // SMTP acceptance is the only delivery signal; a later bounce overrides it.
      await db
        .insert(messageEvents)
        .values({ assignmentId: a.id, type: "delivered", providerEventId: `delivered:${a.idempotencyKey}:${step}`, occurredAt: now, payload: { step } })
        .onConflictDoNothing();
    }
    if (step === 1) {
      await db
        .update(assignments)
        .set({ status: "sent", providerMessageId: res.providerMessageId, sentAt: now, mailboxId: mailbox?.id ?? null, error: null })
        .where(eq(assignments.id, a.id));
      await scheduleFollowUp(db, campaign, a.id, v, 2, now);
    } else {
      await scheduleFollowUp(db, campaign, a.id, v, step + 1, now);
    }
    return "sent";
  } catch (err) {
    await db.delete(outboundMessages).where(eq(outboundMessages.id, claim.id));
    const message = err instanceof Error ? err.message : String(err);
    if (step === 1) await db.update(assignments).set({ status: "failed", error: message }).where(eq(assignments.id, a.id));
    else await db.update(assignments).set({ sequenceStoppedReason: `step ${step} failed: ${message}` }).where(eq(assignments.id, a.id));
    return "failed";
  }
}

async function scheduleFollowUp(db: DB, campaign: Campaign, assignmentId: string, v: Variant, step: number, from: Date) {
  const fu = v.followUps[step - 2];
  if (!fu) return;
  const runAt = new Date(from.getTime() + campaignHoursToMs(fu.delayDays * 24, campaign.senderProvider));
  await enqueue(db, "sequence.followup", { assignmentId, step }, { runAt, dedupeKey: `fu:${assignmentId}:${step}` });
}

/** Total sequence length in campaign hours for a set of variants. */
export function sequenceHours(vs: Pick<Variant, "followUps">[]) {
  return Math.max(0, ...vs.map((v) => v.followUps.reduce((s, f) => s + f.delayDays * 24, 0)));
}

const STOP_EVENTS = ["bounced", "unsubscribed", "complained"] as const;

export async function handleFollowUp(db: DB, assignmentId: string, step: number) {
  const [row] = await db
    .select({ a: assignments, p: prospects, v: variants, c: campaigns })
    .from(assignments)
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .innerJoin(variants, eq(variants.id, assignments.variantId))
    .innerJoin(campaigns, eq(campaigns.id, assignments.campaignId))
    .where(eq(assignments.id, assignmentId));
  if (!row || row.a.status !== "sent" || row.a.sequenceStoppedReason) return;
  const { a, p, v, c } = row;

  const [stop] = await db
    .select({ type: messageEvents.type })
    .from(messageEvents)
    .where(and(eq(messageEvents.assignmentId, a.id), inArray(messageEvents.type, [...STOP_EVENTS])))
    .limit(1);
  if (stop) {
    await db.update(assignments).set({ sequenceStoppedReason: stop.type }).where(eq(assignments.id, a.id));
    return;
  }
  // Replies: out-of-office doesn't stop the sequence; anything else does.
  // An unclassified reply holds the follow-up until classification finishes.
  const replyRows = await db
    .select({ id: replies.id, category: replyClassifications.category })
    .from(replies)
    .leftJoin(replyClassifications, eq(replyClassifications.replyId, replies.id))
    .where(eq(replies.assignmentId, a.id));
  if (replyRows.some((r) => r.category === null)) {
    await enqueue(db, "sequence.followup", { assignmentId, step }, { runAt: new Date(Date.now() + Math.min(600_000, campaignHoursToMs(0.5, c.senderProvider))), dedupeKey: `fu:${assignmentId}:${step}` });
    return;
  }
  if (replyRows.some((r) => r.category !== "auto_reply")) {
    await db.update(assignments).set({ sequenceStoppedReason: "replied" }).where(eq(assignments.id, a.id));
    return;
  }
  if (c.status === "paused") {
    await enqueue(db, "sequence.followup", { assignmentId, step }, { runAt: new Date(Date.now() + campaignHoursToMs(6, c.senderProvider)), dedupeKey: `fu:${assignmentId}:${step}` });
    return;
  }
  if (c.status !== "running") {
    await db.update(assignments).set({ sequenceStoppedReason: `campaign ${c.status}` }).where(eq(assignments.id, a.id));
    return;
  }
  if ((await campaignSentToday(db, c.id, c.senderProvider)) >= c.limits.dailySendCap) {
    await enqueue(db, "sequence.followup", { assignmentId, step }, { runAt: campaignNextDay(c.senderProvider), dedupeKey: `fu:${assignmentId}:${step}` });
    return;
  }
  const result = await sendStep(db, c, a, p, v, step);
  if (result === "no_capacity") {
    await enqueue(db, "sequence.followup", { assignmentId, step }, { runAt: campaignNextDay(c.senderProvider), dedupeKey: `fu:${assignmentId}:${step}` });
  }
}

const STALE_SENDING_MS = 5 * 60 * 1000;

/** Send queued first-touch emails for an experiment within the daily cap. Safe to re-run. */
export async function handleSend(db: DB, experimentId: string) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  if (!exp || exp.status !== "sending") return;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, exp.campaignId));
  if (!campaign || campaign.status !== "running") return;

  await assignBatch(db, experimentId);

  if (campaign.senderProvider === "platform") {
    // The platform schedules the actual sends within mailbox caps and warm-up;
    // evaluation waits until every enrolled lead has been sent step 1.
    const enrolled = await enrollExperiment(db, campaign, experimentId);
    const armVariants = await db
      .select({ followUps: variants.followUps })
      .from(experimentArms)
      .innerJoin(variants, eq(variants.id, experimentArms.variantId))
      .where(eq(experimentArms.experimentId, experimentId));
    const observeUntil = new Date(Date.now() + campaignHoursToMs(sequenceHours(armVariants) + campaign.limits.observationHours, campaign.senderProvider));
    await db.update(experiments).set({ status: "observing", observeUntil, lastSentAt: new Date() }).where(eq(experiments.id, experimentId));
    await db
      .update(campaigns)
      .set({ statusDetail: `Experiment ${exp.seq}: ${enrolled} leads handed to sending; results are judged once their sequences finish` })
      .where(eq(campaigns.id, campaign.id));
    await enqueue(db, "experiment.evaluate", { experimentId }, { runAt: observeUntil, dedupeKey: `eval:${experimentId}` });
    await audit(db, campaign.id, "engine", "experiment.enrolled", { experimentId, seq: exp.seq, enrolled });
    return;
  }

  let allowance = campaign.limits.dailySendCap - (await campaignSentToday(db, campaign.id, campaign.senderProvider));

  const queue = await db
    .select({ a: assignments, p: prospects, v: variants })
    .from(assignments)
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .innerJoin(variants, eq(variants.id, assignments.variantId))
    .where(
      and(
        eq(assignments.experimentId, experimentId),
        or(eq(assignments.status, "queued"), and(eq(assignments.status, "sending"), lt(assignments.createdAt, new Date(Date.now() - STALE_SENDING_MS)))),
      ),
    )
    .orderBy(asc(assignments.createdAt));

  let sent = 0;
  let outOfMailboxCapacity = false;
  for (const { a, p, v } of queue) {
    if (allowance <= 0) break;
    if (sent % 10 === 0) {
      const [c] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaign.id));
      if (c?.status !== "running") return;
    }
    const claimed = await db
      .update(assignments)
      .set({ status: "sending" })
      .where(and(eq(assignments.id, a.id), inArray(assignments.status, ["queued", "sending"])))
      .returning({ id: assignments.id });
    if (claimed.length === 0) continue;
    const result = await sendStep(db, campaign, a, p, v, 1);
    if (result === "sent") {
      sent++;
      allowance--;
    } else if (result === "already_sent") {
      // Crashed after claiming: the email row exists, so treat it as sent (never resend).
      await db.update(assignments).set({ status: "sent", sentAt: a.sentAt ?? new Date() }).where(eq(assignments.id, a.id));
    } else if (result === "no_capacity") {
      await db.update(assignments).set({ status: "queued" }).where(eq(assignments.id, a.id));
      outOfMailboxCapacity = true;
      break;
    }
  }
  if (sent) await db.update(experiments).set({ lastSentAt: new Date() }).where(eq(experiments.id, experimentId));

  const [remaining] = await db
    .select({ n: sql<number>`count(*)` })
    .from(assignments)
    .where(and(eq(assignments.experimentId, experimentId), inArray(assignments.status, ["queued", "sending"])));
  if (Number(remaining?.n ?? 0) > 0) {
    await enqueue(db, "experiment.send", { experimentId }, { runAt: campaignNextDay(campaign.senderProvider), dedupeKey: `send:${experimentId}` });
    await db
      .update(campaigns)
      .set({ statusDetail: `${outOfMailboxCapacity ? "Mailbox capacity" : "Daily cap"} reached; resuming tomorrow (${remaining?.n} queued)` })
      .where(eq(campaigns.id, campaign.id));
    return;
  }

  const [sentTotal] = await db
    .select({ n: sql<number>`count(*)` })
    .from(assignments)
    .where(and(eq(assignments.experimentId, experimentId), eq(assignments.status, "sent")));
  const armVariants = await db
    .select({ followUps: variants.followUps })
    .from(experimentArms)
    .innerJoin(variants, eq(variants.id, experimentArms.variantId))
    .where(eq(experimentArms.experimentId, experimentId));
  // Observe for the whole sequence plus the reply window after its last step.
  const hours = sequenceHours(armVariants) + campaign.limits.observationHours;
  const observeUntil = new Date(Date.now() + campaignHoursToMs(hours, campaign.senderProvider));
  await db.update(experiments).set({ status: "observing", observeUntil }).where(eq(experiments.id, experimentId));
  await db
    .update(campaigns)
    .set({ statusDetail: `Experiment ${exp.seq}: ${sentTotal?.n} sequences started, observing until ${observeUntil.toISOString()}` })
    .where(eq(campaigns.id, campaign.id));
  await enqueue(db, "experiment.evaluate", { experimentId }, { runAt: observeUntil, dedupeKey: `eval:${experimentId}` });
  await audit(db, campaign.id, "engine", "experiment.sent", { experimentId, seq: exp.seq, sent: Number(sentTotal?.n ?? 0) });
}
