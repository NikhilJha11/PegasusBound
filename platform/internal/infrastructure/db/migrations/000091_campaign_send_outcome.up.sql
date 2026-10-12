-- Worker send outcomes close the loop on campaign sends. A step is stamped
-- sent_at when the control plane hands it to a worker; when the worker reports
-- that the send failed, sent_at is cleared again so the step is retried, and the
-- failure is kept here so the lead can be shown as failed once retries run out.
ALTER TABLE campaign_contact_progress
    ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_at timestamptz,
    ADD COLUMN IF NOT EXISTS failure_reason text NOT NULL DEFAULT '';
