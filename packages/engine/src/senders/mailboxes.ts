import { and, eq, gte, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { DB } from "../db/client";
import { mailboxes, messageEvents, outboundMessages } from "../db/schema";
import { decryptJson, encryptJson } from "../crypto";
import { startOfUtcDay } from "../orchestrator/util";
import type { Mailbox } from "./types";

export interface MailboxInput {
  email: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
  password: string;
  dailyLimit: number;
  warmup: boolean;
}

export const mailboxPassword = (mb: Mailbox) => decryptJson<{ password: string }>(mb.secret)!.password;

export function smtpTransport(mb: Mailbox) {
  return nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpPort === 465,
    auth: { user: mb.username, pass: mailboxPassword(mb) },
  });
}

export function imapClient(mb: Mailbox) {
  return new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: mb.imapPort === 993,
    auth: { user: mb.username, pass: mailboxPassword(mb) },
    logger: false,
  });
}

/** Verify SMTP and IMAP credentials without sending anything. */
export async function testMailbox(mb: Mailbox): Promise<{ ok: boolean; detail: string }> {
  try {
    await smtpTransport(mb).verify();
  } catch (err) {
    return { ok: false, detail: `SMTP: ${err instanceof Error ? err.message : String(err)}` };
  }
  const imap = imapClient(mb);
  try {
    await imap.connect();
    await imap.logout();
  } catch (err) {
    return { ok: false, detail: `IMAP: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, detail: "SMTP and IMAP verified" };
}

export async function saveMailbox(db: DB, orgId: string, input: MailboxInput) {
  const values = {
    orgId,
    email: input.email.toLowerCase(),
    fromName: input.fromName,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    username: input.username,
    secret: encryptJson({ password: input.password }),
    dailyLimit: input.dailyLimit,
    warmup: input.warmup,
  };
  const [row] = await db
    .insert(mailboxes)
    .values(values)
    .onConflictDoUpdate({ target: [mailboxes.orgId, mailboxes.email], set: { ...values, status: "active", statusDetail: null } })
    .returning();
  const result = await testMailbox(row!);
  await db
    .update(mailboxes)
    .set({ status: result.ok ? "active" : "error", statusDetail: result.detail })
    .where(eq(mailboxes.id, row!.id));
  return { mailbox: row!, ...result };
}

/** Warm-up ramp: start at 5/day, +2/day, up to the mailbox's daily limit. */
export function capacityFor(mb: Mailbox, now = new Date()) {
  if (!mb.warmup) return mb.dailyLimit;
  const days = Math.floor((now.getTime() - mb.warmupStartedAt.getTime()) / 86400000);
  return Math.min(mb.dailyLimit, 5 + 2 * Math.max(0, days));
}

export async function sentTodayByMailbox(db: DB) {
  const rows = await db
    .select({ mailboxId: outboundMessages.mailboxId, n: sql<number>`count(*)` })
    .from(outboundMessages)
    .where(gte(outboundMessages.sentAt, startOfUtcDay()))
    .groupBy(outboundMessages.mailboxId);
  return new Map(rows.map((r) => [r.mailboxId, Number(r.n)]));
}

/** Choose the active mailbox with the most remaining capacity today (or the pinned one). */
export async function pickMailbox(db: DB, orgId: string, pinnedId?: string | null): Promise<Mailbox | null> {
  const all = await db.select().from(mailboxes).where(and(eq(mailboxes.orgId, orgId), eq(mailboxes.status, "active")));
  const sent = await sentTodayByMailbox(db);
  const withRoom = all
    .map((mb) => ({ mb, room: capacityFor(mb) - (sent.get(mb.id) ?? 0) }))
    .filter((x) => x.room > 0);
  if (pinnedId) return withRoom.find((x) => x.mb.id === pinnedId)?.mb ?? null;
  withRoom.sort((a, b) => b.room - a.room);
  return withRoom[0]?.mb ?? null;
}

/** Pause any mailbox whose recent bounce rate signals a reputation problem. */
export async function checkMailboxHealth(db: DB) {
  const since = new Date(Date.now() - 7 * 86400000);
  const rows = await db
    .select({
      mailboxId: outboundMessages.mailboxId,
      sent: sql<number>`count(distinct ${outboundMessages.id})`,
      bounced: sql<number>`count(distinct ${messageEvents.id}) filter (where ${messageEvents.type} = 'bounced')`,
    })
    .from(outboundMessages)
    .leftJoin(messageEvents, eq(messageEvents.assignmentId, outboundMessages.assignmentId))
    .where(and(gte(outboundMessages.sentAt, since), sql`${outboundMessages.mailboxId} is not null`))
    .groupBy(outboundMessages.mailboxId);
  for (const r of rows) {
    const sent = Number(r.sent);
    const bounced = Number(r.bounced);
    if (sent >= 20 && bounced / sent > 0.08) {
      await db
        .update(mailboxes)
        .set({ status: "paused", statusDetail: `Paused: ${bounced}/${sent} bounced in the last 7 days` })
        .where(and(eq(mailboxes.id, r.mailboxId!), eq(mailboxes.status, "active")));
    }
  }
}
