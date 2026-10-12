import { sha256 } from "../crypto";
import { mulberry32 } from "../stats/bayes";
import { enqueue } from "../jobs/queue";
import type { EmailTraits, MessageEventType } from "../db/schema";
import type { ProviderEvent, Sender } from "./types";
import { env } from "../env";

/**
 * Simulated email provider. Each variant (by content hash) gets a hidden
 * "true" positive-reply rate so the learning loop has a real signal to find.
 * Events arrive later via delayed jobs, exactly as webhooks would.
 */

const REPLY_TEXT: Record<string, string[]> = {
  positive: [
    "Interested — tell me more about how this works.",
    "Sounds interesting. Happy to chat, can you send over some details?",
    "Yes, send the benchmark over please.",
    "This is timely. We've been looking at exactly this for our sites. Can you send it over?",
    "Interested. How does it work with our existing setup?",
    "Sounds good. Happy to take a look at examples from similar teams.",
    "Tell me more. What does a pilot usually involve?",
  ],
  meeting: [
    "Let's talk. I'm available next Tuesday afternoon, send me an invite.",
    "Sure, book a time on my calendar for Thursday.",
    "Let's chat. Thursday at 3pm works, send me an invite.",
    "Happy to meet. Use my calendar link to book a time next week.",
  ],
  referral: [
    "I'm not the right person, please speak to my colleague Sam who runs partnerships.",
    "Thanks. Please reach out to my colleague Ana who owns this area.",
  ],
  objection: [
    "We already use another platform for this, thanks.",
    "Not right now, maybe next quarter.",
    "Not really relevant for us.",
    "No budget for new tools until the new financial year.",
    "We already have something in place that works fine.",
    "Bad time for us, we're mid-replatform. Circle back later this year.",
  ],
  negative: ["Not interested, thanks.", "No thanks."],
  unsubscribe: ["Please remove me from your list.", "Take me off this list please."],
  ooo: ["I am out of the office until Monday with limited access to email.", "Automatic reply: I'm on leave and back next week."],
};

/**
 * Hidden "truth" for MOCK_OUTCOMES=traits: additive effects on the
 * positive-reply rate per trait value, with persona-specific tilts. The
 * engine never sees this; it has to discover it from replies.
 */
const TRAIT_EFFECTS: Record<string, Record<string, number>> = {
  angle: { pain: 1.0, outcome: 0.6, proof: 2.0, trigger_event: 1.2, insight: 1.3, offer: 0.55 },
  cta: { call: 1.0, demo: 0.7, resource: 1.6, reply_question: 1.3, referral_ask: 0.75 },
  subjectStyle: { question: 1.35, company_name: 1.1, benefit: 1.05, curiosity: 0.8, plain: 1.0 },
  tone: { conversational: 1.0, formal: 0.65, consultative: 1.1, challenger: 0.85, warm: 1.05 },
  format: { plain_short: 1.0, story: 1.2, bulleted: 0.8, question_led: 1.15, observation_led: 1.05 },
  length: { short: 1.0, medium: 0.8, long: 0.55 },
  personalization: { merge_fields: 1.0, segment_specific: 1.35, researched: 1.5 },
};
/** Persona-specific multipliers: different buyers reward different things. */
const PERSONA_TILTS: [RegExp, Record<string, number>][] = [
  [/founder|ceo|owner|managing director/i, { "tone:challenger": 1.9, "length:short": 1.15, "cta:reply_question": 1.35, "cta:resource": 0.7, "angle:proof": 0.75 }],
  [/revenue|sales|commercial|cro/i, { "cta:demo": 2.6, "angle:proof": 1.2, "format:bulleted": 1.5, "subjectStyle:question": 0.8 }],
  [/audience|marketing|growth|brand|editor|content|product/i, { "angle:insight": 1.7, "format:story": 1.25, "subjectStyle:question": 1.2 }],
];

