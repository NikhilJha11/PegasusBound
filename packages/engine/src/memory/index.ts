import { and, desc, eq, inArray, like } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  campaigns,
  experiments,
  memoryEntries,
  TRAIT_DIMENSIONS,
  variants,
  type EmailTraits,
  type TraitDimension,
} from "../db/schema";
import { comparePosteriors } from "../stats/bayes";
import { variantCounts } from "../orchestrator/stats";
import { sha256 } from "../crypto";

/**
 * Unified memory layer.
 *
 * Two kinds of evidence, kept apart because they deserve different trust:
 *  - Controlled: an experiment changed ONE variable and a winner was declared.
 *    These become durable "principles" ("question-led subjects beat plain
 *    subjects for heads of events").
 *  - Observational: performance of every trait value pooled across all
 *    variants and campaigns. Confounded (other traits vary too), so it only
 *    produces preliminary hints and an "avoid" list.
 * Plus Company Brain guidelines and human notes. Everything is injected into
 * every strategist call, so all sequences inherit what any sequence learned.
 */

export const DIMENSION_LABELS: Record<TraitDimension, string> = {
  tone: "Tone",
  format: "Format",
  angle: "Messaging angle",
  cta: "Call to action",
  personalization: "Personalization",
  subjectStyle: "Subject line style",
  length: "Length",
};

const DIMENSION_KEYWORDS: [RegExp, TraitDimension][] = [
  [/subject/i, "subjectStyle"],
  [/(cta|call to action|ask)/i, "cta"],
  [/(angle|message|value prop|positioning|hook)/i, "angle"],
  [/tone|voice/i, "tone"],
  [/(length|brevity|short|long)/i, "length"],
  [/(format|structure|layout)/i, "format"],
  [/personali[sz]/i, "personalization"],
];

export function dimensionForVariable(variable: string): TraitDimension | null {
  for (const [re, dim] of DIMENSION_KEYWORDS) if (re.test(variable)) return dim;
  return null;
}

/** Deterministic traits that shouldn't depend on the model's self-report. */
export function derivedTraits(subject: string, body: string): Pick<EmailTraits, "length" | "subjectStyle"> {
  const words = body.split(/\s+/).filter(Boolean).length;
  const length = words < 80 ? "short" : words <= 150 ? "medium" : "long";
  const subjectStyle = subject.includes("?")
    ? "question"
    : /\{\{company\}\}/i.test(subject)
      ? "company_name"
      : undefined;
  return subjectStyle ? { length, subjectStyle } : { length };
}

export interface TraitRow {
  value: string;
  variants: number;
  delivered: number;
  positive: number;
  meetings: number;
  rate: number;
  ci90: [number, number];
  pBest: number;
}

export type TraitTable = Record<TraitDimension, TraitRow[]>;

/** Performance of each trait value, for one campaign or across all of them. */
export async function traitPerformance(db: DB, opts: { orgId: string; campaignId?: string; scope?: string }): Promise<TraitTable> {
  const counts = await variantCounts(db, opts.campaignId ?? null, opts.orgId);
  let vs = await db
    .select({ v: variants, persona: campaigns.brief })
    .from(variants)
    .innerJoin(campaigns, eq(campaigns.id, variants.campaignId))
    .where(and(eq(campaigns.orgId, opts.orgId), opts.campaignId ? eq(variants.campaignId, opts.campaignId) : undefined));
  if (opts.scope && opts.scope !== "*") vs = vs.filter((r) => scopeOf(r.persona.persona) === opts.scope);

  const out = {} as TraitTable;
  for (const dim of Object.keys(TRAIT_DIMENSIONS) as TraitDimension[]) {
    const agg = new Map<string, { variants: number; delivered: number; positive: number; meetings: number }>();
    for (const { v } of vs) {
      const value = v.traits[dim];
      const c = counts.get(v.id);
      if (!value || !c || c.sent === 0) continue;
      const cur = agg.get(value) ?? { variants: 0, delivered: 0, positive: 0, meetings: 0 };
      cur.variants++;
      cur.delivered += c.delivered;
      cur.positive += c.positive;
      cur.meetings += c.meetings;
      agg.set(value, cur);
    }
    const entries = [...agg.entries()];
    const posts = entries.length
      ? comparePosteriors(entries.map(([value, a]) => ({ id: value, trials: a.delivered, successes: a.positive })), { samples: 8000 })
      : [];
    out[dim] = entries
      .map(([value, a], i) => ({ value, ...a, rate: posts[i]!.mean, ci90: posts[i]!.ci90, pBest: entries.length > 1 ? posts[i]!.pBest : 1 }))
      .sort((x, y) => y.rate - x.rate);
  }
  return out;
}

