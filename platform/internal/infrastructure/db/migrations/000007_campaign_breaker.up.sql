-- Campaign deliverability circuit breaker.
--
-- The auto-pause logic computed only a cumulative bounce rate and never read
-- PauseComplaintRateThreshold, so complaint-rate protection was dead. Record
-- per-contact complaint events alongside bounces so the breaker can enforce a
-- complaint-rate threshold and compute rolling rates from the same table.

ALTER TABLE public.campaign_contact_progress
    ADD COLUMN complained_at timestamp with time zone;
