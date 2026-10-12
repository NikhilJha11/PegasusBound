-- Durable hand-off of platform events to the Pegasusbound intelligence service.
-- The backend/consumer append rows here (same transaction-less best effort as
-- other record sinks); the intelligence service claims them with SKIP LOCKED
-- and deletes them once processed.
CREATE TABLE IF NOT EXISTS intelligence_event_outbox (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID        NOT NULL,
    event_type      TEXT        NOT NULL,
    data            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_until   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS intelligence_event_outbox_pending_idx
    ON intelligence_event_outbox (id) WHERE claimed_until IS NULL;
