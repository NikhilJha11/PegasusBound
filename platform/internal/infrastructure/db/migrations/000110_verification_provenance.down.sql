-- Postgres cannot drop a single enum value, so 'paused_undeliverable' stays on
-- campaign_status. Campaigns parked in it return to a plain pause first.
UPDATE campaigns SET status = 'paused' WHERE status = 'paused_undeliverable';

DROP INDEX IF EXISTS public.idx_contacts_verification_pending;
CREATE INDEX IF NOT EXISTS idx_contacts_verification_pending
    ON public.contacts (verification_checked_at)
    WHERE verification_status = 'unknown' AND verification_checked_at IS NULL;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_verification_source_check;
ALTER TABLE public.contacts
    DROP COLUMN IF EXISTS verification_source,
    DROP COLUMN IF EXISTS verification_provider,
    DROP COLUMN IF EXISTS verification_sub_status;
