ALTER TABLE public.email_accounts ALTER COLUMN warmup_tag DROP DEFAULT;

DROP INDEX IF EXISTS public.idx_warmup_spam_reports_provider;

ALTER TABLE public.warmup_spam_reports DROP COLUMN IF EXISTS recipient_domain;
ALTER TABLE public.warmup_spam_reports DROP COLUMN IF EXISTS recipient_provider;
