DROP INDEX IF EXISTS public.idx_email_accounts_lifecycle_checked;
DROP INDEX IF EXISTS public.idx_email_accounts_send_lifecycle;

ALTER TABLE public.email_accounts
    DROP CONSTRAINT IF EXISTS email_accounts_send_lifecycle_check;

ALTER TABLE public.email_accounts
    DROP COLUMN IF EXISTS send_lifecycle_checked_at,
    DROP COLUMN IF EXISTS send_lifecycle_reason,
    DROP COLUMN IF EXISTS send_lifecycle_since,
    DROP COLUMN IF EXISTS send_lifecycle;
