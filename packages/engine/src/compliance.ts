import crypto from "node:crypto";
import { env } from "./env";
import type { CampaignBrief } from "./db/schema";

const sign = (data: string) => crypto.createHmac("sha256", env().APP_SECRET).update(`unsub:${data}`).digest("base64url").slice(0, 22);

/** Unforgeable per-recipient unsubscribe token. */
export function unsubscribeToken(assignmentId: string) {
  return `${Buffer.from(assignmentId).toString("base64url")}.${sign(assignmentId)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [idPart, sig] = token.split(".");
  if (!idPart || !sig) return null;
  const id = Buffer.from(idPart, "base64url").toString("utf8");
  const expected = sign(id);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export const unsubscribeUrl = (assignmentId: string) => `${env().APP_URL}/u/${unsubscribeToken(assignmentId)}`;

/** Plain-text footer required for commercial email (CAN-SPAM, PECR/GDPR). */
export function complianceFooter(brief: CampaignBrief, assignmentId: string) {
  const who = [brief.senderCompany, brief.senderAddress].filter(Boolean).join(", ");
  return `\n\n--\n${who}\nIf this isn't relevant, reply "no thanks" or unsubscribe here: ${unsubscribeUrl(assignmentId)}`;
}

/** RFC 2369 + RFC 8058 one-click unsubscribe headers (required by Gmail/Yahoo bulk sender rules). */
export function listUnsubscribeHeaders(assignmentId: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${env().APP_URL}/api/unsubscribe/${unsubscribeToken(assignmentId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