/** Hidden "true" positive-reply rate for an email's traits (MOCK_OUTCOMES=traits). */
export function traitRate(traits: EmailTraits, persona = "", contentHash = "00000000") {
  let p = 0.04;
  for (const [dim, effects] of Object.entries(TRAIT_EFFECTS)) {
    const v = traits[dim as keyof EmailTraits];
    if (v) p *= effects[v] ?? 1;
  }
  for (const [re, tilt] of PERSONA_TILTS) {
    if (!re.test(persona)) continue;
    for (const [k, m] of Object.entries(tilt)) {
      const [dim, val] = k.split(":");
      if (traits[dim as keyof EmailTraits] === val) p *= m;
    }
  }
  // Copy-level noise: two emails with the same traits still differ a little.
  const jitter = 0.9 + mulberry32(parseInt(contentHash.slice(0, 8), 16))() * 0.2;
  return Math.min(0.3, Math.max(0.004, p * jitter));
}

export function latentRates(contentHash: string, traits?: EmailTraits, persona?: string) {
  const r = mulberry32(parseInt(contentHash.slice(0, 8), 16))();
  if (traits && env().MOCK_OUTCOMES === "traits") {
    return { bounce: 0.015, positive: traitRate(traits, persona, contentHash), objection: 0.035, negative: 0.015, unsubscribe: 0.005, ooo: 0.04 };
  }
  return {
    bounce: 0.02,
    positive: 0.03 + r * 0.12, // 3%–15%
    objection: 0.04,
    negative: 0.02,
    unsubscribe: 0.006,
    ooo: 0.04,
  };
}

export function simulateOutcome(providerMessageId: string, contentHash: string, to: string, step = 1, traits?: EmailTraits, persona?: string): ProviderEvent[] {
  // Seeded by recipient + copy + step (not by random ids) so a simulation is reproducible.
  const rand = mulberry32(parseInt(sha256(`${to}:${contentHash}:${step}`).slice(0, 8), 16));
  const base = latentRates(contentHash, traits, persona);
  // Follow-ups land in an existing thread: no new bounces, fewer (but real) replies.
  const rates = step === 1 ? base : { ...base, bounce: 0, positive: base.positive * 0.5, ooo: 0.01, unsubscribe: base.unsubscribe * 1.5 };
  const hour = 3600 * 1000;
  const now = Date.now();
  const ev = (type: MessageEventType, atHours: number, replyBody?: string): ProviderEvent => ({
    providerMessageId,
    providerEventId: `mock:${providerMessageId}:${type}`,
    type,
    occurredAt: new Date(now + atHours * hour),
    replyBody,
    fromEmail: replyBody ? to : undefined,
  });
  if (rand() < rates.bounce) return [ev("bounced", 0.1)];
  const out = [ev("delivered", 0.05)];
  const pick = (k: string) => {
    const arr = REPLY_TEXT[k]!;
    return arr[Math.floor(rand() * arr.length)]!;
  };
  const replyAt = 2 + rand() * 40;
  let roll = rand();
  if ((roll -= rates.positive) < 0) {
    const kind = rand();
    out.push(ev("replied", replyAt, pick(kind < 0.55 ? "positive" : kind < 0.85 ? "meeting" : "referral")));
  } else if ((roll -= rates.objection) < 0) out.push(ev("replied", replyAt, pick("objection")));
  else if ((roll -= rates.negative) < 0) out.push(ev("replied", replyAt, pick("negative")));
  else if ((roll -= rates.unsubscribe) < 0) {
    out.push(ev("replied", replyAt, pick("unsubscribe")));
    out.push(ev("unsubscribed", replyAt));
  } else if ((roll -= rates.ooo) < 0) out.push(ev("replied", 0.2, pick("ooo")));
  return out;
}

export const mockSender: Sender = {
  name: "mock",
  usesMailboxes: false,
  async send(db, email) {
    const providerMessageId = email.messageIdHeader;
    const events = simulateOutcome(providerMessageId, email.meta.contentHash, email.to, email.step, email.meta.traits, email.meta.persona);
    const scale = env().MOCK_TIME_SCALE_SECONDS_PER_HOUR * 1000;
    for (const e of events) {
      const realHours = (e.occurredAt.getTime() - Date.now()) / 3600000;
      // Simulated events happen on the same scaled clock as everything else.
      const runAt = new Date(Date.now() + realHours * scale);
      await enqueue(db, "mock.deliverEvents", { event: { ...e, occurredAt: runAt.toISOString() } }, { runAt, dedupeKey: e.providerEventId });
    }
    return { providerMessageId };
  },
};
