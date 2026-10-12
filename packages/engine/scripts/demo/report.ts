// Demo workspace, phase 3: write demo/bridged/DEMO-OUTPUT.md, a readable
// account of everything the engine did for Bridged (the script for the video).
//   DATABASE_URL=... npx tsx scripts/demo/report.ts   (run.ps1 -Report sets it)
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

process.env.DATABASE_SCHEMA = "intel";
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const { orgId: ORG } = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/.demo-credentials"), "utf8"));
const { getDb, closeDb } = await import("../../src/db/client");
const q = await import("../../src/queries");
const { listMemory, traitPerformance, DIMENSION_LABELS } = await import("../../src/memory");
const { getContextProfile, listDocuments } = await import("../../src/knowledge/documents");
const db = await getDb();
const rows = <T,>(r: unknown) => (r as { rows: T[] }).rows;
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "–");
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "–");
const out: string[] = [];
const w = (s = "") => out.push(s);

// Status lines written mid-run carry run-time dates; drop them.
await db.execute(sql`UPDATE campaigns SET status_detail = regexp_replace(status_detail, ',? *(observing )?until [0-9T:.Z-]+', '') WHERE org_id = ${ORG} AND status_detail ~ 'until [0-9]{4}-'`);
// Evaluations store their time inside JSON; align it with the backfilled timeline.
await db.execute(sql`UPDATE experiments e SET evaluation = jsonb_set(evaluation, '{evaluatedAt}', to_jsonb(to_char(observe_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  FROM campaigns c WHERE c.id = e.campaign_id AND c.org_id = ${ORG} AND e.evaluation IS NOT NULL AND e.observe_until IS NOT NULL`);

const t = rows<Record<string, number>>(
  await db.execute(sql`SELECT
    (SELECT count(*)::int FROM prospects WHERE org_id = ${ORG}) prospects,
    (SELECT count(*)::int FROM outbound_messages o JOIN assignments a ON a.id = o.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG}) emails,
    (SELECT count(*)::int FROM outbound_messages o JOIN assignments a ON a.id = o.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG} AND o.step > 1) followups,
    (SELECT count(*)::int FROM replies r JOIN assignments a ON a.id = r.assignment_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.org_id = ${ORG}) replies,
    (SELECT count(*)::int FROM meetings m JOIN campaigns c ON c.id = m.campaign_id WHERE c.org_id = ${ORG}) meetings,
    (SELECT count(*)::int FROM meetings m JOIN campaigns c ON c.id = m.campaign_id WHERE c.org_id = ${ORG} AND m.qualified) qualified,
    (SELECT count(*)::int FROM experiments e JOIN campaigns c ON c.id = e.campaign_id WHERE c.org_id = ${ORG}) experiments,
    (SELECT count(*)::int FROM variants v JOIN campaigns c ON c.id = v.campaign_id WHERE c.org_id = ${ORG}) variants,
    (SELECT count(*)::int FROM learning_records l JOIN campaigns c ON c.id = l.campaign_id WHERE c.org_id = ${ORG}) learnings`),
)[0]!;

w("# Pegasusbound demo: Nikhil · Bridged");
w();
w("Synthetic demo workspace. 1,000 fictional prospects at fictional publishers, run through the real engine on the mock sender (no email was sent), then laid out over the past six weeks. The case-study numbers in the uploaded documents are sample content written for the demo.");
w();
w("## At a glance");
w();
w(`| Prospects | Emails sent | Follow-ups | Replies | Meetings | Qualified | Experiments | Email variants | Learnings |`);
w(`|---|---|---|---|---|---|---|---|---|`);
w(`| ${t.prospects} | ${t.emails} | ${t.followups} | ${t.replies} | ${t.meetings} | ${t.qualified} | ${t.experiments} | ${t.variants} | ${t.learnings} |`);
w();

