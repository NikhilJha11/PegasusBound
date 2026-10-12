-- Verification provenance: who produced a contact's verdict and how specific
-- it is, so an external or manual verdict is never overwritten by the in-house
-- probe, and a campaign that runs out of deliverable leads pauses for the
-- owner instead of quietly finishing.
--
-- verification_source: '' (never checked) | 'probe' (in-house SMTP probe) |
--   'provider' (a paid backend on the org's integration) | 'imported' (a
--   status column brought in with the list or through the API) | 'manual'
--   (a member marked it deliverable). Only 'manual' is never re-checked.
-- verification_provider: which backend or vocabulary produced the verdict.
-- verification_sub_status: catch_all | disposable | role | spamtrap |
--   mailbox_full | no_mx | syntax | undisclosed | ''.

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS verification_source text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verification_provider text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verification_sub_status text NOT NULL DEFAULT '';

ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_verification_source_check
    CHECK (verification_source IN ('', 'probe', 'provider', 'imported', 'manual'));

-- Every verdict recorded so far came from the probe.
UPDATE public.contacts
SET verification_source = 'probe', verification_provider = 'builtin'
WHERE verification_checked_at IS NOT NULL AND verification_source = '';

-- The scheduler now re-checks aged verdicts too, so the pending index covers
-- the check timestamp itself (NULLs first) instead of only never-checked rows.
DROP INDEX IF EXISTS public.idx_contacts_verification_pending;
CREATE INDEX IF NOT EXISTS idx_contacts_verification_pending
    ON public.contacts (verification_checked_at NULLS FIRST, created_at)
    WHERE verification_source <> 'manual';

-- A campaign whose remaining leads were all refused by verification parks
-- here, resumable once the owner re-verifies or marks them deliverable.
ALTER TYPE public.campaign_status ADD VALUE IF NOT EXISTS 'paused_undeliverable';
