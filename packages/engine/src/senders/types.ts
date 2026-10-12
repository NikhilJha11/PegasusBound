import type { DB } from "../db/client";
import type { EmailTraits, MessageEventType, mailboxes } from "../db/schema";

export type Mailbox = typeof mailboxes.$inferSelect;

export interface OutboundEmail {
  /** Providers MUST dedupe on this: a retried send with the same key must not send twice. */
  idempotencyKey: string;
  to: string;
  fromName: string;
  subject: string;
  body: string;
  step: number;
  /** RFC 5322 Message-ID for this email, e.g. <iole.{assignment}.{step}@domain>. */
  messageIdHeader: string;
  /** Threading for follow-ups. */
  inReplyTo?: string;
  references?: string[];
  headers: Record<string, string>;
  mailbox: Mailbox | null;
  /** Opaque metadata for simulation/correlation. */
  meta: { campaignId: string; variantId: string; contentHash: string; assignmentId: string; traits?: EmailTraits; persona?: string };
}

export interface SendResult {
  providerMessageId: string;
  fromEmail?: string;
}

/** Normalised inbound event, produced by webhooks or polling. */
export interface ProviderEvent {
  providerMessageId: string;
  providerEventId: string;
  type: MessageEventType;
  occurredAt: Date;
  replyBody?: string;
  replySubject?: string;
  fromEmail?: string;
  payload?: Record<string, unknown>;
}

export interface Sender {
  name: string;
  /** Whether this sender needs connected mailboxes. */
  usesMailboxes: boolean;
  send(db: DB, email: OutboundEmail): Promise<SendResult>;
  /** Parse a provider webhook body into normalised events. */
  parseWebhook?(body: unknown, headers: Record<string, string>): ProviderEvent[];
  /** Pull new events (e.g. IMAP replies and bounces). */
  poll?(db: DB): Promise<ProviderEvent[]>;
}