export const scopeOf = (persona: string | undefined) => (persona ?? "").trim().toLowerCase() || "*";

async function upsertEntry(db: DB, e: Omit<typeof memoryEntries.$inferInsert, "id" | "createdAt" | "updatedAt"> & { orgId: string }) {
  await db
    .insert(memoryEntries)
    .values({ ...e, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [memoryEntries.orgId, memoryEntries.key],
      set: { text: e.text, confidence: e.confidence, evidence: e.evidence, active: e.active ?? true, updatedAt: new Date() },
    });
}

const confRank = { preliminary: 0, moderate: 1, strong: 2 } as const;

/** Recompute experiment-derived memory from the evidence. Idempotent. */
export async function refreshMemory(db: DB, orgId: string) {
  // 1. Controlled evidence from experiments that declared a winner.
  const evaluated = await db
    .select({ e: experiments, brief: campaigns.brief })
    .from(experiments)
    .innerJoin(campaigns, eq(campaigns.id, experiments.campaignId))
    .where(and(eq(experiments.status, "evaluated"), eq(campaigns.orgId, orgId)));
  const allVariants = new Map(
    (await db.select({ v: variants }).from(variants).innerJoin(campaigns, eq(campaigns.id, variants.campaignId)).where(eq(campaigns.orgId, orgId))).map(
      (r) => [r.v.id, r.v],
    ),
  );
  const wins = new Map<string, { dim: TraitDimension; win: string; lose: string; scope: string; experiments: string[]; best: number; lines: string[]; minDelivered: number }>();

  for (const { e, brief } of evaluated) {
    const ev = e.evaluation;
    if (!ev?.decision.winnerVariantId) continue;
    const winner = allVariants.get(ev.decision.winnerVariantId);
    const ws = ev.stats.find((s) => s.variantId === ev.decision.winnerVariantId);
    if (!winner || !ws) continue;
    const dims = new Set<TraitDimension>();
    const named = dimensionForVariable(e.variableTested);
    if (named) dims.add(named);
    for (const s of ev.stats) {
      if (s.variantId === winner.id) continue;
      const loser = allVariants.get(s.variantId);
      if (!loser) continue;
      // Only credit dimensions that actually differ between the two arms.
      const differing = (Object.keys(TRAIT_DIMENSIONS) as TraitDimension[]).filter((d) => winner.traits[d] && loser.traits[d] && winner.traits[d] !== loser.traits[d]);
      const credit = named && differing.includes(named) ? [named] : differing.length === 1 ? differing : [];
      for (const dim of credit) {
        const scope = scopeOf(brief.persona);
        const key = `ctrl:${scope}:${dim}:${winner.traits[dim]}>${loser.traits[dim]}`;
        const cur = wins.get(key) ?? { dim, win: winner.traits[dim]!, lose: loser.traits[dim]!, scope, experiments: [], best: 0, lines: [], minDelivered: Infinity };
        cur.experiments.push(e.id);
        cur.best = Math.max(cur.best, ws.pBest);
        cur.minDelivered = Math.min(cur.minDelivered, ws.delivered, s.delivered);
        cur.lines.push(`${ws.positive}/${ws.delivered} vs ${s.positive}/${s.delivered}`);
        wins.set(key, cur);
      }
    }
  }
  for (const [key, w] of wins) {
    const confidence = w.experiments.length >= 2 && w.minDelivered >= 60 ? "strong" : w.best >= 0.95 && w.minDelivered >= 40 ? "moderate" : "preliminary";
    await upsertEntry(db, {
      orgId,
      kind: "principle",
      source: "experiment",
      key,
      scope: w.scope,
      dimension: w.dim,
      value: w.win,
      confidence,
      text: `${DIMENSION_LABELS[w.dim]}: "${w.win.replaceAll("_", " ")}" beat "${w.lose.replaceAll("_", " ")}" in ${w.experiments.length} controlled test${w.experiments.length > 1 ? "s" : ""} (positive replies ${w.lines.join("; ")}).`,
      evidence: { experiments: w.experiments, bestPBest: w.best },
    });
  }

  // 2. Observational hints and an avoid-list, from all evidence pooled.
  const table = await traitPerformance(db, { orgId });
  const seen = new Set<string>();
  for (const dim of Object.keys(table) as TraitDimension[]) {
    const rows = table[dim];
    if (rows.length < 2) continue;
    for (const r of rows) {
      if (r.delivered < 60) continue;
      const kind = r.pBest >= 0.9 ? "principle" : r.pBest < 0.03 ? "avoid" : null;
      if (!kind) continue;
      const key = `obs:*:${dim}:${r.value}`;
      seen.add(key);
      await upsertEntry(db, {
        orgId,
        kind,
        source: "experiment",
        key,
        scope: "*",
        dimension: dim,
        value: r.value,
        confidence: "preliminary",
        text:
          kind === "principle"
            ? `${DIMENSION_LABELS[dim]} "${r.value.replaceAll("_", " ")}" has the best positive-reply rate across all campaigns (${(r.rate * 100).toFixed(1)}%, ${r.positive}/${r.delivered}). Observational, not yet a controlled result.`
            : `${DIMENSION_LABELS[dim]} "${r.value.replaceAll("_", " ")}" is the weakest across all campaigns (${(r.rate * 100).toFixed(1)}%, ${r.positive}/${r.delivered}). Avoid unless testing deliberately.`,
        evidence: { delivered: r.delivered, positive: r.positive, pBest: r.pBest },
      });
    }
  }
  // Retire observational entries that no longer hold.
  const obs = await db.select().from(memoryEntries).where(and(eq(memoryEntries.orgId, orgId), like(memoryEntries.key, "obs:%")));
  const stale = obs.filter((o) => !seen.has(o.key) && o.active).map((o) => o.id);
  if (stale.length) await db.update(memoryEntries).set({ active: false, updatedAt: new Date() }).where(inArray(memoryEntries.id, stale));
}

