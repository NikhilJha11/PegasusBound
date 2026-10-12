import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import * as s from "./db/schema";
import { TRAIT_DIMENSIONS, type EmailTraits, type TraitDimension } from "./db/schema";
import { variantCounts, emptyCounts } from "./orchestrator/stats";
import { comparePosteriors } from "./stats/bayes";
import { DIMENSION_LABELS } from "./memory";

/**
 * Every email a campaign has sent, ranked best to worst by posterior
 * positive-reply rate, with the evidence and a plain-language reason for its
 * place. Plus the iteration curve: how the reply rate moved experiment by
 * experiment as the engine learned.
 */

export interface RankedEmail {
  rank: number;
  variantId: string;
  label: string;
  status: string;
  subject: string;
  body: string;
  traits: EmailTraits;
  /** Experiment number this email first went out in. */
  introducedIn: number | null;
  experiments: number[];
  sent: number;
  delivered: number;
  replies: number;
  positive: number;
  meetings: number;
  unsubscribed: number;
  rate: number;
  posteriorMean: number;
  ci90: [number, number];
  /** Probability this is the best email of the campaign. */
  pBest: number;
  /** Lift over the campaign's first-iteration baseline, in percentage points. */
  liftVsBaseline: number | null;
  why: string;
}

export interface IterationPoint {
  seq: number;
  variableTested: string;
  status: string;
  decision: string | null;
  delivered: number;
  positive: number;
  rate: number;
  /** Best arm's posterior rate in this experiment. */
  bestRate: number;
  bestLabel: string | null;
  startedAt: string | null;
}

const pp = (x: number) => `${(x * 100).toFixed(1)}%`;
const human = (v: unknown) => String(v ?? "").replaceAll("_", " ");

function traitDiff(a: EmailTraits, b: EmailTraits) {
  return (Object.keys(TRAIT_DIMENSIONS) as TraitDimension[]).filter((d) => a[d] && b[d] && a[d] !== b[d]);
}

export async function getCampaignRanking(db: DB, orgId: string, campaignId: string) {
  const [campaign] = await db.select().from(s.campaigns).where(and(eq(s.campaigns.id, campaignId), eq(s.campaigns.orgId, orgId)));
  if (!campaign) return null;
  const variants = await db.select().from(s.variants).where(eq(s.variants.campaignId, campaignId)).orderBy(asc(s.variants.label));
  const experiments = await db.select().from(s.experiments).where(eq(s.experiments.campaignId, campaignId)).orderBy(asc(s.experiments.seq));
  const arms = experiments.length
    ? await db.select().from(s.experimentArms).where(inArray(s.experimentArms.experimentId, experiments.map((e) => e.id)))
    : [];
  const seqOf = new Map(experiments.map((e) => [e.id, e.seq]));
  const counts = await variantCounts(db, campaignId);

  const sentVariants = variants.filter((v) => (counts.get(v.id)?.delivered ?? 0) > 0);
  const posts = comparePosteriors(
    sentVariants.map((v) => {
      const c = counts.get(v.id)!;
      return { id: v.id, successes: c.positive, trials: c.delivered };
    }),
  );
  const post = new Map(posts.map((p) => [p.id, p]));

  // Baseline: the best arm of the first experiment, as it performed then.
  const firstExp = experiments[0];
  const baselineRate = firstExp?.evaluation?.stats.length
    ? Math.max(...firstExp.evaluation.stats.map((st) => (st.delivered ? st.positive / st.delivered : 0)))
    : null;

  const rows = variants.map((v) => {
    const c = counts.get(v.id) ?? emptyCounts(v.id);
    const p = post.get(v.id);
    const exps = arms.filter((a) => a.variantId === v.id).map((a) => seqOf.get(a.experimentId)!).sort((a, b) => a - b);
    return {
      variantId: v.id,
      label: v.label,
      status: v.status,
      subject: v.subject,
      body: v.body,
      traits: v.traits,
      introducedIn: exps[0] ?? null,
      experiments: exps,
      sent: c.sent,
      delivered: c.delivered,
      replies: c.replies,
      positive: c.positive,
      meetings: c.meetings,
      unsubscribed: c.unsubscribed,
      rate: c.delivered ? c.positive / c.delivered : 0,
      posteriorMean: p?.mean ?? 0,
      ci90: (p?.ci90 ?? [0, 0]) as [number, number],
      pBest: p?.pBest ?? 0,
      liftVsBaseline: baselineRate !== null && c.delivered ? c.positive / c.delivered - baselineRate : null,
    };
  });
  // Sent emails ranked by posterior mean (shrinks small samples toward the prior); drafts last.
  rows.sort((a, b) => Number(b.delivered > 0) - Number(a.delivered > 0) || b.posteriorMean - a.posteriorMean || b.delivered - a.delivered);

  const ranked: RankedEmail[] = rows.map((r, i) => ({ ...r, rank: i + 1, why: "" }));
  const top = ranked[0];
  for (const r of ranked) r.why = explain(r, ranked, top, experiments);

  const curve: IterationPoint[] = await iterationCurve(db, campaignId, experiments, variants);
  return { campaign: { id: campaign.id, name: campaign.name, status: campaign.status, persona: campaign.brief.persona }, ranked, curve, baselineRate };
}