// --- understanding layer -----------------------------------------------------
const docs = await listDocuments(db, ORG);
const ctx = await getContextProfile(db, ORG);
w("## 1. Knowledge → understanding layer");
w();
w("Bridged has no Company Brain connected, so the engine started from uploaded documents (Intelligence → Knowledge).");
w();
w("| Document | Type | What the engine extracted |");
w("|---|---|---|");
for (const d of [...docs].reverse()) {
  const a = d.analysis;
  const c = a
    ? [["ICP traits", a.icp], ["personas", a.personas], ["pain points", a.painPoints], ["value props", a.valueProps], ["proof points", a.proofPoints], ["restrictions", a.prohibitedClaims], ["objections", a.objections], ["competitors", a.competitors], ["reference emails", a.examples]]
        .filter(([, v]) => (v as unknown[]).length)
        .map(([k, v]) => `${(v as unknown[]).length} ${k}`)
        .join(", ")
    : d.statusDetail;
  w(`| ${d.filename}${d.pageCount ? ` (${d.pageCount} p.)` : ""} | ${d.kind} | ${c}${a?.voice?.rules.length ? `, ${a.voice.rules.length} voice rules` : ""} |`);
}
w();
if (ctx) {
  const list = (title: string, items: string[], n = 6) => {
    if (!items.length) return;
    w(`**${title}**`);
    for (const i of items.slice(0, n)) w(`- ${i}`);
    w();
  };
  list("Ideal customer", ctx.icp);
  list("Personas", ctx.personas);
  list("Pain points", ctx.painPoints);
  list("Value propositions", ctx.valueProps);
  list("Proof points (cited in emails)", ctx.proofPoints.map((p) => p.claim));
  list("Never say", ctx.prohibitedClaims);
  if (ctx.voice) {
    w(`**Voice profile** (learned from ${ctx.examples.length} sample emails): ${ctx.voice.tone}, ~${ctx.voice.avgWords} words, opens "${ctx.voice.greeting}", signs off "${ctx.voice.signoff}".`);
    for (const r of ctx.voice.rules.slice(0, 8)) w(`- ${r}`);
    w();
  }
}

// --- campaigns -------------------------------------------------------------
const camps = rows<{ id: string }>(await db.execute(sql`SELECT id FROM campaigns WHERE org_id = ${ORG} ORDER BY created_at`));
w("## 2. Campaigns, experiments and iterations");
w();
let n = 0;
for (const { id } of camps) {
  const d = (await q.getCampaignDetail(db, ORG, id))!;
  const c = d.campaign;
  const label = new Map(d.variants.map((v) => [v.id, v]));
  n++;
  const tot = [...d.counts.values()].reduce(
    (a, x) => ({ sent: a.sent + Number(x.sent), del: a.del + Number(x.delivered), pos: a.pos + Number(x.positive), rep: a.rep + Number(x.replies), mtg: a.mtg + Number(x.meetings) }),
    { sent: 0, del: 0, pos: 0, rep: 0, mtg: 0 },
  );
  w(`### 2.${n} ${c.name}`);
  w();
  w(`Persona **${c.brief.persona}** · ICP ${c.brief.icp} · status **${c.status.replaceAll("_", " ")}**${c.statusDetail ? ` (${c.statusDetail})` : ""} · launched ${day(c.createdAt)}${c.approvedAt ? `, approved once on ${day(c.approvedAt)}` : ""}`);
  w();
  if (tot.sent) w(`Sent ${tot.sent} · delivered ${tot.del} · replies ${tot.rep} (${pct(tot.rep, tot.del)}) · positive ${tot.pos} (${pct(tot.pos, tot.del)}) · meetings ${tot.mtg}`);
  w();
  if (c.plan) {
    w(`**Plan:** ${c.plan.summary}`);
    w();
    w(`Learning agenda: ${c.plan.learningAgenda.map((a) => a.variable).join(" → ")}`);
    w();
  }
  for (const e of [...d.experiments].reverse()) {
    w(`**Experiment ${e.seq}: ${e.variableTested}** (${e.status.replaceAll("_", " ")}, batch ${e.batchSize}, sent ${day(e.sendingStartedAt)})`);
    w();
    w(`> ${e.hypothesis}`);
    w();
    const ev = e.evaluation;
    const armIds = d.arms.filter((a) => a.experimentId === e.id).map((a) => a.variantId);
    w("| Variant | Traits | Subject | Delivered | Positive | Rate | P(best) |");
    w("|---|---|---|---|---|---|---|");
    for (const vid of armIds) {
      const v = label.get(vid)!;
      const st = ev?.stats.find((x) => x.variantId === vid);
      const tr = Object.entries(v.traits).map(([k, val]) => `${k}: ${String(val).replaceAll("_", " ")}`).join(", ");
      w(`| ${v.label}${ev?.decision.winnerVariantId === vid ? " 🏆" : ""} | ${tr} | ${v.subject.replace(/\|/g, "/")} | ${st?.delivered ?? "–"} | ${st?.positive ?? "–"} | ${st ? pct(st.positive, st.delivered) : "–"} | ${st ? `${Math.round(st.pBest * 100)}%` : "–"} |`);
    }
    w();
    if (ev) {
      w(`Decision: **${ev.decision.action}**. ${ev.decision.rationale.join(" ")}`);
      w();
    }
  }
  for (const l of [...d.learnings].reverse()) {
    w(`- 💡 [${l.confidence}] ${l.observation} _(next: ${l.nextAction})_`);
  }
  w();
  // One full sample email per campaign: the current champion (or first draft).
  const champ = d.variants.find((v) => v.status === "champion") ?? d.variants[d.variants.length - 1];
  if (champ) {
    w(`<details><summary>Sample email: ${champ.label}${champ.status === "champion" ? " (current champion)" : ""}</summary>`);
    w();
    w("```");
    w(`Subject: ${champ.subject}`);
    w();
    w(champ.body);
    for (const f of champ.followUps) w(`\n--- follow-up after ${f.delayDays} days ---\n${f.body}`);
    w("```");
    w();
    w("</details>");
    w();
  }
}

