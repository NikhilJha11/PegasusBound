import { TRAIT_DIMENSIONS, type CampaignBrief, type EmailTraits, type KnowledgeBrief, type TraitDimension } from "../db/schema";
import { dimensionForVariable } from "../memory";

/**
 * Deterministic copywriter for LLM_MODE=mock. It composes emails from the
 * knowledge brief (pain points, value props, proof, voice) and the requested
 * traits, so variants differ in exactly the dimension under test and the
 * copy reads like the company that uploaded the documents.
 */

type FullTraits = Required<Omit<EmailTraits, "length">> & { length: "short" | "medium" | "long" };

const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.;:,]+$/, "");
const sentence = (s: string) => {
  const c = clean(s);
  return c ? `${c.charAt(0).toUpperCase()}${c.slice(1)}.` : "";
};
const lower = (s: string) => {
  const c = clean(s);
  return /^[A-Z][a-z]/.test(c) ? c.charAt(0).toLowerCase() + c.slice(1) : c;
};
const pickAt = <T>(arr: T[], i: number, fallback: T): T => (arr.length ? arr[i % arr.length]! : fallback);

const STOP_TAIL = /\s+(that|and|so|the|a|an|to|for|of|with|on|in|can't|cannot|but|or)$/i;
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/** Items ranked by word overlap with the campaign brief, so each persona gets its most relevant points. */
function relevant(items: string[], brief: CampaignBrief) {
  const want = words(`${brief.objective} ${brief.offer} ${brief.context} ${brief.persona} ${brief.campaignType}`);
  return items
    .map((t, i) => ({ t, i, n: [...words(t)].filter((w) => want.has(w)).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.t);
}

/** "Acme: pages per session rose 38%" → "at Acme, pages per session rose 38%". */
function proofPhrase(claim: string) {
  const m = clean(claim).match(/^([^:]{3,48}):\s+(.+)$/);
  return m ? `at ${m[1]}, ${m[2]}` : lower(claim);
}

/** A short noun phrase from the first clause of a sentence. */
function shortPhrase(s: string, max = 6) {
  let p = lower(clean(s).split(/[,;:]| so | because | which /)[0] ?? s)
    .split(/\s+/)
    .slice(0, max)
    .join(" ");
  while (STOP_TAIL.test(p)) p = p.replace(STOP_TAIL, "");
  return p;
}

/** Who the prospect's peers are, from the ICP: "Digital publishers with 1M+ readers" → "digital publishers". */
function peers(brief: CampaignBrief) {
  const head = clean(brief.icp).split(/\s+(with|in|running|that|who|of|across)\s+/i)[0] ?? brief.icp;
  return lower(head) || "teams like yours";
}

function proofs(brief: CampaignBrief, k: KnowledgeBrief) {
  const order = relevant(k.proofPoints.map((p) => p.claim), brief);
  return order.map((c) => k.proofPoints.find((p) => p.claim === c)!);
}

function pains(brief: CampaignBrief, k: KnowledgeBrief) {
  return relevant(k.painPoints, brief);
}

function benefits(brief: CampaignBrief, k: KnowledgeBrief) {
  const vps = k.documentContext?.valueProps ?? k.approvedClaims;
  const outcomeLike = vps.filter((v) => /^(more|new|higher|fewer|less|faster|better|first-party)\b/i.test(v.trim()));
  return relevant(outcomeLike.length ? outcomeLike : vps, brief);
}

function roleLine(brief: CampaignBrief, k: KnowledgeBrief) {
  const persona = relevant(k.personaInsights, brief)[0];
  const duty = persona?.split(":")[1]?.trim();
  return duty ? `As the person who ${lower(duty)}, you'll know this one well.` : `In your role, this probably lands on your desk more than most.`;
}

function greeting(t: FullTraits, k: KnowledgeBrief) {
  if (t.tone === "formal") return "Dear {{first_name}},";
  const learned = k.voiceGuidelines?.map((g) => g.match(/Open with "([^"]+)"/)?.[1]).find(Boolean);
  if (t.tone === "warm") return "Hi {{first_name}}, hope your week's going well.";
  return learned ?? "Hi {{first_name}},";
}

function signoff(t: FullTraits, k: KnowledgeBrief, brief: CampaignBrief) {
  const learned = k.voiceGuidelines?.map((g) => g.match(/Sign off with "([^"]+)"/)?.[1]).find(Boolean);
  const s = t.tone === "formal" ? "Kind regards" : learned ?? "Best";
  return `${s},\n${brief.senderName}\n${brief.senderCompany}`;
}

function opener(t: FullTraits, brief: CampaignBrief, k: KnowledgeBrief, seed: number) {
  const pain = pickAt(pains(brief, k), seed, `${lower(brief.objective)} is harder than it should be`);
  const benefit = pickAt(benefits(brief, k), seed, brief.offer);
  const proof = proofs(brief, k)[seed % Math.max(1, k.proofPoints.length)]?.claim;
  const tone = t.tone === "challenger" ? "Most teams get this wrong: " : t.tone === "consultative" ? "One thing worth pressure-testing: " : "";
  switch (t.angle) {
    case "pain":
      return t.format === "question_led"
        ? `How is {{company}} handling this today: ${lower(pain)}?`
        : `${tone}A pattern we keep hearing from ${peers(brief)}: ${lower(pain)}.`.replace(/^(.+?: )A /, "$1a ");
    case "outcome":
      return t.format === "question_led"
        ? `What would it mean for {{company}} to get ${lower(benefit)}?`
        : `${tone}Teams like {{company}} use ${brief.senderCompany} to get ${lower(benefit)}.`;
    case "proof":
      return proof ? `${tone}One data point worth sharing: ${proofPhrase(proof)}.` : `${tone}Teams similar to {{company}} are already seeing ${lower(benefit)}.`;
    case "trigger_event":
      return `Noticed {{company}} has been growing the team this year. That's usually when ${lower(pain)}.`;
    case "insight":
      return `${tone}Something we keep seeing across ${peers(brief)}: ${lower(pain)}.`;
    case "offer":
      return `${tone}${sentence(brief.offer)}`;
  }
}

function cta(t: FullTraits, brief: CampaignBrief) {
  switch (t.cta) {
    case "call":
      return t.tone === "formal" ? "Would you be open to a 15-minute call next week?" : "Worth a 15-minute call next week?";
    case "demo":
      return "Open to a short demo on {{company}}'s own pages?";
    case "resource":
      return `I put together a one-page breakdown of how other ${peers(brief)} approach this. Want me to send it over?`;
    case "reply_question":
      return "Is this on your radar for this quarter?";
    case "referral_ask":
      return "If this sits with someone else on your team, who would be the right person to speak to?";
  }
}

function topic(brief: CampaignBrief, k: KnowledgeBrief) {
  return shortPhrase(pains(brief, k)[0] ?? brief.objective, 6);
}

function subject(t: FullTraits, brief: CampaignBrief, k: KnowledgeBrief) {
  const tp = topic(brief, k);
  switch (t.subjectStyle) {
    case "question":
      return `{{first_name}}, quick question about ${tp}?`;
    case "company_name":
      return `{{company}} and ${brief.senderCompany}`;
    case "benefit":
      return shortPhrase(benefits(brief, k)[0] ?? brief.offer, 7);
    case "curiosity":
      return `an idea for your readers`;
    case "plain":
      return tp;
  }
}

export function composeEmail(brief: CampaignBrief, k: KnowledgeBrief, t: FullTraits, seed = 0) {
  const lines: string[] = [greeting(t, k), ""];
  lines.push(opener(t, brief, k, seed));
  const values = k.documentContext?.valueProps?.length ? k.documentContext.valueProps : k.approvedClaims;
  const proof = proofs(brief, k)[seed % Math.max(1, k.proofPoints.length)];
  const sourceRefs: string[] = [];
  if (t.angle === "proof" && proof) sourceRefs.push(proof.sourceRef);

  if (t.personalization === "segment_specific") {
    lines.push("", roleLine(brief, k));
  } else if (t.personalization === "researched") {
    lines.push("", "Given your role as {{title}} at {{company}}, I suspect this lands on your desk more than most.");
  }

  if (t.format === "bulleted") {
    lines.push("", `What ${brief.senderCompany} changes:`);
    for (const v of values.slice(0, 3)) lines.push(`- ${clean(v)}`);
  } else if (t.format === "story" && proof) {
    lines.push("", `A recent example: ${proofPhrase(proof.claim)}. It started with the same problem you're probably seeing now.`);
    if (!sourceRefs.includes(proof.sourceRef)) sourceRefs.push(proof.sourceRef);
  } else if (t.format === "observation_led") {
    lines.push("", `Looking at how ${lower(brief.icp)} run today, there's usually a gap between effort and results here.`);
  }

  if (t.length !== "short") {
    lines.push("", sentence(pickAt(values, seed + 1, brief.offer)));
  }
  if (t.length === "long") {
    const extraPain = pickAt(pains(brief, k), seed + 1, "");
    if (extraPain) lines.push("", `It also tends to show up as ${lower(extraPain)}.`);
    if (proof && t.angle !== "proof" && t.format !== "story") {
      lines.push("", `For context, ${proofPhrase(proof.claim)}.`);
      sourceRefs.push(proof.sourceRef);
    }
    for (const v of values.slice(1, 4)) lines.push(`- ${clean(v)}`);
  }
  // Pad to the length bucket under test (derivedTraits measures it: <80, 80–150, >150 words).
  const minWords = t.length === "long" ? 165 : t.length === "medium" ? 92 : 0;
  const filler = [
    ...values.slice(1).map((v) => sentence(v)),
    ...k.painPoints.slice(1).map((p) => `We also hear that ${lower(p)}.`),
    ...k.personaInsights.map((i) => sentence(i)),
    "Most teams we talk to only notice this once it shows up in the quarterly numbers.",
    "Getting started doesn't need a long implementation project or extra headcount.",
    "It usually takes a few weeks to see clearly whether it moves the needle.",
    "Happy to share what the first month typically looks like.",
    "The teams that move fastest usually start with one clear use case and expand from there.",
    "It's built to sit alongside the tools you already use rather than replace them.",
    "We measure success on the same numbers your leadership already reports on.",
    "Most of the work is on our side, so it won't pull your team off their current priorities.",
    "If the fit isn't right, I'd rather tell you that early than waste your time.",
  ];
  const words = () => `${lines.join(" ")} ${para.join(" ")}`.split(/\s+/).filter(Boolean).length + 12;
  let para: string[] = [];
  for (let i = 0; minWords && words() < minWords && i < filler.length; i++) {
    para.push(filler[(i + seed) % filler.length]!);
    if (para.length === 3) lines.push("", para.join(" ")), (para = []);
  }
  if (para.length) lines.push("", para.join(" "));
  lines.push("", cta(t, brief), "", signoff(t, k, brief));
  return { subject: subject(t, brief, k), body: lines.join("\n"), sourceRefs: [...new Set(sourceRefs)] };
}

export function composeFollowUps(brief: CampaignBrief, k: KnowledgeBrief, t: FullTraits, delays: number[]) {
  const proof = proofs(brief, k)[1] ?? proofs(brief, k)[0];
  const value = pickAt(k.documentContext?.valueProps ?? k.approvedClaims, 1, brief.offer);
  const objection = k.documentContext?.objections?.[0];
  const bodies = [
    `Hi {{first_name}},\n\nOne more thought on this. ${proof ? sentence(proofPhrase(proof.claim)) : sentence(value)}\n\n${cta(t, brief)}`,
    objection
      ? `Hi {{first_name}},\n\nA question I often get at this point: "${clean(objection.split(":")[0]!)}?" ${objection.includes(":") ? sentence(objection.split(":").slice(1).join(":")) : "Happy to walk through how others handled it."}\n\nShould I send a short summary instead?`
      : `Hi {{first_name}},\n\nI'll leave it here so I don't crowd your inbox. If ${topic(brief, k)} becomes a priority, just reply and I'll send over what similar teams changed.`,
    `Hi {{first_name}},\n\nClosing the loop. If the timing is wrong, no problem at all. Is there a better quarter to reconnect?`,
  ];
  return delays.map((delayDays, i) => ({ delayDays, body: bodies[i % bodies.length]! }));
}

const DEFAULT_TRAITS: FullTraits = {
  tone: "conversational",
  format: "plain_short",
  angle: "pain",
  cta: "call",
  personalization: "merge_fields",
  subjectStyle: "plain",
  length: "short",
};

export function fullTraits(t: EmailTraits | undefined): FullTraits {
  return { ...DEFAULT_TRAITS, ...(t ?? {}) } as FullTraits;
}

export const LEARNING_AGENDA: { variable: string; why: string }[] = [
  { variable: "messaging angle", why: "Biggest expected effect on positive replies" },
  { variable: "call to action", why: "Turns interest into meetings" },
  { variable: "subject line", why: "Decides whether the email is read at all" },
  { variable: "tone", why: "This persona may respond to a different register" },
  { variable: "email format", why: "Structure changes how fast the value lands" },
  { variable: "length", why: "Shorter emails are easier to answer on mobile" },
  { variable: "personalization", why: "Segment-specific detail may beat merge fields alone" },
];

const VAR_LABEL: Record<TraitDimension, string> = {
  angle: "messaging angle",
  cta: "call to action",
  subjectStyle: "subject line",
  tone: "tone",
  format: "email format",
  length: "length",
  personalization: "personalization",
};

export function variantDraft(brief: CampaignBrief, k: KnowledgeBrief, t: FullTraits, delays: number[], rationale: string, seed = 0) {
  const e = composeEmail(brief, k, t, seed);
  return {
    angle: `${t.angle.replaceAll("_", " ")} · ${t.format.replaceAll("_", " ")}`,
    cta: t.cta.replaceAll("_", " "),
    subject: e.subject,
    body: e.body,
    followUps: composeFollowUps(brief, k, t, delays),
    traits: { tone: t.tone, format: t.format, angle: t.angle, cta: t.cta, personalization: t.personalization, subjectStyle: t.subjectStyle },
    rationale,
    sourceRefs: e.sourceRefs,
  };
}

/** Picks the next variable and a fresh value for the challenger. */
export function nextChallenge(champion: FullTraits, tested: string[], agenda: { variable: string }[]) {
  const order = (agenda.length ? agenda : LEARNING_AGENDA).map((a) => a.variable);
  const untested = order.find((v) => !tested.includes(v));
  // Once everything has been tested once, keep cycling through the agenda.
  const variable = untested ?? order[tested.length % order.length]!;
  const dim = (dimensionForVariable(variable) ?? "angle") as TraitDimension;
  const options = (TRAIT_DIMENSIONS[dim] as readonly string[]).filter((v) => v !== champion[dim]);
  const tries = tested.filter((v) => v === variable).length;
  const value = options[(tries * 2 + tested.length) % options.length]!;
  return { variable: VAR_LABEL[dim] ?? variable, dim, value, traits: { ...champion, [dim]: value } as FullTraits };
}
