-- Cold mailbox lifecycle (issue #157).
--
-- Cold sending ran until a hard health band tripped, with nothing in between:
-- a mailbox showing early fatigue either kept sending at full volume or was
-- quarantined. There was no way to pull one out of cold rotation to recover on
-- warmup traffic alone and put it back once it had.
--
-- This is a different axis from risk_band, which decides WHICH worker and IP
-- host a mailbox. This decides whether the mailbox is offered to cold sending
-- at all; a resting mailbox is still a clean-band mailbox.
--
-- Defaults to 'active' so no existing mailbox changes behaviour on deploy.
ALTER TABLE public.email_accounts
    ADD COLUMN send_lifecycle text NOT NULL DEFAULT 'active',
    -- When the current state was entered, so a rest has a measurable length
    -- and promotion can require a probation window rather than a sweep tick.
    ADD COLUMN send_lifecycle_since timestamptz,
    ADD COLUMN send_lifecycle_reason text,
    -- When the rebalancer last looked at this mailbox. Ordering candidates by
    -- it guarantees rotation: ordering by send_lifecycle_since alone means
    -- every never-moved mailbox sorts equal-first, so on an install with more
    -- than one page of them the same page is re-examined forever and the rest
    -- are never evaluated at all.
    ADD COLUMN send_lifecycle_checked_at timestamptz;

ALTER TABLE public.email_accounts
    ADD CONSTRAINT email_accounts_send_lifecycle_check
    CHECK (send_lifecycle IN ('warming', 'active', 'resting', 'reserve'));

-- Cold sender resolution filters on this every scheduling pass.
CREATE INDEX idx_email_accounts_send_lifecycle
    ON public.email_accounts USING btree (send_lifecycle)
    WHERE send_lifecycle <> 'active';

-- The rebalancer's rotation order.
CREATE INDEX idx_email_accounts_lifecycle_checked
    ON public.email_accounts USING btree (send_lifecycle_checked_at NULLS FIRST);

COMMENT ON COLUMN public.email_accounts.send_lifecycle IS
    'Whether the mailbox is offered to cold sending: warming | active | resting | reserve. Orthogonal to risk_band, which decides which worker hosts it.';
