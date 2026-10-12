-- Provisioning templates gained a "draft" concept in the admin UI (save a
-- template without it becoming usable / auto-provision-eligible). Persist it
-- so the flag survives a round-trip instead of being silently dropped.
ALTER TABLE public.provisioning_templates
    ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;
