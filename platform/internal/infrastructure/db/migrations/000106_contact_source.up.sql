-- First-touch source attribution for contacts (issue #255).
--
-- Existing rows are stamped 'unknown' rather than guessed at: nothing in the
-- database records how they arrived. first_seen_at is the row's creation
-- time, which is a fact, not a guess.
ALTER TABLE public.contacts
    ADD COLUMN source text NOT NULL DEFAULT 'unknown',
    ADD COLUMN source_detail text NOT NULL DEFAULT '',
    ADD COLUMN first_seen_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.contacts SET first_seen_at = created_at;

ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_source_check
    CHECK (source IN ('unknown', 'manual', 'campaign', 'import', 'sheet_sync', 'api', 'ai_assistant'));

COMMENT ON COLUMN public.contacts.source IS
    'First-touch origin of the contact; never rewritten once set.';
COMMENT ON COLUMN public.contacts.source_detail IS
    'Free-form detail for the source: the import file name, the campaign, the API key or the sheet.';

-- Category membership changes join the lifecycle events already carried by
-- contact_activities (contact_created, campaign_added, campaign_removed).
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'category_added';
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'category_removed';
