-- Members can hold several roles at once. Assignments live in a join table;
-- organization_members.permissions stays the denormalized effective snapshot
-- (the bitwise OR of every assigned role's permissions) so all readers (Go
-- middleware, realtime auth) remain JOIN-free. Owner is unaffected: it is a
-- membership status with no role rows and keeps its full mask.
CREATE TABLE organization_member_roles (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id, role_id)
);
CREATE INDEX idx_member_roles_role ON organization_member_roles (role_id);
CREATE INDEX idx_member_roles_member ON organization_member_roles (organization_id, user_id);

-- Invitations can likewise carry several roles.
CREATE TABLE organization_invitation_roles (
    invitation_id uuid NOT NULL REFERENCES organization_invitations(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (invitation_id, role_id)
);
CREATE INDEX idx_invitation_roles_invite ON organization_invitation_roles (invitation_id);

-- Backfill: each member's single role_id becomes one assignment row.
INSERT INTO organization_member_roles (organization_id, user_id, role_id)
SELECT organization_id, user_id, role_id
FROM organization_members
WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO organization_invitation_roles (invitation_id, role_id)
SELECT id, role_id FROM organization_invitations WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Recompute every non-owner member's effective permission snapshot.
UPDATE organization_members om
SET permissions = COALESCE((
    SELECT bit_or(r.permissions)
    FROM organization_member_roles mr
    JOIN organization_roles r ON r.id = mr.role_id
    WHERE mr.organization_id = om.organization_id AND mr.user_id = om.user_id
), 0)
WHERE om.role <> 'owner';
