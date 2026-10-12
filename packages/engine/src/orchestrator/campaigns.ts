import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  assignments,
  campaigns,
  DEFAULT_LIMITS,
  enrollments,
  experimentArms,
  experiments,
  learningRecords,
  prospects,
  suppressions,
  variants,
  type CampaignBrief,
  type CampaignLimits,
  STANDALONE_ORG,
  type KnowledgeBrief,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { buildKnowledgeBrief } from "../agents/knowledge";
import { getContextProfile } from "../knowledge/documents";
import { checkCopy, finalTraits, planCampaign, type VariantDraft } from "../agents/strategist";
import { playbookFor, rememberBrainGuidelines } from "../memory";
import { setPlatformCampaignsRunning } from "../platform/bridge";
import { sha256 } from "../crypto";
import { audit } from "./util";
import { env } from "../env";

export interface NewCampaign {
  orgId?: string;
  createdBy?: string;
  name: string;
  brief: CampaignBrief;
  limits?: Partial<CampaignLimits>;
  senderProvider?: string;
}

export async function createCampaign(db: DB, input: NewCampaign) {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  if (!limits.batchStages.length) throw new Error("batchStages must not be empty");
  const [row] = await db
    .insert(campaigns)
    .values({
      orgId: input.orgId ?? STANDALONE_ORG,
      createdBy: input.createdBy ?? null,
      name: input.name,
      brief: input.brief,
      limits,
      senderProvider: input.senderProvider ?? env().SENDER_PROVIDER,
    })
    .returning();
  await audit(db, row!.id, "user", "campaign.created", { name: input.name });
  return row!;
}

export interface ContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  persona?: string;
  crmRecordId?: string;
  attributes?: Record<string, string>;
}

const RECENT_CONTACT_DAYS = 90;

/**
 * Upsert prospects and enroll them. Suppressed contacts and anyone contacted
 * by another campaign in the last 90 days are enrolled as "excluded" so the
 * reason is visible but they can never be assigned.
 */
export async function enrollContacts(db: DB, campaignId: string, contacts: ContactInput[], source: "csv" | "crm") {
  if (contacts.length === 0) return { enrolled: 0, excluded: 0, reasons: {} as Record<string, number> };
  const emails = contacts.map((c) => c.email.toLowerCase());
  const reasons: Record<string, number> = {};
  const [camp] = await db.select({ orgId: campaigns.orgId }).from(campaigns).where(eq(campaigns.id, campaignId));
  if (!camp) throw new Error("Campaign not found");
  const org = camp.orgId;

  for (let i = 0; i < contacts.length; i += 500) {
    const chunk = contacts.slice(i, i + 500);
    await db
      .insert(prospects)
      .values(
        chunk.map((c) => ({
          orgId: org,
          email: c.email.toLowerCase(),
          firstName: c.firstName ?? null,
          lastName: c.lastName ?? null,
          company: c.company ?? null,
          title: c.title ?? null,
          persona: c.persona ?? null,
          source,
          crmRecordId: c.crmRecordId ?? null,
          attributes: c.attributes ?? {},
        })),
      )
      .onConflictDoUpdate({
        target: [prospects.orgId, prospects.email],
        set: {
          firstName: sql`coalesce(excluded.first_name, ${prospects.firstName})`,
          lastName: sql`coalesce(excluded.last_name, ${prospects.lastName})`,
          company: sql`coalesce(excluded.company, ${prospects.company})`,
          title: sql`coalesce(excluded.title, ${prospects.title})`,
          persona: sql`coalesce(excluded.persona, ${prospects.persona})`,
          crmRecordId: sql`coalesce(excluded.crm_record_id, ${prospects.crmRecordId})`,
        },
      });
  }

  let enrolled = 0;
  let excluded = 0;
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const rows = await db
      .select({ id: prospects.id, email: prospects.email })
      .from(prospects)
      .where(and(eq(prospects.orgId, org), inArray(prospects.email, chunk)));
    const suppressed = new Set(
      (
        await db
          .select({ email: suppressions.email })
          .from(suppressions)
          .where(and(eq(suppressions.orgId, org), inArray(suppressions.email, chunk)))
      ).map((r) => r.email),
    );
    const since = new Date(Date.now() - RECENT_CONTACT_DAYS * 86400000);
    const recent = new Set(
      (
        await db
          .select({ prospectId: assignments.prospectId })
          .from(assignments)
          .where(
            and(
              inArray(assignments.prospectId, rows.map((r) => r.id)),
              ne(assignments.campaignId, campaignId),
              gt(assignments.sentAt, since),
            ),
          )
      ).map((r) => r.prospectId),
    );
    const values = rows.map((r) => {
      const reason = suppressed.has(r.email) ? "suppressed" : recent.has(r.id) ? `contacted by another campaign in the last ${RECENT_CONTACT_DAYS} days` : null;
      if (reason) {
        excluded++;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      } else enrolled++;
      return { campaignId, prospectId: r.id, status: (reason ? "excluded" : "eligible") as "excluded" | "eligible", exclusionReason: reason };
    });
    if (values.length) await db.insert(enrollments).values(values).onConflictDoNothing();
  }
  await audit(db, campaignId, "user", "audience.enrolled", { source, enrolled, excluded, reasons });
  return { enrolled, excluded, reasons };
}

