DROP INDEX IF EXISTS idx_campaign_progress_in_flight;

ALTER TABLE campaign_contact_progress
    DROP COLUMN IF EXISTS dispatch_task_id,
    DROP COLUMN IF EXISTS dispatched_at;

-- task_status keeps 'skipped_duplicate': Postgres cannot drop an enum value.
