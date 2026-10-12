DROP INDEX IF EXISTS idx_crm_tasks_org_type;
ALTER TABLE crm_tasks DROP CONSTRAINT IF EXISTS crm_tasks_type_chk;
ALTER TABLE crm_tasks DROP COLUMN IF EXISTS type;
