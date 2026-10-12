-- Pool link: a self-hosted Pegasusbound instance connects its mailboxes to the
-- hosted warmup pool. The same binary serves both roles, so both halves of
-- the schema ship together.
--
-- Cloud side (the instance that runs the pool):
--   pool_link_codes      device-code handshake, approved by a signed-in member
--   pool_link_instances  linked self-hosted instances and their token hashes
--   pool_link_mailboxes  enrolled mailboxes; the email_accounts row is the
--                        real mailbox, this marks it warmup-only and remembers
--                        which remote mailbox it mirrors
--
-- Self-hosted side (the instance that owns the mailboxes):
--   cloud_link           the single link to the cloud, token sealed with
--                        CREDENTIALS_ENCRYPTION_KEY
--   cloud_link_mailboxes local mailboxes warmed by the cloud instead of the
--                        local pool

CREATE TABLE IF NOT EXISTS pool_link_codes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code_hash text NOT NULL UNIQUE,
    user_code        text NOT NULL UNIQUE,
    instance_name    text NOT NULL,
    instance_url     text NOT NULL DEFAULT '',
    instance_version text NOT NULL DEFAULT '',
    status           text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'claimed', 'denied')),
    organization_id  uuid REFERENCES organizations (id) ON DELETE CASCADE,
    approved_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    instance_id      uuid,
    -- Held only between approval and the instance's next poll, then cleared.
    instance_token   text,
    expires_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pool_link_codes_expires ON pool_link_codes (expires_at);

CREATE TABLE IF NOT EXISTS pool_link_instances (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name            text NOT NULL,
    url             text NOT NULL DEFAULT '',
    version         text NOT NULL DEFAULT '',
    token_hash      text NOT NULL UNIQUE,
    created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,
    revoked_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pool_link_instances_org ON pool_link_instances (organization_id);

CREATE TABLE IF NOT EXISTS pool_link_mailboxes (
    instance_id      uuid NOT NULL REFERENCES pool_link_instances (id) ON DELETE CASCADE,
    remote_id        uuid NOT NULL,
    email_account_id uuid NOT NULL UNIQUE REFERENCES email_accounts (id) ON DELETE CASCADE,
    enrolled_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (instance_id, remote_id)
);

CREATE TABLE IF NOT EXISTS cloud_link (
    id                boolean PRIMARY KEY DEFAULT true CHECK (id),
    cloud_url         text NOT NULL,
    instance_id       uuid NOT NULL,
    token             text NOT NULL,
    organization_name text NOT NULL DEFAULT '',
    connected_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    connected_at      timestamptz NOT NULL DEFAULT now(),
    last_synced_at    timestamptz,
    last_error        text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cloud_link_mailboxes (
    email_account_id uuid PRIMARY KEY REFERENCES email_accounts (id) ON DELETE CASCADE,
    remote_id        uuid NOT NULL,
    enrolled_at      timestamptz NOT NULL DEFAULT now()
);

-- The paid tier for linked instances: unlimited enrolled mailboxes. Operators
-- attach the Stripe price through the admin plans page; without one the plan
-- is invisible and the free allowance applies.
INSERT INTO plans (
    id, name, max_contacts, daily_emails, ai_generation, account_limit,
    price, discounted_price, duration_id, savings, public,
    dedicated_workers, daily_campaign_limit,
    max_campaigns, max_active_campaigns, max_team_members, max_email_accounts,
    monthly_credits
) VALUES (
    '00000000-0000-0000-0000-000000000002', 'Self-hosted pool', 100, 20, false, 0,
    15, 15, '00000000-0000-0000-0000-0000000000d1', 0, false,
    0, 20,
    2, 1, 5, NULL,
    0
)
ON CONFLICT (id) DO NOTHING;