export async function startPlanning(db: DB, campaignId: string) {
  await db.update(campaigns).set({ status: "planning", statusDetail: "Reading your knowledge" }).where(eq(campaigns.id, campaignId));
  await enqueue(db, "campaign.plan", { campaignId }, { dedupeKey: `plan:${campaignId}`, maxAttempts: 3 });
}

export async function nextVariantLabel(db: DB, campaignId: string) {
  const [row] = await db.select({ n: sql<number>`count(distinct ${variants.label})` }).from(variants).where(eq(variants.campaignId, campaignId));
  return `V${Number(row?.n ?? 0) + 1}`;
}

export const variantHash = (d: Pick<VariantDraft, "subject" | "body" | "followUps">) =>
  sha256(`${d.subject}\n---\n${d.body}\n---\n${d.followUps.map((f) => `${f.delayDays}:${f.body}`).join("\n---\n")}`);

export async function insertVariant(db: DB, campaignId: string, draft: VariantDraft, knowledge: KnowledgeBrief, status: "draft" | "active" | "champion") {
  const label = await nextVariantLabel(db, campaignId);
  const problems = checkCopy(draft, knowledge);
  const [row] = await db
    .insert(variants)
    .values({
      campaignId,
      label,
      angle: draft.angle,
      cta: draft.cta,
      subject: draft.subject,
      body: draft.body,
      rationale: problems.length ? `${draft.rationale}\n\n⚠ Copy check: ${problems.join("; ")}` : draft.rationale,
      sourceRefs: draft.sourceRefs,
      followUps: draft.followUps,
      traits: finalTraits(draft),
      contentHash: variantHash(draft),
      status,
    })
    .returning();
  return { variant: row!, problems };
}

export async function handlePlan(db: DB, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || campaign.status !== "planning") return;

  const prior = await db
    .select({ observation: learningRecords.observation, scope: learningRecords.scope, confidence: learningRecords.confidence })
    .from(learningRecords)
    .innerJoin(campaigns, eq(campaigns.id, learningRecords.campaignId))
    .where(eq(campaigns.orgId, campaign.orgId))
    .orderBy(desc(learningRecords.createdAt))
    .limit(15);
  const priorLearnings = prior.map((p) => `[${p.confidence}] ${p.observation} (scope: ${p.scope})`);

  const knowledge = await buildKnowledgeBrief(db, campaign.orgId, campaign.brief, priorLearnings);
  // Document rules are already in memory (source "document"); only Brain rules are new here.
  const docRules = new Set((await getContextProfile(db, campaign.orgId))?.voice?.rules ?? []);
  await rememberBrainGuidelines(db, campaign.orgId, (knowledge.voiceGuidelines ?? []).filter((g) => !docRules.has(g)), campaign.brief.persona);
  await db.update(campaigns).set({ knowledge, statusDetail: "Designing experiments" }).where(eq(campaigns.id, campaignId));

  const memory = await playbookFor(db, campaign.orgId, campaign.brief.persona);
  const { plan, firstExperiment } = await planCampaign(campaign.brief, knowledge, memory, campaign.limits.followUpDelaysDays ?? []);
  const drafts = firstExperiment.variants.slice(0, 3);
  if (drafts.length < 2) throw new Error("Strategist returned fewer than 2 variants");

  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [exp] = await t
      .insert(experiments)
      .values({
        campaignId,
        seq: 1,
        hypothesis: firstExperiment.hypothesis,
        variableTested: firstExperiment.variableTested,
        status: "pending_approval",
        batchSize: campaign.limits.batchStages[0]!,
      })
      .returning();
    const allProblems: string[] = [];
    for (const d of drafts) {
      const { variant, problems } = await insertVariant(t, campaignId, d, knowledge, "draft");
      allProblems.push(...problems.map((p) => `${variant.label}: ${p}`));
      await t.insert(experimentArms).values({ experimentId: exp!.id, variantId: variant.id, role: "explore" });
    }
    await t
      .update(campaigns)
      .set({
        plan: { ...plan, risks: [...plan.risks, ...allProblems] },
        status: "awaiting_approval",
        statusDetail: allProblems.length ? "Review copy warnings before approving" : "Ready for your approval",
      })
      .where(eq(campaigns.id, campaignId));
  });
  await audit(db, campaignId, "engine", "campaign.planned", { variants: drafts.length, knowledgeSources: knowledge.sources.length });
}

