-- Cloud-managed mailboxes for linked instances.
--
-- managed = true means the cloud holds the mailbox's only credential (the
-- OAuth grant came through Pegasusbound's app) and the instance sends with
-- short-lived access tokens it fetches from the cloud. Unenrolling such a
-- mailbox removes the link, not the workspace mailbox.

ALTER TABLE pool_link_mailboxes ADD COLUMN IF NOT EXISTS managed boolean NOT NULL DEFAULT false;
ALTER TABLE pool_link_mailboxes ADD COLUMN IF NOT EXISTS last_token_at timestamptz;

ALTER TABLE cloud_link_mailboxes ADD COLUMN IF NOT EXISTS managed boolean NOT NULL DEFAULT false;