/** Persist Company Brain voice/format guidance as memory, so every campaign applies it. */
export async function rememberBrainGuidelines(db: DB, orgId: string, guidelines: string[], scope: string) {
  for (const g of guidelines) {
    const text = g.trim();
    if (!text) continue;
    await upsertEntry(db, { orgId, kind: "guideline", source: "brain", key: `brain:${sha256(text.toLowerCase()).slice(0, 24)}`, scope: "*", text, confidence: "strong", evidence: { firstSeenScope: scope } });
  }
}

export async function addHumanMemory(db: DB, orgId: string, input: { kind: "principle" | "guideline" | "avoid"; text: string; scope?: string }) {
  await upsertEntry(db, {
    orgId,
    kind: input.kind,
    source: "human",
    key: `human:${sha256(`${input.kind}:${input.text}:${Date.now()}`).slice(0, 24)}`,
    scope: input.scope?.trim().toLowerCase() || "*",
    text: input.text.trim(),
    confidence: "strong",
    evidence: {},
  });
}

export async function setMemoryActive(db: DB, orgId: string, id: string, active: boolean) {
  await db
    .update(memoryEntries)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(memoryEntries.orgId, orgId), eq(memoryEntries.id, id)));
}

export async function listMemory(db: DB, orgId: string) {
  return db.select().from(memoryEntries).where(eq(memoryEntries.orgId, orgId)).orderBy(desc(memoryEntries.active), desc(memoryEntries.updatedAt));
}

/** The playbook handed to the strategist for a given persona. */
export async function playbookFor(db: DB, orgId: string, persona: string): Promise<string> {
  const scope = scopeOf(persona);
  const active = await db.select().from(memoryEntries).where(and(eq(memoryEntries.orgId, orgId), eq(memoryEntries.active, true)));
  const inScope = (e: (typeof active)[number]) => e.scope === "*" || e.scope === scope || scope.includes(e.scope) || e.scope.includes(scope);
  const entries = active.filter(inScope);
  // Proven elsewhere: a starting hypothesis for this segment, still to be verified here.
  const transfer = active.filter((e) => !inScope(e) && e.kind === "principle" && e.confidence !== "preliminary");
  entries.sort((a, b) => confRank[b.confidence] - confRank[a.confidence]);
  const section = (title: string, rows: typeof entries) =>
    rows.length ? `${title}:\n${rows.map((r) => `- [${r.confidence}${r.scope !== "*" ? `, ${r.scope}` : ""}] ${r.text}`).join("\n")}` : "";
  const table = await traitPerformance(db, { orgId });
  const leaderboard = (Object.keys(table) as TraitDimension[])
    .filter((d) => table[d].length > 1)
    .map((d) => `- ${DIMENSION_LABELS[d]}: ${table[d].map((r) => `${r.value} ${(r.rate * 100).toFixed(1)}% (n=${r.delivered})`).join(", ")}`)
    .join("\n");
  const parts = [
    section("Company Brain and team guidelines (always follow)", entries.filter((e) => e.kind === "guideline")),
    section("Proven principles (apply by default; don't spend experiments re-testing strong ones)", entries.filter((e) => e.kind === "principle")),
    section("Learned in other segments (use as the starting baseline, then verify for this persona)", transfer),
    section("Avoid", entries.filter((e) => e.kind === "avoid")),
    leaderboard ? `Trait leaderboard across all campaigns (observational):\n${leaderboard}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : "No memory yet: this is the first campaign. Explore.";
}

