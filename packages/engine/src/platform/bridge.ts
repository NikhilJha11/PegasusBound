import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  assignments,
  campaigns,
  experimentArms,
  experiments,
  meetings,
  messageEvents,
  outboundMessages,
  platformCampaigns,
  prospects,
  variants,
} from "../db/schema";
import { recordAssignmentEvent } from "../orchestrator/events";
import { audit } from "../orchestrator/util";
import { idem, orgKey, platformRequest } from "./client";

/**
 * Bridge between the intelligence engine and the Pegasusbound sending
 * platform. Each experiment arm (one frozen variant inside one experiment)
 * runs as a native platform campaign, so the platform's mailboxes, warm-up,
 * caps, threading, stop-on-reply, unsubscribe and suppression all apply.
 * The engine decides who gets which variant and when to scale.
 */

type Campaign = typeof campaigns.$inferSelect;
type Variant = typeof variants.$inferSelect;

/** Our merge fields → the platform's Go-template fields (with safe fallbacks). */
export function toPlatformTemplate(text: string) {
  return text
    .replaceAll("{{first_name}}", "{{if .FirstName}}{{.FirstName}}{{else}}there{{end}}")
    .replaceAll("{{company}}", "{{if .Company}}{{.Company}}{{else}}your team{{end}}")
    .replaceAll("{{title}}", "your role");
}

/** Platform campaign names are 3–50 bytes (UTF-8): keep the suffix, trim the title to fit. */
export function platformCampaignName(title: string, seq: number, label: string) {
  const suffix = ` #${seq} ${label}`;
  const fits = (t: string) => Buffer.byteLength(`AI: ${t}${suffix}`, "utf8") <= 50;
  let t = title.trim().replace(/\s+/g, " ");
  if (!fits(t)) {
    const chars = [...t];
    while (chars.length && !fits(`${chars.join("").trimEnd()}...`)) chars.pop();
    t = `${chars.join("").trimEnd()}...`;
  }
  return `AI: ${t}${suffix}`;
}

async function ensurePlatformCampaign(db: DB, campaign: Campaign, experimentId: string, seq: number, v: Variant, armCount: number) {
  const [existing] = await db
    .select()
    .from(platformCampaigns)
    .where(and(eq(platformCampaigns.experimentId, experimentId), eq(platformCampaigns.variantId, v.id)));
  if (existing) return existing;

  const key = await orgKey(db, campaign.orgId);
  const steps = [
    { name: "Step 1", subject: toPlatformTemplate(v.subject), body_plain: toPlatformTemplate(v.body), wait_after: 0 },
    ...v.followUps.map((f, i) => ({
      name: `Follow-up ${i + 1}`,
      subject: "",
      body_plain: toPlatformTemplate(f.body),
      wait_after: f.delayDays,
      thread_reply: true,
    })),
  ];
  const createBody = {
      name: platformCampaignName(campaign.name, seq, v.label),
      description: `Managed by Pegasusbound Intelligence. Experiment #${seq}, variant ${v.label} (${v.angle}). Don't edit the copy here: results are tied to this exact version.`,
      stop_on_reply: true,
      text_only: true,
      open_tracking: false,
      link_tracking: false,
      unsubscribe_header: true,
      daily_limit: Math.max(1, Math.ceil(campaign.limits.dailySendCap / Math.max(1, armCount))),
      sender_strategy: "tags",
      ...(campaign.limits.timezone ? { timezone: campaign.limits.timezone } : {}),
      start_time: campaign.limits.sendStart ?? "08:00",
      end_time: campaign.limits.sendEnd ?? "18:00",
      days: campaign.limits.sendDays ?? 31,
      steps,
  };
  // The key covers the exact body: an identical retry dedupes, a changed request gets a new key.
  const created = await platformRequest<{ id: string }>(key, "POST", "/campaigns", createBody, {
    idempotencyKey: idem("create-campaign", experimentId, v.id, JSON.stringify(createBody)),
  });
  const stepList = await platformRequest<{ data?: { id: string }[] } | { id: string }[]>(key, "GET", `/campaigns/${created.id}/steps`);
  const stepIds = (Array.isArray(stepList) ? stepList : (stepList.data ?? [])).map((s) => s.id);
  const [row] = await db
    .insert(platformCampaigns)
    .values({ orgId: campaign.orgId, campaignId: campaign.id, experimentId, variantId: v.id, platformCampaignId: created.id, stepIds })
    .onConflictDoNothing()
    .returning();
  await audit(db, campaign.id, "engine", "platform.campaign_created", { experimentId, variant: v.label, platformCampaignId: created.id });
  return row ?? (await db.select().from(platformCampaigns).where(eq(platformCampaigns.platformCampaignId, created.id)))[0]!;
}

/**
 * Hand the experiment's queued assignments to the platform. Idempotent:
 * contact upserts and campaign links are no-ops when repeated, and each
 * chunk carries an Idempotency-Key.
 */
