DROP INDEX IF EXISTS idx_deals_campaign_status_value;
DROP INDEX IF EXISTS idx_deals_stage_status_value;
DROP INDEX IF EXISTS idx_deals_org_assigned_status;

ALTER TABLE deals
    DROP CONSTRAINT IF EXISTS deals_source_mailbox_id_fkey,
    DROP CONSTRAINT IF EXISTS deals_campaign_id_fkey;

ALTER TABLE deals
    DROP COLUMN IF EXISTS source_mailbox_id,
    DROP COLUMN IF EXISTS campaign_id;
