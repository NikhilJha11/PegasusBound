-- Drop the unreachable 'warming' cold-rotation state (issue #244).
--
-- Nothing ever set it: the rebalancer only writes active and resting, and the
-- owner's hold is 'reserve'. A mailbox still ramping is expressed by the cold
-- ramp ceiling, not by a lifecycle state. Fold any row back to active first so
-- the tightened check cannot fail on legacy data.
UPDATE public.email_accounts
   SET send_lifecycle = 'active',
       send_lifecycle_since = NULL,
       send_lifecycle_reason = NULL
 WHERE send_lifecycle = 'warming';

ALTER TABLE public.email_accounts
    DROP CONSTRAINT IF EXISTS email_accounts_send_lifecycle_check;

ALTER TABLE public.email_accounts
    ADD CONSTRAINT email_accounts_send_lifecycle_check
    CHECK (send_lifecycle IN ('active', 'resting', 'reserve'));

COMMENT ON COLUMN public.email_accounts.send_lifecycle IS
    'Whether the mailbox is offered to cold sending: active | resting | reserve. Orthogonal to risk_band, which decides which worker hosts it.';