export async function enrollExperiment(db: DB, campaign: Campaign, experimentId: string) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  const arms = await db
    .select({ v: variants })
    .from(experimentArms)
    .innerJoin(variants, eq(variants.id, experimentArms.variantId))
    .where(and(eq(experimentArms.experimentId, experimentId), inArray(variants.status, ["active", "champion"])));
  const key = await orgKey(db, campaign.orgId);
  let enrolled = 0;
  for (const { v } of arms) {
    const queued = await db
      .select({ a: assignments, p: prospects })
      .from(assignments)
      .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
      .where(and(eq(assignments.experimentId, experimentId), eq(assignments.variantId, v.id), inArray(assignments.status, ["queued", "sending"])))
      .orderBy(asc(assignments.createdAt));
    if (queued.length === 0) continue;
    const pc = await ensurePlatformCampaign(db, campaign, experimentId, exp!.seq, v, arms.length);
    for (let i = 0; i < queued.length; i += 200) {
      const chunk = queued.slice(i, i + 200);
      await platformRequest(
        key,
        "POST",
        "/contacts",
        chunk.map(({ p }) => ({
          email: p.email,
          first_name: p.firstName ?? "",
          last_name: p.lastName ?? "",
          company: p.company ?? "",
          campaigns: [pc.platformCampaignId],
          custom_fields: p.title ? { title: p.title } : {},
        })),
        { idempotencyKey: idem("enroll", pc.platformCampaignId, ...chunk.map((c) => c.a.id)) },
      );
      await db
        .update(assignments)
        .set({ status: "enrolled" })
        .where(inArray(assignments.id, chunk.map((c) => c.a.id)));
      enrolled += chunk.length;
    }
    await platformRequest(key, "POST", `/campaigns/${pc.platformCampaignId}/start`, undefined, { idempotencyKey: idem("start", pc.platformCampaignId, String(Date.now() / 3.6e6 | 0)) }).catch(
      async (err) => {
        // Already running is fine; anything else is surfaced but doesn't undo enrollment.
        if (!/already|running|active/i.test(String(err))) await audit(db, campaign.id, "engine", "platform.start_failed", { error: String(err) });
      },
    );
  }
  return enrolled;
}

