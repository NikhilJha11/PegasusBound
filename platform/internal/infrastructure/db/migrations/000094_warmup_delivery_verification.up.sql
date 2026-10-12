-- Warmup verification can no longer assume the custom verify header survives
-- delivery. Microsoft Graph drops custom headers in transit and re-stamps the
-- Message-ID, so warmup sent from an Outlook mailbox reached every recipient
-- unmarked: the token was never consumed and the mail landed in the
-- recipient's unibox as ordinary mail.
--
-- sent_message_id records the Message-ID the provider actually put on the
-- wire (read back from the created draft on Graph, our own elsewhere), and
-- subject records what was sent, so the recipient can still resolve the token
-- from an inbound message that carries no header.

ALTER TABLE public.warmup_tokens
    ADD COLUMN IF NOT EXISTS sent_message_id text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '';

-- Recipient-side lookup by the delivered Message-ID.
CREATE INDEX IF NOT EXISTS idx_warmup_tokens_sent_message_id
    ON public.warmup_tokens (sent_message_id)
    WHERE consumed_at IS NULL AND sent_message_id <> '';

-- Recipient-side fallback: the pending tokens for one recipient, newest first.
CREATE INDEX IF NOT EXISTS idx_warmup_tokens_pending_recipient
    ON public.warmup_tokens (recipient_account_id, sender_account_id, created_at DESC)
    WHERE consumed_at IS NULL;
