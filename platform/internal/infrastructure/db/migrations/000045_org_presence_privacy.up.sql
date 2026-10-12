-- Org-wide team presence privacy controls. The realtime service reads these on
-- channel join: presence_show_online gates whether members are tracked at all
-- (who is online), and presence_show_activity gates the viewing/editing detail.
-- Both default to true so existing workspaces keep current behavior; a workspace
-- admin can turn either off from workspace settings for privacy.
ALTER TABLE organizations
    ADD COLUMN presence_show_online   BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN presence_show_activity BOOLEAN NOT NULL DEFAULT true;
