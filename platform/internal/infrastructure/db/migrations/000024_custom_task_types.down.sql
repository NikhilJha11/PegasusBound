ALTER TABLE crm_tasks ALTER COLUMN type SET DEFAULT 'general';
UPDATE crm_tasks SET type = 'general' WHERE type IS NULL OR type NOT IN ('general', 'call', 'email', 'meeting');
ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_type_chk CHECK (type IN ('general', 'call', 'email', 'meeting'));

DROP INDEX IF EXISTS idx_crm_task_types_org;
DROP TABLE IF EXISTS crm_task_types;