// --- formats ---------------------------------------------------------------
w("## 3. Email formats: what performs best (all campaigns)");
w();
const perf = await traitPerformance(db, { orgId: ORG });
for (const [dim, list] of Object.entries(perf)) {
  if (!list.length) continue;
  w(`**${DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS]}**: ${list.map((r) => `${r.value.replaceAll("_", " ")} ${(r.rate * 100).toFixed(1)}% (${r.positive}/${r.delivered}, P(best) ${Math.round(r.pBest * 100)}%)`).join(" · ")}`);
  w();
}

// --- memory ----------------------------------------------------------------
w("## 4. Unified memory (applied to every new campaign)");
w();
const mem = (await listMemory(db, ORG)).filter((m) => m.active);
for (const kind of ["principle", "guideline", "avoid"] as const) {
  const list = mem.filter((m) => m.kind === kind);
  if (!list.length) continue;
  w(`**${{ principle: "Proven principles", guideline: "Guidelines", avoid: "Avoid" }[kind]}**`);
  for (const m of list) w(`- [${m.confidence}, ${m.source}${m.scope !== "*" ? `, ${m.scope}` : ""}] ${m.text}`);
  w();
}

// --- threads ---------------------------------------------------------------
w("## 5. Sample lead threads");
w();
const threads = rows<{ assignment_id: string; email: string; first_name: string; company: string; category: string; campaign: string }>(
  await db.execute(sql`SELECT DISTINCT ON (l.category) a.id assignment_id, p.email, p.first_name, p.company, l.category, c.name campaign
    FROM replies r JOIN assignments a ON a.id = r.assignment_id JOIN prospects p ON p.id = a.prospect_id JOIN campaigns c ON c.id = a.campaign_id
    JOIN LATERAL (SELECT category FROM reply_classifications rc WHERE rc.reply_id = r.id ORDER BY rc.created_at DESC LIMIT 1) l ON true
    WHERE c.org_id = ${ORG} AND l.category IN ('meeting_requested', 'positive_interest', 'referral', 'objection_existing_solution', 'not_now')
    ORDER BY l.category, r.received_at`),
);
for (const th of threads) {
  const thread = await q.getThread(db, ORG, th.assignment_id);
  const list = ((thread?.items ?? []) as { kind: string; at: string; subject?: string; body?: string }[]).filter((i) => i.kind !== "event").sort((a, b) => a.at.localeCompare(b.at));
  w(`**${th.first_name} at ${th.company}** (${th.campaign}) → ${th.category.replaceAll("_", " ")}`);
  w();
  w("```");
  for (const it of list) w(`[${day(it.at)}] ${it.kind === "out" ? "→ Nikhil" : "← " + th.first_name}${it.subject ? ` · ${it.subject}` : ""}\n${it.body}\n`);
  w("```");
  w();
}

const file = path.join(ROOT, "demo/bridged/DEMO-OUTPUT.md");
fs.writeFileSync(file, out.join("\n"));
console.log(`wrote ${file} (${out.length} lines)`);
await closeDb();
