-- organization_id is the tenant key that scopes recipient suppression, the
-- entitlement gate, and every org-scoped read. A NULL there removed the check
-- instead of stopping the send (issue #168), so the four core tenant tables
-- lose the NULL state entirely: legacy rows are attributed to their owner's
-- organization first, then the column goes NOT NULL.

-- Every orgless row still has a real owner (user_id is a NOT NULL FK to users).
-- A user who lost, or never got, an organization gets a recovery workspace so
-- their rows stay reachable instead of being deleted to satisfy the constraint.
DO $$
DECLARE
    orphan_user uuid;
    orphan_name text;
    new_org     uuid;
BEGIN
    FOR orphan_user IN
        SELECT DISTINCT o.uid
        FROM (
            SELECT user_id AS uid FROM campaigns      WHERE organization_id IS NULL
            UNION SELECT user_id FROM contacts        WHERE organization_id IS NULL
            UNION SELECT user_id FROM email_accounts  WHERE organization_id IS NULL
        ) o
        WHERE NOT EXISTS (
            SELECT 1 FROM organization_members m WHERE m.user_id = o.uid
        )
    LOOP
        SELECT COALESCE(NULLIF(u.first_name, '') || '''s Organization', 'My Organization')
          INTO orphan_name
          FROM users u WHERE u.id = orphan_user;

        INSERT INTO organizations (id, name, slug, owner_user_id)
        VALUES (gen_random_uuid(), orphan_name,
                'recovered-' || replace(orphan_user::text, '-', ''), orphan_user)
        RETURNING id INTO new_org;

        -- permissions = -1 is the stored form of models.AllPermissions (0xFFFF)
        -- in the smallint column, matching what organizationService.Create writes.
        INSERT INTO organization_members (organization_id, user_id, role, permissions, accepted_at)
        VALUES (new_org, orphan_user, 'owner', -1, NOW());

        INSERT INTO crm_task_types (organization_id, name, color, position)
        VALUES (new_org, 'Call', '#8b5cf6', 0),
               (new_org, 'Email', '#0ea5e9', 1),
               (new_org, 'Meeting', '#f59e0b', 2)
        ON CONFLICT (organization_id, name) DO NOTHING;
    END LOOP;
END $$;

-- Deterministic attribution: the organization the user owns, else their
-- earliest-joined membership. Campaigns go first so contacts can prefer the
-- organization of a campaign they are already a lead of.
UPDATE campaigns c
SET organization_id = (
    SELECT m.organization_id
    FROM organization_members m
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = c.user_id
    ORDER BY (o.owner_user_id = c.user_id) DESC, m.invited_at, m.organization_id
    LIMIT 1
)
WHERE c.organization_id IS NULL;

UPDATE contacts c
SET organization_id = COALESCE(
    (
        SELECT ca.organization_id
        FROM campaign_leads cl
        JOIN campaigns ca ON ca.id = cl.campaign_id
        WHERE cl.contact_id = c.id AND ca.organization_id IS NOT NULL
        ORDER BY ca.created_at, ca.id
        LIMIT 1
    ),
    (
        SELECT m.organization_id
        FROM organization_members m
        LEFT JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = c.user_id
        ORDER BY (o.owner_user_id = c.user_id) DESC, m.invited_at, m.organization_id
        LIMIT 1
    )
)
WHERE c.organization_id IS NULL;

UPDATE email_accounts e
SET organization_id = (
    SELECT m.organization_id
    FROM organization_members m
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = e.user_id
    ORDER BY (o.owner_user_id = e.user_id) DESC, m.invited_at, m.organization_id
    LIMIT 1
)
WHERE e.organization_id IS NULL;

-- A step belongs to whatever organization owns its campaign; campaign_id is a
-- NOT NULL FK, so this always resolves once campaigns are backfilled.
UPDATE sequences s
SET organization_id = c.organization_id
FROM campaigns c
WHERE c.id = s.campaign_id AND s.organization_id IS NULL;

-- A live session with no workspace is how an orgless row was created in the
-- first place: every org-scoped write it reached ran with no tenant. Point
-- existing sessions at the same organization a fresh login would now pick.
UPDATE sessions s
SET current_organization_id = (
    SELECT m.organization_id
    FROM organization_members m
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = s.user_id AND o.deletion_scheduled_for IS NULL
    ORDER BY (o.owner_user_id = s.user_id) DESC, m.invited_at, m.organization_id
    LIMIT 1
)
WHERE s.current_organization_id IS NULL;

ALTER TABLE campaigns      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE contacts       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE email_accounts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sequences      ALTER COLUMN organization_id SET NOT NULL;
