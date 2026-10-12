-- Make task types user-managed instead of a fixed enum. Each organization
-- keeps its own set of task types (name + colour) in crm_task_types. A task
-- stores the chosen type's NAME in crm_tasks.type (free text), so deleting a
-- type never orphans existing tasks — they keep their label and fall back to a
-- neutral colour in the UI.
CREATE TABLE IF NOT EXISTS crm_task_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#94a3b8',
    position integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_crm_task_types_org ON crm_task_types (organization_id, position);

-- Retire the fixed-enum gate so custom type names are allowed; an empty string
-- now means "no type".
ALTER TABLE crm_tasks DROP CONSTRAINT IF EXISTS crm_tasks_type_chk;
ALTER TABLE crm_tasks ALTER COLUMN type SET DEFAULT '';
