DROP INDEX IF EXISTS idx_automations_inbound_token;
ALTER TABLE automations DROP COLUMN IF EXISTS inbound_token;