/** Pause or resume every platform campaign behind an engine campaign. */
export async function setPlatformCampaignsRunning(db: DB, campaign: Campaign, running: boolean) {
  const rows = await db.select().from(platformCampaigns).where(eq(platformCampaigns.campaignId, campaign.id));
  if (rows.length === 0) return;
  const key = await orgKey(db, campaign.orgId);
  for (const r of rows) {
    try {
      await platformRequest(key, "POST", `/campaigns/${r.platformCampaignId}/${running ? "start" : "stop"}`);
    } catch (err) {
      await audit(db, campaign.id, "engine", running ? "platform.start_failed" : "platform.stop_failed", { platformCampaignId: r.platformCampaignId, error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Inbound: platform events → learning loop
// ---------------------------------------------------------------------------

type EventData = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

async function resolve(db: DB, orgId: string, data: EventData) {
  const platformCampaignId = str(data.campaign_id);
  const email = str(data.contact_email || data.recipient).toLowerCase();
  if (!platformCampaignId || !email) return null;
  const [pc] = await db
    .select()
    .from(platformCampaigns)
    .where(and(eq(platformCampaigns.orgId, orgId), eq(platformCampaigns.platformCampaignId, platformCampaignId)));
  if (!pc) return null; // not an AI-managed campaign
  const [row] = await db
    .select({ a: assignments })
    .from(assignments)
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .where(and(eq(assignments.experimentId, pc.experimentId), eq(prospects.orgId, orgId), eq(prospects.email, email)));
  return row ? { pc, a: row.a } : null;
}

/**
 * Apply one platform event. Returns false when the event isn't about an
 * AI-managed campaign (it is then simply dropped from the outbox).
 */
export async function handlePlatformEvent(db: DB, orgId: string, eventType: string, data: EventData, eventKey: string): Promise<boolean> {
  if (eventType === "meeting.booked" || eventType === "meeting.canceled" || eventType === "meeting.rescheduled") {
    return handleMeeting(db, orgId, eventType, data);
  }
  const hit = await resolve(db, orgId, data);
  if (!hit) return false;
  const { pc, a } = hit;
  const now = new Date();

  switch (eventType) {
    case "campaign.email_sent": {
      const stepIndex = Math.max(0, pc.stepIds.indexOf(str(data.sequence_id)));
      const step = stepIndex + 1;
      const taskId = str(data._task_id) || `${a.id}:${step}`;
      const providerMessageId = `pb:${taskId}`;
      const [om] = await db
        .insert(outboundMessages)
        .values({
          assignmentId: a.id,
          step,
          fromEmail: str(data.from_email) || null,
          toEmail: str(data.contact_email),
          subject: str(data._subject),
          body: str(data._body_text),
          messageIdHeader: providerMessageId,
          providerMessageId,
          sentAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!om) return true;
      await db
        .insert(messageEvents)
        .values([
          { assignmentId: a.id, type: "sent", providerEventId: `pb:sent:${taskId}`, occurredAt: now, payload: { step } },
          // Accepted by the mailbox provider; a later bounce event overrides it.
          { assignmentId: a.id, type: "delivered", providerEventId: `pb:delivered:${taskId}`, occurredAt: now, payload: { step } },
        ])
        .onConflictDoNothing();
      if (step === 1 && a.status !== "sent") {
        await db.update(assignments).set({ status: "sent", sentAt: now, providerMessageId }).where(eq(assignments.id, a.id));
        await db.update(experiments).set({ lastSentAt: now }).where(eq(experiments.id, pc.experimentId));
      }
      return true;
    }
    case "campaign.reply_received": {
      const body = str(data._body_text) || str(data.snippet);
      await recordAssignmentEvent(db, a, {
        providerMessageId: a.providerMessageId ?? "",
        providerEventId: `pb:reply:${str(data._message_id) || eventKey}`,
        type: "replied",
        occurredAt: now,
        replyBody: body || "(empty reply)",
        fromEmail: str(data.contact_email),
        payload: { platformIntent: str(data.intent), platformConfidence: data.confidence ?? null, threadId: str(data.thread_id) },
      });
      return true;
    }
    case "campaign.email_bounced":
    case "deliverability.bounce":
      await recordAssignmentEvent(db, a, {
        providerMessageId: a.providerMessageId ?? "",
        providerEventId: `pb:bounce:${pc.platformCampaignId}:${a.id}`,
        type: "bounced",
        occurredAt: now,
        payload: { reason: str(data.reason) },
      });
      return true;
    case "campaign.unsubscribed":
      await recordAssignmentEvent(db, a, {
        providerMessageId: a.providerMessageId ?? "",
        providerEventId: `pb:unsub:${pc.platformCampaignId}:${a.id}`,
        type: "unsubscribed",
        occurredAt: now,
        payload: { source: str(data.source) },
      });
      return true;
    case "deliverability.complaint":
      await recordAssignmentEvent(db, a, {
        providerMessageId: a.providerMessageId ?? "",
        providerEventId: `pb:complaint:${pc.platformCampaignId}:${a.id}`,
        type: "complained",
        occurredAt: now,
      });
      return true;
    default:
      return false;
  }
}

async function handleMeeting(db: DB, orgId: string, eventType: string, data: EventData) {
  const email = str(data.contact_email || data.email || data.attendee_email).toLowerCase();
  if (!email) return false;
  // The most recent AI-managed assignment for this person in the organization.
  const [row] = await db
    .select({ a: assignments })
    .from(assignments)
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .innerJoin(campaigns, eq(campaigns.id, assignments.campaignId))
    .where(and(eq(campaigns.orgId, orgId), eq(prospects.email, email), sql`${assignments.status} IN ('enrolled', 'sent')`))
    .orderBy(sql`${assignments.sentAt} DESC NULLS LAST`)
    .limit(1);
  if (!row) return false;
  const status = eventType === "meeting.canceled" ? "requested" : "booked";
  await db
    .insert(meetings)
    .values({ campaignId: row.a.campaignId, assignmentId: row.a.id, bookedAt: new Date(), status, source: "platform" })
    .onConflictDoUpdate({ target: meetings.assignmentId, set: { status, source: "platform" } });
  return true;
}

/**
 * Drain the platform's intelligence outbox (written by the Go backend's
 * intelsink). Rows are claimed with SKIP LOCKED and deleted once applied, so
 * every event is processed at least once; handlers are idempotent.
 */
export async function drainPlatformOutbox(db: DB, limit = 200): Promise<number> {
  const res = await db.execute(sql`
    UPDATE intelligence_event_outbox SET claimed_until = now() + interval '5 minutes'
    WHERE id IN (
      SELECT id FROM intelligence_event_outbox
      WHERE claimed_until IS NULL OR claimed_until < now()
      ORDER BY id LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, event_type, data`);
  const rows = (res as unknown as { rows: { id: string; organization_id: string; event_type: string; data: EventData }[] }).rows;
  for (const r of rows) {
    try {
      await handlePlatformEvent(db, r.organization_id, r.event_type, r.data ?? {}, String(r.id));
      await db.execute(sql`DELETE FROM intelligence_event_outbox WHERE id = ${r.id}`);
    } catch (err) {
      // Leave it claimed; it becomes visible again when the claim expires.
      console.error(`[engine] outbox event ${r.id} (${r.event_type}) failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return rows.length;
}

/** True when the platform outbox table exists (i.e. we're running inside Pegasusbound). */
export async function platformOutboxAvailable(db: DB) {
  const res = await db.execute(sql`SELECT to_regclass('public.intelligence_event_outbox') IS NOT NULL AS ok`);
  return Boolean((res as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok);
}
