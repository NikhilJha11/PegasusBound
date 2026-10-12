-- Disconnecting a mailbox failed for any mailbox that had ever been scheduled
-- work. tasks.email_account_id and warmup_admin_actions.email_account_id both
-- referenced email_accounts with no delete action, so the DELETE raised a
-- foreign key violation and the customer got a server error while the mailbox
-- stayed connected. Both rows describe work for, or enforcement against, one
-- mailbox and mean nothing once it is gone, so they go with it.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_email_account_id_fkey;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_email_account_id_fkey
    FOREIGN KEY (email_account_id) REFERENCES email_accounts (id) ON DELETE CASCADE;

ALTER TABLE warmup_admin_actions DROP CONSTRAINT IF EXISTS warmup_admin_actions_email_account_id_fkey;
ALTER TABLE warmup_admin_actions
    ADD CONSTRAINT warmup_admin_actions_email_account_id_fkey
    FOREIGN KEY (email_account_id) REFERENCES email_accounts (id) ON DELETE CASCADE;
