ALTER TABLE public.email_accounts
    DROP CONSTRAINT IF EXISTS email_accounts_send_lifecycle_check;

ALTER TABLE public.email_accounts
    ADD CONSTRAINT email_accounts_send_lifecycle_check
    CHECK (send_lifecycle IN ('warming', 'active', 'resting', 'reserve'));

COMMENT ON COLUMN public.email_accounts.send_lifecycle IS
    'Whether the mailbox is offered to cold sending: warming | active | resting | reserve. Orthogonal to risk_band, which decides which worker hosts it.';
