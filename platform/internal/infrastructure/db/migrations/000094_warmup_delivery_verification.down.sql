DROP INDEX IF EXISTS public.idx_warmup_tokens_pending_recipient;
DROP INDEX IF EXISTS public.idx_warmup_tokens_sent_message_id;

ALTER TABLE public.warmup_tokens
    DROP COLUMN IF EXISTS subject,
    DROP COLUMN IF EXISTS sent_message_id;
