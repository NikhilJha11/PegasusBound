import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

export interface RawVariantCounts {
  variantId: string;
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  positive: number;
  negative: number;
  unsubscribed: number;
  complained: number;
  pendingReview: number;
  meetings: number;
}

/**
 * Counts per variant, pooled across every experiment in the campaign.
 * Pooling is valid because variants are immutable. Uses only the latest
 * classification per reply; replies awaiting human review don't count as
 * positive until confirmed.
 */
export async function variantCounts(db: DB, campaignId: string | null, orgId: string | null = null): Promise<Map<string, RawVariantCounts>> {
  const res = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (rc.reply_id) rc.reply_id, rc.category, rc.needs_review
      FROM reply_classifications rc
      ORDER BY rc.reply_id, rc.created_at DESC
    ),
    per_assignment AS (
      SELECT a.id, a.variant_id, a.status,
        bool_or(e.type IN ('delivered', 'replied', 'opened')) AS delivered,
        bool_or(e.type = 'bounced') AS bounced,
        bool_or(e.type = 'unsubscribed') AS unsub_event,
        bool_or(e.type = 'complained') AS complained
      FROM assignments a
      LEFT JOIN message_events e ON e.assignment_id = a.id
      WHERE (${campaignId}::uuid IS NULL OR a.campaign_id = ${campaignId}::uuid)
        AND (${orgId}::uuid IS NULL OR a.campaign_id IN (SELECT c.id FROM campaigns c WHERE c.org_id = ${orgId}::uuid))
      GROUP BY a.id
    ),
    per_reply AS (
      SELECT r.assignment_id,
        bool_or(l.category IS NOT NULL AND l.category <> 'auto_reply') AS human_reply,
        bool_or(l.category IN ('positive_interest', 'meeting_requested', 'referral') AND NOT l.needs_review) AS positive,
        bool_or(l.category IN ('negative', 'unsubscribe') AND NOT l.needs_review) AS negative,
        bool_or(l.category = 'unsubscribe') AS unsub_reply,
        bool_or(l.needs_review) AS pending
      FROM replies r JOIN latest l ON l.reply_id = r.id
      GROUP BY r.assignment_id
    )
    SELECT pa.variant_id,
      count(*) FILTER (WHERE pa.status = 'sent') AS sent,
      count(*) FILTER (WHERE pa.delivered AND NOT coalesce(pa.bounced, false)) AS delivered,
      count(*) FILTER (WHERE pa.bounced) AS bounced,
      count(*) FILTER (WHERE pr.human_reply) AS replies,
      count(*) FILTER (WHERE pr.positive) AS positive,
      count(*) FILTER (WHERE pr.negative) AS negative,
      count(*) FILTER (WHERE pa.unsub_event OR pr.unsub_reply) AS unsubscribed,
      count(*) FILTER (WHERE pa.complained) AS complained,
      count(*) FILTER (WHERE pr.pending) AS pending_review,
      (SELECT count(*) FROM meetings m JOIN assignments a2 ON a2.id = m.assignment_id WHERE a2.variant_id = pa.variant_id) AS meetings
    FROM per_assignment pa
    LEFT JOIN per_reply pr ON pr.assignment_id = pa.id
    GROUP BY pa.variant_id`);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows;
  const out = new Map<string, RawVariantCounts>();
  for (const r of rows) {
    out.set(r.variant_id as string, {
      variantId: r.variant_id as string,
      sent: Number(r.sent),
      delivered: Number(r.delivered),
      bounced: Number(r.bounced),
      replies: Number(r.replies),
      positive: Number(r.positive),
      negative: Number(r.negative),
      unsubscribed: Number(r.unsubscribed),
      complained: Number(r.complained),
      pendingReview: Number(r.pending_review),
      meetings: Number(r.meetings),
    });
  }
  return out;
}

export const emptyCounts = (variantId: string): RawVariantCounts => ({
  variantId,
  sent: 0,
  delivered: 0,
  bounced: 0,
  replies: 0,
  positive: 0,
  negative: 0,
  unsubscribed: 0,
  complained: 0,
  pendingReview: 0,
  meetings: 0,
});
