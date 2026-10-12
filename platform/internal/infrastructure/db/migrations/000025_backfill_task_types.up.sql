-- Backfill default task types for organizations that already existed before
-- types were seeded at creation. Idempotent: ON CONFLICT keeps it safe to run
-- alongside the org-creation seeding and never overwrites a renamed/recoloured
-- type. New orgs get these via the create path, not this migration.
INSERT INTO crm_task_types (organization_id, name, color, position)
SELECT o.id, d.name, d.color, d.position
FROM organizations o
CROSS JOIN (
    VALUES
        ('Call', '#8b5cf6', 0),
        ('Email', '#0ea5e9', 1),
        ('Meeting', '#f59e0b', 2)
) AS d(name, color, position)
ON CONFLICT (organization_id, name) DO NOTHING;
