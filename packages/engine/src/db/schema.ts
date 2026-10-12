import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  boolean,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Tenant id: the Pegasusbound organization that owns the row. The standalone
 * app (no platform) uses STANDALONE_ORG for everything.
 */
export const STANDALONE_ORG = "00000000-0000-0000-0000-000000000000";
const orgId = () => uuid("org_id").notNull().default(STANDALONE_ORG);

// ---------------------------------------------------------------------------
// Connections (Company Brain MCP, CRM MCP)
// ---------------------------------------------------------------------------

export type ConnectionKind = "brain" | "crm";
export type AuthType = "none" | "bearer" | "oauth";

export const connections = pgTable("connections", {
  id: id(),
  orgId: orgId(),
  kind: text("kind").$type<ConnectionKind>().notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  authType: text("auth_type").$type<AuthType>().notNull().default("none"),
  /** Encrypted JSON: { bearer?: string, oauth?: { tokens, clientInformation, codeVerifier, state } } */
  secret: text("secret"),
  status: text("status").$type<"pending" | "connected" | "needs_auth" | "error">().notNull().default("pending"),
  statusDetail: text("status_detail"),
  /** Tools discovered from the server on last check. */
  tools: jsonb("tools").$type<{ name: string; description?: string; readOnly: boolean }[]>(),
  /** Which engine capabilities this server can satisfy, and with which tool. */
  capabilities: jsonb("capabilities").$type<Record<string, string | null>>(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export const prospects = pgTable(
  "prospects",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    title: text("title"),
    persona: text("persona"),
    source: text("source").$type<"csv" | "crm">().notNull(),
    crmRecordId: text("crm_record_id"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prospects_org_email_uq").on(t.orgId, t.email)],
);

/** Organization-wide do-not-contact list. Enforced by the policy engine for every send. */
export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    reason: text("reason").$type<"unsubscribed" | "bounced" | "complained" | "manual" | "crm">().notNull(),
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("suppressions_org_email_uq").on(t.orgId, t.email)],
);

// ---------------------------------------------------------------------------
// Campaigns & experiments
// ---------------------------------------------------------------------------

export type CampaignStatus =
  | "draft"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "stopped"
  | "failed";

export interface CampaignLimits {
  /** Hard cap on prospects this campaign may ever contact. */
  maxTotalProspects: number;
  /** Batch stages; the engine may only move to the next stage when evidence justifies it. */
  batchStages: number[];
  dailySendCap: number;
  /** How long to wait after a batch's last send before evaluating. */
  observationHours: number;
  /** Pause the whole campaign if bounce rate exceeds this. */
  bounceRateStop: number;
  /** Pause if (complaints + unsubscribes) / delivered exceeds this. */
  negativeRateStop: number;
  /** P(variant is best) needed to declare a winner and scale. */
  scaleProbability: number;
  /** Retire a variant whose P(best) falls below this. */
  retireProbability: number;
  /** Minimum delivered emails per variant before any decision other than "continue". */
  minDeliveredPerVariant: number;
  maxExperiments: number;
  /** If true, engine-generated challenger copy must be approved before sending. */
  requireApprovalForNewCopy: boolean;
  /** Days to wait before each follow-up step (empty = single-touch). */
  followUpDelaysDays: number[];
  /** IANA timezone the sending window is in (platform sender). */
  timezone?: string;
  /** Sending window, "HH:MM" 24h, and weekday bitmask (Mon=1 … Sun=64). Default weekdays 08:00–18:00. */
  sendStart?: string;
  sendEnd?: string;
  sendDays?: number;
}

export const DEFAULT_LIMITS: CampaignLimits = {
  maxTotalProspects: 850,
  batchStages: [50, 100, 200, 500],
  dailySendCap: 100,
  observationHours: 72,
  bounceRateStop: 0.05,
  negativeRateStop: 0.03,
  scaleProbability: 0.9,
  retireProbability: 0.05,
  minDeliveredPerVariant: 20,
  maxExperiments: 8,
  requireApprovalForNewCopy: false,
  followUpDelaysDays: [3, 4],
};

export interface CampaignBrief {
  campaignType: string;
  objective: string;
  icp: string;
  persona: string;
  offer: string;
  style: string;
  context: string;
  senderName: string;
  senderCompany: string;
  /** Postal address for the compliance footer (CAN-SPAM / PECR). */
  senderAddress?: string;
}

export const campaigns = pgTable("campaigns", {
  id: id(),
  orgId: orgId(),
  /** Who created it (platform user email or standalone user). */
  createdBy: text("created_by"),
  name: text("name").notNull(),
  status: text("status").$type<CampaignStatus>().notNull().default("draft"),
  statusDetail: text("status_detail"),
  brief: jsonb("brief").$type<CampaignBrief>().notNull(),
  limits: jsonb("limits").$type<CampaignLimits>().notNull(),
  senderProvider: text("sender_provider").notNull().default("mock"),
  /** Structured research brief built from the Company Brain (with source refs). */
  knowledge: jsonb("knowledge").$type<KnowledgeBrief>(),
  /** Overall plan: learning agenda proposed by the strategist. */
  plan: jsonb("plan").$type<CampaignPlan>(),
  stageIndex: integer("stage_index").notNull().default(0),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  createdAt: createdAt(),
});

export interface KnowledgeSource {
  ref: string;
  title: string;
  tool: string;
  excerpt: string;
}

export interface KnowledgeBrief {
  productSummary: string;
  approvedClaims: string[];
  prohibitedClaims: string[];
  painPoints: string[];
  proofPoints: { claim: string; sourceRef: string }[];
  personaInsights: string[];
  /** Tone, format and style rules from the Company Brain. */
  voiceGuidelines?: string[];
  /** Reference emails from uploaded samples: match their voice, never copy them. */
  styleExamples?: { subject: string; body: string; sourceRef: string }[];
  /** Understanding layer built from uploaded documents. */
  documentContext?: {
    icp: string[];
    personas: string[];
    valueProps: string[];
    objections: string[];
    competitors: string[];
    documents: string[];
  };
  priorLearnings: string[];
  gaps: string[];
  sources: KnowledgeSource[];
}

export interface CampaignPlan {
  summary: string;
  learningAgenda: { variable: string; why: string }[];
  risks: string[];
}

export type ExperimentStatus = "pending_approval" | "sending" | "observing" | "evaluated" | "cancelled";

export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    seq: integer("seq").notNull(),
    hypothesis: text("hypothesis").notNull(),
    variableTested: text("variable_tested").notNull(),
    status: text("status").$type<ExperimentStatus>().notNull(),
    batchSize: integer("batch_size").notNull(),
    sendingStartedAt: timestamp("sending_started_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    observeUntil: timestamp("observe_until", { withTimezone: true }),
    evaluation: jsonb("evaluation").$type<ExperimentEvaluation>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("experiments_campaign_seq_uq").on(t.campaignId, t.seq)],
);

export interface VariantStats {
  variantId: string;
  key: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
  meetings: number;
  negative: number;
  unsubscribed: number;
  complained: number;
  pendingReview: number;
  posteriorMean: number;
  ci90: [number, number];
  pBest: number;
}

export type DecisionAction = "scale" | "continue" | "revise" | "stop" | "pause_health";

export interface ExperimentEvaluation {
  evaluatedAt: string;
  stats: VariantStats[];
  decision: {
    action: DecisionAction;
    winnerVariantId: string | null;
    retireVariantIds: string[];
    nextBatchSize: number;
    rationale: string[];
  };
  narrative?: string;
}

export interface FollowUpStep {
  delayDays: number;
  body: string;
}

export const TRAIT_DIMENSIONS = {
  tone: ["conversational", "formal", "consultative", "challenger", "warm"],
  format: ["plain_short", "story", "bulleted", "question_led", "observation_led"],
  angle: ["pain", "outcome", "proof", "trigger_event", "insight", "offer"],
  cta: ["call", "demo", "resource", "reply_question", "referral_ask"],
  personalization: ["merge_fields", "segment_specific", "researched"],
  subjectStyle: ["question", "company_name", "benefit", "curiosity", "plain"],
  length: ["short", "medium", "long"],
} as const;
export type TraitDimension = keyof typeof TRAIT_DIMENSIONS;
export type EmailTraits = { [K in TraitDimension]?: (typeof TRAIT_DIMENSIONS)[K][number] };

export type VariantStatus = "draft" | "active" | "retired" | "champion";

/**
 * Immutable copy versions. Subject/body never change after insert — a
 * revision is a new row with parentVariantId set and version + 1.
 */
export const variants = pgTable(
  "variants",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    /** Stable label like "V1", "V2" across the campaign. */
    label: text("label").notNull(),
    version: integer("version").notNull().default(1),
    parentVariantId: uuid("parent_variant_id"),
    angle: text("angle").notNull(),
    cta: text("cta").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    rationale: text("rationale").notNull(),
    /** Knowledge source refs that informed this copy. */
    sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
    /** Follow-up steps sent in the same thread if there's no reply. */
    followUps: jsonb("follow_ups").$type<FollowUpStep[]>().notNull().default([]),
    /** What kind of email this is: tone, format, CTA... feeds the memory layer. */
    traits: jsonb("traits").$type<EmailTraits>().notNull().default({}),
    contentHash: text("content_hash").notNull(),
    status: text("status").$type<VariantStatus>().notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("variants_campaign_label_version_uq").on(t.campaignId, t.label, t.version)],
);

