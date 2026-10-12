-- Server-side click-link store. Emails carry only an opaque ticket
-- (https://<tracking-domain>/c/<id>); the tracking service resolves the
-- destination here via the backend internal API. Nothing to forge: the
-- destination never travels inside the link, which closes the open-redirect
-- hole without any signing secret.
CREATE TABLE tracked_links (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    destination text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Cleanup horizon scans + per-task lookups (analytics/debugging).
CREATE INDEX idx_tracked_links_created ON tracked_links (created_at);
CREATE INDEX idx_tracked_links_task ON tracked_links (task_id);
