import { describe, expect, it } from "vitest";
import { comparePosteriors } from "../src/stats/bayes";
import { decide, type VariantCounts } from "../src/stats/decision";
import { DEFAULT_LIMITS } from "../src/db/schema";

const v = (key: string, delivered: number, positive: number, extra: Partial<VariantCounts> = {}): VariantCounts => ({
  variantId: key,
  key,
  sent: delivered,
  delivered,
  bounced: 0,
  positive,
  unsubscribed: 0,
  complained: 0,
  ...extra,
});

const base = { limits: DEFAULT_LIMITS, stageIndex: 0, experimentsRun: 1, remainingBudget: 500 };

describe("comparePosteriors", () => {
  it("is deterministic and favours the better arm", () => {
    const arms = [
      { id: "a", trials: 100, successes: 12 },
      { id: "b", trials: 100, successes: 3 },
    ];
    const r1 = comparePosteriors(arms);
    const r2 = comparePosteriors(arms);
    expect(r1).toEqual(r2);
    expect(r1[0]!.pBest).toBeGreaterThan(0.98);
    expect(r1[0]!.pBest + r1[1]!.pBest).toBeCloseTo(1, 5);
    expect(r1[0]!.ci90[0]).toBeLessThan(r1[0]!.mean);
    expect(r1[0]!.ci90[1]).toBeGreaterThan(r1[0]!.mean);
  });

  it("is uncertain for equal small samples", () => {
    const [a] = comparePosteriors([
      { id: "a", trials: 25, successes: 2 },
      { id: "b", trials: 25, successes: 2 },
    ]);
    expect(a!.pBest).toBeGreaterThan(0.4);
    expect(a!.pBest).toBeLessThan(0.6);
  });
});

describe("decide", () => {
  it("pauses on high bounce rate before anything else", () => {
    const d = decide({ ...base, variants: [v("A", 20, 5, { sent: 25, bounced: 5 }), v("B", 25, 0)] });
    expect(d.action).toBe("pause_health");
  });

  it("continues when evidence is thin", () => {
    const d = decide({ ...base, variants: [v("A", 10, 3), v("B", 10, 0)] });
    expect(d.action).toBe("continue");
    expect(d.nextBatchSize).toBe(50);
  });

  it("scales a clear winner to the next stage", () => {
    const d = decide({ ...base, variants: [v("A", 60, 12), v("B", 60, 1)] });
    expect(d.action).toBe("scale");
    expect(d.winnerVariantId).toBe("A");
    expect(d.retireVariantIds).toEqual(["B"]);
    expect(d.nextBatchSize).toBe(100);
    expect(d.nextStageIndex).toBe(1);
  });

  it("caps the next batch at the remaining budget", () => {
    const d = decide({ ...base, remainingBudget: 30, variants: [v("A", 60, 12), v("B", 60, 1)] });
    expect(d.nextBatchSize).toBe(30);
  });

  it("revises when nothing works", () => {
    const d = decide({ ...base, variants: [v("A", 45, 0), v("B", 45, 0)] });
    expect(d.action).toBe("revise");
  });

  it("stops when budget is exhausted", () => {
    const d = decide({ ...base, remainingBudget: 0, variants: [v("A", 60, 6), v("B", 60, 4)] });
    expect(d.action).toBe("stop");
  });

  it("keeps testing an uncertain difference", () => {
    const d = decide({ ...base, variants: [v("A", 30, 4), v("B", 30, 3)] });
    expect(d.action).toBe("continue");
    expect(d.retireVariantIds).toEqual([]);
  });
});

describe("decide: practical equivalence", () => {
  it("moves on with the leader as baseline when a lot of evidence shows no clear winner", () => {
    const d = decide({ ...base, variants: [v("A", 80, 8), v("B", 80, 10)] });
    expect(d.action).toBe("continue");
    expect(d.winnerVariantId).toBeNull();
    expect(d.retireVariantIds).toEqual(["A"]);
  });
});
