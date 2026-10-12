-- Warmup analytics correctness + content-segment fix.
--
--  1. per-provider placement (B3): warmup_spam_reports records which recipient
--     provider/domain a warmup message was filtered into spam at, so placement
--     can be segmented (Gmail-spam vs Outlook-inbox) instead of a single flat
--     rate. Both columns default '' so existing rows and callers that don't yet
--     supply the dimension keep working.
--
--  2. content-segment fix (B11): warmup_tag was bound to a random RID(8) at
--     account creation and then used as the warmup content segment, so the
--     segment-aware AI bank never matched and every mailbox silently drew only
--     generic content. Default it to '' going forward; it is now a real,
--     user/admin-settable content segment (slug). Existing random tags simply
--     fall back to generic content, which is the safe behaviour, so no backfill
--     is required.

ALTER TABLE public.warmup_spam_reports
    ADD COLUMN recipient_provider text DEFAULT ''::text NOT NULL,
    ADD COLUMN recipient_domain text DEFAULT ''::text NOT NULL;

CREATE INDEX idx_warmup_spam_reports_provider
    ON public.warmup_spam_reports USING btree (report_type, recipient_provider, created_at DESC);

ALTER TABLE public.email_accounts ALTER COLUMN warmup_tag SET DEFAULT ''::text;