function explain(r: RankedEmail, all: RankedEmail[], top: RankedEmail | undefined, experiments: (typeof s.experiments.$inferSelect)[]) {
  if (!r.delivered) return "Not sent yet: waiting for approval or the next batch.";
  const traits = (t: EmailTraits, dims: TraitDimension[]) => dims.map((d) => `${DIMENSION_LABELS[d].toLowerCase()} "${human(t[d])}"`).join(", ");
  const wins = experiments.filter((e) => e.evaluation?.decision.winnerVariantId === r.variantId).map((e) => e.seq);
  const evidence = `${r.positive} positive replies from ${r.delivered} delivered (${pp(r.rate)}, 90% credible range ${pp(r.ci90[0])}–${pp(r.ci90[1])})`;
  if (r === top) {
    const next = all.find((x) => x !== r && x.delivered > 0);
    const diff = next ? traitDiff(r.traits, next.traits) : [];
    const parts = [
      `Best performer: ${evidence}, with a ${Math.round(r.pBest * 100)}% probability of being the strongest email in this campaign.`,
      next && diff.length ? `It beats #2 (${next.label}) on ${traits(r.traits, diff)} instead of ${traits(next.traits, diff)}.` : "",
      wins.length ? `Declared the winner of experiment${wins.length > 1 ? "s" : ""} ${wins.join(", ")} in controlled tests.` : "",
      r.liftVsBaseline !== null && r.liftVsBaseline > 0.001 ? `That's ${(r.liftVsBaseline * 100).toFixed(1)} points above the first iteration's best email.` : "",
    ];
    return parts.filter(Boolean).join(" ");
  }
  const gap = top ? top.posteriorMean - r.posteriorMean : 0;
  const diff = top ? traitDiff(top.traits, r.traits) : [];
  const fate =
    r.status === "retired"
      ? "The engine retired it once its chance of being best fell below the threshold."
      : r.status === "champion"
        ? "It is a current champion in its segment."
        : r.pBest > 0.25
          ? "Still in contention; more sends will separate it."
          : "Kept for comparison while the leader collects evidence.";
  return [
    `${evidence}; ${(gap * 100).toFixed(1)} points behind #1.`,
    diff.length && top ? `Differs from the leader on ${traits(r.traits, diff)}.` : "",
    fate,
  ]
    .filter(Boolean)
    .join(" ");
}

async function iterationCurve(
  db: DB,
  campaignId: string,
  experiments: (typeof s.experiments.$inferSelect)[],
  variants: (typeof s.variants.$inferSelect)[],
): Promise<IterationPoint[]> {
  const res = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (rc.reply_id) rc.reply_id, rc.category, rc.needs_review
      FROM reply_classifications rc ORDER BY rc.reply_id, rc.created_at DESC
    )
    SELECT a.experiment_id,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM message_events e WHERE e.assignment_id = a.id AND e.type IN ('delivered','replied','opened'))
                         AND NOT EXISTS (SELECT 1 FROM message_events e WHERE e.assignment_id = a.id AND e.type = 'bounced')) AS delivered,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM replies r JOIN latest l ON l.reply_id = r.id
                         WHERE r.assignment_id = a.id AND l.category IN ('positive_interest','meeting_requested','referral') AND NOT l.needs_review)) AS positive
    FROM assignments a WHERE a.campaign_id = ${campaignId} GROUP BY a.experiment_id`);
  const per = new Map((res as unknown as { rows: { experiment_id: string; delivered: string; positive: string }[] }).rows.map((r) => [r.experiment_id, r]));
  const label = new Map(variants.map((v) => [v.id, v.label]));
  return experiments.map((e) => {
    const c = per.get(e.id);
    const delivered = Number(c?.delivered ?? 0);
    const positive = Number(c?.positive ?? 0);
    const stats = e.evaluation?.stats ?? [];
    const best = [...stats].sort((a, b) => b.posteriorMean - a.posteriorMean)[0];
    return {
      seq: e.seq,
      variableTested: e.variableTested,
      status: e.status,
      decision: e.evaluation?.decision.action ?? null,
      delivered,
      positive,
      rate: delivered ? positive / delivered : 0,
      bestRate: best ? best.positive / Math.max(1, best.delivered) : 0,
      bestLabel: best ? label.get(best.variantId) ?? null : null,
      startedAt: e.sendingStartedAt ? new Date(e.sendingStartedAt).toISOString() : null,
    };
  });
}
