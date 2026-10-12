ALTER TABLE organizations
    DROP COLUMN IF EXISTS presence_show_activity,
    DROP COLUMN IF EXISTS presence_show_online;
