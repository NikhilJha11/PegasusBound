-- Account-takeover signals at login (issue #149).
--
-- Sign-ins were only ever remembered as a Redis device fingerprint with a TTL,
-- so nothing durable recorded WHERE an account was accessed from. Without that
-- history there is nothing to compare a new sign-in against, and a session
-- opened from the other side of the world looks exactly like any other.
--
-- Bounded per user by the sweep in internal/app/authrisk: this is a comparison
-- window, not an audit log, and the audit log already exists separately.
CREATE TABLE public.login_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ip inet,
    user_agent text,
    city text,
    country_code text,
    -- Coordinates are the city centroid MaxMind reports, which is what makes
    -- an implied-speed comparison possible at all.
    latitude double precision,
    longitude double precision,
    -- Flagged records that this sign-in itself looked anomalous, so repeated
    -- flags are visible without recomputing the whole history.
    flagged boolean NOT NULL DEFAULT false,
    flag_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The comparison reads the user's most recent sign-in.
CREATE INDEX idx_login_history_user_recent
    ON public.login_history USING btree (user_id, created_at DESC);

COMMENT ON TABLE public.login_history IS
    'Recent sign-in locations per user, for impossible-travel and new-country checks. A bounded comparison window, not an audit log.';
