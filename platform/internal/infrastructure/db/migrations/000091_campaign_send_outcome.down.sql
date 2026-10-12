ALTER TABLE campaign_contact_progress
    DROP COLUMN IF EXISTS failure_reason,
    DROP COLUMN IF EXISTS failed_at,
    DROP COLUMN IF EXISTS send_attempts;