/** The single human approval: audience, copy, limits. After this the engine runs on its own. */
export async function approveCampaign(db: DB, campaignId: string, approvedBy: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "awaiting_approval") throw new Error(`Campaign is ${campaign.status}, not awaiting approval`);
  const pending = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.campaignId, campaignId), eq(experiments.status, "pending_approval")));
  const [eligible] = await db
    .select({ n: sql<number>`count(*)` })
    .from(enrollments)
    .where(and(eq(enrollments.campaignId, campaignId), eq(enrollments.status, "eligible")));
  if (Number(eligible?.n ?? 0) === 0) throw new Error("No eligible prospects enrolled");

  await db
    .update(campaigns)
    .set({ status: "running", statusDetail: "Sending first batch", approvedAt: new Date(), approvedBy })
    .where(eq(campaigns.id, campaignId));
  for (const exp of pending) await activateExperiment(db, exp.id);
  await audit(db, campaignId, "user", "campaign.approved", { approvedBy, limits: campaign.limits });
}

export async function activateExperiment(db: DB, experimentId: string) {
  const arms = await db.select().from(experimentArms).where(eq(experimentArms.experimentId, experimentId));
  const draftIds = arms.map((a) => a.variantId);
  if (draftIds.length) {
    await db.update(variants).set({ status: "active" }).where(and(inArray(variants.id, draftIds), eq(variants.status, "draft")));
  }
  await db.update(experiments).set({ status: "sending", sendingStartedAt: new Date() }).where(eq(experiments.id, experimentId));
  await enqueue(db, "experiment.send", { experimentId }, { dedupeKey: `send:${experimentId}` });
}

/** Approve engine-generated copy when the campaign requires it. */
export async function approveExperiment(db: DB, experimentId: string, approvedBy: string) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  if (!exp || exp.status !== "pending_approval") throw new Error("Experiment is not awaiting approval");
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, exp.campaignId));
  if (campaign?.status === "awaiting_approval") return approveCampaign(db, exp.campaignId, approvedBy);
  await activateExperiment(db, experimentId);
  await db.update(campaigns).set({ statusDetail: `Experiment ${exp.seq} approved` }).where(eq(campaigns.id, exp.campaignId));
  await audit(db, exp.campaignId, "user", "experiment.approved", { experimentId, approvedBy });
}

export async function pauseCampaign(db: DB, campaignId: string, actor: "user" | "engine", reason: string) {
  await db.update(campaigns).set({ status: "paused", statusDetail: reason }).where(eq(campaigns.id, campaignId));
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (c?.senderProvider === "platform") await setPlatformCampaignsRunning(db, c, false);
  await audit(db, campaignId, actor, "campaign.paused", { reason });
}

export async function resumeCampaign(db: DB, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (campaign?.status !== "paused") throw new Error("Campaign is not paused");
  await db.update(campaigns).set({ status: "running", statusDetail: "Resumed" }).where(eq(campaigns.id, campaignId));
  if (campaign.senderProvider === "platform") await setPlatformCampaignsRunning(db, campaign, true);
  const active = await db
    .select()
    .from(experiments)
    .where(and(eq(experiments.campaignId, campaignId), inArray(experiments.status, ["sending", "observing"])));
  for (const exp of active) {
    if (exp.status === "sending") await enqueue(db, "experiment.send", { experimentId: exp.id }, { dedupeKey: `send:${exp.id}` });
    else await enqueue(db, "experiment.evaluate", { experimentId: exp.id }, { runAt: exp.observeUntil ?? new Date(), dedupeKey: `eval:${exp.id}` });
  }
  await audit(db, campaignId, "user", "campaign.resumed", {});
}

/**
 * Edit draft copy before it is ever sent. Sent variants are immutable; once a
 * variant is active, a change must be a new variant.
 */
export async function editDraftVariant(
  db: DB,
  variantId: string,
  input: { subject: string; body: string; followUps: { delayDays: number; body: string }[] },
  by: string,
) {
  const [v] = await db.select().from(variants).where(eq(variants.id, variantId));
  if (!v) throw new Error("Variant not found");
  if (v.status !== "draft") throw new Error("Only draft variants can be edited; sent copy is frozen");
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, v.campaignId));
  const problems = checkCopy({ ...input, sourceRefs: v.sourceRefs }, campaign!.knowledge!);
  const baseRationale = v.rationale.split("\n\n⚠ Copy check:")[0]!.split("\n\nEdited by")[0]!;
  await db
    .update(variants)
    .set({
      subject: input.subject,
      body: input.body,
      followUps: input.followUps,
      traits: { ...v.traits, ...finalTraits({ subject: input.subject, body: input.body, traits: v.traits as VariantDraft["traits"] }) },
      contentHash: variantHash(input),
      rationale: problems.length ? `${baseRationale}\n\n⚠ Copy check: ${problems.join("; ")}` : `${baseRationale}\n\nEdited by ${by}.`,
    })
    .where(eq(variants.id, variantId));
  await audit(db, v.campaignId, "user", "variant.edited", { variantId, label: v.label, by, problems });
  return problems;
}
