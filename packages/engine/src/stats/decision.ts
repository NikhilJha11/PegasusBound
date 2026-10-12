import type { CampaignLimits, DecisionAction, ExperimentEvaluation } from "../db/schema";
import { comparePosteriors } from "./bayes";

export interface VariantCounts {
  variantId: string;
  key: string;
  sent: number;
  delivered: number;
  bounced: number;
  positive: number;
  unsubscribed: number;
  complained: number;
}

export interface DecisionInput {
  variants: VariantCounts[];
  limits: CampaignLimits;
  stageIndex: number;
  experimentsRun: number;
  /** Prospects still eligible and inside the campaign's total budget. */
  remainingBudget: number;
}

export type Decision = ExperimentEvaluation["decision"] & {
  posteriors: Record<string, { mean: number; ci90: [number, number]; pBest: number }>;
  nextStageIndex: number;
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * Deterministic decision policy. The LLM never makes this call — it only
 * explains it. Every branch records a human-readable rationale.
 */
export function decide(input: DecisionInput): Decision {
  const { variants, limits, stageIndex, experimentsRun, remainingBudget } = input;
  const rationale: string[] = [];
  const posts = comparePosteriors(
    variants.map((v) => ({ id: v.variantId, trials: v.delivered, successes: v.positive })),
  );
  const posteriors = Object.fromEntries(posts.map((p) => [p.id, { mean: p.mean, ci90: p.ci90, pBest: p.pBest }]));
  const stageSize = (i: number) => limits.batchStages[Math.min(i, limits.batchStages.length - 1)]!;
  const cap = (n: number) => Math.max(0, Math.min(n, remainingBudget));
  const result = (
    action: DecisionAction,
    extra: Partial<Pick<Decision, "winnerVariantId" | "retireVariantIds" | "nextBatchSize" | "nextStageIndex">> = {},
  ): Decision => ({
    action,
    winnerVariantId: extra.winnerVariantId ?? null,
    retireVariantIds: extra.retireVariantIds ?? [],
    nextBatchSize: extra.nextBatchSize ?? 0,
    nextStageIndex: extra.nextStageIndex ?? stageIndex,
    rationale,
    posteriors,
  });

  // 1. Deliverability and recipient-experience health come first.
  const sent = variants.reduce((s, v) => s + v.sent, 0);
  const delivered = variants.reduce((s, v) => s + v.delivered, 0);
  const bounced = variants.reduce((s, v) => s + v.bounced, 0);
  const negative = variants.reduce((s, v) => s + v.unsubscribed + v.complained, 0);
  if (sent >= 10 && bounced / sent > limits.bounceRateStop) {
    rationale.push(`Bounce rate ${pct(bounced / sent)} exceeds the ${pct(limits.bounceRateStop)} limit. Pausing to protect sender reputation; check list quality.`);
    return result("pause_health");
  }
  if (delivered >= 20 && negative / delivered > limits.negativeRateStop) {
    rationale.push(`Unsubscribe + complaint rate ${pct(negative / delivered)} exceeds the ${pct(limits.negativeRateStop)} limit. Pausing for human review.`);
    return result("pause_health");
  }

  const ranked = [...posts].sort((a, b) => b.pBest - a.pBest);
  const leader = ranked[0]!;
  const leaderKey = variants.find((v) => v.variantId === leader.id)!.key;

  // 2. Budget / experiment-count exhaustion.
  if (remainingBudget <= 0 || experimentsRun >= limits.maxExperiments) {
    rationale.push(
      remainingBudget <= 0
        ? "No remaining eligible prospects inside the campaign budget."
        : `Reached the maximum of ${limits.maxExperiments} experiments.`,
    );
    const winner = leader.pBest >= limits.scaleProbability ? leader.id : null;
    if (winner) rationale.push(`${leaderKey} finished as the best-supported variant (P(best) = ${pct(leader.pBest)}).`);
    else rationale.push("No variant reached the confidence threshold before the budget ran out.");
    return result("stop", { winnerVariantId: winner });
  }

  // 3. Minimum evidence.
  const thin = variants.filter((v) => v.delivered < limits.minDeliveredPerVariant);
  if (thin.length > 0) {
    rationale.push(
      `Not enough evidence yet: ${thin.map((v) => `${v.key} has ${v.delivered} delivered`).join(", ")} (minimum ${limits.minDeliveredPerVariant} per variant).`,
    );
    return result("continue", { nextBatchSize: cap(stageSize(stageIndex)) });
  }

  // 4. Nothing is working: revise the angles rather than spend more budget.
  const totalPositive = variants.reduce((s, v) => s + v.positive, 0);
  if (totalPositive === 0 && variants.every((v) => v.delivered >= 2 * limits.minDeliveredPerVariant)) {
    rationale.push(`Zero positive replies across ${delivered} delivered emails. Revising the messaging rather than scaling.`);
    return result("revise", { retireVariantIds: variants.map((v) => v.variantId), nextBatchSize: cap(stageSize(stageIndex)) });
  }

  // 5. Clear winner -> scale to the next stage with a new challenger.
  if (variants.length > 1 && leader.pBest >= limits.scaleProbability) {
    const next = Math.min(stageIndex + 1, limits.batchStages.length - 1);
    rationale.push(
      `${leaderKey} has P(best) = ${pct(leader.pBest)} (threshold ${pct(limits.scaleProbability)}), posterior positive-reply rate ${pct(leader.mean)} [90% CI ${pct(leader.ci90[0])}–${pct(leader.ci90[1])}].`,
      `Promoting ${leaderKey} to champion and validating it against a new challenger in a larger batch.`,
    );
    return result("scale", {
      winnerVariantId: leader.id,
      retireVariantIds: posts.filter((p) => p.id !== leader.id).map((p) => p.id),
      nextBatchSize: cap(stageSize(next)),
      nextStageIndex: next,
    });
  }

  // 6. Plenty of evidence and still no winner: the difference is too small to
  // matter. Keep the leader as baseline (not a proven winner) and move on to
  // the next variable instead of burning budget on the same question.
  if (variants.length > 1 && variants.every((v) => v.delivered >= 3 * limits.minDeliveredPerVariant)) {
    rationale.push(
      `After ${delivered} delivered emails, no variant reached ${pct(limits.scaleProbability)} confidence (leader ${leaderKey} at ${pct(leader.pBest)}). Any real difference is small.`,
      `Keeping ${leaderKey} as the baseline and testing the next variable.`,
    );
    return result("continue", {
      retireVariantIds: posts.filter((p) => p.id !== leader.id).map((p) => p.id),
      nextBatchSize: cap(stageSize(stageIndex)),
    });
  }

  // 7. Retire clearly weak arms; keep testing the rest.
  const retire = posts.filter((p) => p.id !== leader.id && p.pBest < limits.retireProbability).map((p) => p.id);
  if (retire.length > 0) {
    rationale.push(
      `Retiring ${retire.map((id) => variants.find((v) => v.variantId === id)!.key).join(", ")}: P(best) below ${pct(limits.retireProbability)}.`,
    );
  }
  rationale.push(
    `Difference is still uncertain (leader ${leaderKey} at P(best) = ${pct(leader.pBest)}). Collecting more evidence at the current batch size.`,
  );
  return result("continue", { retireVariantIds: retire, nextBatchSize: cap(stageSize(stageIndex)) });
}
