ALTER TABLE cloud_link_mailboxes DROP COLUMN IF EXISTS managed;

ALTER TABLE pool_link_mailboxes DROP COLUMN IF EXISTS last_token_at;
ALTER TABLE pool_link_mailboxes DROP COLUMN IF EXISTS managed;
