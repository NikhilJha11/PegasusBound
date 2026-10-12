import { eq, inArray } from "drizzle-orm";
import { simpleParser, type ParsedMail } from "mailparser";
import type { DB } from "../db/client";
import { mailboxes, outboundMessages } from "../db/schema";
import { imapClient, smtpTransport } from "./mailboxes";
import type { Mailbox, ProviderEvent, Sender } from "./types";

/**
 * Real sending through the user's own mailboxes (Google Workspace, Microsoft
 * 365, any SMTP/IMAP host with an app password). Replies and bounces are
 * read back over IMAP and matched by Message-ID.
 */

const OUR_ID_RE = /<?iole\.[0-9a-f-]{36}\.\d+@[^>\s"]+>?/gi;
const normId = (id: string) => (id.startsWith("<") ? id : `<${id}>`).toLowerCase();

export function isBounce(mail: Pick<ParsedMail, "from" | "subject" | "headers">) {
  const from = mail.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const ct = String(mail.headers?.get("content-type") ?? "");
  return (
    /mailer-daemon|postmaster/.test(from) ||
    /report-type=delivery-status/i.test(ct) ||
    /(undeliver|delivery status notification|delivery failure|returned mail|mail delivery failed)/i.test(mail.subject ?? "")
  );
}

/** Strip quoted history so only the new reply text remains. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()) || /^From: .+/.test(line.trim())) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Every Message-ID of ours referenced anywhere in the message. */
export function referencedIds(mail: Pick<ParsedMail, "inReplyTo" | "references">, raw: string): string[] {
  const ids = new Set<string>();
  if (mail.inReplyTo) ids.add(normId(mail.inReplyTo));
  const refs = Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [];
  for (const r of refs) ids.add(normId(r));
  for (const m of raw.match(OUR_ID_RE) ?? []) ids.add(normId(m));
  return [...ids].filter((id) => id.startsWith("<iole."));
}

async function pollMailbox(db: DB, mb: Mailbox): Promise<ProviderEvent[]> {
  const client = imapClient(mb);
  const events: ProviderEvent[] = [];
  await client.connect();
  let maxUid = mb.lastUid ?? 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const range = mb.lastUid ? `${mb.lastUid + 1}:*` : undefined;
      const since = new Date(Date.now() - 14 * 86400000);
      const iter = range
        ? client.fetch(range, { uid: true, source: true }, { uid: true })
        : client.fetch({ since }, { uid: true, source: true }, { uid: true });
      for await (const msg of iter) {
        if (!msg.source || msg.uid <= (mb.lastUid ?? 0)) continue;
        maxUid = Math.max(maxUid, msg.uid);
        const raw = msg.source.toString("utf8");
        const mail = await simpleParser(msg.source);
        const ids = referencedIds(mail, raw);
        if (ids.length === 0) continue;
        const [om] = await db.select().from(outboundMessages).where(inArray(outboundMessages.messageIdHeader, ids)).limit(1);
        if (!om) continue;
        const occurredAt = mail.date ?? new Date();
        if (isBounce(mail)) {
          events.push({ providerMessageId: om.providerMessageId, providerEventId: `imap:${mb.id}:${msg.uid}`, type: "bounced", occurredAt });
        } else {
          events.push({
            providerMessageId: om.providerMessageId,
            providerEventId: `imap:${mb.id}:${msg.uid}`,
            type: "replied",
            occurredAt,
            replyBody: stripQuoted(mail.text ?? "") || (mail.text ?? "").slice(0, 4000),
            replySubject: mail.subject,
            fromEmail: mail.from?.value?.[0]?.address?.toLowerCase(),
            payload: { autoSubmitted: String(mail.headers.get("auto-submitted") ?? "") },
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  await db.update(mailboxes).set({ lastUid: maxUid || mb.lastUid, lastPolledAt: new Date() }).where(eq(mailboxes.id, mb.id));
  return events;
}

export const smtpSender: Sender = {
  name: "smtp",
  usesMailboxes: true,
  async send(_db, email) {
    const mb = email.mailbox;
    if (!mb) throw new Error("No mailbox with remaining capacity");
    await smtpTransport(mb).sendMail({
      from: { name: email.fromName || mb.fromName, address: mb.email },
      to: email.to,
      subject: email.subject,
      text: email.body,
      messageId: email.messageIdHeader,
      inReplyTo: email.inReplyTo,
      references: email.references,
      headers: email.headers,
    });
    return { providerMessageId: email.messageIdHeader, fromEmail: mb.email };
  },
  async poll(db) {
    const active = await db.select().from(mailboxes).where(inArray(mailboxes.status, ["active", "paused"]));
    const all: ProviderEvent[] = [];
    for (const mb of active) {
      try {
        all.push(...(await pollMailbox(db, mb)));
      } catch (err) {
        await db
          .update(mailboxes)
          .set({ statusDetail: `IMAP poll failed: ${err instanceof Error ? err.message : String(err)}`, lastPolledAt: new Date() })
          .where(eq(mailboxes.id, mb.id));
      }
    }
    return all;
  },
};
