DROP INDEX IF EXISTS public.idx_campaign_progress_delivery_evidence;
ALTER TABLE public.contacts
    DROP COLUMN IF EXISTS verification_confidence,
    DROP COLUMN IF EXISTS verification_evidence_at;
DROP TABLE IF EXISTS public.contact_verification_evidence;
