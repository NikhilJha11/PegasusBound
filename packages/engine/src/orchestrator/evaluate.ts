import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  assignments,
  campaigns,
  enrollments,
  experimentArms,
  experiments,
  learningRecords,
  replies,
  replyClassifications,
  variants,
  type ExperimentEvaluation,
  type VariantStats,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import { decide } from "../stats/decision";
import { generateChallenger, reviseVariants, type VariantDraft } from "../agents/strategist";
import { confidenceFrom, writeLearning } from "../agents/learner";
import { activateExperiment, insertVariant, pauseCampaign } from "./campaigns";
import { playbookFor } from "../memory";
import { emptyCounts, variantCounts } from "./stats";
import { sequenceHours } from "./send";
import { audit, campaignHoursToMs } from "./util";

type Campaign = typeof campaigns.$inferSelect;
type Variant = typeof variants.$inferSelect;

const MAX_CLASSIFY_DEFERRALS = 10;

export async function handleEvaluate(db: DB, experimentId: string, deferrals = 0) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
  if (!exp || exp.status !== "observing") return;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, exp.campaignId));
  if (!campaign || campaign.status !== "running") return;

  // Don't evaluate while replies are still waiting for classification.
  const [unclassified] = await db
    .select({ n: sql<number>`count(*)` })
    .from(replies)
    .innerJoin(assignments, eq(assignments.id, replies.assignmentId))
    .leftJoin(replyClassifications, eq(replyClassifications.replyId, replies.id))
    .where(and(eq(assignments.campaignId, campaign.id), isNull(replyClassifications.id)));
  if (Number(unclassified?.n ?? 0) > 0 && deferrals < MAX_CLASSIFY_DEFERRALS) {
    await enqueue(db, "experiment.evaluate", { experimentId, deferrals: deferrals + 1 }, { runAt: new Date(Date.now() + Math.min(30_000, campaignHoursToMs(0.25, campaign.senderProvider))), dedupeKey: `eval:${experimentId}` });
    return;
  }

  // Senders that schedule on their own (platform caps, daily limits) can still
  // be working through the batch: judge only once every sequence has had its
  // full observation window after the last first-touch email.
  const [progress] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${assignments.status} in ('queued', 'sending', 'enrolled'))`,
      lastSent: sql<string | null>`max(${assignments.sentAt})`,
    })
    .from(assignments)
    .where(eq(assignments.experimentId, experimentId));
  const armFollowUps = await db
    .select({ followUps: variants.followUps })
    .from(experimentArms)
    .innerJoin(variants, eq(variants.id, experimentArms.variantId))
    .where(eq(experimentArms.experimentId, experimentId));
  const windowMs = campaignHoursToMs(sequenceHours(armFollowUps) + campaign.limits.observationHours, campaign.senderProvider);
  const pending = Number(progress?.pending ?? 0);
  const startedAt = exp.sendingStartedAt ?? exp.createdAt;
  const stuckFor = Date.now() - startedAt.getTime();
  if (pending > 0 && stuckFor < Math.max(windowMs, 1) * 4) {
    await enqueue(db, "experiment.evaluate", { experimentId }, { runAt: new Date(Date.now() + Math.min(6 * 3600_000, Math.max(windowMs / 8, 1000))), dedupeKey: `eval:${experimentId}` });
    await db.update(campaigns).set({ statusDetail: `Experiment ${exp.seq}: ${pending} leads still waiting to be sent` }).where(eq(campaigns.id, campaign.id));
    return;
  }
  if (pending > 0) {
    // Never sent (mailbox capacity, provider error): don't let them distort results.
    await db
      .update(assignments)
      .set({ status: "skipped", error: "Not sent within the experiment window" })
      .where(and(eq(assignments.experimentId, experimentId), inArray(assignments.status, ["queued", "sending", "enrolled"])));
  }
  if (progress?.lastSent) {
    const due = new Date(new Date(progress.lastSent).getTime() + windowMs);
    if (due.getTime() > Date.now() + 1000) {
      await enqueue(db, "experiment.evaluate", { experimentId }, { runAt: due, dedupeKey: `eval:${experimentId}` });
      return;
    }
  }

  const arms = await db
    .select({ arm: experimentArms, v: variants })
    .from(experimentArms)
    .innerJoin(variants, eq(variants.id, experimentArms.variantId))
    .where(eq(experimentArms.experimentId, experimentId))
    .orderBy(asc(variants.label));
  const counts = await variantCounts(db, campaign.id);
  const [eligible] = await db
    .select({ n: sql<number>`count(*)` })
    .from(enrollments)
    .where(and(eq(enrollments.campaignId, campaign.id), eq(enrollments.status, "eligible")));
  const [assignedTotal] = await db.select({ n: sql<number>`count(*)` }).from(assignments).where(eq(assignments.campaignId, campaign.id));
  const remainingBudget = Math.min(Number(eligible?.n ?? 0), campaign.limits.maxTotalProspects - Number(assignedTotal?.n ?? 0));
  const [expCount] = await db.select({ n: sql<number>`count(*)` }).from(experiments).where(eq(experiments.campaignId, campaign.id));

  const liveArms = arms.filter((a) => a.v.status === "active" || a.v.status === "champion");
  const decision = decide({
    variants: liveArms.map(({ v }) => {
      const c = counts.get(v.id) ?? emptyCounts(v.id);
      return { ...c, key: v.label };
    }),
    limits: campaign.limits,
    stageIndex: campaign.stageIndex,
    experimentsRun: Number(expCount?.n ?? 0),
    remainingBudget,
  });

  const stats: VariantStats[] = liveArms.map(({ v }) => {
    const c = counts.get(v.id) ?? emptyCounts(v.id);
    const post = decision.posteriors[v.id]!;
    return { ...c, key: v.label, posteriorMean: post.mean, ci90: post.ci90, pBest: post.pBest };
  });
  const evaluation: ExperimentEvaluation = {
    evaluatedAt: new Date().toISOString(),
    stats,
    decision: {
      action: decision.action,
      winnerVariantId: decision.winnerVariantId,
      retireVariantIds: decision.retireVariantIds,
      nextBatchSize: decision.nextBatchSize,
      rationale: decision.rationale,
    },
  };

  // Learning record: numbers from the database, words from the model.
  const samples = await db
    .select({ label: variants.label, body: replies.body, category: replyClassifications.category, objection: replyClassifications.objection })
    .from(replies)
    .innerJoin(assignments, eq(assignments.id, replies.assignmentId))
    .innerJoin(variants, eq(variants.id, assignments.variantId))
    .innerJoin(replyClassifications, eq(replyClassifications.replyId, replies.id))
    .where(inArray(assignments.variantId, liveArms.map((a) => a.v.id)))
    .orderBy(desc(replies.receivedAt))
    .limit(60);
  let narrative: string | undefined;
  try {
    const learning = await writeLearning({
      brief: campaign.brief,
      hypothesis: exp.hypothesis,
      variableTested: exp.variableTested,
      variants: liveArms.map(({ v }) => ({ id: v.id, label: v.label, angle: v.angle, cta: v.cta, subject: v.subject })),
      evaluation,
      replySamples: samples.map((s) => ({ variantLabel: s.label, category: s.category, objection: s.objection, text: s.body.slice(0, 400) })),
    });
    narrative = learning.narrative;
    const [lr] = await db
      .insert(learningRecords)
      .values({
        campaignId: campaign.id,
        experimentId,
        observation: learning.observation,
        scope: learning.scope,
        evidence: {
          experimentSeq: exp.seq,
          hypothesis: exp.hypothesis,
          variableTested: exp.variableTested,
          variants: liveArms.map(({ v }) => ({ id: v.id, label: v.label, version: v.version, contentHash: v.contentHash, angle: v.angle })),
          stats,
          decision: evaluation.decision,
          objectionThemes: learning.objectionThemes,
        },
        confidence: confidenceFrom(stats, decision.winnerVariantId),
        limitations: learning.limitations,
        nextAction: learning.nextAction,
      })
      .returning();
    await enqueue(db, "learning.writeback", { learningId: lr!.id }, { dedupeKey: `writeback:${lr!.id}` });
  } catch (err) {
    await audit(db, campaign.id, "engine", "learning.failed", { error: err instanceof Error ? err.message : String(err) });
  }

  await db.update(experiments).set({ status: "evaluated", evaluation: { ...evaluation, narrative } }).where(eq(experiments.id, experimentId));
  await audit(db, campaign.id, "engine", "experiment.evaluated", { experimentId, seq: exp.seq, decision: evaluation.decision });
  await enqueue(db, "memory.refresh", { orgId: campaign.orgId }, { dedupeKey: `memory.refresh:${campaign.orgId}` });
  await act(db, campaign, exp, liveArms.map((a) => a.v), decision);
}

async function act(
  db: DB,
  campaign: Campaign,
  exp: typeof experiments.$inferSelect,
  live: Variant[],
  decision: ReturnType<typeof decide>,
) {
  const retire = async (ids: string[]) => {
    if (ids.length) await db.update(variants).set({ status: "retired" }).where(inArray(variants.id, ids));
  };

  switch (decision.action) {
    case "pause_health":
      await pauseCampaign(db, campaign.id, "engine", decision.rationale.join(" "));
      return;

    case "stop": {
      if (decision.winnerVariantId) await db.update(variants).set({ status: "champion" }).where(eq(variants.id, decision.winnerVariantId));
      await db.update(campaigns).set({ status: "completed", statusDetail: decision.rationale.join(" ") }).where(eq(campaigns.id, campaign.id));
      await audit(db, campaign.id, "engine", "campaign.completed", { winner: decision.winnerVariantId });
      return;
    }

    case "scale": {
      const champion = live.find((v) => v.id === decision.winnerVariantId)!;
      await db.update(variants).set({ status: "champion" }).where(eq(variants.id, champion.id));
      await retire(decision.retireVariantIds);
      await db.update(campaigns).set({ stageIndex: decision.nextStageIndex }).where(eq(campaigns.id, campaign.id));
      if (decision.nextBatchSize <= 0) return complete(db, campaign.id, "Budget exhausted after declaring a winner.");
      const challenger = await challengerFor(db, campaign, champion, decision.rationale);
      await createNextExperiment(db, campaign, exp.seq + 1, {
        hypothesis: challenger.hypothesis,
        variableTested: challenger.variableTested,
        existing: [{ id: champion.id, role: "champion" }],
        drafts: [challenger.variant],
        batchSize: decision.nextBatchSize,
      });
      return;
    }

    case "continue": {
      await retire(decision.retireVariantIds);
      if (decision.nextBatchSize <= 0) return complete(db, campaign.id, "No remaining budget.");
      const remaining = live.filter((v) => !decision.retireVariantIds.includes(v.id));
      if (remaining.length >= 2) {
        await createNextExperiment(db, campaign, exp.seq + 1, {
          hypothesis: exp.hypothesis,
          variableTested: exp.variableTested,
          existing: remaining.map((v) => ({ id: v.id, role: v.status === "champion" ? ("champion" as const) : ("explore" as const) })),
          drafts: [],
          batchSize: decision.nextBatchSize,
        });
        return;
      }
      // Only one arm left: it becomes the baseline for a new challenger.
      const leader = remaining[0]!;
      const challenger = await challengerFor(db, campaign, leader, decision.rationale);
      await createNextExperiment(db, campaign, exp.seq + 1, {
        hypothesis: challenger.hypothesis,
        variableTested: challenger.variableTested,
        existing: [{ id: leader.id, role: "champion" }],
        drafts: [challenger.variant],
        batchSize: decision.nextBatchSize,
      });
      return;
    }

    case "revise": {
      await retire(decision.retireVariantIds);
      if (decision.nextBatchSize <= 0) return complete(db, campaign.id, "No remaining budget.");
      const sample = await db
        .select({ body: replies.body })
        .from(replies)
        .innerJoin(assignments, eq(assignments.id, replies.assignmentId))
        .where(eq(assignments.campaignId, campaign.id))
        .limit(30);
      const revised = await reviseVariants(
        campaign.brief,
        campaign.knowledge!,
        live.map((v) => ({ angle: v.angle, cta: v.cta, subject: v.subject, body: v.body, followUps: v.followUps, rationale: v.rationale, sourceRefs: v.sourceRefs })),
        sample.map((s) => s.body).join("\n---\n") || "(no replies)",
        await playbookFor(db, campaign.orgId, campaign.brief.persona),
        campaign.limits.followUpDelaysDays ?? [],
      );
      await createNextExperiment(db, campaign, exp.seq + 1, {
        hypothesis: revised.hypothesis,
        variableTested: revised.variableTested,
        existing: [],
        drafts: revised.variants.slice(0, 3),
        batchSize: decision.nextBatchSize,
      });
      return;
    }
  }
}

async function complete(db: DB, campaignId: string, detail: string) {
  await db.update(campaigns).set({ status: "completed", statusDetail: detail }).where(eq(campaigns.id, campaignId));
  await audit(db, campaignId, "engine", "campaign.completed", { detail });
}

async function challengerFor(db: DB, campaign: Campaign, base: Variant, rationale: string[]) {
  const tested = (await db.select({ v: experiments.variableTested }).from(experiments).where(eq(experiments.campaignId, campaign.id))).map((r) => r.v);
  return generateChallenger(
    campaign.brief,
    campaign.knowledge!,
    {
      champion: { label: base.label, angle: base.angle, cta: base.cta, subject: base.subject, body: base.body, followUps: base.followUps, traits: base.traits },
      testedVariables: [...new Set(tested)],
      learningAgenda: campaign.plan?.learningAgenda ?? [],
      evidenceSummary: rationale.join("\n"),
    },
    await playbookFor(db, campaign.orgId, campaign.brief.persona),
    campaign.limits.followUpDelaysDays ?? [],
  );
}

async function createNextExperiment(
  db: DB,
  campaign: Campaign,
  seq: number,
  spec: {
    hypothesis: string;
    variableTested: string;
    existing: { id: string; role: "champion" | "explore" }[];
    drafts: VariantDraft[];
    batchSize: number;
  },
) {
  const needsApproval = campaign.limits.requireApprovalForNewCopy && spec.drafts.length > 0;
  const [exp] = await db
    .insert(experiments)
    .values({
      campaignId: campaign.id,
      seq,
      hypothesis: spec.hypothesis,
      variableTested: spec.variableTested,
      status: "pending_approval",
      batchSize: spec.batchSize,
    })
    .returning();
  for (const e of spec.existing) await db.insert(experimentArms).values({ experimentId: exp!.id, variantId: e.id, role: e.role });
  const problems: string[] = [];
  for (const d of spec.drafts) {
    const { variant, problems: p } = await insertVariant(db, campaign.id, d, campaign.knowledge!, "draft");
    problems.push(...p);
    await db.insert(experimentArms).values({ experimentId: exp!.id, variantId: variant.id, role: "challenger" });
  }
  await audit(db, campaign.id, "engine", "experiment.created", { seq, batchSize: spec.batchSize, newVariants: spec.drafts.length, problems });

  // Copy that fails the deterministic checks always waits for a human.
  if (needsApproval || problems.length > 0) {
    await db
      .update(campaigns)
      .set({ statusDetail: `Experiment ${seq} needs approval${problems.length ? `: ${problems.join("; ")}` : " (new copy)"}` })
      .where(eq(campaigns.id, campaign.id));
    return;
  }
  await activateExperiment(db, exp!.id);
  await db
    .update(campaigns)
    .set({ statusDetail: `Experiment ${seq}: testing ${spec.variableTested} with ${spec.batchSize} prospects` })
    .where(eq(campaigns.id, campaign.id));
}
