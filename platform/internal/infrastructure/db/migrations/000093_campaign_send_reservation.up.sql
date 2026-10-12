-- A campaign step is reserved BEFORE its SEND_EMAIL goes on the bus, so a crash
-- or a failed progress write between dispatch and the sent_at stamp can no
-- longer look like "never attempted" and send the same email a second time.
-- dispatched_at is the durable attempt record; sent_at stays the timing stamp
-- routing paces follow-ups from. dispatch_task_id ties the reservation to the
-- task whose worker result resolves it.
ALTER TABLE campaign_contact_progress
    ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
    ADD COLUMN IF NOT EXISTS dispatch_task_id uuid;

-- Every already-sent step was, by definition, dispatched.
UPDATE campaign_contact_progress
SET dispatched_at = sent_at
WHERE sent_at IS NOT NULL AND dispatched_at IS NULL;

-- The reclaimer sweeps only reservations with no outcome yet; keep that scan
-- off the full table.
CREATE INDEX IF NOT EXISTS idx_campaign_progress_in_flight
    ON campaign_contact_progress (dispatched_at)
    WHERE sent_at IS NULL AND dispatched_at IS NOT NULL;

-- A tick that finds the pair it selected already reserved by another tick ends
-- here instead of sending a duplicate.
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'skipped_duplicate';
