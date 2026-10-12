-- Evidence ledger for address verification. A probe sees an address once;
-- the platform sees what happens after every send. Each row is one observed
-- fact about a contact's mailbox (a clean delivery, a human open, a reply, a
-- bounce naming the recipient) and the contact's verdict is scored from the
-- ledger plus the last probe or provider verdict. Silence (no open, no
-- reply) is never recorded: it is not evidence of anything.

CREATE TABLE IF NOT EXISTS public.contact_verification_evidence (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN (
                  'delivered', 'opened', 'clicked', 'replied', 'auto_replied',
                  'bounced_recipient', 'bounced_other')),
    -- ref makes an observation idempotent: the campaign step it came from,
    -- or the message id of the bounce or reply.
    ref         text NOT NULL DEFAULT '',
    detail      text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT NOW(),
    created_at  timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, kind, ref)
);

CREATE INDEX IF NOT EXISTS idx_contact_verification_evidence_contact
    ON public.contact_verification_evidence (contact_id, observed_at DESC);

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS verification_confidence smallint NOT NULL DEFAULT 0,
    -- The most recent positive observation (a delivery, an open, a reply),
    -- which is what excuses an address from being re-checked.
    ADD COLUMN IF NOT EXISTS verification_evidence_at timestamptz;

-- The delivery-evidence job scans sent steps that never bounced.
CREATE INDEX IF NOT EXISTS idx_campaign_progress_delivery_evidence
    ON public.campaign_contact_progress (sent_at)
    WHERE sent_at IS NOT NULL AND bounced_at IS NULL;
