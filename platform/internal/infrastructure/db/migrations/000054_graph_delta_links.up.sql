-- graph_delta_links: the consumer's per-mailbox, per-folder Microsoft Graph
-- delta cursor. Unlike the Gmail history id (a small monotonic int stored on
-- email_history_ids), a Graph deltaLink is a long opaque URL, so it is stored
-- per (email, folder) rather than in the email row. The worker relays each new
-- deltaLink via the GRAPH_DELTA_UPDATE job event; the disposable worker never
-- owns this cursor.
CREATE TABLE public.email_delta_links (
    user_id uuid NOT NULL,
    email_id uuid NOT NULL,
    folder text NOT NULL,
    delta_link text NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, email_id, folder)
);
