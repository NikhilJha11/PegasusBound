-- Data backfill; nothing to reverse (the crm_task_types table itself is
-- dropped by 000024's down migration). Removing only the seeded defaults here
-- would risk deleting user-renamed types, so this is intentionally a no-op.
SELECT 1;
