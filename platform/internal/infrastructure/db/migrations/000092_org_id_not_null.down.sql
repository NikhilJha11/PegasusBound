-- Only the constraint is reversible. The backfill (and any recovery workspace
-- it created) is one-way: nothing records which rows were NULL beforehand.
ALTER TABLE campaigns      ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE contacts       ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE email_accounts ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE sequences      ALTER COLUMN organization_id DROP NOT NULL;