/** Which variants compete in which experiment. */
export const experimentArms = pgTable(
  "experiment_arms",
  {
    id: id(),
    experimentId: uuid("experiment_id").notNull().references(() => experiments.id),
    variantId: uuid("variant_id").notNull().references(() => variants.id),
    role: text("role").$type<"champion" | "challenger" | "explore">().notNull(),
  },
  (t) => [uniqueIndex("experiment_arms_uq").on(t.experimentId, t.variantId)],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    prospectId: uuid("prospect_id").notNull().references(() => prospects.id),
    status: text("status").$type<"eligible" | "assigned" | "excluded">().notNull().default("eligible"),
    exclusionReason: text("exclusion_reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("enrollments_uq").on(t.campaignId, t.prospectId)],
);

/** "enrolled" = handed to the Pegasusbound platform, which sends on its own schedule. */
export type AssignmentStatus = "queued" | "sending" | "enrolled" | "sent" | "failed" | "skipped";

/**
 * One prospect -> one variant, ever, per campaign. The unique index on
 * (campaign_id, prospect_id) makes double-sends structurally impossible.
 */
export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    experimentId: uuid("experiment_id").notNull().references(() => experiments.id),
    variantId: uuid("variant_id").notNull().references(() => variants.id),
    prospectId: uuid("prospect_id").notNull().references(() => prospects.id),
    status: text("status").$type<AssignmentStatus>().notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    providerMessageId: text("provider_message_id"),
    mailboxId: uuid("mailbox_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Why the sequence ended early (replied, bounced, unsubscribed, paused...). */
    sequenceStoppedReason: text("sequence_stopped_reason"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("assignments_campaign_prospect_uq").on(t.campaignId, t.prospectId),
    uniqueIndex("assignments_idem_uq").on(t.idempotencyKey),
    index("assignments_experiment_idx").on(t.experimentId),
    index("assignments_provider_msg_idx").on(t.providerMessageId),
  ],
);

export type MessageEventType =
  | "sent"
  | "delivered"
  | "bounced"
  | "opened"
  | "replied"
  | "unsubscribed"
  | "complained";

/** Raw provider events. Append-only; never rewritten. */
export const messageEvents = pgTable(
  "message_events",
  {
    id: id(),
    assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
    type: text("type").$type<MessageEventType>().notNull(),
    providerEventId: text("provider_event_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("message_events_provider_uq").on(t.providerEventId),
    index("message_events_assignment_idx").on(t.assignmentId),
  ],
);

export const replies = pgTable(
  "replies",
  {
    id: id(),
    assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
    eventId: uuid("event_id").notNull().references(() => messageEvents.id),
    fromEmail: text("from_email").notNull(),
    body: text("body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("replies_event_uq").on(t.eventId)],
);

export const REPLY_CATEGORIES = [
  "positive_interest",
  "meeting_requested",
  "referral",
  "not_now",
  "objection_pricing",
  "objection_relevance",
  "objection_timing",
  "objection_existing_solution",
  "negative",
  "unsubscribe",
  "auto_reply",
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];
export const POSITIVE_CATEGORIES: ReplyCategory[] = ["positive_interest", "meeting_requested", "referral"];
export const NEGATIVE_CATEGORIES: ReplyCategory[] = ["negative", "unsubscribe"];

/** Append-only interpretations. The latest row per reply wins; history is kept. */
export const replyClassifications = pgTable(
  "reply_classifications",
  {
    id: id(),
    replyId: uuid("reply_id").notNull().references(() => replies.id),
    category: text("category").$type<ReplyCategory>().notNull(),
    confidence: real("confidence").notNull(),
    objection: text("objection"),
    reason: text("reason").notNull(),
    classifier: text("classifier").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    /** Set when a human confirmed or overrode the category. */
    reviewedBy: text("reviewed_by"),
    createdAt: createdAt(),
  },
  (t) => [index("reply_classifications_reply_idx").on(t.replyId)],
);

/** Every email actually sent, per sequence step, exactly as rendered. */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: id(),
    assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
    step: integer("step").notNull(),
    mailboxId: uuid("mailbox_id"),
    fromEmail: text("from_email"),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** RFC 5322 Message-ID we set; replies reference it. */
    messageIdHeader: text("message_id_header").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("outbound_assignment_step_uq").on(t.assignmentId, t.step),
    uniqueIndex("outbound_provider_uq").on(t.providerMessageId),
    index("outbound_sent_idx").on(t.sentAt),
  ],
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    fromName: text("from_name").notNull(),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull().default(465),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull().default(993),
    username: text("username").notNull(),
    /** Encrypted app password. */
    secret: text("secret").notNull(),
    dailyLimit: integer("daily_limit").notNull().default(40),
    warmup: boolean("warmup").notNull().default(true),
    warmupStartedAt: timestamp("warmup_started_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").$type<"active" | "paused" | "error">().notNull().default("active"),
    statusDetail: text("status_detail"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastUid: integer("last_uid"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mailboxes_org_email_uq").on(t.orgId, t.email)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export type MemoryKind = "principle" | "guideline" | "avoid";
export type MemorySource = "experiment" | "brain" | "document" | "human";

/**
 * The unified memory layer: durable, cross-campaign knowledge about what
 * works. Trait statistics are computed live from the evidence; these rows
 * hold the distilled principles, Company Brain guidelines and human notes.
 */
export const memoryEntries = pgTable(
  "memory_entries",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind").$type<MemoryKind>().notNull(),
    source: text("source").$type<MemorySource>().notNull(),
    text: text("text").notNull(),
    /** Segment the entry applies to, e.g. persona; "*" = everywhere. */
    scope: text("scope").notNull().default("*"),
    dimension: text("dimension"),
    value: text("value"),
    confidence: text("confidence").$type<"preliminary" | "moderate" | "strong">().notNull().default("preliminary"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    /** Dedupe key so recomputation updates instead of duplicating. */
    key: text("key").notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memory_org_key_uq").on(t.orgId, t.key)],
);

export const meetings = pgTable("meetings", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
  bookedAt: timestamp("booked_at", { withTimezone: true }).notNull(),
  status: text("status").$type<"requested" | "booked" | "held" | "no_show">().notNull().default("requested"),
  qualified: boolean("qualified"),
  notes: text("notes"),
  source: text("source").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("meetings_assignment_uq").on(t.assignmentId)]);

export const learningRecords = pgTable("learning_records", {
  id: id(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  experimentId: uuid("experiment_id").notNull().references(() => experiments.id),
  observation: text("observation").notNull(),
  scope: text("scope").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  confidence: text("confidence").$type<"preliminary" | "moderate" | "strong">().notNull(),
  limitations: text("limitations").notNull(),
  nextAction: text("next_action").notNull(),
  brainWriteStatus: text("brain_write_status").$type<"pending" | "written" | "unsupported" | "failed">().notNull().default("pending"),
  brainRef: text("brain_ref"),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    campaignId: uuid("campaign_id"),
    actor: text("actor").$type<"user" | "engine" | "system">().notNull(),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_campaign_idx").on(t.campaignId)],
);

// ---------------------------------------------------------------------------
// Durable jobs (Postgres-backed queue; survives restarts and deploys)
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Optional dedupe key: only one pending job per key. */
    dedupeKey: text("dedupe_key"),
    status: text("status").$type<"pending" | "running" | "done" | "failed">().notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_pending_uq").on(t.dedupeKey).where(sql`status = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// Pegasusbound platform bridge
// ---------------------------------------------------------------------------

/** Per-organization credential the engine uses to act on the platform in the background. */
export const orgCredentials = pgTable("org_credentials", {
  orgId: uuid("org_id").primaryKey(),
  /** Encrypted platform API key (scoped to campaigns/contacts/inbox). */
  secret: text("secret").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

/** Each experiment arm runs as one native platform campaign. */
export const platformCampaigns = pgTable(
  "platform_campaigns",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    experimentId: uuid("experiment_id").notNull().references(() => experiments.id),
    variantId: uuid("variant_id").notNull().references(() => variants.id),
    platformCampaignId: text("platform_campaign_id").notNull(),
    /** Platform step ids in sequence order: index 0 = step 1. */
    stepIds: jsonb("step_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<"active" | "stopped">().notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("platform_campaigns_arm_uq").on(t.experimentId, t.variantId),
    uniqueIndex("platform_campaigns_remote_uq").on(t.platformCampaignId),
  ],
);

// ---------------------------------------------------------------------------
// Uploaded knowledge (for workspaces without a Company Brain, or alongside one)
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = ["icp", "product", "case_study", "email_samples", "brand", "competitors", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** What the engine understood from one document. */
export interface DocumentAnalysis {
  summary: string;
  icp: string[];
  personas: string[];
  painPoints: string[];
  valueProps: string[];
  proofPoints: { claim: string; sourceRef: string }[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  objections: string[];
  competitors: string[];
  /** Writing style learned from sample emails. */
  voice: VoiceProfile | null;
  /** Up to a few example emails (subject + body) kept as few-shot references. */
  examples: { subject: string; body: string; sourceRef: string }[];
}

export interface VoiceProfile {
  tone: string;
  avgWords: number;
  greeting: string | null;
  signoff: string | null;
  usesQuestionsInCta: boolean;
  usesFirstName: boolean;
  rules: string[];
}

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count"),
    text: text("text").notNull().default(""),
    status: text("status").$type<"processing" | "ready" | "failed">().notNull().default("processing"),
    statusDetail: text("status_detail"),
    analysis: jsonb("analysis").$type<DocumentAnalysis>(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("knowledge_documents_org_idx").on(t.orgId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("knowledge_chunks_org_idx").on(t.orgId), uniqueIndex("knowledge_chunks_doc_idx_uq").on(t.documentId, t.idx)],
);

/** The workspace's merged understanding layer, rebuilt whenever documents change. */
export interface ContextProfile {
  summary: string;
  icp: string[];
  personas: string[];
  painPoints: string[];
  valueProps: string[];
  proofPoints: { claim: string; sourceRef: string }[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  objections: string[];
  competitors: string[];
  voice: VoiceProfile | null;
  examples: { subject: string; body: string; sourceRef: string }[];
  documents: { id: string; filename: string; kind: DocumentKind }[];
}

export const orgContext = pgTable("org_context", {
  orgId: uuid("org_id").primaryKey(),
  profile: jsonb("profile").$type<ContextProfile>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
