ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_email_account_id_fkey;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_email_account_id_fkey
    FOREIGN KEY (email_account_id) REFERENCES email_accounts (id);

ALTER TABLE warmup_admin_actions DROP CONSTRAINT IF EXISTS warmup_admin_actions_email_account_id_fkey;
ALTER TABLE warmup_admin_actions
    ADD CONSTRAINT warmup_admin_actions_email_account_id_fkey
    FOREIGN KEY (email_account_id) REFERENCES email_accounts (id);
