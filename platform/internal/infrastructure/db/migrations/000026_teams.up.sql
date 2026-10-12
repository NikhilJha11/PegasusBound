-- Teams: a named, colour-tagged grouping of an organization's members. Teams are
-- created from existing organization members (the team_members junction only ever
-- references users who already belong to the org via organization_members). The
-- (organization_id, name) uniqueness keeps team names distinct within an org.
CREATE TABLE IF NOT EXISTS teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#94a3b8',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_org ON teams (organization_id);

-- team_members: junction between a team and the org users that belong to it. Both
-- sides cascade-delete so removing a team or a user cleans up memberships.
CREATE TABLE IF NOT EXISTS team_members (
    team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);
