-- Task type: a typed categorisation of CRM tasks (what kind of work the task
-- represents) distinct from contact "categories". Drives the campaign
-- "create task" action (e.g. a Call task) and lets the tasks list group/filter
-- by type. 'general' is the neutral default for existing rows and any task
-- created without an explicit type.
ALTER TABLE crm_tasks
    ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'general';

ALTER TABLE crm_tasks
    ADD CONSTRAINT crm_tasks_type_chk CHECK (type IN ('general', 'call', 'email', 'meeting'));

CREATE INDEX IF NOT EXISTS idx_crm_tasks_org_type ON crm_tasks (organization_id, type);
