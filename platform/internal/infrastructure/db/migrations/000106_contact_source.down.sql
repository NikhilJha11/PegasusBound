-- Postgres cannot drop a single enum value, so 'category_added' and
-- 'category_removed' stay on the type; the rows that use them are removed.
DELETE FROM public.contact_activities WHERE activity_type IN ('category_added', 'category_removed');

ALTER TABLE public.contacts
    DROP CONSTRAINT IF EXISTS contacts_source_check,
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS source_detail,
    DROP COLUMN IF EXISTS first_seen_at;
